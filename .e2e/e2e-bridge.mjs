// Page2AI Agent Bridge e2e: real Chrome + a built extension + the real
// @page2ai/mcp server over stdio. An agent's page_to_markdown call with a URL
// must travel MCP -> WebSocket -> extension -> background tab -> extractor and
// back. The fixture server tells the two routes apart: Chrome sends
// `sec-fetch-mode` on a navigation, the server's own fetch does not.
//
// page2ai-bridge/2 (@page2ai/mcp 0.6.0): the server holds the key the popup shows.
// Before the real server, the bridge arm runs three others on port 3025:
//   squatter  a program that took the port without the key; it answers the hello
//             with a welcome and a convert (round 1), a challenge with a made-up proof
//             and a convert in one TCP write (round 2), or the convert before that
//             challenge (round 3). No tab may open; nothing but hellos may reach it.
//   silent    a program that takes the socket and never answers: the popup must
//             name it as not Page2AI once the extension cuts it.
//   no key    the real server without PAGE2AI_BRIDGE_KEY: the popup must say so.
// After the paired call (1.6.0): include_images / include_frontmatter false must reach the
// extractor; a page that redirects to a private address must be refused by the extension
// before anything runs there; a server started while the service worker sleeps must be
// reached by the reconnect alarm alone, no tab moving meanwhile.
//
// Run:  npm i --no-save puppeteer-core @page2ai/mcp
//       npx wxt build --mode e2e   (grants http(s)://*/*: a user who allowed the bridge)
//       node .e2e/e2e-bridge.mjs
// A missing install, build or Chrome, or port 3025 held by another program, ends
// the run with «SETUP FAIL: <what to do>» and exit code 2.
//
// EXT_PATH   built extension dir (default .output/chrome-mv3-e2e)
// MCP_ENTRY  the server's dist/index.js (default node_modules/@page2ai/mcp/dist/index.js)
// EXPECT     'bridge' (default): the page must come through the extension;
//            'fallback': the extension has no access to the page, so the
//            server must still answer, by its own fetch.
// MANUAL_GRANT=1  production build only: a visible Chrome shows the switch's real
//            site-access prompt, and Allow must turn the bridge on by itself
//            (the popup's own message is dropped, as when the toolbar popup
//            closes under the prompt). Someone answers it, or on Windows
//            .e2e/click-allow.py does, through UI Automation:
//            EXT_PATH=.output/chrome-mv3 MANUAL_GRANT=1 node .e2e/e2e-bridge.mjs > run.log
//            python .e2e/click-allow.py run.log

import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve(process.env.EXT_PATH ?? '.output/chrome-mv3-e2e');
const MCP_ENTRY = path.resolve(process.env.MCP_ENTRY ?? 'node_modules/@page2ai/mcp/dist/index.js');
const EXPECT = process.env.EXPECT ?? 'bridge';
const MANUAL = process.env.MANUAL_GRANT === '1';

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
  <p><img src="/img/bridge-diagram.png" alt="A diagram of the agent bridge fixture page"></p>
</main></body></html>`;
const PRIVATE_MARKER = `private-page-${Date.now().toString(36)}`;
const PRIVATE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Router admin</title></head>
<body><main><h1>Router admin</h1><p>A page on a private address. ${PRIVATE_MARKER}</p></main></body></html>`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

let browser;
let mcp;
let squatter;
// A missing piece stops the run with what to do, not a stack trace.
const setupFail = async (why) => {
  console.log(`SETUP FAIL: ${why}\n\nFAILED: setup`);
  mcp?.kill();
  squatter?.close();
  await browser?.close().catch(() => {});
  process.exit(2);
};
if (!['bridge', 'fallback'].includes(EXPECT)) await setupFail(`EXPECT must be bridge or fallback, got ${EXPECT}`);
if (!existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  await setupFail(`no built extension in ${EXT_PATH}: run npx wxt build (production) or npx wxt build --mode e2e`);
}
if (!existsSync(MCP_ENTRY)) {
  await setupFail(`no MCP server at ${MCP_ENTRY}: the install did not run or failed. ` +
    'Run npm i --no-save puppeteer-core @page2ai/mcp@<version> and read its output; ' +
    'npm view @page2ai/mcp version prints the newest version npm has');
}
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) await setupFail('Chrome not found; set CHROME_PATH');

