#!/usr/bin/env node
// Unit test for the Agent Bridge's page checks in lib/agent-bridge.ts (T176). Node 24 strips the types, so the
// module is imported as it ships; its `browser` global is a fake that records every call. Each case is a convert the
// server could send, the document the tab holds when the extractor goes in, and what must reach the server and the tab.
// The race it pins (a script or meta refresh commits another document after the landed-page check) cannot be timed
// in a real browser, so the fake plays the browser's side of it.
//
//   node scripts/agent-bridge.test.mjs
//   AB_MODULE=<path to another agent-bridge.ts> node scripts/agent-bridge.test.mjs   (run it on another build)
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The extension imports './messages' with no extension; WXT resolves that, Node needs the `.ts`.
register('data:text/javascript,' + encodeURIComponent(
  'export async function resolve(s, c, next) {' +
  '  try { return await next(s, c); } catch (e) {' +
  "    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.][.]?[/]/.test(s) && !/[.][cm]?[jt]s$/.test(s)) return next(s + '.ts', c);" +
  '    throw e; } }'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.AB_MODULE || join(ROOT, 'lib/agent-bridge.ts');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -- ${detail}` : ''}`);
};

// ── the fake browser ──────────────────────────────────────────────────────
const TAB = 7;
const calls = [];
let landedUrl = '';      // what tabs.get reports once the tab is complete
let staged = null;       // the InjectionResult of the options call: the document the call landed in
// tabs.get; a case may swap it to hold the tab in its load
let tabsGet = async (id) => ({ id, status: 'complete', url: landedUrl });
globalThis.browser = {
  permissions: { contains: async () => true },
  tabs: {
    create: async ({ url }) => { calls.push({ op: 'create', url }); return { id: TAB }; },
    get: (id) => tabsGet(id),
    remove: async (id) => { calls.push({ op: 'remove', id }); },
    onUpdated: { addListener() {}, removeListener() {} },
  },
  scripting: {
    executeScript: async (d) => {
      calls.push({ op: d.files ? 'files' : 'func', target: d.target, args: d.args });
      return d.files ? [{ frameId: 0, documentId: staged?.documentId }] : [staged];
    },
  },
  alarms: { create: async () => {}, clear: async () => {} },
};

const { BridgeClient } = await import(pathToFileURL(MOD).href);

const sent = [];
const client = new BridgeClient(async () => 'key');
// An open, paired connection: canSend() reads these two.
client.ws = { readyState: WebSocket.OPEN, send: (s) => sent.push(JSON.parse(s)), close() {} };
client.stage = 'open';

let n = 0;
const convert = async (landed, doc) => {
  calls.length = 0;
  sent.length = 0;
  landedUrl = landed;
  staged = doc;
  const id = `req-${++n}`;
  await client.handleConvert({
    type: 'convert', id, url: 'https://public.example/start',
    options: { includeImages: true, includeFrontmatter: true, timeoutMs: 15000 },
  });
  return id;
};
const filesCall = () => calls.find((c) => c.op === 'files');
// The run id the options call staged (T178); undefined on a build that stages none.
const stagedRun = () => calls.find((c) => c.op === 'func')?.args?.[1]?.bridgeRun;
const RESULT = { markdown: '# Public page\n\nThe page text.', filename: 'public-page.md', status: 'ok' };

