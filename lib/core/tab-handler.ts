// Tab & dropdown machinery: discovery, safe clicking, panel capture with
// content-delta fallbacks, URL drift protection.
// Ported from Rev-032v2 prototype (Sections 26, 33-34 + URL drift from 24).

import { cleanBlock, sleep, withHardTimeout } from './utils';
import {
  classTokens,
  clickAndWait,
  composedParent,
  ensureElementInViewport,
  getButtonFallbackLabel,
  getButtonText,
  getNearestHeadingText,
  getPrimaryContentRoot,
  getVisibleText,
  isClickablyVisible,
  isClickableDropdownTrigger,
  isDiscoverablyVisible,
  isInsideDangerousNavigationArea,
  isInsideNonTabWidget,
  isMarkedSelected,
  isNonTabWidgetControl,
  isProbablyUnsafeTabButton,
  isSkippable,
  isVisible,
  queryAllDeep,
  resetComputedStyleCache,
  waitForDomToSettle,
} from './dom';
import { renderNode } from './html-to-md';
import { normalizeMarkdownPreserveCode } from './md-postprocess';
import type {
  ExtractContext,
  ExtractorState,
  ResolvedConfig,
  TabGroup,
  TabPanelCapture,
} from '../types';

// --- URL drift (Section 24) ---

export const isUrlDrifted = (state: ExtractorState): boolean => location.href !== state.initialUrl;

export const tryRestoreUrl = async (state: ExtractorState): Promise<boolean> => {
  if (!isUrlDrifted(state)) return true;
  try {
    if (history.length > state.initialHistoryLength) {
      // Strict growth since the last restore means the click pushed an entry
      // ABOVE ours during this run, so back() lands on our own page, pops the
      // entry (no Back-button pollution) and fires the popstate the site may
      // rely on.
      history.back();
      await sleep(300);
    } else {
      // No growth ⇒ replace-style drift (devsite/ai.google.dev): there is
      // nothing above ours to go back to — back() here steps out of the page
      // and destroys this content script mid-extraction (#10). replaceState
      // rewrites the address on the same document, where a navigation is
      // impossible, and restores the state snapshot taken at extraction
      // start, not the widget's. (Also the safe fallback at the 50-entry
      // history cap, where growth becomes invisible.)
      history.replaceState(state.initialHistoryState, '', state.initialUrl);
    }
  } catch {
    // Sandboxed frames refuse history access; rate-limited replaceState
    // throws SecurityError. Either way the drift stays and the caller aborts
    // tab capture gracefully.
  }
  // history.length never shrinks on back(), so growth is only meaningful
  // relative to the LAST restore: without this resync, one push-style restore
  // would lock every later replace-style drift into the back() branch — and
  // out of the page.
  state.initialHistoryLength = Math.max(state.initialHistoryLength, history.length);
  return !isUrlDrifted(state);
};

// --- Tab & dropdown discovery (Section 26) ---

export const getAllPotentialButtons = (
  root: Element,
  config: Pick<ResolvedConfig, 'traverseShadowDom'>,
): HTMLElement[] => {
  if (!config.traverseShadowDom) {
    return [...root.querySelectorAll<HTMLElement>('button, [role="tab"]')];
  }
  const seen = new Set<Element>();
  return [
    ...queryAllDeep(root, 'button', config.traverseShadowDom),
    ...queryAllDeep(root, '[role="tab"]', config.traverseShadowDom),
  ].filter((e) => {
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  }) as HTMLElement[];
};

// --- Tab classification (BL-19 round 2) ---
// A group is clicked only on POSITIVE evidence that it is a tab strip: a wrong
// click changes the reader's page (formatting toggled, a choice changed, a
// popover opened, a form sent), a missed tab costs hidden text in the export.
// Every rule below prefers the miss.

const TAB_TOGGLES = new Set(['tab', 'pill']);

// Declares itself a tab: role=tab, or Bootstrap data-bs-toggle / data-toggle =
// tab | pill. A bare `nav-pills` class does not: Bootstrap styles link bars
// with it too.
export const isExplicitTab = (b: Element): boolean =>
  (b.getAttribute('role') || '').toLowerCase() === 'tab' ||
  TAB_TOGGLES.has((b.getAttribute('data-bs-toggle') || b.getAttribute('data-toggle') || '').toLowerCase());

// Path 1: inside a role=tablist only its declared tabs are candidates. The
// close (×), add (+) and scroll buttons of closable or scrollable strips sit in
// the same tablist and are never clicked (D7); fewer than two declared tabs
// means no group.
export const getTabGroupButtons = (c: Element, config: ResolvedConfig): HTMLElement[] =>
  [...c.querySelectorAll<HTMLElement>('[role="tab"], button[data-bs-toggle], button[data-toggle]')].filter(
    (b) => {
      const t = getButtonText(b);
      return (
        isExplicitTab(b) &&
        Boolean(t) &&
        t.length >= config.minTabButtonTextLength &&
        t.length <= config.maxTabButtonTextLength &&
        isDiscoverablyVisible(b) &&
        !isProbablyUnsafeTabButton(b, config)
      );
    },
  );

// Slide pickers marked up as a tablist (APG carousel, Splide): a slide change
// would read as a revealed panel.
const isCarouselTablist = (tl: Element): boolean =>
  /\bslides?\b|carousel/i.test(tl.getAttribute('aria-label') || '') ||
  [...tl.querySelectorAll('[role="tab"]')].filter((t) => /^(?:go to )?slide\s*\d+/i.test(getButtonText(t)))
    .length >= 2;

