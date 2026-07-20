// Popup: the single driver of extraction. Sends the request to the background
// (which injects /extractor.js), renders streamed progress, and offers
// clipboard copy + .md download. Clipboard lives here because the popup has
// document focus; content scripts and service workers do not.

import './style.css';
import {
  STEP_BUSY,
  STEP_INJECT_ERROR,
  resultCacheKey,
  type CachedResult,
  type ExtractAck,
  type ExtractRequestMessage,
  type Page2mdMessage,
} from '~/lib/messages';
import type { AutoProfile, ExtractResult } from '~/lib/types';

type StatusTone = 'info' | 'busy' | 'ok' | 'warn' | 'error';

const $ = <T extends HTMLElement>(sel: string): T => {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`popup: missing element ${sel}`);
  return node;
};

const el = {
  version: $<HTMLSpanElement>('#version'),
  pageHost: $<HTMLDivElement>('#page-host'),
  profile: $<HTMLSelectElement>('#profile'),
  extract: $<HTMLButtonElement>('#extract'),
  status: $<HTMLDivElement>('#status'),
  log: $<HTMLDetailsElement>('#log'),
  logCount: $<HTMLSpanElement>('#log-count'),
  logList: $<HTMLUListElement>('#log-list'),
  result: $<HTMLElement>('#result'),
  stats: $<HTMLDivElement>('#stats'),
  copy: $<HTMLButtonElement>('#copy'),
  download: $<HTMLButtonElement>('#download'),
  previewText: $<HTMLTextAreaElement>('#preview-text'),
};

const MAX_LOG_ENTRIES = 300;

let activeTabId: number | null = null;
let activeTabUrl = '';
let lastResult: ExtractResult | null = null;
let extracting = false;

const RESTRICTED_PREFIXES = [
  'chrome://', 'chrome-extension://', 'chrome-untrusted://', 'devtools://',
  'edge://', 'about:', 'view-source:', 'https://chromewebstore.google.com',
];

const isRestrictedUrl = (url: string): boolean =>
  RESTRICTED_PREFIXES.some((p) => url.startsWith(p));

const setStatus = (text: string, tone: StatusTone = 'info'): void => {
  el.status.hidden = false;
  el.status.textContent = text;
  el.status.dataset.tone = tone;
};

const setExtracting = (on: boolean): void => {
  extracting = on;
  el.extract.disabled = on;
  el.extract.textContent = on ? 'Extracting…' : 'Extract Markdown';
};

const appendLog = (step: string, message: string, level: string): void => {
  el.log.hidden = false;
  const li = document.createElement('li');
  li.dataset.level = level;
  li.textContent = `[${step}] ${message}`;
  el.logList.append(li);
  while (el.logList.childElementCount > MAX_LOG_ENTRIES) {
    el.logList.firstElementChild?.remove();
  }
  el.logCount.textContent = String(el.logList.childElementCount);
};

const formatChars = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const describeResult = (r: ExtractResult): string => {
  const parts = [`profile: ${r.profile}`, `${formatChars(r.markdown.length)} chars`];
  if (r.tabsCaptured) parts.push(`${r.tabsCaptured} tabs`);
  if (r.dropdownsCaptured) parts.push(`${r.dropdownsCaptured} dropdowns`);
  if (r.status === 'official-md' && r.officialMarkdownRatio != null) {
    parts.push(`official llms.txt markdown (ratio ${r.officialMarkdownRatio.toFixed(2)})`);
  }
  if (r.quality) parts.push(`quality: ${r.quality.ratioStatus} (${r.quality.ratio.toFixed(2)})`);
  return parts.join(' · ');
};