const hits = [];
const server = createServer((req, res) => {
  hits.push({ browser: Boolean(req.headers['sec-fetch-mode']), path: req.url ?? '' });
  if (req.url === '/agent/redirect-private') {
    res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/private/landed` });
    res.end();
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(req.url?.startsWith('/private/') ? PRIVATE_HTML : TEST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// A name only Chrome resolves (--host-resolver-rules below): @page2ai/mcp 0.5.4 refuses
// loopback through the bridge, as its own fetch does, and passes a name it cannot
// resolve on to the browser.
const FIXTURE_HOST = 'agent-fixture.test';
const origin = `http://${FIXTURE_HOST}:${server.address().port}`;
const pageUrl = `${origin}/agent/asked`;
const browserHits = (prefix) => hits.filter((h) => h.browser && h.path.startsWith(prefix)).length;

// The extension reads its port when the background starts, so the test takes
// the default one, as a user does, and stops if anything else holds it (a
// Claude Desktop or Cursor running @page2ai/mcp would win the connection).
const bridgePort = 3025;
const portFree = await new Promise((resolve) => {
  const s = createNetServer();
  s.once('error', () => resolve(false));
  s.listen(bridgePort, '127.0.0.1', () => s.close(() => resolve(true)));
});
if (!portFree) {
  let holder = '';
  if (process.platform === 'win32') {
    // netstat names the PID, tasklist the program: usually Claude Desktop or Cursor.
    const { execSync } = await import('node:child_process');
    const pid = execSync('netstat -ano -p tcp', { encoding: 'utf8' }).split('\n')
      .find((l) => l.includes(`:${bridgePort} `) && /LISTENING/.test(l))?.trim().split(/\s+/).pop();
    if (pid) holder = ` by ${execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' }).split(',')[0].replace(/"/g, '')} (PID ${pid})`;
  }
  server.close();
  await setupFail(`port ${bridgePort} is held${holder}: quit the app running @page2ai/mcp (Claude Desktop, Cursor, ...) and run again`);
}

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run', '--disable-features=ChromeWhatsNewUI', '--no-sandbox', '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${FIXTURE_HOST} 127.0.0.1`,
      // Chrome sends Sec-Fetch-* (the route test below) only to a secure origin.
      `--unsafely-treat-insecure-origin-as-secure=${origin}`],
  });
}

try {
  browser = await launch(!MANUAL);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

const waitFor = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the MCP server over stdio -------------------------------------------
let stderr = '';
let stdoutBuf = '';
const waiters = new Map();
const startMcp = (key) => {
  stdoutBuf = '';
  mcp = spawn(process.execPath, [MCP_ENTRY], {
    env: {
      ...process.env,
      PAGE2AI_BRIDGE_PORT: String(bridgePort),
      PAGE2AI_BRIDGE_KEY: key,
      // An unpacked build has its own ID, not the store's. E2E_NO_ORIGIN=1 is
      // the negative control: the server must then refuse this extension.
      PAGE2AI_BRIDGE_ORIGINS: process.env.E2E_NO_ORIGIN ? '' : `chrome-extension://${extensionId}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  mcp.stderr.on('data', (d) => { stderr += d; });
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
};
const stopMcp = async () => {
  if (!mcp || mcp.exitCode !== null) return;
  const exited = new Promise((r) => mcp.once('exit', r));
  mcp.kill();
  await exited;
};
const rpc = (id, method, params, ms) => new Promise((resolve) => {
  waiters.set(id, resolve);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  setTimeout(() => { if (waiters.delete(id)) resolve(null); }, ms);
});

let extensionId = '';
try {
  // Chrome first: the extension's ID is the Origin the server has to accept.
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  extensionId = new URL(swTarget.url()).host;
  console.log(`extension: ${EXT_PATH} (${extensionId})`);
  console.log(`server:    ${MCP_ENTRY}`);
  console.log(`expect:    ${EXPECT}; page ${pageUrl}; bridge port ${bridgePort}`);

  // The popup in a tab: its own chrome-extension:// page is then the active tab,
  // a page it cannot extract, like the New Tab page for a real user. The switch
  // has to work there too.
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  await popup.waitForSelector('#bridge-toggle', { timeout: 10000 });
  const bridgeStatus = () => popup.$eval('#bridge-status',
    (n) => ({ state: n.dataset.state ?? '', problem: n.dataset.problem ?? '', text: n.textContent ?? '' })).catch(() => ({}));
  const helpText = () => popup.$eval('#bridge-help', (n) => n.textContent ?? '').catch(() => '');
  // What the switch sends after a grant; off then on also restarts the backoff.
  const toggle = (on) => popup.evaluate((enabled) => chrome.runtime.sendMessage({ type: 'PAGE2AI_BRIDGE_TOGGLE', enabled }), on);
  const reconnect = async () => { await toggle(false); await sleep(200); await toggle(true); };
  // The key, made on first use; an extension older than page2ai-bridge/2 has none.
  const key = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'PAGE2AI_BRIDGE_KEY' }))
    .then((r) => r?.key ?? '').catch(() => '');
  check('the extension made a key in the format the server reads', /^[A-Za-z0-9_-]{43}$/.test(key));

  const pairedRun = EXPECT === 'bridge' && !MANUAL;
  if (pairedRun) {
    // --- squatter: a program on the port without the key ---------------------
    // Every tab Chrome opens meanwhile counts, not only those that reach the fixture.
    const tabsOpened = [];
    const onTarget = (t) => { if (t.type() === 'page') tabsOpened.push(t.url()); };
    browser.on('targetcreated', onTarget);
    const { WebSocketServer } = createRequire(MCP_ENTRY)('ws');
    const squat = { hellos: 0, auths: 0, other: [] };
    squatter = new WebSocketServer({ host: '127.0.0.1', port: bridgePort });
    await new Promise((resolve, reject) => { squatter.once('listening', resolve); squatter.once('error', reject); });
    const convertFor = (round) => ({
      type: 'convert', id: `squat-${round}`, url: `${origin}/squatter/${round}`,
      options: { includeImages: true, includeFrontmatter: true, timeoutMs: 15000 },
    });
    const madeUpChallenge = (m) => ({ type: 'challenge', protocol: m.protocol, serverVersion: 'squatter',
      nonceS: randomBytes(32).toString('hex'), proof: randomBytes(32).toString('hex') });
    squatter.on('connection', (ws) => ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'auth') squat.auths++;
      if (m.type !== 'hello') { squat.other.push(m.type); return; }
      const round = ++squat.hellos;
      const frames = round === 1
        ? [{ type: 'welcome', protocol: m.protocol, serverVersion: 'squatter', token: 'squatter' }, convertFor(1)]
        : round === 2 ? [madeUpChallenge(m), convertFor(2)] : [convertFor(round), madeUpChallenge(m)];
      // One TCP write: the convert is already there while the extension checks the proof.
      ws._socket.cork();
      for (const f of frames) ws.send(JSON.stringify(f));
      process.nextTick(() => ws._socket.uncork());
    }));
    await popup.click('#bridge-toggle');
    await waitFor(() => squat.hellos >= 3, 20000);
    await sleep(4000);
    browser.off('targetcreated', onTarget);
    console.log(`squatter: hellos=${squat.hellos} auths=${squat.auths} other=${squat.other.join(',') || '-'} tabs=${tabsOpened.length}`);
    check('squatter: the extension said hello to all three rounds', squat.hellos >= 3);
    check('squatter: no tab opened for its converts', tabsOpened.length === 0 && browserHits('/squatter/') === 0,
      `tabs: ${tabsOpened.join(' ') || 'none'}; browser requests: ${browserHits('/squatter/')}`);
    check('squatter: the extension sent no proof to a server that did not prove the key', squat.auths === 0);
    check('squatter: the extension sent it nothing but hellos', squat.other.length === 0, squat.other.join(','));
    const s1 = await bridgeStatus();
    check('squatter: the popup says the program on the port is not Page2AI', s1.problem === 'untrusted',
      `${s1.state}/${s1.problem}: ${s1.text}`);
    for (const ws of squatter.clients) ws.terminate();
    await new Promise((r) => squatter.close(r));
    squatter = null;

    // --- silent: a program that takes the socket and never answers ------------
    const silentSockets = new Set();
    const silent = createNetServer((s) => { silentSockets.add(s); s.on('error', () => {}); });
    await new Promise((resolve, reject) => { silent.once('error', reject); silent.listen(bridgePort, '127.0.0.1', resolve); });
    await reconnect();
    // The extension cuts it after 10 s. ef12464 then wrote «waiting for the MCP server»
    // over its own verdict, the upgrade never having finished.
    await sleep(11500);
    const sSilent = await bridgeStatus();
    check('silent program: the popup says the program on the port is not Page2AI', sSilent.problem === 'untrusted',
      `${sSilent.state}/${sSilent.problem}: ${sSilent.text}`);
    for (const s of silentSockets) s.destroy();
    await new Promise((r) => silent.close(r));

    // --- the real server without a key ----------------------------------------
    startMcp('');
    check('no key: server bridge listening', await waitFor(() => stderr.includes('bridge listening'), 15000));
    await reconnect();
    const noKey = await waitFor(async () => (await bridgeStatus()).problem === 'no-key', 15000);
    const s2 = await bridgeStatus();
    check('no key: the popup says the server has no key', noKey, `${s2.state}/${s2.problem}: ${s2.text}`);
    check('no key: the popup says where the key goes', /settings/.test(await helpText()) &&
      (await popup.$eval('.bridge-where', (n) => n.textContent ?? '').catch(() => '')).includes('PAGE2AI_BRIDGE_KEY'));
    check('no key: the server log says what to paste where', /has no PAGE2AI_BRIDGE_KEY: copy the key from the Page2AI popup/.test(stderr));
    await stopMcp();
  }

  // --- the real server with the key ------------------------------------------
  let serverKey = key;
  if (pairedRun) {
    // The user's path: Show, then the value the popup prints.
    await popup.click('#bridge-key-show');
    await waitFor(async () => /^[A-Za-z0-9_-]{43}$/.test(
      await popup.$eval('#bridge-key', (n) => (n.textContent ?? '').trim()).catch(() => '')), 5000);
    const shown = await popup.$eval('#bridge-key', (n) => (n.textContent ?? '').trim()).catch(() => '');
    check('the popup shows the same key on Show', shown === key && key !== '');
    serverKey = shown;
    // Copy key when the clipboard API refuses (the popup lost focus): ef12464's fallback
    // copied the preview's Markdown and said «Copied». The key itself is never printed.
    await popup.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('Document is not focused.'));
      const exec = document.execCommand.bind(document);
      document.execCommand = (cmd, ...rest) => {
        if (cmd !== 'copy') return exec(cmd, ...rest);
        const field = [...document.querySelectorAll('textarea, input')]
          .find((f) => typeof f.selectionStart === 'number' && f.selectionEnd > f.selectionStart);
        window.copiedText = field ? field.value.slice(field.selectionStart, field.selectionEnd) : String(document.getSelection());
        return true;
      };
    });
    await popup.click('#bridge-key-copy');
    await waitFor(async () => (await popup.evaluate(() => window.copiedText ?? null)) !== null, 5000);
    const copiedText = await popup.evaluate(() => window.copiedText ?? null);
    check('Copy key copies the key when the clipboard API refuses', copiedText === key,
      `copied ${copiedText === null ? 'nothing' : `${String(copiedText).length} characters, ${copiedText === key ? 'the key' : 'not the key'}`}`);
  }
  stderr = '';
  startMcp(serverKey);
  check('server bridge listening', await waitFor(() => stderr.includes('bridge listening'), 15000));

  if (pairedRun) {
    await reconnect();
  } else {
    if (MANUAL) {
      // The real toolbar popup can close when the prompt takes focus, and then only the
      // background's permissions.onAdded can turn the bridge on. Model that: drop the
      // message the popup sends after a grant.
      const preGranted = await popup.evaluate(() =>
        chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }));
      if (preGranted) await setupFail('MANUAL_GRANT needs the production build (EXT_PATH=.output/chrome-mv3): this build already has site access, so no prompt appears');
      await popup.evaluate(() => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.droppedToggles = 0;
        chrome.runtime.sendMessage = (msg, ...rest) => {
          if (msg?.type === 'PAGE2AI_BRIDGE_TOGGLE') { window.droppedToggles++; return Promise.resolve(); }
          return send(msg, ...rest);
        };
      });
      console.log(`browser pid: ${browser.process()?.pid ?? '?'}`);
      console.log('\n>>> In the Chrome window: answer the Page2AI site-access prompt with Allow (2 minutes) <<<\n');
    }
    await popup.click('#bridge-toggle');
    const viaSwitch = await waitFor(() => stderr.includes('bridge: extension connected'), MANUAL ? 120000 : 8000);
    if (MANUAL) {
      const dropped = await popup.evaluate(() => window.droppedToggles).catch(() => 0);
      check('Allow alone turns the bridge on (background permissions.onAdded; popup message dropped)',
        viaSwitch && dropped > 0, `dropped popup toggles: ${dropped}`);
    }
    if (!viaSwitch) {
      // The fallback arm runs a production build: the switch asks for site
      // access and no one answers the prompt. Model a user who enabled the
      // bridge and revoked the access later: send what the switch sends after
      // a grant.
      await toggle(true);
    }
  }
  check('extension paired with the server and connected',
    await waitFor(() => stderr.includes('bridge: extension connected'), 20000));
  const s3 = await bridgeStatus();
  console.log(`popup status: ${s3.state}/${s3.problem || '-'}: ${s3.text}`);
  if (EXPECT === 'bridge') check('the popup says connected', s3.state === 'connected' && !s3.problem);

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
  const pageHits = hits.filter((h) => h.path.startsWith('/agent/'));
  const viaBrowser = pageHits.filter((h) => h.browser).length;
  const viaServer = pageHits.length - viaBrowser;
  console.log(`fixture requests: browser=${viaBrowser} server=${viaServer}`);

  if (EXPECT === 'bridge') {
    check('tool answered without an error', Boolean(call) && !isError);
    check('answer holds the page marker', text.includes(MARKER));
    check('page came through the extension', viaBrowser > 0 && viaServer === 0);

    // include_images / include_frontmatter: bfba0b8 sent them and the extractor ignored them.
    check('default options keep the image and the frontmatter', text.includes('![') && /^---\n/.test(text));
    const bare = await rpc(3, 'tools/call', {
      name: 'page_to_markdown',
      arguments: { url: `${origin}/agent/options-off`, timeout_ms: 15000, include_images: false, include_frontmatter: false },
    }, 60000);
    const bareText = bare?.result?.content?.[0]?.text ?? '';
    check('include_images and include_frontmatter false: no image, no frontmatter',
      bareText.includes(MARKER) && !bareText.includes('![') && !/^captured_at: /m.test(bareText),
      bareText.slice(0, 120).replace(/\n/g, ' | '));

    // A page that redirects to a private address. bfba0b8 ran the extractor there and
    // only the server's check of the landed URL kept the text from the agent.
    const redir = await rpc(4, 'tools/call', {
      name: 'page_to_markdown',
      arguments: { url: `${origin}/agent/redirect-private`, timeout_ms: 15000 },
    }, 60000);
    const redirText = (redir?.result?.content ?? []).map((c) => c.text ?? '').join('\n');
    // «redirected to» is the landed-page check, before anything is injected; the check of
    // the result's document says «moved to», which would mean the extractor ran there.
    check('redirect to a private address: the extension refuses the page it landed on',
      !redirText.includes(PRIVATE_MARKER) && `${stderr}${redirText}`.includes('RESTRICTED_URL') &&
      `${stderr}${redirText}`.includes('The page redirected to'),
      redirText.slice(0, 160).replace(/\n/g, ' | '));

    if (pairedRun) {
      // A server started while the service worker sleeps. bfba0b8 retried by setTimeout,
      // which dies with the worker, so it waited for some tab event. Nothing moves here.
      await stopMcp();
      const swNow = await browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 10000 });
      await (await swNow.worker()).close();
      await sleep(2000);
      stderr = '';
      startMcp(serverKey);
      check('restarted server listening', await waitFor(() => stderr.includes('bridge listening'), 15000));
      // The alarm fires within 30 s of the worker's last start; Chrome may run it later
      // than asked, and the wait ends as soon as the extension connects.
      const woke = await waitFor(() => stderr.includes('bridge: extension connected'), 75000);
      check('a server started while the service worker slept is reached (reconnect alarm)', woke);
    }
  } else {
    // No site access: the extension refuses before opening a tab, and the
    // server answers by its own fetch, as it does without the bridge. For this
    // page that answer is a DNS failure: only Chrome maps the name.
    check('extension refused for missing site access', `${stderr}${text}`.includes('PERMISSION_REQUIRED'));
    check('no tab was opened for the page', viaBrowser === 0);
    check('server answered by its own route, not a bridge failure',
      Boolean(call) && !text.startsWith('Bridge conversion failed'), text.slice(0, 90));
  }
} finally {
  const bridgeLines = stderr.split('\n').filter((l) => /bridge/i.test(l)).slice(0, 12);
  if (bridgeLines.length) console.log(`server log:\n  ${bridgeLines.join('\n  ')}`);
  mcp?.kill();
  squatter?.close();
  await browser.close().catch(() => {});
  server.close();
}

console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