// Container class tokens that name a tab STRIP on their own.
const STRONG_TAB_CONTAINER_TOKENS = new Set([
  'tablist', 'tab-list', 'tabs-list', 'tab-nav', 'tabs-nav', 'tab-bar', 'tabs-bar', 'tab-strip',
  'tab-menu', 'tabs-menu', 'tab-buttons', 'tab-links', 'tab-header', 'tab-headers', 'tabs-header', 'nav-tabs',
]);
// Generic names, kept for W3Schools' `div.tab > button.tablinks` (copied across
// the web); `tabs` also wraps whole widgets and layouts. Each counts only
// beside a second signal.
const WEAK_TAB_CONTAINER_TOKENS = new Set(['tab', 'tabs']);
// `tab`/`tabs` as one segment of a longer name (Sentry docs: `code-tabs-wrapper`)
// is a weak container too, unless a panel segment says it holds the panels.
const isTabContainerToken = (t: string): boolean =>
  STRONG_TAB_CONTAINER_TOKENS.has(t) ||
  WEAK_TAB_CONTAINER_TOKENS.has(t) ||
  (/(?:^|[-_])tabs?(?:$|[-_])/.test(t) && !/(?:^|[-_])(?:panes?|panels?|contents?|body)(?:$|[-_])/.test(t));
// Tab PANELS. Whole tokens: the old /\btab\b/ also matched tab-pane and
// tab-content and took a panel's own buttons for a tab strip (D2).
const TAB_PANEL_TOKENS = new Set([
  'tab-pane', 'tab-panel', 'tabpanel', 'tab-content', 'tab-body', 'tabcontent', 'tabs-panel', 'tabs-content',
  'tab-panes',
]);
// Containers of other button widgets: toolbars, toggle and radio groups (Radix
// ToggleGroup is role=group, D1), menus, Bootstrap button groups, pagination,
// steppers, segmented controls, filter chips, ratings.
const NON_TAB_GROUP_ROLES = new Set(['toolbar', 'radiogroup', 'group', 'menubar', 'menu', 'listbox', 'tree', 'grid']);
const NON_TAB_GROUP_TOKEN =
  /^(?:btn-group|btn-toolbar|button-group|toggle-group|segmented|segmented-control|pagination|pager|stepper|steps|wizard|chips|chip-group|chip-list|filter-group|filters|facets|rating|stars)$/;
// A button's own class naming it a tab trigger: W3Schools `tablinks`,
// `tab-btn`, `tabs__item`, jQuery UI `ui-tabs-tab`.
const isTabButtonToken = (t: string): boolean =>
  /^(?:tab|tablinks?|tab-?(?:link|btn|button|item|trigger|title|label|handle))$/.test(t) ||
  /^tabs?[-_]{1,2}(?:tab|item|link|btn|button|trigger)$/.test(t) ||
  /[-_]tab$/.test(t);

interface TabContainerEvidence {
  strong: boolean;
  weak: boolean;
  nonTabGroup: boolean;
}

// Parent, grandparent, great-grandparent: a strip wraps its buttons in one
// container plus at most the widget root; further up are unrelated layouts.
const readTabContainer = (p: Element): TabContainerEvidence => {
  const ev: TabContainerEvidence = { strong: false, weak: false, nonTabGroup: false };
  let n: Element | null = p;
  for (let i = 0; i < 3 && n; i++) {
    const role = (n.getAttribute('role') || '').toLowerCase();
    const toks = classTokens(n);
    if (NON_TAB_GROUP_ROLES.has(role) || toks.some((t) => NON_TAB_GROUP_TOKEN.test(t))) ev.nonTabGroup = true;
    if (
      role === 'tablist' ||
      n.hasAttribute('data-tabs') ||
      n.hasAttribute('data-tablist') ||
      toks.some((t) => STRONG_TAB_CONTAINER_TOKENS.has(t))
    ) {
      ev.strong = true;
    } else if (toks.some(isTabContainerToken)) {
      ev.weak = true;
    }
    n = n.parentElement;
  }
  return ev;
};

// Walking up from the group, a tab PANEL met before any strip marker means the
// buttons are that panel's content (Yes/No, Copy, an editor toolbar), D2. A
// nested strip names itself first, so inner tabs inside an outer panel pass.
const isInsideTabPanel = (p: Element): boolean => {
  let n: Element | null = p;
  for (let i = 0; i < 40 && n && n !== document.body; i++) {
    const role = (n.getAttribute('role') || '').toLowerCase();
    const toks = classTokens(n);
    if (role === 'tablist' || toks.some(isTabContainerToken)) return false;
    if (role === 'tabpanel' || toks.some((t) => TAB_PANEL_TOKENS.has(t))) return true;
    n = composedParent(n);
  }
  return false;
};

const distinctCount = (vals: Array<string | null>): number => new Set(vals.filter(Boolean)).size;

// Path 2 decision. A declared tab qualifies alone. Otherwise two points, at
// least one of which names a TAB (a container token, a tab class on every
// button, distinct data-tab values, aria-controls naming two distinct existing
// elements, data-state active|inactive) rather than only a selection
// (aria-selected on 2+, exactly one `.active`): segmented controls, pagination,
// filter chips and rating stars mark one item selected too (D3). `primary` and
// `bg-primary` are no signal at all: a dialog's Save button is btn-primary.
export const isTabLikeGroup = (bs: HTMLElement[], p: Element): boolean => {
  if (bs.some(isExplicitTab)) return true;
  const c = readTabContainer(p);
  let identity = c.strong ? 2 : c.weak ? 1 : 0;
  if (bs.every((b) => classTokens(b).some(isTabButtonToken))) identity++;
  if (distinctCount(bs.map((b) => b.getAttribute('data-tab'))) >= 2) identity++;
  const targets = bs.map((b) => {
    const id = (b.getAttribute('aria-controls') || '').trim().split(/\s+/)[0];
    return id && document.getElementById(id) ? id : null;
  });
  if (distinctCount(targets) >= 2) identity++;
  if (bs.some((b) => /^(?:active|inactive)$/.test(b.getAttribute('data-state') || ''))) identity++;
  const selection =
    bs.filter((b) => b.hasAttribute('aria-selected')).length >= 2 || bs.filter(isMarkedSelected).length === 1 ? 1 : 0;
  return identity >= 1 && identity + selection >= 2;
};