const copyMarkdown = async (markdown: string): Promise<boolean> => {
  try {
    // clipboardWrite permission lifts the transient-activation requirement,
    // but the popup document must still be focused.
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    try {
      el.previewText.hidden = false;
      el.previewText.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
};

const showResult = (result: ExtractResult, opts: { fromCache?: boolean } = {}): void => {
  lastResult = result;
  el.result.hidden = false;
  el.stats.textContent = describeResult(result);
  el.previewText.value = result.markdown;

  if (activeTabId != null) {
    void browser.action.setBadgeText({ tabId: activeTabId, text: '' }).catch(() => undefined);
  }

  if (result.status === 'fallback-after-crash') {
    const detail = result.error ? ` (${result.error.name}: ${result.error.message})` : '';
    setStatus(
      result.markdown
        ? `Extractor crashed — plain-text fallback is available${detail}`
        : `Extractor crashed and fail-safe export is disabled${detail}`,
      'error',
    );
    return;
  }
  if (opts.fromCache) {
    setStatus('Result from the previous extraction of this page', 'info');
  }
};

const onFreshResult = async (result: ExtractResult): Promise<void> => {
  setExtracting(false);
  showResult(result);
  if (result.status === 'fallback-after-crash' || !result.markdown) return;
  const copied = await copyMarkdown(result.markdown);
  setStatus(
    copied
      ? `Done — Markdown copied to clipboard (${formatChars(result.markdown.length)} chars)`
      : 'Done — click Copy to put the Markdown on the clipboard',
    copied ? 'ok' : 'warn',
  );
};

const onMessage = (message: unknown, sender: { tab?: { id?: number } }): void => {
  const msg = message as Page2mdMessage;
  // Messages from content scripts carry sender.tab; background-originated
  // progress carries an explicit tabId. Ignore other tabs' traffic.
  const senderTabId = sender.tab?.id ?? (msg.type === 'PAGE2MD_PROGRESS' ? msg.tabId : undefined);
  if (senderTabId != null && senderTabId !== activeTabId) return;

  if (msg.type === 'PAGE2MD_PROGRESS') {
    appendLog(msg.step, msg.message, msg.level);
    if (msg.step === STEP_INJECT_ERROR) {
      setExtracting(false);
      setStatus(msg.message, 'error');
    } else if (msg.step === STEP_BUSY) {
      setStatus(msg.message, 'warn');
    } else if (extracting) {
      setStatus(msg.message, msg.level === 'info' ? 'busy' : msg.level);
    }
    return;
  }
  if (msg.type === 'PAGE2MD_RESULT') {
    void onFreshResult(msg.result);
  }
};

const startExtract = async (): Promise<void> => {
  if (extracting || activeTabId == null) return;
  setExtracting(true);
  lastResult = null;
  el.result.hidden = true;
  el.logList.replaceChildren();
  el.logCount.textContent = '0';
  el.log.hidden = true;
  setStatus('Starting extraction…', 'busy');

  const request: ExtractRequestMessage = {
    type: 'PAGE2MD_EXTRACT',
    tabId: activeTabId,
    options: { profile: el.profile.value as AutoProfile },
  };
  let ack: ExtractAck | undefined;
  try {
    ack = (await browser.runtime.sendMessage(request)) as ExtractAck;
  } catch (e) {
    ack = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!ack?.ok) {
    setExtracting(false);
    setStatus(`Could not start: ${ack?.error ?? 'no response from background'}`, 'error');
  }
};

const downloadResult = (): void => {
  if (!lastResult?.markdown) return;
  const blob = new Blob([lastResult.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastResult.filename || 'page.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const init = async (): Promise<void> => {
  el.version.textContent = `v${browser.runtime.getManifest().version}`;
  el.extract.addEventListener('click', () => void startExtract());
  el.copy.addEventListener('click', async () => {
    if (!lastResult?.markdown) return;
    const copied = await copyMarkdown(lastResult.markdown);
    setStatus(copied ? 'Copied to clipboard' : 'Copy failed — select the preview text manually', copied ? 'ok' : 'error');
  });
  el.download.addEventListener('click', downloadResult);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No active tab found', 'error');
    el.extract.disabled = true;
    return;
  }
  activeTabId = tab.id;
  activeTabUrl = tab.url ?? '';
  if (activeTabUrl) {
    try {
      el.pageHost.textContent = new URL(activeTabUrl).hostname;
      el.pageHost.title = activeTabUrl;
    } catch {
      el.pageHost.textContent = '';
    }
  }
  if (isRestrictedUrl(activeTabUrl)) {
    setStatus('This page cannot be extracted (browser-internal page)', 'warn');
    el.extract.disabled = true;
    return;
  }

  browser.runtime.onMessage.addListener(onMessage);

  // Recover a result cached by the background while the popup was closed.
  const key = resultCacheKey(tab.id);
  const stored = await browser.storage.session.get(key);
  const cached = stored[key] as CachedResult | undefined;
  if (cached?.result && (!cached.url || !activeTabUrl || cached.url === activeTabUrl)) {
    showResult(cached.result, { fromCache: true });
  }

  el.extract.focus();
};

void init();