// ── 1. literals the server refuses are refused here too ───────────────────
const BLOCKED = [
  'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost./', 'http://a.localhost/',
  'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fe90::1]/', 'http://[fd00::1]/', 'http://10.0.0.1/',
  'http://100.64.0.1/', 'http://0.0.0.0/', 'http://169.254.169.254/',
  // T176: core's lists (src/node/ssrf-guard.ts) that 1.6.0's first cut missed
  'http://198.18.0.1/', 'http://224.0.0.1/', 'http://255.255.255.255/', 'http://192.0.2.1/', 'http://198.51.100.1/',
  'http://203.0.113.1/', 'http://192.0.0.1/', 'http://192.88.99.1/', 'http://[2002:7f00:1::]/',
  'http://[64:ff9b::7f00:1]/', 'http://[2001::1]/', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
  'http://[2001:db8::1]/', 'http://[100::1]/', 'http://metadata.google.internal/', 'http://metadata/',
  'http://metadata.google.internal./',
];
const PUBLIC = [
  'https://example.com/', 'http://8.8.8.8/', 'http://1.1.1.1/', 'http://100.63.255.1/', 'http://100.128.0.1/',
  'http://172.32.0.1/', 'http://198.20.0.1/', 'http://223.255.255.1/', 'http://[2606:4700:4700::1111]/',
  'http://[2001:4860:4860::8888]/', 'https://metadata.example.com/', 'https://localhost.example.com/',
];
const missed = BLOCKED.filter((u) => !client.isRestrictedUrl(u));
check('every literal and name core refuses is refused', missed.length === 0, missed.join(' '));
const over = PUBLIC.filter((u) => client.isRestrictedUrl(u));
check('public hosts pass', over.length === 0, over.join(' '));

// ── 2. the tab holds another document by the time the extractor would go in ──
let id = await convert('https://public.example/start',
  { documentId: 'DOC-PRIVATE', frameId: 0, result: 'http://127.0.0.1:8080/admin' });
check('a page that moved to a private address after the check: refused',
  sent.some((m) => m.type === 'error' && m.id === id && m.code === 'RESTRICTED_URL'), JSON.stringify(sent));
check('... and the extractor never went in', !filesCall(), JSON.stringify(calls));
check('... and the tab was closed', calls.some((c) => c.op === 'remove' && c.id === TAB));

// ── 3. the extractor goes into the document that was checked, not "the tab" ──
id = await convert('https://public.example/start',
  { documentId: 'DOC-A', frameId: 0, result: 'https://public.example/start' });
check('the extractor is pinned to the checked document',
  JSON.stringify(filesCall()?.target?.documentIds) === '["DOC-A"]', JSON.stringify(filesCall()?.target));
check('... and nothing was refused', !sent.some((m) => m.type === 'error'), JSON.stringify(sent));

// ── 4. a result from any other document is not returned ──────────────────
client.onResult(TAB, RESULT, 'https://public.example/start', 'DOC-B', stagedRun());
check('a result sent by another document: refused, not returned',
  sent.some((m) => m.type === 'error' && m.id === id) && !sent.some((m) => m.type === 'result'),
  JSON.stringify(sent));

// ── 5. the normal path still returns the page ─────────────────────────────
id = await convert('https://public.example/start',
  { documentId: 'DOC-A', frameId: 0, result: 'https://public.example/start' });
client.onResult(TAB, RESULT, 'https://public.example/start', 'DOC-A', stagedRun());
check('the checked document\'s result is returned',
  sent.some((m) => m.type === 'result' && m.id === id && m.markdown === RESULT.markdown), JSON.stringify(sent));

// ── 6. a browser without documentId (Chrome < 106) keeps the old target ───
id = await convert('https://public.example/start', { frameId: 0, result: 'https://public.example/start' });
check('no documentId: the tab target, as before', filesCall() && !('documentIds' in filesCall().target),
  JSON.stringify(filesCall()?.target));
client.onResult(TAB, RESULT, 'https://public.example/start', undefined, stagedRun());
check('... and its result is returned', sent.some((m) => m.type === 'result' && m.id === id), JSON.stringify(sent));

// ── 7. T178: a run the user starts from the popup in a bridge tab is the user's ──
id = await convert('https://public.example/start',
  { documentId: 'DOC-A', frameId: 0, result: 'https://public.example/start' });
const run = stagedRun();
check('the options call stages a run id for this request', typeof run === 'string' && run.length >= 16, String(run));
check('the bridge owns its tab until the request is answered',
  typeof client.ownsTab === 'function' && client.ownsTab(TAB) && !client.ownsTab(TAB + 1));