// Discovers every real tab/code group, even when labels repeat. Mintlify reuses
// Python|TypeScript across many code groups: dedup by labels alone kept only the
// first group, so the signature is labels + heading context + DOM position.
export const discoverTabGroups = (ctx: ExtractContext): TabGroup[] => {
  const { config } = ctx;
  const groups: TabGroup[] = [];
  const used = new Set<Element>();
  const root = getPrimaryContentRoot();
  const push = (c: Element, bs: HTMLElement[], reason: string): void => {
    const safe = bs.filter((b) => !isProbablyUnsafeTabButton(b, config));
    const ut = [...new Set(safe.map(getButtonText).filter(Boolean))];
    if (safe.length < 2 || safe.length > config.maxButtonsPerTabGroup || ut.length < 2) return;
    const labelsKey = ut.join('|').toLowerCase();
    if (!labelsKey) return;
    const headingCtx = getNearestHeadingText(c);
    const verticalPos = Math.round(c.getBoundingClientRect().top + window.scrollY);
    const sig = `${labelsKey}|${headingCtx}|${verticalPos}`;
    if (groups.some((g) => g.signature === sig)) return;
    safe.forEach((b) => used.add(b));
    groups.push({ container: c, buttons: safe, reason, signature: sig });
  };
  root.querySelectorAll('[role="tablist"]').forEach((tl) => {
    if (isInsideDangerousNavigationArea(tl) || isInsideNonTabWidget(tl) || isCarouselTablist(tl)) return;
    push(tl, getTabGroupButtons(tl, config), 'role=tablist');
  });
  const cands = getAllPotentialButtons(root, config).filter(
    (b) =>
      !used.has(b) &&
      // A tablist's members are Path 1's to judge; what it left are close, add
      // and scroll controls (D7).
      !b.closest('[role="tablist"]') &&
      getButtonText(b) &&
      isDiscoverablyVisible(b) &&
      !isProbablyUnsafeTabButton(b, config),
  );
  const byP = new Map<HTMLElement, HTMLElement[]>();
  cands.forEach((b) => {
    const p = b.parentElement;
    if (!p || isInsideDangerousNavigationArea(p)) return;
    if (!byP.has(p)) byP.set(p, []);
    byP.get(p)!.push(b);
  });
  byP.forEach((bs, p) => {
    const fb = bs.filter((b) => {
      const t = getButtonText(b);
      return t.length >= config.minTabButtonTextLength && t.length <= config.maxTabButtonTextLength;
    });
    if (fb.length < 2) return;
    // One toggle, radio, menu item, stepper or slide picker among the siblings
    // makes the whole row that widget, its unmarked buttons included.
    if ([...p.children].some((s) => s.matches('button, [role="tab"]') && isNonTabWidgetControl(s))) return;
    // #12 and T99: a same-parent group is clicked only on positive evidence.
    if (!fb.some(isExplicitTab) && (readTabContainer(p).nonTabGroup || isInsideTabPanel(p))) return;
    if (!isTabLikeGroup(fb, p)) return;
    push(p, fb, 'same-parent-buttons');
  });
  return groups.slice(0, config.maxTabGroups);
};

export const findTabRoot = (g: TabGroup): Element => {
  let root: Element = g.container;
  let cand: Element | null = root;
  for (let i = 0; i < 7; i++) {
    if (!cand || cand === document.body) break;
    const t = getVisibleText(cand);
    const bt = g.buttons.map(getButtonText).join(' ');
    if (cleanBlock(t.replace(bt, '')).length > 40) root = cand;
    cand = cand.parentElement;
  }
  return root || g.container;
};

export const getPathFromRoot = (r: Element, t: Element): number[] => {
  const p: number[] = [];
  let n: Element | null = t;
  while (n && n !== r) {
    const par: Element | null = n.parentElement;
    if (!par) return [];
    p.unshift([...par.children].indexOf(n));
    n = par;
  }
  return p;
};

export const getNodeByPath = (r: Element, p: number[]): Element | null => {
  let n: Element | null = r;
  for (const i of p) {
    if (!n || !n.children || !n.children[i]) return null;
    n = n.children[i];
  }
  return n;
};

export const getTextFromCloneExcludingGroup = (r: Element, gc: Element): string => {
  const cl = r.cloneNode(true) as Element;
  const p = getPathFromRoot(r, gc);
  const gcl = getNodeByPath(cl, p);
  if (gcl) gcl.remove();
  return cleanBlock((cl as HTMLElement).innerText || cl.textContent || '');
};

