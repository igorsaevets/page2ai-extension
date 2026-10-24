// Agent Bridge: WebSocket client that connects the Page2AI extension to
// @page2ai/mcp's localhost bridge server. When connected, the MCP server
// routes page_to_markdown calls through this extension, giving agents access
// to the user's real browser (cookies, JS rendering, extension-quality output).
//
// Protocol: page2ai-bridge/2 (@page2ai/mcp 0.6.0, src/bridge/protocol.ts there).
// Security: loopback only, and a key this extension makes (makeBridgeKey) that the
// user pastes into the server's PAGE2AI_BRIDGE_KEY. Any program can listen on the
// port when the server is not running; the server has to prove it knows the key
// before this client sends its own proof, and before any convert is obeyed.

import {
  OPTIONS_GLOBAL_KEY,
  type BridgeProblem,
  type StagedOptions,
} from './messages';
import type { ExtractResult } from './types';

const BRIDGE_PROTOCOL = 'page2ai-bridge/2';
const DEFAULT_PORT = 3025;
const PING_INTERVAL_MS = 20_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HANDSHAKE_MS = 10_000;
// The retry that outlives the service worker: a setTimeout dies with it after
// 30 s idle, so a server started later was reached only when some event woke
// the worker. Chrome fires alarms at most every 30 s (unpacked: no limit).
export const RECONNECT_ALARM = 'page2ai-bridge-reconnect';
const RECONNECT_ALARM_MINUTES = 0.5;

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

// Loopback, private, link-local, shared (CGNAT) and other non-public addresses
// written as literals, and localhost and metadata names. @page2ai/mcp refuses
// them on every route; a page that redirects to one is not read here either, so
// the extractor never clicks through, say, a router's admin page. A name that
// resolves to such an address stays the server's check: an extension cannot
// resolve names. The lists are @page2ai/core's (src/node/ssrf-guard.ts);
// WHATWG URL parsing has already turned hex, octal and dotless IPv4 into a
// dotted quad and compressed IPv6.
const BLOCKED_IPV4: RegExp[] = [
  /^127\./, /^10\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^(22[4-9]|23\d)\./, // 224.0.0.0/4 multicast
  /^(24\d|25[0-5])\./, // 240.0.0.0/4 reserved, 255.255.255.255
  /^192\.0\.[02]\./, /^192\.88\.99\./, /^198\.51\.100\./, /^203\.0\.113\./, /^198\.1[89]\./,
];
// Unique local fc00::/7, link-local fe80::/10, IPv4-mapped, NAT64 and 6to4 (both
// embed an IPv4 address), documentation, discard, Teredo 2001::/32 (two forms).
const BLOCKED_IPV6_PREFIXES = [
  'fc', 'fd', 'fe8', 'fe9', 'fea', 'feb', '::ffff:', '64:ff9b:', '2002:', '2001:db8:', '100:',
  '2001::', '2001:0:',
];
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);

const isPrivateHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_NAMES.has(h) || h.endsWith('.localhost')) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return BLOCKED_IPV4.some((p) => p.test(h));
  return h.includes(':') &&
    (h === '::' || h === '::1' || BLOCKED_IPV6_PREFIXES.some((p) => h.startsWith(p)));
};

// ── key ─────────────────────────────────────────────────────────────────

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)),
    (c) => c.charCodeAt(0));

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** 32 random bytes, base64url: what the popup shows and PAGE2AI_BRIDGE_KEY holds. */
export const makeBridgeKey = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export const isBridgeKey = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);

interface HandshakeKey {
  /** First 16 hex digits of SHA-256(key), as the server names it. */
  id: string;
  hmac: CryptoKey;
}

const loadKey = async (key: string): Promise<HandshakeKey> => {
  const bytes = fromBase64Url(key);
  const id = toHex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 16);
  const hmac = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { id, hmac };
};

const protocolNumber = (p: unknown): number => Number(/^page2ai-bridge\/(\d+)$/.exec(String(p))?.[1] ?? NaN);

