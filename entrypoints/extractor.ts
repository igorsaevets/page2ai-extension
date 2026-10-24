// Unlisted script: builds to /extractor.js and is injected on demand into the
// active tab's isolated world via chrome.scripting.executeScript({ files }).
// It runs the core extractor and streams progress + the final result back over
// runtime messaging; it never touches storage or downloads anything itself.

import { runExtractor } from '~/lib/core/extractor';
import {
  OPTIONS_GLOBAL_KEY,
  RUNNING_GLOBAL_KEY,
  STEP_BUSY,
  STEP_INJECT_ERROR,
  type ProgressMessage,
  type ResultMessage,
  type StagedOptions,
} from '~/lib/messages';

export default defineUnlistedScript(async () => {
  const g = globalThis as Record<string, unknown>;

  const send = (msg: ProgressMessage | ResultMessage): void => {
    try {
      // Rejections happen when no popup is open and the worker is between
      // wake-ups; the background listener persists results, so best-effort.
      void browser.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      // Extension context invalidated (reload/update) — nowhere to report.
    }
  };

  // The isolated world persists across injections in the same tab, so a
  // global flag is enough to prevent overlapping runs.
  if (g[RUNNING_GLOBAL_KEY]) {
    send({
      type: 'PAGE2AI_PROGRESS',
      step: STEP_BUSY,
      message: 'Extraction is already running in this tab',
      level: 'warn',
    });
    return;
  }
  // Every caller stages the options in the document first, and an isolated world
  // belongs to one document. None here means this is not the document the caller
  // checked: Chrome 155 runs a documentIds target that names a document now in the
  // back/forward cache in the tab's current document instead (T176).
  if (!(OPTIONS_GLOBAL_KEY in g)) {
    send({
      type: 'PAGE2AI_PROGRESS',
      step: STEP_INJECT_ERROR,
      message: 'The page changed before the extractor started: run the extraction again',
      level: 'error',
    });
    return;
  }
  g[RUNNING_GLOBAL_KEY] = true;

  const { bridgeRun, ...options } = (g[OPTIONS_GLOBAL_KEY] ?? {}) as StagedOptions;
  delete g[OPTIONS_GLOBAL_KEY];

  try {
    const result = await runExtractor(options, (step, message, level) => {
      send({ type: 'PAGE2AI_PROGRESS', step, message, level: level ?? 'info' });
    });
    // The bridge takes only the result of the run it started (T178).
    send({ type: 'PAGE2AI_RESULT', result, ...(bridgeRun ? { bridgeRun } : {}) });
  } finally {
    g[RUNNING_GLOBAL_KEY] = false;
  }
});