// Enhanced findControlledPanel for Radix/shadcn tabs.
// Level 1: aria-controls → getElementById → data-state or isVisible.
// Level 2: sibling search near tablist — NO isVisible gate on data-state path.
// The element a button's aria-controls names, visible or not.
export const resolveControlsTarget = (btn: Element): Element | null => {
  const controls = btn.getAttribute('aria-controls');
  if (!controls) return null;
  // Resolve the id NEAR the button before the document-wide lookup.
  // Real pages repeat panel ids across widgets (devsite gives EVERY group
  // id="tabpanel-python"), and getElementById always returns the first
  // match — so every group after the first captured group 1's panel and
  // its own content was lost as a "duplicate" (#11).
  const eid = window.CSS && CSS.escape ? CSS.escape(controls) : controls.replace(/"/g, '\\"');
  let scoped: Element | null = null;
  let scope: Element | null = btn.parentElement;
  for (let i = 0; i < 5 && scope && !scoped; i++) {
    // A malformed id can make the selector throw; that must degrade to the
    // document fallback, not kill the tab phase (panel review, T79).
    try {
      scoped = scope.querySelector(`[id="${eid}"]`);
    } catch {
      break;
    }
    scope = scope.parentElement;
  }
  return scoped || document.getElementById(controls);
};

export const findControlledPanel = (btn: Element): Element | null => {
  const panel = resolveControlsTarget(btn);
  if (panel) {
    const dataState = panel.getAttribute('data-state');
    if (dataState === 'active') return panel;
    if (isVisible(panel)) return panel;
  }
  const searchContexts: Element[] = [];
  const tablist = btn.closest('[role="tablist"]');
  if (tablist && tablist.parentElement) searchContexts.push(tablist.parentElement);
  if (btn.parentElement && btn.parentElement.parentElement) {
    const gp = btn.parentElement.parentElement;
    if (!searchContexts.includes(gp)) searchContexts.push(gp);
  }
  for (const ctx of searchContexts) {
    // data-state="active" — trust it without isVisible (Radix may still have
    // the hidden attr mid-transition).
    const activePanel = ctx.querySelector('[role="tabpanel"][data-state="active"]');
    if (activePanel) return activePanel;
    const visiblePanel = ctx.querySelector('[role="tabpanel"]:not([hidden])');
    if (visiblePanel && isVisible(visiblePanel)) return visiblePanel;
  }
  return null;
};

// Expanded panel search — 3 levels for balanced, 4 for aggressive.
export const findPanelAfterGroup = (
  g: TabGroup,
  root: Element,
  config: ResolvedConfig,
): Element | null => {
  const gc = g.container;

  if (config.tabPanelStrategy === 'balanced' || config.tabPanelStrategy === 'aggressive') {
    // Level 3: nextElementSibling of gc.
    let next = gc.nextElementSibling;
    while (next) {
      if (!isSkippable(next, config) && isVisible(next) && getVisibleText(next).length > 5) {
        return next;
      }
      next = next.nextElementSibling;
    }

    // Level 4: non-button CHILDREN of gc with visible text > 20 chars.
    // Covers shadcn/Radix where panel is inside the same container as buttons.
    for (const child of gc.children) {
      if (!child || child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === 'BUTTON' || child.getAttribute('role') === 'tab') continue;
      if (child.getAttribute('role') === 'tablist') continue;
      if (isSkippable(child, config)) continue;
      const ds = child.getAttribute('data-state');
      if (ds === 'active') return child;
      if (ds === 'inactive') continue;
      if (child.hasAttribute('hidden')) continue;
      if (!isVisible(child)) continue;
      const text = getVisibleText(child);
      if (text.length > 20) return child;
    }

    // Level 5: siblings of gc.parentElement that come after gc.
    // Covers cases where gc is the tablist and the panel is a sibling of gc's parent.
    if (gc.parentElement && gc.parentElement !== root && gc.parentElement !== document.body) {
      const parent = gc.parentElement;
      let foundGc = false;
      for (const sibling of parent.children) {
        if (sibling === gc) {
          foundGc = true;
          continue;
        }
        if (!foundGc) continue;
        if (sibling.tagName === 'BUTTON' || sibling.getAttribute('role') === 'tab') continue;
        if (isSkippable(sibling, config)) continue;
        const ds = sibling.getAttribute('data-state');
        if (ds === 'active') return sibling;
        if (ds === 'inactive') continue;
        if (sibling.hasAttribute('hidden')) continue;
        if (!isVisible(sibling)) continue;
        const text = getVisibleText(sibling);
        if (text.length > 20) return sibling;
      }
    }
  }

  // Aggressive: broad querySelectorAll fallback.
  if (config.tabPanelStrategy === 'aggressive') {
    const cands = [
      ...root.querySelectorAll('section, article, div, ul, ol, p, table, pre, [role="tabpanel"]'),
    ].filter(
      (e) =>
        e !== gc &&
        !gc.contains(e) &&
        !e.contains(gc) &&
        isVisible(e) &&
        Boolean(gc.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        getVisibleText(e).length >= 10,
    );
    return cands[0] || null;
  }

  return null;
};

export const discoverDropdownButtons = (config: ResolvedConfig): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="combobox"]')]
    .filter(
      (b) =>
        isClickableDropdownTrigger(b) &&
        isClickablyVisible(b) &&
        !isInsideDangerousNavigationArea(b) &&
        !b.closest('form') &&
        !(b as HTMLButtonElement).form &&
        !(b as HTMLButtonElement).disabled,
    )
    .slice(0, config.maxDropdownButtons);

export const findVisibleDropdownPanel = (btn: Element): Element | null => {
  const cp = findControlledPanel(btn);
  if (cp) return cp;
  const cands = [
    ...document.querySelectorAll(
      '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-select-content], [cmdk-list]',
    ),
  ].filter(
    (e) => isVisible(e) && cleanBlock((e as HTMLElement).innerText || e.textContent || '').length > 0,
  );
  return cands[cands.length - 1] || null;
};

// --- Tab capture (Section 33) ---

// Sequence-aware text delta extraction. Set-based line comparison loses shared
// lines like `import asyncio` across different code examples, so fenced code
// blocks are compared as whole units; set-diff applies only to plain text.
export const extractTextDelta = (beforeText: string, afterText: string): string => {
  if (!beforeText || !afterText) return '';
  if (beforeText === afterText) return '';

  // Strategy 1: extract fenced code blocks and compare as whole units.
  const extractFenced = (text: string): string[] => {
    const blocks: string[] = [];
    const regex = /^```[\s\S]*?^```/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) blocks.push(match[0].trim());
    return blocks;
  };

  const beforeFenced = extractFenced(beforeText);
  const afterFenced = extractFenced(afterText);
  const beforeFencedSet = new Set(beforeFenced);
  const newCodeBlocks = afterFenced.filter((block) => !beforeFencedSet.has(block));

  // Strategy 2: line-based diff for non-code text.
  const stripFenced = (text: string): string => text.replace(/^```[\s\S]*?^```/gm, '').trim();
  const beforePlain = stripFenced(beforeText);
  const afterPlain = stripFenced(afterText);

  const beforeLines = new Set(
    beforePlain.split('\n').map((l) => l.trim()).filter(Boolean),
  );
  const afterLines = afterPlain.split('\n').map((l) => l.trim()).filter(Boolean);
  const newPlainLines = afterLines.filter((line) => !beforeLines.has(line));

  // Merge lone `-` markers with the following line to form proper list items.
  const merged: string[] = [];
  for (let i = 0; i < newPlainLines.length; i++) {
    if (newPlainLines[i] === '-' && i + 1 < newPlainLines.length && newPlainLines[i + 1] !== '-') {
      merged.push(`- ${newPlainLines[i + 1]}`);
      i++;
    } else if (newPlainLines[i] === '-') {
      continue;
    } else {
      merged.push(newPlainLines[i]!);
    }
  }

  const parts: string[] = [];
  if (merged.length) parts.push(merged.join('\n'));
  if (newCodeBlocks.length) parts.push(newCodeBlocks.join('\n\n'));

  return parts.join('\n\n');
};

