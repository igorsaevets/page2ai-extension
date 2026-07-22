// Background service worker: injects the extractor into the requested tab and
// persists results in storage.session so the popup can recover them even if it
// was closed while the extraction was still running.

import {
  OPTIONS_GLOBAL_KEY,
  STEP_INJECT_ERROR,
  resultCacheKey,
  type CachedResult,
  type ExtractAck,
  type ExtractRequestMessage,
  type Page2aiMessage,
  type ProgressMessage,
} from '~/lib/messages';

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

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
      const cached: CachedResult = {
        result: msg.result,
        url: sender.tab.url ?? '',
        savedAt: Date.now(),
      };
      void browser.storage.session.set({ [resultCacheKey(tabId)]: cached });
      void browser.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
      void browser.action.setBadgeText({ tabId, text: '✓' });
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
