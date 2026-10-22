// Agent Bridge: WebSocket client that connects the Page2AI extension to
// @page2ai/mcp's localhost bridge server. When connected, the MCP server
// routes page_to_markdown calls through this extension, giving agents access
// to the user's real browser (cookies, JS rendering, extension-quality output).
//
// Protocol: page2ai-bridge/1 (spec: BRIDGE_PROTOCOL.md)
// Security: loopback only, Origin auto-set by the browser, per-session token.

import {
  OPTIONS_GLOBAL_KEY,
  type Page2aiMessage,
} from './messages';
import type { ExtractResult } from './types';

const BRIDGE_PROTOCOL = 'page2ai-bridge/1';
const DEFAULT_PORT = 3025;
const PING_INTERVAL_MS = 20_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const RESTRICTED_DOMAINS = new Set([
  'accounts.google.com',
  'myaccount.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'account.live.com',
  'appleid.apple.com',
  'id.apple.com',
  'signin.aws.amazon.com',
]);

// The bridge opens web pages only. An allowlist, not a list of bad schemes:
// file:, data:, blob: and javascript: were all reachable through the old one.
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

interface ConvertRequest {
  type: 'convert';
  id: string;
  url: string;
  options: {
    includeImages: boolean;
    includeFrontmatter: boolean;
    timeoutMs: number;
  };
}

interface PendingConvert {
  requestId: string;
  tabId: number;
  url: string;
  timer: ReturnType<typeof setTimeout>;
}

type BridgeState = 'disconnected' | 'connecting' | 'connected';
type StateCallback = (state: BridgeState) => void;