// Full-content signature. Head/tail alone is not enough: code samples for the
// same API share their first and last 200 chars (same imports, same closing
// print) while differing in the middle — on ai.google.dev that false collision
// suppressed 4 of 5 groups' panels as "duplicates" and dropped their content
// entirely (#11). Length + a full-text hash makes collisions practically
// impossible; the head stays for debuggability.
export const makeTabSignature = (text: string | null | undefined): string => {
  const t = String(text || '');
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `${t.length}:${(h >>> 0).toString(36)}:${t.slice(0, 200)}`;
};

export const captureCurrentTabPanel = async (
  ctx: ExtractContext,
  btn: HTMLElement,
  group: TabGroup,
  root: Element,
  beforeText: string,
  afterText: string,
): Promise<TabPanelCapture | null> => {
  const { config, state } = ctx;
  const cp = findControlledPanel(btn);
  const panel = cp || findPanelAfterGroup(group, root, config);

  if (panel) {
    const ls = renderNode(ctx, panel, 1, {
      expandTabs: false,
      expandDropdowns: false,
      includeRegionMarkers: false,
      skipCapturedTabPanels: false,
      skipCapturedDropdownPanels: false,
    });
    const j = normalizeMarkdownPreserveCode(ls.join('\n'));
    if (j) {
      const sig = makeTabSignature(j);
      if (state.capturedTabPanelTextSignatures.has(sig)) {
        // True duplicate of an already-exported panel. Suppress it at its
        // original location, but through the dedicated set so the renderer
        // says WHY — and never through capturedTabPanelElements, which
        // promises the content was exported (#11).
        state.dedupSuppressedTabPanelElements.add(panel);
        ctx.progress(
          'tabs',
          `tab "${getButtonText(btn)}" panel suppressed as a duplicate of an already-exported panel`,
        );
        return null;
      }
      if (j.length > config.maxTabPanelChars) {
        // Exporting would truncate; the panel is left unmarked so the main
        // render keeps it in place, in full (#11).
        ctx.progress(
          'tabs',
          `tab "${getButtonText(btn)}" panel too large to relocate (${j.length} > ${config.maxTabPanelChars} chars) — leaving it in place`,
          'warn',
        );
        return null;
      }
      state.capturedTabPanelTextSignatures.add(sig);
      return {
        lines: j.split('\n'),
        source: cp ? 'aria-controls' : 'panel-after-group',
        panelEl: panel,
      };
    }
  }

  // Level 6: content delta detection. If visible text changed after the tab
  // click, the difference IS the tab content.
  if (beforeText && afterText && beforeText !== afterText) {
    const delta = extractTextDelta(beforeText, afterText);
    if (delta && delta.length > 20) {
      // Sanity: delta should not be too large (> 50% of page = probably wrong).
      if (
        state.baselineBodyText.length > 0 &&
        delta.length > state.baselineBodyText.length * config.tabFallbackMaxBodyRatio
      ) {
        ctx.progress('tabs', `tab content delta too large (${delta.length} chars), skipping`, 'warn');
      } else {
        const sig = makeTabSignature(delta);
        if (!state.capturedTabPanelTextSignatures.has(sig)) {
          state.capturedTabPanelTextSignatures.add(sig);
          return {
            text: delta.slice(0, config.maxTabPanelChars),
            source: 'content-delta',
            truncated: delta.length > config.maxTabPanelChars,
          };
        }
      }
    }
  }

  // Level 7: clone-based fallback with sanity check.
  if (!cp && config.tabPanelStrategy !== 'safe') {
    const ft = getTextFromCloneExcludingGroup(root, group.container);
    if (ft && ft.length > 5) {
      if (
        state.baselineBodyText.length > 0 &&
        ft.length > state.baselineBodyText.length * config.tabFallbackMaxBodyRatio
      ) {
        ctx.progress(
          'tabs',
          `tab fallback too large (${ft.length} chars = ${((ft.length / state.baselineBodyText.length) * 100).toFixed(0)}% of page), skipping`,
          'warn',
        );
        return null;
      }
      const sig = makeTabSignature(ft);
      if (state.capturedTabPanelTextSignatures.has(sig)) return null;
      state.capturedTabPanelTextSignatures.add(sig);
      return {
        text: ft.slice(0, config.maxTabPanelChars),
        source: 'root-without-tab-buttons',
        truncated: ft.length > config.maxTabPanelChars,
      };
    }
  }

  return null;
};