const popupConsumed = client.onResult(TAB, { ...RESULT, markdown: '# Public page\n\nThe user\'s run.' },
  'https://public.example/start', 'DOC-A', undefined);
check('a result without the run id (a popup run) is not taken for the agent',
  !popupConsumed && sent.length === 0 && !calls.some((c) => c.op === 'remove'), JSON.stringify(sent));
check('... nor one with another run\'s id',
  !client.onResult(TAB, RESULT, 'https://public.example/start', 'DOC-A', 'another-run') && sent.length === 0);
client.onResult(TAB, RESULT, 'https://public.example/start', 'DOC-A', run);
check('... and the bridge\'s own run still answers',
  sent.some((m) => m.type === 'result' && m.id === id && m.markdown === RESULT.markdown), JSON.stringify(sent));
check('... after which the tab is no longer the bridge\'s', typeof client.ownsTab === 'function' && !client.ownsTab(TAB));

// ── 8. T178: a crashed or blank extraction is not the page ────────────────
const answer = async (result) => {
  const rid = await convert('https://public.example/start',
    { documentId: 'DOC-A', frameId: 0, result: 'https://public.example/start' });
  client.onResult(TAB, result, 'https://public.example/start', 'DOC-A', stagedRun());
  return sent.find((m) => m.id === rid);
};
const crashed = await answer({
  status: 'fallback-after-crash', filename: 'x-fallback.md',
  markdown: '# Public page\n\n<!-- AI: FALLBACK EXPORT START -->\n\nPlain text of the page\n\n<!-- AI: FALLBACK EXPORT END -->',
  error: { name: 'SyntaxError', message: "'[[[' is not a valid selector" },
});
check('the crash fallback: EXTRACTION_FAILED, so the server reads the page itself',
  crashed?.type === 'error' && crashed.code === 'EXTRACTION_FAILED' && /SyntaxError/.test(crashed.message),
  JSON.stringify(crashed));
// Real extractor output (scripts/fixtures/extractor-outputs.json): blank ones fail, the rest is the page.
const { cases } = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/extractor-outputs.json'), 'utf8'));
const wrong = [];
for (const [name, c] of Object.entries(cases)) {
  const got = await answer({ status: 'ok', filename: 'page.md', markdown: c.markdown });
  const ok = c.blank
    ? got?.type === 'error' && got.code === 'EXTRACTION_FAILED' && /no text/.test(got.message)
    : got?.type === 'result' && got.markdown === c.markdown;
  if (!ok) wrong.push(`${name} (${c.blank ? 'blank' : 'text'}): ${got?.type}/${got?.code ?? ''}`);
}
check(`blank extractions refused, pages with text returned (${Object.keys(cases).length} real outputs)`,
  wrong.length === 0, wrong.join('; '));

// ── 9. one message per request: an answer during the tab's load ends it ──
let failLoad;
tabsGet = () => new Promise((_, reject) => { failLoad = reject; });
calls.length = 0;
sent.length = 0;
const loading = client.handleConvert({
  type: 'convert', id: 'req-loading', url: 'https://public.example/start',
  options: { includeImages: true, includeFrontmatter: true, timeoutMs: 15000 },
});
for (let i = 0; i < 200 && !failLoad; i++) await new Promise((r) => setTimeout(r, 5));
client.onInjectError(TAB, 'The page changed before the extractor started: run the extraction again');
failLoad(new Error(`No tab with id: ${TAB}`));
await loading;
tabsGet = async (tid) => ({ id: tid, status: 'complete', url: landedUrl });
const forLoading = sent.filter((m) => m.id === 'req-loading');
check('a request answered while its tab loads gets no second message',
  forLoading.length === 1 && forLoading[0].code === 'EXTRACTION_FAILED', JSON.stringify(forLoading));

// A result that never came would leave its timeout running.
for (const p of client.pending.values()) clearTimeout(p.timer);
console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