/** The page's own text in an extractor result: without the frontmatter, the HTML
 *  comments the extractor adds (content markers, quality metrics) and the title
 *  heading it writes from document.title. Empty on an empty page or an app shell
 *  that had not rendered (measured on the extractor's output, T178). */
const pageTextOf = (markdown: string): string => markdown
  .replace(/^---\n[\s\S]*?\n---\n/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*# .*$/m, '')
  .trim();

// ── client ──────────────────────────────────────────────────────────────

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
  // Staged with the options and echoed in the result: only this run answers the request.
  run: string;
  timer: ReturnType<typeof setTimeout>;
  // The document the checks passed and the extractor went into (Chrome 106+).
  documentId?: string;
}

type BridgeState = 'disconnected' | 'connecting' | 'connected';
type StateCallback = (state: BridgeState, problem: BridgeProblem | null) => void;

// Where one connection is in the handshake. Only 'open' obeys a convert.
type Stage = 'hello' | 'auth' | 'open' | 'closed';

export class BridgeClient {
  private ws: WebSocket | null = null;
  private stage: Stage = 'closed';
  private state: BridgeState = 'disconnected';
  private problem: BridgeProblem | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  // Bumped by every connect() and disable(): a connect still loading the key
  // stops if a newer one (a new key) or a disable came in meanwhile.
  private connectGen = 0;
  private pending = new Map<number, PendingConvert>();
  private enabled = false;
  private port: number;
  private onStateChange: StateCallback | null = null;
  private readonly getKey: () => Promise<string>;

  constructor(getKey: () => Promise<string>, port?: number) {
    this.getKey = getKey;
    this.port = port ?? DEFAULT_PORT;
  }

  getState(): BridgeState {
    return this.state;
  }

  getProblem(): BridgeProblem | null {
    return this.problem;
  }

  setStateCallback(cb: StateCallback | null): void {
    this.onStateChange = cb;
  }

