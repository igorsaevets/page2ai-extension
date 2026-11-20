// Page2AI e2e suite for app interfaces (P2A-063..P2A-067, P2A-069): the agent script (the extension's extractor,
// bundled by scripts/build-agent.mjs) on fixture pages shaped like Google Search Console, measured T275/T276.
//
//  /icons    — icon fonts: a ligature word or a private-use glyph is not text; an icon-only control is named by its
//              aria-label; an icon that names itself (role="img" + aria-label) keeps that name. Controls: words in an
//              ordinary font, text that mixes private-use code points with letters, and an account link whose
//              aria-label holds a name and an e-mail (it must not print).
//  /hidden   — text nobody sees: an aria-hidden tooltip cut to 1 x 1 px, a live region cut to 88 x 1 px (an SPA
//              route announcer). Controls that must stay: an sr-only button label, sr-only words in prose, visible
//              aria-hidden text (E-370), a collapsed accordion panel (aria-hidden, 0 px tall, full width), a skip link.
//  /controls — a listbox showing its chosen option only, role="heading", <a> without href, href="", an iframe
//              without a source; an open listbox stays as it was.
//  /links    — a page of long links: the quality ratio leaves link targets out.
//
// Run:  npm i --no-save puppeteer-core
//       npm run build:agent
//       node .e2e/e2e-dashboard-noise.mjs
// AGENT_FN=<path> runs the suite on another build (the negative control: 1.7.1 must fail it).

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const AGENT_FN_PATH = path.resolve(process.env.AGENT_FN || '.output/agent/page2ai-agent.fn.js');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

