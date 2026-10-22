// Page2AI Agent Bridge e2e: real Chrome + a built extension + the real
// @page2ai/mcp server over stdio. An agent's page_to_markdown call with a URL
// must travel MCP -> WebSocket -> extension -> background tab -> extractor and
// back. The fixture server tells the two routes apart: Chrome sends
// `sec-fetch-mode` on a navigation, the server's own fetch does not.
//
// Run:  npm i --no-save puppeteer-core @page2ai/mcp
//       npx wxt build --mode e2e   (grants http://127.0.0.1/*: a user who allowed the bridge)
//       node .e2e/e2e-bridge.mjs
//
// EXT_PATH   built extension dir (default .output/chrome-mv3-e2e)
// MCP_ENTRY  the server's dist/index.js (default node_modules/@page2ai/mcp/dist/index.js)
// EXPECT     'bridge' (default): the page must come through the extension;
//            'fallback': the extension has no access to the page, so the
//            server must still answer, by its own fetch.
// MANUAL_GRANT=1  a visible Chrome; a person answers the switch's site-access
//            prompt with Allow (browser UI no automation can click). With the
//            production build this checks the one step CI cannot:
//            EXT_PATH=.output/chrome-mv3 MANUAL_GRANT=1 node .e2e/e2e-bridge.mjs

import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve(process.env.EXT_PATH ?? '.output/chrome-mv3-e2e');
const MCP_ENTRY = path.resolve(process.env.MCP_ENTRY ?? 'node_modules/@page2ai/mcp/dist/index.js');
const EXPECT = process.env.EXPECT ?? 'bridge';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const MARKER = `bridge-marker-${Date.now().toString(36)}`;
const TEST_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Bridge Fixture</title></head>
<body><main>
  <h1>Bridge Fixture</h1>
  <p>An agent asked for this page through the Page2AI MCP server. ${MARKER}</p>
  <p>A second paragraph, so the extractor has a body to keep.</p>
</main></body></html>`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

if (!['bridge', 'fallback'].includes(EXPECT)) throw new Error(`EXPECT must be bridge or fallback, got ${EXPECT}`);
for (const [what, p] of [['extension', path.join(EXT_PATH, 'manifest.json')], ['MCP server', MCP_ENTRY]]) {
  if (!existsSync(p)) throw new Error(`${what} not found: ${p}`);
}
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) throw new Error('Chrome not found; set CHROME_PATH');

const hits = [];
const server = createServer((req, res) => {
  hits.push({ browser: Boolean(req.headers['sec-fetch-mode']), ua: req.headers['user-agent'] ?? '' });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(TEST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/agent/asked`;

// The extension reads its port when the background starts, so the test takes
// the default one, as a user does, and stops if anything else holds it (a
// Claude Desktop or Cursor running @page2ai/mcp would win the connection).
const bridgePort = 3025;
await new Promise((resolve, reject) => {
  const s = createNetServer();
  s.once('error', () => reject(new Error(`port ${bridgePort} is in use: stop the other @page2ai/mcp first`)));
  s.listen(bridgePort, '127.0.0.1', () => s.close(resolve));
});

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run', '--disable-features=ChromeWhatsNewUI', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

const MANUAL = process.env.MANUAL_GRANT === '1';
let browser;
try {
  browser = await launch(!MANUAL);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

const waitFor = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
};