// Index of the button marked selected, or -1. Whole class tokens: the old
// substring test took `btn-primary` and `inactive` for the selected tab and
// "restored" a dialog's Save button up to three times.
export const getActiveButtonIndex = (bs: HTMLElement[]): number => {
  const ia = bs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  if (ia >= 0) return ia;
  return bs.findIndex((b) => isMarkedSelected(b));
};

export const annotateTabButtons = (ctx: ExtractContext, gs: TabGroup[]): void => {
  let idx = 0;
  gs.forEach((g, gi) =>
    g.buttons.forEach((b) => {
      if (!b.dataset.aiExporterButtonId) {
        idx++;
        b.dataset.aiExporterButtonId = `tab-g${gi + 1}-b${idx}`;
        ctx.state.taggedExporterAttrElements.add(b);
      }
      ctx.state.knownTabButtonIds.add(b.dataset.aiExporterButtonId);
    }),
  );
};

export const annotateDropdownButtons = (ctx: ExtractContext, bs: HTMLElement[]): void =>
  bs.forEach((b, i) => {
    if (!b.dataset.aiExporterDropdownId) {
      b.dataset.aiExporterDropdownId = `dropdown-${i + 1}`;
      ctx.state.taggedExporterAttrElements.add(b);
    }
  });

// Returns true when the tab phase has exceeded its cumulative wall-clock budget.
// Tab pages with many groups × many buttons can burn dozens of seconds in
// aggregate even though every individual click is bounded to ~780 ms by
// waitForDomToSettle. Once the budget is hit we set state.tabCaptureAborted so
// the outer loop exits gracefully and the rest of extraction (dropdowns, main
// render, quality gate) still runs.
const isTabPhaseBudgetExceeded = (
  config: ResolvedConfig,
  state: ExtractorState,
): boolean => {
  if (state.tabPhaseStartMs == null) return false;
  return Date.now() - state.tabPhaseStartMs > config.tabPhaseBudgetMs;
};

// --- First-click guard (BL-19 round 2: D4, D9) ---
// Discovery cannot prove a group is a tab strip; its first click can. The
// snapshot is taken AFTER the scroll that precedes every click, so content a
// scroll loads lazily is part of "before", not evidence of a panel.
interface TabClickSnapshot {
  selected: boolean;
  target: Element | null;
  targetShown: boolean;
  text: string;
}

// Same trust as findControlledPanel: Radix keeps `hidden` mid-transition.
const isPanelShown = (el: Element): boolean => el.getAttribute('data-state') === 'active' || isVisible(el);

const snapshotTabClick = (btn: Element, root: Element): TabClickSnapshot => {
  const target = resolveControlsTarget(btn);
  return {
    selected: isMarkedSelected(btn),
    target,
    targetShown: Boolean(target && isPanelShown(target)),
    text: getVisibleText(root),
  };
};

// Any one of: the button became selected, the element it controls appeared,
// the root shows a line it did not show before.
const tabClickRevealedPanel = (btn: Element, root: Element, before: TabClickSnapshot): boolean => {
  if (!before.selected && isMarkedSelected(btn)) return true;
  const target = resolveControlsTarget(btn);
  if (target && isPanelShown(target) && (!before.targetShown || target !== before.target)) return true;
  return Boolean(extractTextDelta(before.text, getVisibleText(root)));
};