  async enable(port?: number): Promise<void> {
    if (port != null) this.port = port;
    this.enabled = true;
    this.reconnectAttempt = 0;
    // Made again on every start: Chrome may drop alarms on a browser restart.
    void browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_ALARM_MINUTES });
    void this.connect();
  }

  disable(): void {
    this.enabled = false;
    this.connectGen++;
    void browser.alarms.clear(RECONNECT_ALARM);
    this.clearReconnect();
    this.cleanup();
    this.setProblem(null);
  }

  /** The reconnect alarm woke the worker (or fired while it ran): try now if idle. */
  onAlarm(name: string): void {
    if (name !== RECONNECT_ALARM || !this.enabled || this.state !== 'disconnected') return;
    this.clearReconnect();
    void this.connect();
  }

  /** A new key: drop the connection made with the old one and pair again. */
  restart(): void {
    if (!this.enabled) return;
    this.clearReconnect();
    this.cleanup();
    this.reconnectAttempt = 0;
    void this.connect();
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  /** A tab a convert request opened and has not closed yet: the agent's, not the user's. */
  ownsTab(tabId: number): boolean {
    return this.pending.has(tabId);
  }

  /** A convert request is in flight: a reload now would drop it (lib/update-reload.ts). */
  isBusy(): boolean {
    return this.pending.size > 0;
  }

  /** Called by the background message handler when a PAGE2AI_RESULT arrives.
   *  Returns true if the result is of the run a bridge convert started (consumed).
   *  `tabUrl` and `documentId` are the sending document's (MessageSender);
   *  `bridgeRun` is the run id the result carries (absent on a popup run). */
  onResult(tabId: number, result: ExtractResult, tabUrl: string, documentId?: string, bridgeRun?: string): boolean {
    const pending = this.pending.get(tabId);
    if (!pending || bridgeRun !== pending.run) return false;

    clearTimeout(pending.timer);
    this.pending.delete(tabId);
    // Checked after the load too; a script can still move the page meanwhile.
    if (pending.documentId && documentId && documentId !== pending.documentId) {
      this.sendError(pending.requestId, 'RESTRICTED_URL',
        'The page changed before its result came back; the Agent Bridge returns only the page it checked');
    } else if (this.isRestrictedUrl(tabUrl)) {
      this.sendError(pending.requestId, 'RESTRICTED_URL',
        `The page moved to ${this.safeHostname(tabUrl)}, which the Agent Bridge does not read`);
    } else if (result.status === 'fallback-after-crash') {
      // The plain-text fallback is not the page's Markdown: the server reads the page itself.
      this.sendError(pending.requestId, 'EXTRACTION_FAILED',
        `The extractor failed on this page${result.error ? ` (${result.error.name}: ${result.error.message})` : ''}`);
    } else if (!pageTextOf(result.markdown ?? '')) {
      this.sendError(pending.requestId, 'EXTRACTION_FAILED',
        'The page in the browser had no text to extract: an empty page, or an app that had not rendered yet');
    } else {
      this.sendConvertResult(pending.requestId, result, tabUrl);
    }
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

  private async connect(): Promise<void> {
    if (!this.enabled || this.state !== 'disconnected') return;
    const gen = ++this.connectGen;
    this.setState('connecting');

    let key: HandshakeKey;
    try {
      key = await loadKey(await this.getKey());
    } catch {
      if (gen !== this.connectGen) return;
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (gen !== this.connectGen || !this.enabled || this.ws) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    } catch {
      this.setProblem('no-server');
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.stage = 'hello';
    const nonceE = toHex(crypto.getRandomValues(new Uint8Array(32)));
    let opened = false;
    let heard = false;
    // One message at a time: a convert sent right behind a challenge waits until
    // the challenge is checked, and finds the connection closed if it failed.
    let queue = Promise.resolve();

    // A program that accepts the socket and never answers is not a Page2AI server.
    this.handshakeTimer = setTimeout(() => {
      if (this.ws === ws && this.stage !== 'open') this.distrust(ws);
    }, HANDSHAKE_MS);

    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL,
        extensionId: browser.runtime.id,
        extensionVersion: browser.runtime.getManifest().version,
        keyId: key.id,
        nonceE,
      }));
    };

    ws.onmessage = (event) => {
      heard = true;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        this.distrust(ws);
        return;
      }
      queue = queue.then(() => this.handleMessage(ws, msg, key, nonceE)).catch(() => this.distrust(ws));
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      // Closed before the server said a word: nothing listens, or an older server
      // refused the upgrade (0.5.x does for a Firefox origin it does not list). A
      // program that took the socket and stayed silent is not a Page2AI server; when
      // the handshake timer cut it, distrust() has said so already (ef12464 then
      // wrote no-server over it, the upgrade never having finished).
      if (!heard && this.stage !== 'closed') this.setProblem(opened ? 'untrusted' : 'no-server');
      this.cleanup();
      if (this.enabled) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror — cleanup happens there
    };
  }

  private cleanup(): void {
    this.stopPing();
    if (this.handshakeTimer != null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.stage = 'closed';

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
    this.onStateChange?.(s, this.problem);
  }

  private setProblem(p: BridgeProblem | null): void {
    if (this.problem === p) return;
    this.problem = p;
    this.onStateChange?.(this.state, p);
  }

  /** The peer broke the protocol or failed the key check: it gets nothing more. */
  private distrust(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.setProblem('untrusted');
    this.stage = 'closed';
    try { ws.close(); } catch { /* ignore */ }
  }

  // ── message handling ──────────────────────────────────────────────────

  private async handleMessage(ws: WebSocket, msg: Record<string, unknown>, key: HandshakeKey, nonceE: string): Promise<void> {
    if (this.ws !== ws || this.stage === 'closed') return;
    const type = msg.type as string;

    if (this.stage === 'hello') {
      if (type === 'error') {
        this.setProblem(this.problemOf(msg, false));
        this.stage = 'closed';
        ws.close();
        return;
      }
      if (type !== 'challenge' || msg.protocol !== BRIDGE_PROTOCOL || !isHex64(msg.nonceS) || !isHex64(msg.proof)) {
        this.distrust(ws);
        return;
      }
      const nonceS = msg.nonceS;
      const proven = await crypto.subtle.verify('HMAC', key.hmac, fromHex(msg.proof),
        new TextEncoder().encode(`${BRIDGE_PROTOCOL}|server|${this.port}|${nonceE}|${nonceS}`));
      if (this.ws !== ws || this.stage !== 'hello') return;
      if (!proven) {
        this.distrust(ws);
        return;
      }
      const proof = toHex(await crypto.subtle.sign('HMAC', key.hmac,
        new TextEncoder().encode(`${BRIDGE_PROTOCOL}|client|${this.port}|${nonceS}|${nonceE}`)));
      if (this.ws !== ws || this.stage !== 'hello') return;
      this.stage = 'auth';
      ws.send(JSON.stringify({ type: 'auth', proof }));
      return;
    }

    if (this.stage === 'auth') {
      if (type === 'welcome' && msg.protocol === BRIDGE_PROTOCOL) {
        this.stage = 'open';
        if (this.handshakeTimer != null) {
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }
        this.reconnectAttempt = 0;
        this.setProblem(null);
        this.setState('connected');
        this.startPing();
        return;
      }
      if (type === 'error') {
        this.setProblem(this.problemOf(msg, true));
        this.stage = 'closed';
        ws.close();
        return;
      }
      // A convert before the welcome, or anything else: not the protocol.
      this.distrust(ws);
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

  /** A refusal before the handshake ended. `proven`: the server had already
   *  proved it knows the key. */
  private problemOf(msg: Record<string, unknown>, proven: boolean): BridgeProblem {
    switch (msg.code) {
      case 'NO_KEY': return 'no-key';
      case 'UNKNOWN_KEY': return 'unknown-key';
      case 'ALREADY_CONNECTED': return 'busy';
      case 'PROTOCOL_MISMATCH':
        return protocolNumber(msg.protocol) > protocolNumber(BRIDGE_PROTOCOL) ? 'outdated-extension' : 'outdated-server';
      // Before a challenge only a page2ai-bridge/1 server (@page2ai/mcp 0.5.x) says
      // AUTH_FAILED: it refuses every hello it does not speak.
      case 'AUTH_FAILED': return proven ? 'refused' : 'outdated-server';
      default: return 'refused';
    }
  }

  // ── convert request ───────────────────────────────────────────────────

  /** Why the bridge may not read this URL, or null. Asked for the URL the server
   *  sent and again for the page the tab ended on: a redirect can lead anywhere. */
  private async refusal(url: string): Promise<{ code: string; message: string } | null> {
    if (this.isRestrictedUrl(url)) {
      return { code: 'RESTRICTED_URL', message: `Refused to extract sensitive URL: ${this.safeHostname(url)}` };
    }
    // Without site access the tab would load and the injection fail. Match
    // patterns carry no port.
    const { protocol, hostname } = new URL(url);
    const hasAccess = await browser.permissions
      .contains({ origins: [`${protocol}//${hostname}/*`] })
      .catch(() => false);
    return hasAccess ? null : {
      code: 'PERMISSION_REQUIRED',
      message: `Page2AI has no access to ${hostname}: turn the Agent Bridge switch in the Page2AI popup off and on to grant site access`,
    };
  }

  private async handleConvert(req: ConvertRequest): Promise<void> {
    const refused = await this.refusal(req.url);
    if (refused) {
      this.sendError(req.id, refused.code, refused.message);
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

    const run = crypto.randomUUID();
    this.pending.set(tabId, { requestId: req.id, tabId, url: req.url, run, timer });

    try {
      await this.waitForTabLoad(tabId, timeoutMs);
      if (!this.pending.has(tabId)) return; // timed out while waiting

      // The browser has followed any redirect by now. Nothing runs in the page the
      // tab ended on before it passes the checks the asked URL passed.
      const landed = await browser.tabs.get(tabId).then((t) => t.url ?? '', () => '');
      const landedRefusal = await this.refusal(landed);
      if (!this.pending.has(tabId)) return;
      if (landedRefusal) {
        clearTimeout(this.pending.get(tabId)!.timer);
        this.pending.delete(tabId);
        browser.tabs.remove(tabId).catch(() => undefined);
        this.sendError(req.id, landedRefusal.code,
          `The page redirected to ${this.safeHostname(landed)}. ${landedRefusal.message}`);
        return;
      }

      // A tab target means whatever document the tab holds when the call lands, and
      // a script or meta refresh can commit another one after the check above. So
      // the options call reports the document it ran in, that document's own URL
      // is checked, and the extractor goes into that document only: pinned by
      // documentIds, and it runs only where the options were staged (Chrome 155
      // sends a pin on a document now in the back/forward cache to the current one).
      const [staged] = await browser.scripting.executeScript({
        target: { tabId },
        func: (key: string, opts: unknown) => {
          (globalThis as Record<string, unknown>)[key] = opts;
          return location.href;
        },
        // The agent's include_images / include_frontmatter (ignored before 1.6.0), and the
        // run id the result must carry to answer this request.
        args: [OPTIONS_GLOBAL_KEY, {
          profile: 'auto',
          overrides: {
            includeImages: req.options.includeImages !== false,
            includeFrontmatter: req.options.includeFrontmatter !== false,
          },
          bridgeRun: run,
        } satisfies StagedOptions],
      });
      const pending = this.pending.get(tabId);
      if (!pending) return;
      const docUrl = typeof staged?.result === 'string' ? staged.result : landed;
      // The call ran, so the site access is there; what is left is the URL itself.
      if (this.isRestrictedUrl(docUrl)) {
        clearTimeout(pending.timer);
        this.pending.delete(tabId);
        browser.tabs.remove(tabId).catch(() => undefined);
        this.sendError(req.id, 'RESTRICTED_URL',
          `The page moved to ${this.safeHostname(docUrl)} before the extractor ran, which the Agent Bridge does not read`);
        return;
      }
      pending.documentId = staged?.documentId;

      void browser.scripting
        .executeScript({
          target: pending.documentId ? { tabId, documentIds: [pending.documentId] } : { tabId },
          files: ['/extractor.js'],
        })
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
      // Nothing to say if the request was answered meanwhile (its result, a
      // refusal, the timer): a second message for one id is not the protocol.
      const p = this.pending.get(tabId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(tabId);
        browser.tabs.remove(tabId).catch(() => undefined);
        this.sendError(req.id, 'EXTRACTION_FAILED',
          e instanceof Error ? e.message : String(e));
      }
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

  private canSend(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.stage === 'open';
  }

  private sendConvertResult(id: string, result: ExtractResult, url: string): void {
    if (!this.canSend()) return;
    this.ws!.send(JSON.stringify({
      type: 'result',
      id,
      markdown: result.markdown,
      title: result.filename?.replace(/\.md$/, '') ?? '',
      url,
      charCount: result.markdown.length,
      source: 'extension',
    }));
  }

  private sendError(id: string, code: string, message: string): void {
    if (!this.canSend()) return;
    this.ws!.send(JSON.stringify({ type: 'error', id, code, message }));
  }

  // ── keepalive ─────────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.canSend()) this.ws!.send(JSON.stringify({ type: 'ping' }));
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
    if (!this.enabled || this.reconnectTimer != null) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
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
      const host = parsed.hostname.replace(/\.$/, '');
      return RESTRICTED_DOMAINS.has(host) || isPrivateHost(host);
    } catch {
      return true;
    }
  }

  private safeHostname(url: string): string {
    try { return new URL(url).hostname; }
    catch { return '(invalid URL)'; }
  }
}