let mcp;
let stderr = '';
try {
  // Chrome first: the extension's ID is the Origin the server has to accept.
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  const extensionId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  console.log(`extension: ${EXT_PATH} (${extensionId})`);
  console.log(`server:    ${MCP_ENTRY}`);
  console.log(`expect:    ${EXPECT}; page ${pageUrl}; bridge port ${bridgePort}`);

  mcp = spawn(process.execPath, [MCP_ENTRY], {
    env: {
      ...process.env,
      PAGE2AI_BRIDGE_PORT: String(bridgePort),
      // An unpacked build has its own ID, not the store's. E2E_NO_ORIGIN=1 is
      // the negative control: the server must then refuse this extension.
      PAGE2AI_BRIDGE_ORIGINS: process.env.E2E_NO_ORIGIN ? '' : `chrome-extension://${extensionId}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  mcp.stderr.on('data', (d) => { stderr += d; });
  let stdoutBuf = '';
  const waiters = new Map();
  mcp.stdout.on('data', (d) => {
    stdoutBuf += d;
    let i;
    while ((i = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, i);
      stdoutBuf = stdoutBuf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && waiters.has(msg.id)) {
        waiters.get(msg.id)(msg);
        waiters.delete(msg.id);
      }
    }
  });
  const rpc = (id, method, params, ms) => new Promise((resolve) => {
    waiters.set(id, resolve);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (waiters.delete(id)) resolve(null); }, ms);
  });

  check('server bridge listening', await waitFor(() => stderr.includes('bridge listening'), 15000));

  // The user's path: the popup's Agent Bridge switch, clicked.
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  await popup.waitForSelector('#bridge-toggle', { timeout: 10000 });
  // Opened in a tab, the popup's own chrome-extension:// page is the active
  // tab: a page it cannot extract, like the New Tab page for a real user. The
  // switch has to work there too.
  if (MANUAL) console.log('\n>>> In the Chrome window: answer the Page2AI site-access prompt with Allow (2 minutes) <<<\n');
  await popup.click('#bridge-toggle');
  const viaSwitch = await waitFor(() => stderr.includes('bridge: extension connected'), MANUAL ? 120000 : 8000);
  const afterClick = await popup.$eval('#bridge-status', (n) => `${n.dataset.state}: ${n.textContent}`).catch(() => '?');
  console.log(`popup status after the switch: ${afterClick}`);
  if (EXPECT === 'bridge') check('popup switch connects the bridge (on a page it cannot extract)', viaSwitch);
  if (!viaSwitch) {
    // The fallback arm runs a production build: the switch asks for site
    // access and no one answers the prompt. Model a user who enabled the
    // bridge and revoked the access later: send what the switch sends after
    // a grant. (In the bridge arm this keeps the pipeline under test.)
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'PAGE2AI_BRIDGE_TOGGLE', enabled: true }));
  }
  check('extension connected to the bridge',
    await waitFor(() => stderr.includes('bridge: extension connected'), 20000));
  const popupStatus = await popup.$eval('#bridge-status', (n) => `${n.dataset.state}: ${n.textContent}`).catch(() => '?');
  console.log(`popup status: ${popupStatus}`);
  void sw;

  const init = await rpc(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'page2ai-e2e-bridge', version: '0' },
  }, 15000);
  check('initialize answered', Boolean(init?.result), init?.result?.serverInfo?.version ?? '');
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const call = await rpc(2, 'tools/call', {
    name: 'page_to_markdown',
    arguments: { url: pageUrl, timeout_ms: 15000 },
  }, 60000);
  const text = call?.result?.content?.[0]?.text ?? '';
  const isError = call?.result?.isError === true;
  console.log(`tool: isError=${isError} chars=${text.length} :: ${text.slice(0, 200).replace(/\n/g, ' | ')}`);
  const viaBrowser = hits.filter((h) => h.browser).length;
  const viaServer = hits.length - viaBrowser;
  console.log(`fixture requests: browser=${viaBrowser} server=${viaServer}`);

  if (EXPECT === 'bridge') {
    check('tool answered without an error', Boolean(call) && !isError);
    check('answer holds the page marker', text.includes(MARKER));
    check('page came through the extension', viaBrowser > 0 && viaServer === 0);
  } else {
    // No site access: the extension refuses before opening a tab, and the
    // server answers by its own fetch, as it does without the bridge. For a
    // 127.0.0.1 page that answer is the SSRF guard's refusal.
    check('extension refused for missing site access', `${stderr}${text}`.includes('PERMISSION_REQUIRED'));
    check('no tab was opened for the page', viaBrowser === 0);
    check('server answered by its own route, not a bridge failure',
      Boolean(call) && !text.startsWith('Bridge conversion failed'), text.slice(0, 90));
  }
} finally {
  const bridgeLines = stderr.split('\n').filter((l) => /bridge/i.test(l)).slice(0, 12);
  if (bridgeLines.length) console.log(`server log:\n  ${bridgeLines.join('\n  ')}`);
  mcp?.kill();
  await browser.close().catch(() => {});
  server.close();
}

console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
