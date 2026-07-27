// SPA readiness gate (v0.3).
//
// The problem this solves is not "the page is slow". It is that
// `waitForDomToSettle()` in dom.ts answers the question "has the DOM stopped
// changing", and on a client-rendered page that is the wrong question. An empty
// `<div id="root"></div>` with a fetch in flight is *perfectly quiescent*: no
// mutations fire, so the settle observer resolves after its idle window and the
// extractor faithfully converts an empty shell. Quiescence is not readiness.
//
// So this module waits for CONTENT rather than for silence. It samples a cheap
// content signal on an interval, requires that signal to be both above a floor
// and unchanged across consecutive samples, and refuses to call the page ready
// while an explicit loading indicator is still in the DOM. A MutationObserver
// only wakes the poller early; it is never the thing that decides.
//
// Cost on a static page is one measurement (`auto` mode short-circuits), which
// is why the gate is on by default.

import { getPrimaryContentRoot } from './dom';
import type { ExtractContext, SpaReadinessReport } from '../types';

// Elements whose presence means the page is still telling the user "wait".
// Kept deliberately narrow: a false positive here costs the whole wait budget on
// every page that happens to use the word "loading" in a class name, so class
// matching is anchored to whole words and the ARIA signals come first.
export const SPA_LOADING_SELECTORS: string[] = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  '[data-loading="true"]',
  '[data-state="loading"]',
  '[class~="skeleton"]',
  '[class~="loading"]',
  '[class~="spinner"]',
  '[class~="shimmer"]',
];

export interface ContentSignal {
  chars: number;
  blocks: number;
}

// Two numbers, both cheap. `chars` alone is fooled by a page that renders a long
// "Loading your workspace…" paragraph; `blocks` alone is fooled by a skeleton
// screen made of fifty empty divs. Requiring both to stabilise is what makes the
// pair worth measuring separately.
export const measureContentSignal = (): ContentSignal => {
  const root = getPrimaryContentRoot();
  const text = (root as HTMLElement).innerText || root.textContent || '';
  return {
    chars: text.replace(/\s+/g, ' ').trim().length,
    blocks: root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre, table, img').length,
  };
};

// Returns the selector that matched, not a boolean, so the report can name the
// thing that held the page up. A gate that times out without saying why is a gate
// nobody can tune.
export const findLoadingIndicator = (selectors: string[]): string | null => {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      // An indicator that is display:none is a leftover, not a live one. Checking
      // offsetParent is far cheaper than getComputedStyle and catches the common
      // case where a framework hides the spinner instead of removing it.
      if (el && ((el as HTMLElement).offsetParent !== null || el === document.body)) return sel;
    } catch {
      // A malformed selector must not take the extraction down with it.
    }
  }
  return null;
};

// True when the page looks client-rendered and therefore worth waiting for.
// This is the whole of `auto` mode: a server-rendered documentation page answers
// false here and pays exactly one measurement. Engaging when it should not have
// costs two poll intervals, so this side deliberately errs toward engaging.
const looksClientRendered = (signal: ContentSignal, minChars: number): boolean =>
  signal.chars < minChars ||
  signal.blocks === 0 ||
  findLoadingIndicator(SPA_LOADING_SELECTORS) !== null;

// The release condition, and the character floor is deliberately NOT in it.
//
// First version gated release on `chars >= spaMinContentChars` and the e2e test
// caught it: a genuinely short page that had finished rendering could never
// satisfy the floor, so the gate burned its entire budget and reported a timeout
// on a page that was ready in 200 ms. A floor is the right question for "should I
// start waiting" and the wrong one for "may I stop".
//
// What actually distinguishes rendered from rendering is: nothing is announcing
// itself as busy, and there is at least one real content element carrying text.
const hasRenderedContent = (signal: ContentSignal): boolean =>
  signal.blocks > 0 && signal.chars > 0;

export const waitForSpaContentReady = async (
  ctx: ExtractContext,
): Promise<SpaReadinessReport> => {
  const { config, progress } = ctx;
  const initial = measureContentSignal();

  const base: SpaReadinessReport = {
    engaged: false,
    outcome: 'disabled',
    waitedMs: 0,
    initialChars: initial.chars,
    finalChars: initial.chars,
    lastLoadingIndicator: null,
  };

  if (config.spaReadinessMode === 'off') return base;

  if (
    config.spaReadinessMode === 'auto' &&
    !looksClientRendered(initial, config.spaMinContentChars)
  ) {
    return { ...base, outcome: 'static' };
  }

  progress(
    'spa-wait',
    `waiting for client-rendered content (have ${initial.chars} chars, want >=${config.spaMinContentChars})`,
  );

  const startedAt = Date.now();
  const root = getPrimaryContentRoot();

  // The observer's only job is to cut a poll interval short when something
  // actually happens. Correctness never depends on it firing, which is what
  // keeps the gate honest on pages that mutate inside a shadow root or a
  // cross-origin iframe the observer cannot see.
  let wake: (() => void) | null = null;
  const observer = new MutationObserver(() => wake?.());
  try {
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  } catch {
    // Detached root: fall back to pure polling.
  }

  const nextTick = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(t);
        wake = null;
        resolve();
      };
    });

  let previous = initial;
  let stableRuns = 0;
  let lastIndicator: string | null = null;
  let outcome: SpaReadinessReport['outcome'] = 'timeout';

  try {
    while (Date.now() - startedAt < config.spaMaxWaitMs) {
      await nextTick(config.spaPollIntervalMs);

      const current = measureContentSignal();
      lastIndicator = findLoadingIndicator(SPA_LOADING_SELECTORS);

      const unchanged = current.chars === previous.chars && current.blocks === previous.blocks;

      // Less text means less confidence that what we are looking at is the final
      // render rather than a placeholder, so a thin page has to hold still for
      // twice as long before it is believed. This is where the character floor
      // earns its keep: as a confidence dial, not as a gate.
      const requiredStable =
        current.chars >= config.spaMinContentChars
          ? config.spaStableSamples
          : config.spaStableSamples * 2;

      // All three conditions, every time. Dropping the indicator check is what
      // lets the gate fire on a skeleton screen that happens to sit still.
      if (hasRenderedContent(current) && unchanged && !lastIndicator) {
        stableRuns += 1;
        if (stableRuns >= requiredStable) {
          outcome = 'ready';
          previous = current;
          break;
        }
      } else {
        stableRuns = 0;
      }
      previous = current;
    }
  } finally {
    observer.disconnect();
    wake = null;
  }

  const waitedMs = Date.now() - startedAt;
  const report: SpaReadinessReport = {
    engaged: true,
    outcome,
    waitedMs,
    initialChars: initial.chars,
    finalChars: previous.chars,
    lastLoadingIndicator: lastIndicator,
  };

  if (outcome === 'ready') {
    progress('spa-wait', `content ready after ${waitedMs}ms (${previous.chars} chars)`);
  } else {
    // A timeout is not a failure: the page may simply be an empty state. Say what
    // was seen and continue, because refusing to extract is strictly worse than
    // extracting a short page with a note attached.
    progress(
      'spa-wait',
      `gave up after ${waitedMs}ms with ${previous.chars} chars` +
        (lastIndicator ? ` (still showing ${lastIndicator})` : ''),
      'warn',
    );
  }
  return report;
};
