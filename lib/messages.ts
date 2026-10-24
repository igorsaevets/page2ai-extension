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

/** Why the bridge is not connected, as far as the extension can tell. */
export type BridgeProblem =
  | 'no-server'           // nothing answered on the port
  | 'no-key'              // the MCP server runs without PAGE2AI_BRIDGE_KEY
  | 'unknown-key'         // it holds other keys
  | 'refused'             // it did not accept this browser's proof
  | 'untrusted'           // the program on the port failed the key check
  | 'outdated-server'     // it speaks an older protocol (0.5.x)
  | 'outdated-extension'  // it speaks a newer one
  | 'busy';               // another browser holds the connection

/** background → popup: current Agent Bridge status. */
export interface BridgeStatusMessage {
  type: 'PAGE2AI_BRIDGE_STATUS';
  state: 'disconnected' | 'connecting' | 'connected';
  problem: BridgeProblem | null;
}

/** popup → background: ask for the current status; answered with { state, problem }.
 *  The background broadcasts only changes, so an open popup asks once. */
export interface BridgeStatusQueryMessage {
  type: 'PAGE2AI_BRIDGE_STATUS_QUERY';
}

/** popup → background: the key the MCP server needs, made on first use; answered
 *  with { key }. `renew` replaces it: the old key stops working at once. */
export interface BridgeKeyMessage {
  type: 'PAGE2AI_BRIDGE_KEY';
  renew?: boolean;
}

export type Page2aiMessage =
  | ExtractRequestMessage
  | ProgressMessage
  | ResultMessage
  | BridgeToggleMessage
  | BridgeStatusMessage
  | BridgeStatusQueryMessage
  | BridgeKeyMessage;

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
