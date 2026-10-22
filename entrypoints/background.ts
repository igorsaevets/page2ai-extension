// Background service worker: injects the extractor into the requested tab,
// persists results in storage.session so the popup can recover them even if it
// was closed while the extraction was still running, and manages the Agent
// Bridge WebSocket client that connects to @page2ai/mcp.

import {
  BRIDGE_ORIGINS,
  OPTIONS_GLOBAL_KEY,
  STEP_INJECT_ERROR,
  resultCacheKey,
  type BridgeStatusMessage,
  type CachedResult,
  type ExtractAck,
  type ExtractRequestMessage,
  type Page2aiMessage,
  type ProgressMessage,
} from '~/lib/messages';
import { BridgeClient } from '~/lib/agent-bridge';

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const BRIDGE_STORAGE_KEY = 'agentBridge';
const BRIDGE_PORT_KEY = 'agentBridgePort';

let bridgeClient: BridgeClient | null = null;

const initBridge = async (): Promise<void> => {
  const stored = await browser.storage.local.get([BRIDGE_STORAGE_KEY, BRIDGE_PORT_KEY]);
  const enabled = stored[BRIDGE_STORAGE_KEY] === true;
  const port = typeof stored[BRIDGE_PORT_KEY] === 'number' ? stored[BRIDGE_PORT_KEY] : undefined;

  bridgeClient = new BridgeClient(port);

  bridgeClient.setStateCallback((state) => {
    const status: BridgeStatusMessage = { type: 'PAGE2AI_BRIDGE_STATUS', state };
    void browser.runtime.sendMessage(status).catch(() => undefined);
  });

  if (enabled) {
    void bridgeClient.enable();
  }
};

const startExtraction = async ({ tabId, options }: ExtractRequestMessage): Promise<void> => {
  // Stage options in the tab's isolated world first: executeScript({ files })
  // cannot pass args, and this cheap call also validates that the page is
  // injectable (chrome://, Web Store etc. reject here). Options must stay
  // JSON-serializable — never pass RegExp overrides through this path.
  await browser.scripting.executeScript({
    target: { tabId },
    func: (key: string, opts: unknown) => {
      (globalThis as Record<string, unknown>)[key] = opts;
    },
    args: [OPTIONS_GLOBAL_KEY, options],
  });

  // Fire the actual extraction WITHOUT awaiting it: executeScript resolves only
  // after the injected script's promise settles, which can take tens of seconds
  // on tab-heavy pages. Results arrive via runtime messages instead.
  void browser.scripting
    .executeScript({ target: { tabId }, files: ['/extractor.js'] })
    .catch((e) => {
      const msg: ProgressMessage = {
        type: 'PAGE2AI_PROGRESS',
        step: STEP_INJECT_ERROR,
        message: `Failed to inject extractor: ${errorText(e)}`,
        level: 'error',
        tabId,
      };
      void browser.runtime.sendMessage(msg).catch(() => undefined);
    });
};

export default defineBackground(() => {
  // A toggle can arrive while initBridge still awaits storage: chain on it.
  const bridgeReady = initBridge();

  // The grant itself turns the bridge on: the popup that asked may be gone by
  // the time the user answers the prompt, and its .then with it. A revoke
  // (chrome://extensions, about:addons, or the switch) turns it off.
  const touchesBridge = (p: { origins?: string[] }): boolean =>
    Boolean(p.origins?.some((o) => BRIDGE_ORIGINS.includes(o)));
  browser.permissions.onAdded.addListener((p) => {
    if (!touchesBridge(p)) return;
    void browser.storage.local.set({ [BRIDGE_STORAGE_KEY]: true });
    void bridgeReady.then(() => bridgeClient?.enable());
  });
  browser.permissions.onRemoved.addListener((p) => {
    if (!touchesBridge(p)) return;
    void browser.storage.local.set({ [BRIDGE_STORAGE_KEY]: false });
    void bridgeReady.then(() => bridgeClient?.disable());
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const msg = message as Page2aiMessage;

    if (msg?.type === 'PAGE2AI_EXTRACT') {
      startExtraction(msg)
        .then(() => sendResponse({ ok: true } satisfies ExtractAck))
        .catch((e) => sendResponse({ ok: false, error: errorText(e) } satisfies ExtractAck));
      return true; // keep the channel open for the async response
    }

    if (msg?.type === 'PAGE2AI_RESULT' && sender.tab?.id != null) {
      const tabId = sender.tab.id;

      // Bridge intercept: if this tab was created by a bridge convert request,
      // route the result to the MCP server and close the tab.
      if (bridgeClient?.onResult(tabId, msg.result, sender.tab.url ?? '')) {
        return undefined;
      }

      const cached: CachedResult = {
        result: msg.result,
        url: sender.tab.url ?? '',
        savedAt: Date.now(),
      };
      void browser.storage.session.set({ [resultCacheKey(tabId)]: cached });
      void browser.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
      void browser.action.setBadgeText({ tabId, text: '✓' });
    }

    if (msg?.type === 'PAGE2AI_PROGRESS' && msg.step === STEP_INJECT_ERROR) {
      const tabId = sender.tab?.id ?? msg.tabId;
      if (tabId != null) {
        bridgeClient?.onInjectError(tabId, msg.message);
      }
    }

    if (msg?.type === 'PAGE2AI_BRIDGE_TOGGLE') {
      void browser.storage.local.set({ [BRIDGE_STORAGE_KEY]: msg.enabled });
      void bridgeReady.then(() => {
        if (msg.enabled) {
          void bridgeClient?.enable();
        } else {
          bridgeClient?.disable();
        }
      });
      return undefined;
    }

    if (msg?.type === 'PAGE2AI_BRIDGE_STATUS_QUERY') {
      void bridgeReady.then(() => sendResponse({ state: bridgeClient?.getState() ?? 'disconnected' }));
      return true; // answered after initBridge settles
    }

    return undefined;
  });

  // A navigation invalidates the cached result for that tab.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void browser.storage.session.remove(resultCacheKey(tabId));
      void browser.action.setBadgeText({ tabId, text: '' });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(resultCacheKey(tabId));
  });
});