// Font families as Search Console declares them; no font file is served, the computed family is what counts.
const page = (title, body, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}
<style>.gs{font-family:'Google Symbols','Material Icons Extended'} .mi{font-family:'Material Icons'}
.ms{font-family:'Material Symbols Outlined'} .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.tip{position:absolute;left:-10000px;top:56px;width:1px;height:1px;overflow:hidden}
.ann{position:absolute;top:-1000px;left:0;width:88px;height:1px;overflow:hidden}
.skip{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.zero{height:0;overflow:hidden} .parked{position:absolute;top:-99999px}</style></head>
<body><main><h1>${title}</h1>
<p>Fixture prose so that the extractor keeps the main region of this page as the content.</p>
${body}
<p>Closing paragraph of the fixture page, also prose, so the main region is long enough.</p></main></body></html>`;

const LONG = 'https://example.com/search-console/index/drilldown?resource_id=sc-domain%3Aexample.com&item_key=CAMYCyAC&hl=en&page=';
const ROUTES = {
  '/icons': page('Icon fonts', `
<div><button aria-label="Help"><span class="gs" aria-hidden="true">help_outline</span></button></div>
<div><button aria-label="Unread messages: 11"><span class="gs" aria-hidden="true">notifications</span></button></div>
<div><a href="https://example.com/overview"><span class="gs" aria-hidden="true">home</span> Overview</a></div>
<div><div role="button" tabindex="0" aria-label="Filter table rows"><i class="gs" aria-hidden="true">&#xE152;</i></div></div>
<div><button><span class="ms" aria-hidden="true">add</span>New report</button></div>
<div><a href="https://example.com/settings" aria-label="Settings"><span class="mi">settings</span></a></div>
<p><span class="mi" aria-hidden="true">lock</span> HTTPS works on every page.</p>
<p>Status of the property: <span class="mi" role="img" aria-label="Verified">check_circle</span></p>
<div><button><span>&#xE2C4;</span> EXPORT</button></div>
<p>Plain words keyboard_arrow_down in an ordinary font stay.</p>
<p>Legacy text &#xE000; with letters stays.</p>
<div><a href="https://accounts.example.com/signout" aria-label="Account: Jane Example (jane@example.com)"><img src="https://example.com/avatar.png" alt="" width="32" height="32"></a></div>`),
  '/hidden': page('Hidden text', `
<div><button aria-label="User settings"><span class="gs" aria-hidden="true">manage_accounts</span></button><div role="tooltip" aria-hidden="true" class="tip">User settings tooltip</div></div>
<div aria-live="assertive" class="ann">Route announcer text</div>
<div><button><svg aria-hidden="true" width="10" height="10"></svg><span class="sr">Close dialog</span></button></div>
<p>Read more<span class="sr"> about pricing plans</span> here.</p>
<p aria-hidden="true">Visible decorative quote stays.</p>
<div aria-hidden="true" class="zero">Collapsed answer text stays.</div>
<a class="skip" href="#main">Skip to content</a>`),
  '/controls': page('Controls', `
<div>Rows per page:</div>
<div role="listbox" aria-label="Number of rows per page"><div role="option" aria-selected="false" class="zero">5</div><div role="option" aria-selected="true">10</div><div role="option" aria-selected="false" class="zero">25</div></div>
<div role="listbox"><div role="option" aria-selected="true">All known pages</div><div role="option" aria-selected="false" class="parked">All submitted pages</div></div>
<div role="listbox" aria-label="Open list"><div role="option" aria-selected="true">Alpha option</div><div role="option" aria-selected="false">Beta option</div></div>
<div><span role="heading" aria-level="1">Page with redirect</span></div>
<div role="heading">Default level heading</div>
<div role="heading" aria-level="9">Deep level heading</div>
<div><a role="button" tabindex="0"><span class="gs" aria-hidden="true">search</span>URL inspection</a></div>
<p><a>Plain placeholder</a> without a target.</p>
<p><a href="">This very page</a></p>
<iframe title="Empty frame"></iframe>`),
  '/links': page('Links', `<ul>${Array.from({ length: 40 }, (_, i) => `<li><a href="${LONG}${i}">Item ${i}</a></li>`).join('')}</ul>`,
    '<link rel="canonical" href="https://example.com/declared">'),
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found in standard locations');
  process.exit(2);
}
if (!existsSync(AGENT_FN_PATH)) {
  console.error(`FATAL: ${AGENT_FN_PATH} missing — run npm run build:agent first`);
  process.exit(2);
}
const AGENT_FN = readFileSync(AGENT_FN_PATH, 'utf8');
const server = createServer((req, res) => {
  const route = ROUTES[new URL(req.url, 'http://127.0.0.1').pathname];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.statusCode = route ? 200 : 404;
  res.end(route || 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  pipe: process.platform === 'win32',
  args: ['--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'],
});
// The whole document: frontmatter and the quality block are checked too.
const extract = async (route, opts = { profile: 'dashboard' }) => {
  const tab = await browser.newPage();
  await tab.goto(base + route, { waitUntil: 'load' });
  const r = await tab.evaluate(`(${AGENT_FN})(${JSON.stringify(opts)})`);
  await tab.close();
  return String(r?.markdown || '');
};
const body = (md) => {
  const s = md.indexOf('Fixture prose');
  const e = md.indexOf('<!-- AI: MAIN CONTENT END -->');
  return md.slice(s < 0 ? 0 : s, e < 0 ? md.length : e);
};
try {
  for (const opts of [{ profile: 'dashboard' }, {}]) {
    const tag = opts.profile ? 'dashboard' : 'auto';
    const i = body(await extract('/icons', opts));
    check(`${tag} /icons: an icon-only button is named by its aria-label`, i.includes('[Button: Help]') && i.includes('[Button: Unread messages: 11]'));
    check(`${tag} /icons: no ligature word is printed`, !/help_outline|notifications\]|manage_accounts|\bhome\b|\block\b|\badd\b|settings\]|check_circle/.test(i), (i.match(/help_outline|notifications|\bhome\b|\block\b|\badd\b|check_circle/g) || []).join(','));
    check(`${tag} /icons: a link keeps its words without the icon`, i.includes('[Overview](https://example.com/overview)'));
    check(`${tag} /icons: a private-use glyph is not a name`, i.includes('[Button: Filter table rows]') && !/[\uE000-\uF8FF]\]|\[Button: [\uE000-\uF8FF]/u.test(i));
    check(`${tag} /icons: a button with an icon and words keeps the words`, i.includes('[Button: New report]'));
    check(`${tag} /icons: an icon-only link is named by its aria-label`, i.includes('[Settings](https://example.com/settings)'));
    check(`${tag} /icons: prose keeps its words, not the icon`, /(^|\n)HTTPS works on every page\./.test(i));
    check(`${tag} /icons: an icon that names itself keeps its name`, i.includes('Status of the property: Verified'));
    check(`${tag} /icons: a lone private-use glyph beside words is dropped`, i.includes('[Button: EXPORT]'));
    check(`${tag} /icons: words in an ordinary font stay (control)`, i.includes('Plain words keyboard_arrow_down in an ordinary font stay.'));
    check(`${tag} /icons: private-use code points mixed with letters stay (control)`, i.includes('Legacy text') && /Legacy text [\uE000] with letters stays\./u.test(i));
    check(`${tag} /icons: an account link's aria-label (name, e-mail) is not printed`, !i.includes('jane@example.com') && !i.includes('Jane Example'));
    const h = body(await extract('/hidden', opts));
    check(`${tag} /hidden: an aria-hidden tooltip cut to 1 x 1 px is not printed`, !h.includes('User settings tooltip') && h.includes('[Button: User settings]'));
    check(`${tag} /hidden: a live region cut to 88 x 1 px is not printed`, !h.includes('Route announcer text'));
    check(`${tag} /hidden: an sr-only button label stays (control)`, h.includes('[Button: Close dialog]'));
    check(`${tag} /hidden: sr-only words in prose stay (control)`, h.includes('about pricing plans'));
    check(`${tag} /hidden: visible aria-hidden text stays (control, E-370)`, h.includes('Visible decorative quote stays.'));
    check(`${tag} /hidden: a collapsed accordion panel stays (control)`, h.includes('Collapsed answer text stays.'));
    check(`${tag} /hidden: an off-screen skip link stays (control: not aria-hidden, not live)`, h.includes('Skip to content'));
    const cdoc = await extract('/controls', opts);
    const c = body(cdoc);
    check(`${tag} /controls: a listbox showing one option prints that value with its name`, c.includes('[Listbox: Number of rows per page | selected: 10]') && !/^\s*25\s*$/m.test(c));
    check(`${tag} /controls: a listbox with parked options prints the chosen one`, c.includes('[Listbox | selected: All known pages]') && !c.includes('All submitted pages'));
    check(`${tag} /controls: an open listbox renders as before (control)`, c.includes('Alpha option') && c.includes('Beta option') && !c.includes('[Listbox: Open list'));
    check(`${tag} /controls: role="heading" is a heading at its aria-level`, /^# Page with redirect$/m.test(c));
    check(`${tag} /controls: role="heading" without aria-level is level 2, above 6 is 6`, /^## Default level heading$/m.test(c) && /^###### Deep level heading$/m.test(c));
    check(`${tag} /controls: <a role="button"> without href is a button, not a link`, c.includes('[Button: URL inspection]') && !/\]\(http:\/\/127\.0\.0\.1:\d+\/controls\)[^\n]*$/m.test(c.split('\n').filter((l) => l.includes('URL inspection')).join('\n')));
    check(`${tag} /controls: <a> without href prints its text, no link`, c.includes('Plain placeholder') && !c.includes('[Plain placeholder]('));
    check(`${tag} /controls: href="" stays a link to the document (control)`, c.includes(`[This very page](${base}/controls)`));
    check(`${tag} /controls: an iframe without a source is not an embed of the page`, !c.includes('Embedded iframe'));
    check(`${tag} /controls: no canonical is invented when the page declares none`, /^canonical: ""$/m.test(cdoc));
    const l = await extract('/links', opts);
    check(`${tag} /links: a declared canonical is kept (control)`, /^canonical: "https:\/\/example\.com\/declared"$/m.test(l));
    const status = (l.match(/ratio_status: ([A-Z-]+)/) || [])[1] || 'none';
    check(`${tag} /links: the quality ratio leaves link targets out`, /main_render_text_chars \(link targets left out\): \d+/.test(l) && status !== 'OVER-EXTRACTED-NOISE', `status ${status}`);
  }
} catch (e) {
  check('suite ran', false, String(e?.stack || e));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
