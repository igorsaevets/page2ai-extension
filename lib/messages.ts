// Message protocol between popup, background and the injected extractor script.
// All payloads must stay structured-cloneable (no RegExp/functions): options travel
// through scripting.executeScript args and results through runtime messaging.

import type { ExtractOptions, ExtractResult, ProgressLevel } from './types';

/** popup → background: start extraction in the given tab. */
export interface ExtractRequestMessage {
  type: 'PAGE2AI_EXTRACT';
  tabId: number;
  options: ExtractOptions;
}

/** extractor → popup/background (or background → popup with explicit tabId). */
export interface ProgressMessage {
  type: 'PAGE2AI_PROGRESS';
  step: string;
  message: string;
  level: ProgressLevel;
  /** Set only on background-originated messages; content-script messages carry sender.tab instead. */
  tabId?: number;
}

/** extractor → popup/background: extraction finished (ok or fallback). */
export interface ResultMessage {
  type: 'PAGE2AI_RESULT';
  result: ExtractResult;
}

/** Site access the Agent Bridge needs: the manifest's optional_host_permissions,
 *  requested by the popup's switch (a user gesture), never at install. Without
 *  it, scripting.executeScript on a tab the bridge opened fails: activeTab
 *  covers only the tab the user invoked Page2AI on. */
export const BRIDGE_ORIGINS = ['http://*/*', 'https://*/*'];

/** popup → background: toggle the Agent Bridge on or off. */
export interface BridgeToggleMessage {
  type: 'PAGE2AI_BRIDGE_TOGGLE';
  enabled: boolean;
}

/** background → popup: current Agent Bridge status. */
export interface BridgeStatusMessage {
  type: 'PAGE2AI_BRIDGE_STATUS';
  state: 'disconnected' | 'connecting' | 'connected';
}

/** popup → background: ask for the current status; answered with { state }.
 *  The background broadcasts only changes, so an open popup asks once. */
export interface BridgeStatusQueryMessage {
  type: 'PAGE2AI_BRIDGE_STATUS_QUERY';
}

export type Page2aiMessage =
  | ExtractRequestMessage
  | ProgressMessage
  | ResultMessage
  | BridgeToggleMessage
  | BridgeStatusMessage
  | BridgeStatusQueryMessage;

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
export const OPTIONS_GLOBAL_KEY = '__page2aiOptions';
/** Isolated-world global guarding against concurrent runs in one tab. */
export const RUNNING_GLOBAL_KEY = '__page2aiRunning';

/** Progress steps with special popup handling. */
export const STEP_BUSY = 'busy';
export const STEP_INJECT_ERROR = 'inject-error';