export class BridgeClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private state: BridgeState = 'disconnected';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pending = new Map<number, PendingConvert>();
  private enabled = false;
  private port: number;
  private onStateChange: StateCallback | null = null;

  constructor(port?: number) {
    this.port = port ?? DEFAULT_PORT;
  }

  getState(): BridgeState {
    return this.state;
  }

  setStateCallback(cb: StateCallback | null): void {
    this.onStateChange = cb;
  }

  async enable(port?: number): Promise<void> {
    if (port != null) this.port = port;
    this.enabled = true;
    this.reconnectAttempt = 0;
    this.connect();
  }

  disable(): void {
    this.enabled = false;
    this.clearReconnect();
    this.cleanup();
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  /** Called by the background message handler when a PAGE2AI_RESULT arrives.
   *  Returns true if the result belonged to a bridge-created tab (consumed). */
  onResult(tabId: number, result: ExtractResult, tabUrl: string): boolean {
    const pending = this.pending.get(tabId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(tabId);
    this.sendConvertResult(pending.requestId, result, tabUrl);
    browser.tabs.remove(tabId).catch(() => undefined);
    return true;
  }

  /** Called when a PAGE2AI_PROGRESS inject-error arrives for a tab. */
  onInjectError(tabId: number, message: string): boolean {
    const pending = this.pending.get(tabId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(tabId);
    this.sendError(pending.requestId, 'EXTRACTION_FAILED', message);
    browser.tabs.remove(tabId).catch(() => undefined);
    return true;
  }

  // ── connection lifecycle ──────────────────────────────────────────────

  private connect(): void {
    if (!this.enabled || this.state !== 'disconnected') return;
    this.setState('connecting');

    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    } catch {
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL,
        extensionId: browser.runtime.id,
        extensionVersion: browser.runtime.getManifest().version,
      }));
    };

    this.ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch { return; }
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.cleanup();
      if (this.enabled) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — cleanup happens there
    };
  }

  private cleanup(): void {
    this.stopPing();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.token = null;

    for (const [tabId, p] of this.pending) {
      clearTimeout(p.timer);
      browser.tabs.remove(tabId).catch(() => undefined);
    }
    this.pending.clear();
    this.setState('disconnected');
  }

  private setState(s: BridgeState): void {
    if (this.state === s) return;
    this.state = s;
    this.onStateChange?.(s);
  }

  // ── message handling ──────────────────────────────────────────────────

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    if (type === 'welcome') {
      this.token = msg.token as string;
      this.setState('connected');
      this.reconnectAttempt = 0;
      this.startPing();
      return;
    }

    if (type === 'error' && !this.token) {
      // Auth rejection — close and retry later
      this.ws?.close();
      return;
    }

    if (type === 'convert') {
      void this.handleConvert(msg as unknown as ConvertRequest);
      return;
    }

    if (type === 'pong') {
      return;
    }
  }

  // ── convert request ───────────────────────────────────────────────────

  private async handleConvert(req: ConvertRequest): Promise<void> {
    if (this.isRestrictedUrl(req.url)) {
      this.sendError(req.id, 'RESTRICTED_URL',
        `Refused to extract sensitive URL: ${this.safeHostname(req.url)}`);
      return;
    }

    // Check site access before opening anything: without it the tab would load
    // and the injection fail. Match patterns carry no port.
    const { protocol, hostname } = new URL(req.url);
    const hasAccess = await browser.permissions
      .contains({ origins: [`${protocol}//${hostname}/*`] })
      .catch(() => false);
    if (!hasAccess) {
      this.sendError(req.id, 'PERMISSION_REQUIRED',
        `Page2AI has no access to ${hostname}: turn the Agent Bridge switch in the Page2AI popup off and on to grant site access`);
      return;
    }

    let tabId: number;
    try {
      const tab = await browser.tabs.create({ url: req.url, active: false });
      if (!tab?.id) {
        this.sendError(req.id, 'TAB_LOAD_FAILED', 'Tab has no ID');
        return;
      }
      tabId = tab.id;
    } catch (e) {
      this.sendError(req.id, 'TAB_LOAD_FAILED',
        `Failed to create tab: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const timeoutMs = Math.max(req.options.timeoutMs ?? 15_000, 5_000);

    const timer = setTimeout(() => {
      this.pending.delete(tabId);
      browser.tabs.remove(tabId).catch(() => undefined);
      this.sendError(req.id, 'TIMEOUT', `Extraction timed out after ${timeoutMs}ms`);
    }, timeoutMs + 5_000);

    this.pending.set(tabId, { requestId: req.id, tabId, url: req.url, timer });

    try {
      await this.waitForTabLoad(tabId, timeoutMs);
      if (!this.pending.has(tabId)) return; // timed out while waiting

      await browser.scripting.executeScript({
        target: { tabId },
        func: (key: string, opts: unknown) => {
          (globalThis as Record<string, unknown>)[key] = opts;
        },
        args: [OPTIONS_GLOBAL_KEY, { profile: 'auto' }],
      });

      void browser.scripting
        .executeScript({ target: { tabId }, files: ['/extractor.js'] })
        .catch((e) => {
          if (this.pending.has(tabId)) {
            clearTimeout(this.pending.get(tabId)!.timer);
            this.pending.delete(tabId);
            browser.tabs.remove(tabId).catch(() => undefined);
            this.sendError(req.id, 'EXTRACTION_FAILED',
              `Extractor injection failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
    } catch (e) {
      const p = this.pending.get(tabId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(tabId);
        browser.tabs.remove(tabId).catch(() => undefined);
      }
      this.sendError(req.id, 'EXTRACTION_FAILED',
        e instanceof Error ? e.message : String(e));
    }
  }

  private waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        browser.tabs.onUpdated.removeListener(onUpdate);
        reject(new Error('Tab load timed out'));
      }, Math.min(timeoutMs, 30_000));

      const done = (): void => {
        clearTimeout(deadline);
        browser.tabs.onUpdated.removeListener(onUpdate);
        resolve();
      };

      const onUpdate = (id: number, info: { status?: string }): void => {
        if (id === tabId && info.status === 'complete') done();
      };

      browser.tabs.onUpdated.addListener(onUpdate);

      browser.tabs.get(tabId)
        .then((t) => { if (t.status === 'complete') done(); })
        .catch(() => {
          clearTimeout(deadline);
          browser.tabs.onUpdated.removeListener(onUpdate);
          reject(new Error('Tab not found'));
        });
    });
  }

  // ── WS send helpers ───────────────────────────────────────────────────

  private sendConvertResult(id: string, result: ExtractResult, url: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.token) return;
    this.ws.send(JSON.stringify({
      type: 'result',
      id,
      token: this.token,
      markdown: result.markdown,
      title: result.filename?.replace(/\.md$/, '') ?? '',
      url,
      charCount: result.markdown.length,
      source: 'extension',
    }));
  }

  private sendError(id: string, code: string, message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.token) return;
    this.ws.send(JSON.stringify({ type: 'error', id, token: this.token, code, message }));
  }

  // ── keepalive ─────────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.token) {
        this.ws.send(JSON.stringify({ type: 'ping', token: this.token }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── reconnect ─────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.enabled) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── URL guardrails ────────────────────────────────────────────────────

  private isRestrictedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return true;
      // `accounts.google.com.` (trailing dot) is the same host.
      return RESTRICTED_DOMAINS.has(parsed.hostname.replace(/\.$/, ''));
    } catch {
      return true;
    }
  }

  private safeHostname(url: string): string {
    try { return new URL(url).hostname; }
    catch { return '(invalid URL)'; }
  }
}