export const extractTabPanels = async (ctx: ExtractContext): Promise<void> => {
  const { config, state } = ctx;
  if (!config.extractTabs || !ctx.flags.allowClickTabs) return;
  state.tabPhaseStartMs = Date.now();
  const gs = discoverTabGroups(ctx);
  annotateTabButtons(ctx, gs);
  ctx.progress('tabs', `discovered ${gs.length} tab group(s)`);

  for (const g of gs) {
    if (state.tabCaptureAborted) break;
    if (isTabPhaseBudgetExceeded(config, state)) {
      state.tabCaptureAborted = true;
      ctx.progress(
        'tabs',
        `cumulative tab phase budget exceeded (${config.tabPhaseBudgetMs}ms) — skipping remaining ${gs.length - gs.indexOf(g)} group(s)`,
        'warn',
      );
      break;
    }
    const root = findTabRoot(g);
    // -1 when no button is marked selected: Phase 1 then reads button 0
    // without clicking, and no click "restores" a state nobody observed (D9).
    const markedIndex = getActiveButtonIndex(g.buttons);
    const activeIndex = markedIndex >= 0 ? markedIndex : 0;
    const activeButton = g.buttons[activeIndex];
    const groupLabel = g.buttons.map(getButtonText).join(' | ').slice(0, 120);
    const guard = {
      confirmed: false,
      stopped: false,
      lastClicked: null as HTMLElement | null,
      activeReadWithoutClick: false,
    };

    // Every click of the group goes through here. Returns the root's visible
    // text from just before the click, or null once the group is stopped.
    const clickInGroup = async (btn: HTMLElement): Promise<string | null> => {
      if (guard.stopped) return null;
      await ensureElementInViewport(btn);
      if (!guard.confirmed) await waitForDomToSettle(root, config.tabSettleMs, 120);
      resetComputedStyleCache();
      const before = snapshotTabClick(btn, root);
      await clickAndWait(btn, root, config.tabClickWaitMs, config.tabSettleMs);
      guard.lastClicked = btn;
      resetComputedStyleCache();
      if (!guard.confirmed) {
        if (!tabClickRevealedPanel(btn, root, before)) {
          // The stray click is the whole cost. No second click to "undo" it:
          // on a radio, a stepper or an action that repeats, never reverts.
          guard.stopped = true;
          ctx.progress(
            'tabs',
            `group "${groupLabel}": first click on "${getButtonText(btn)}" revealed no panel — group stopped`,
            'warn',
          );
          return null;
        }
        guard.confirmed = true;
      }
      return before.text;
    };

    // ---------------------------------------------------------------------
    // PHASE 1: pre-capture the initially active tab. Clicking the active tab
    // doesn't change the DOM, so content-delta won't work. Strategy: try
    // direct panel detection first; if it fails, cycle-away-and-back.
    // ---------------------------------------------------------------------
    if (activeButton) {
      const activeBid = activeButton.dataset.aiExporterButtonId;
      const activeLabel = getButtonText(activeButton);

      if (activeBid && activeLabel) {
        resetComputedStyleCache();
        let captured = await withHardTimeout(
          captureCurrentTabPanel(ctx, activeButton, g, root, '', ''),
          config.perTabHardTimeoutMs,
        );
        guard.activeReadWithoutClick = Boolean(captured);

        // Cycle away and back only from a button marked selected: with none
        // marked there is no observed state to come back to (D9).
        if (!captured && markedIndex >= 0) {
          const otherIndex = g.buttons.findIndex(
            (b, i) => i !== activeIndex && !isProbablyUnsafeTabButton(b, config),
          );

          if (otherIndex >= 0) {
            const otherButton = g.buttons[otherIndex]!;
            try {
              if ((await clickInGroup(otherButton)) !== null) {
                if (config.abortTabCaptureOnUrlDrift && isUrlDrifted(state)) {
                  const restored = await tryRestoreUrl(state);
                  if (!restored) {
                    state.tabCaptureAborted = true;
                    ctx.progress(
                      'tabs',
                      `URL drifted in Phase 1 (active tab "${activeLabel}") and could not be restored — aborting all remaining tab groups`,
                      'warn',
                    );
                  }
                }

                if (!state.tabCaptureAborted) {
                  resetComputedStyleCache();
                  const textWhileAway = getVisibleText(root);

                  if ((await clickInGroup(activeButton)) !== null) {
                    resetComputedStyleCache();
                    const textAfterReturn = getVisibleText(root);

                    captured = await withHardTimeout(
                      captureCurrentTabPanel(
                        ctx,
                        activeButton,
                        g,
                        root,
                        textWhileAway,
                        textAfterReturn,
                      ),
                      config.perTabHardTimeoutMs,
                    );
                  }
                }
              }
            } catch (e) {
              ctx.progress(
                'tabs',
                `cycle-away-and-back failed for active tab "${activeLabel}": ${String(e)}`,
                'warn',
              );
              // Back to the active tab only in a group its first click proved.
              if (guard.confirmed && guard.lastClicked !== activeButton) {
                try {
                  await clickAndWait(activeButton, root, config.tabClickWaitMs, config.tabSettleMs);
                  guard.lastClicked = activeButton;
                } catch {
                  // active tab restore failed — continue
                }
              }
            }
          }
        }

        if (captured) {
          const pt = normalizeMarkdownPreserveCode(
            captured.text || (captured.lines ? captured.lines.join('\n') : ''),
          );
          if (pt) {
            state.tabPanelsByButtonId.set(activeBid, { label: activeLabel, ...captured });
            ctx.appendix.capturedTabs.push({ label: activeLabel, source: captured.source });
            ctx.progress('tabs', `active tab "${activeLabel}" captured (source: ${captured.source})`);

            // Mark the panel DOM element to prevent duplicate rendering in the
            // main flow — only now that the content is actually exported (#11),
            // and never for a truncated export: the visible in-place render is
            // the complete copy then. Delta/clone captures carry no panelEl;
            // the active panel is currently visible, so the finders locate it.
            if (!captured.truncated) {
              resetComputedStyleCache();
              const panelEl =
                captured.panelEl || findControlledPanel(activeButton) || findPanelAfterGroup(g, root, config);
              if (panelEl) {
                state.capturedTabPanelElements.add(panelEl);
              }
            }
          }
        } else {
          ctx.progress('tabs', `active tab "${activeLabel}" panel not captured (all methods failed)`, 'warn');
        }
      }
    }

    if (state.tabCaptureAborted) break;
    if (guard.stopped) continue;

    // ---------------------------------------------------------------------
    // PHASE 2: capture remaining (non-active) tabs via content-delta. An
    // active tab Phase 1 did not capture goes LAST: the first click then lands
    // on a tab whose panel is hidden (a click on the visible one shows no
    // change and would stop a real group), and the group ends where it began.
    // ---------------------------------------------------------------------
    const activeId = activeButton?.dataset?.aiExporterButtonId;
    const order = g.buttons.filter((b) => b !== activeButton);
    if (activeButton && !(activeId && state.tabPanelsByButtonId.has(activeId))) order.push(activeButton);
    for (const btn of order) {
      if (state.tabCaptureAborted || guard.stopped) break;
      if (isTabPhaseBudgetExceeded(config, state)) {
        state.tabCaptureAborted = true;
        ctx.progress(
          'tabs',
          `cumulative tab phase budget exceeded mid-group (${config.tabPhaseBudgetMs}ms)`,
          'warn',
        );
        break;
      }
      const label = getButtonText(btn);
      const bid = btn.dataset.aiExporterButtonId;
      if (!bid || !label) continue;

      try {
        const beforeText = await clickInGroup(btn);
        if (beforeText === null) break;

        if (config.abortTabCaptureOnUrlDrift && isUrlDrifted(state)) {
          ctx.progress('tabs', `URL drifted after tab "${label}"`, 'warn');
          if (!(await tryRestoreUrl(state))) {
            state.tabCaptureAborted = true;
            ctx.progress(
              'tabs',
              `URL restore failed after "${label}" — aborting all remaining tab groups`,
              'warn',
            );
            break;
          }
        }

        resetComputedStyleCache();
        const afterText = getVisibleText(root);

        const cp = await withHardTimeout(
          captureCurrentTabPanel(ctx, btn, g, root, beforeText, afterText),
          config.perTabHardTimeoutMs,
        );
        if (!cp) {
          if (isTabPhaseBudgetExceeded(config, state)) {
            state.tabCaptureAborted = true;
            ctx.progress(
              'tabs',
              `tab capture for "${label}" hit the ${config.perTabHardTimeoutMs}ms per-tab limit; overall budget also exhausted — aborting`,
              'warn',
            );
            break;
          }
          continue;
        }

        const pt = normalizeMarkdownPreserveCode(cp.text || (cp.lines ? cp.lines.join('\n') : ''));
        if (!pt) continue;

        state.tabPanelsByButtonId.set(bid, { label, ...cp });
        ctx.appendix.capturedTabs.push({ label, source: cp.source });
        // Suppress the panel at its original location only because its content
        // is now exported under this button (#11).
        if (cp.panelEl) state.capturedTabPanelElements.add(cp.panelEl);
      } catch (e) {
        ctx.progress('tabs', `failed tab "${label}": ${String(e)}`, 'warn');
      }
    }

    // Restore the tab the reader had open: only in a confirmed group, only to
    // an observed state (a button marked selected, or the one whose panel was
    // read without a click), never after an abort (the page has drifted).
    if (
      !state.tabCaptureAborted &&
      guard.confirmed &&
      activeButton &&
      guard.lastClicked !== activeButton &&
      (markedIndex >= 0 || guard.activeReadWithoutClick)
    ) {
      try {
        await clickAndWait(activeButton, root, config.tabClickWaitMs, config.tabSettleMs);
        resetComputedStyleCache();
      } catch {
        // restore failed — page stays on the last clicked tab
      }
    }
  }
};

