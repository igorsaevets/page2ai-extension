// Message protocol between popup, background and the injected extractor script.
// All payloads must stay structured-cloneable (no RegExp/functions): options travel
// through scripting.executeScript args and results through runtime messaging.

import type { ExtractOptions, ExtractResult, ProgressLevel } from './types';

/** popup → background: start extraction in the given tab. */
export interface ExtractRequestMessage {
  type: 'PAGE2MD_EXTRACT';
  tabId: number;
  options: ExtractOptions;
}

/** extractor → popup/background (or background → popup with explicit tabId). */
export interface ProgressMessage {
  type: 'PAGE2MD_PROGRESS';
  step: string;
  message: string;
  level: ProgressLevel;
  /** Set only on background-originated messages; content-script messages carry sender.tab instead. */
  tabId?: number;
}

/** extractor → popup/background: extraction finished (ok, official-md or fallback). */
export interface ResultMessage {
  type: 'PAGE2MD_RESULT';
  result: ExtractResult;
}

export type Page2mdMessage = ExtractRequestMessage | ProgressMessage | ResultMessage;

/** background → popup: response to ExtractRequestMessage. */
export interface ExtractAck {
  ok: boolean;
  error?: string;
}

/** Shape stored in storage.session under resultCacheKey(tabId). */
export interface CachedResult {
  result: ExtractResult;
  url: string;
  savedAt: number;
}

export const resultCacheKey = (tabId: number): string => `result:${tabId}`;

/** Isolated-world global used to stage options for the file-injected extractor. */
export const OPTIONS_GLOBAL_KEY = '__page2mdOptions';
/** Isolated-world global guarding against concurrent runs in one tab. */
export const RUNNING_GLOBAL_KEY = '__page2mdRunning';

/** Progress steps with special popup handling. */
export const STEP_BUSY = 'busy';
export const STEP_INJECT_ERROR = 'inject-error';