// --- Dropdown capture (Section 34) ---

export const captureDropdownPanel = async (ctx: ExtractContext, btn: HTMLElement): Promise<void> => {
  const { config, state } = ctx;
  const label = getButtonFallbackLabel(btn);
  const did = btn.dataset.aiExporterDropdownId;
  if (!did) return;
  let openedHere = false;
  try {
    const we = btn.getAttribute('aria-expanded') === 'true';
    if (!we) {
      await clickAndWait(btn, document.body, config.dropdownClickWaitMs, config.dropdownSettleMs);
      openedHere = true;
    }
    const panel = findVisibleDropdownPanel(btn);
    if (panel) {
      const ls = renderNode(ctx, panel, 1, {
        expandTabs: false,
        expandDropdowns: false,
        includeRegionMarkers: false,
        skipCapturedTabPanels: false,
        skipCapturedDropdownPanels: false,
      });
      const j = normalizeMarkdownPreserveCode(ls.join('\n'));
      if (j) {
        state.capturedDropdownPanelElements.add(panel);
        state.dropdownPanelsByButtonId.set(did, {
          label,
          lines: j.slice(0, config.maxDropdownPanelChars).split('\n'),
          source: 'dropdown-panel',
        });
      }
    }
  } catch (e) {
    ctx.progress('dropdowns', `dropdown "${label}" failed: ${String(e)}`, 'warn');
  } finally {
    // BL-24: close only what this call opened, on its own trigger. No synthetic
    // Escape: Radix listens for it on document in the capture phase, Headless
    // UI on window, Bootstrap's dropdown on document, so an Escape sent from
    // anywhere also dismisses the reader's own dialog, popover or edit. A menu
    // without aria-expanded stays open, a smaller harm than closing theirs.
    if (openedHere && btn.isConnected && btn.getAttribute('aria-expanded') === 'true') {
      try {
        btn.click();
        await sleep(80);
      } catch {
        // left open
      }
    }
  }
};

export const extractDropdownPanels = async (ctx: ExtractContext): Promise<void> => {
  if (!ctx.flags.allowDropdownClicks) return;
  const bs = discoverDropdownButtons(ctx.config);
  annotateDropdownButtons(ctx, bs);
  ctx.progress('dropdowns', `discovered ${bs.length} dropdown button(s)`);
  for (const b of bs) await captureDropdownPanel(ctx, b);
};
