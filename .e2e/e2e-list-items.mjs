// Page2AI e2e suite for list items (P2A-025): the agent script (the extension's extractor, bundled by
// scripts/build-agent.mjs) on fixture pages.
//
//  /wrapped — an <li> built from <div>/<p> wrappers with no whitespace between tags, the shape React and Tailwind
//             apps render: no words glue at a block boundary, the link keeps its URL, a `hidden` span stays out
//             of the link, a visibility:hidden copy of a tab label does not double it, a `hidden="until-found"`
//             panel is kept, and the button's label keeps a space between its block spans.
//  /blocks  — an ordered list whose items hold a <pre>, a <table>, two paragraphs and a nested list: each block
//             renders below its bullet (1.7.0 dropped a <pre> or <table> that sat directly in an <li>), and the
//             numbering runs on.
//  /plain   — lists with inline content only: the output these always had, line for line (the control).
//
// Run:  npm i --no-save puppeteer-core
//       npm run build:agent
//       node .e2e/e2e-list-items.mjs

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

// AGENT_FN=<path> runs the suite on another build (the negative control: 1.7.0 must fail it).
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

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)} .row{display:flex;gap:8px}
.col{display:flex;flex-direction:column} .blk{display:block} .tab{position:relative}</style></head>
<body><main><h1>${title}</h1>
<p>Fixture prose so that the extractor keeps the main region of this page as the content.</p>
${body}
<p>Closing paragraph of the fixture page, also prose, so the main region is long enough.</p></main></body></html>`;

const ROUTES = {
  '/wrapped': page('Wrapped items', `<ul>
<li class="row"><span aria-hidden="true">!</span><div class="col"><button class="col" aria-expanded="true"><span class="blk"><span class="sr">Warning:</span> Alpha title</span><span class="blk"><span>file.json</span> <span aria-hidden="true">&#183;</span> <span>fieldOne</span></span></button><p>Alpha summary sentence.</p><div><p>Alpha detail sentence.</p><p><a href="https://example.com/docs" target="_blank"><span>Docs</span><span hidden>(opens in new tab)</span></a><code class="blk">ALPHA_CODE</code></p></div></div></li>
<li>Plain item with <a href="https://example.com/plain">a link</a> and <code>PLAIN_CODE</code>.</li>
</ul>
<p><a class="tab" href="https://example.com/?tab=one"><span style="position:absolute">Overview</span><span aria-hidden="true" style="visibility:hidden">Overview</span></a></p>
<div><button aria-expanded="false">All checks</button><div hidden="until-found"><p>Security scan passed.</p></div></div>`),
  '/blocks': page('Block items', `<ol>
<li><p>Install the package:</p><pre><code>npm install example-pkg</code></pre></li>
<li>Compare the plans:<table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Free</td><td>0</td></tr></tbody></table></li>
<li><div><p>First paragraph of step three.</p><p>Second paragraph of step three.</p></div></li>
<li>Step four with a nested list<ul><li>Nested one</li><li>Nested two</li></ul></li>
</ol>`),
  '/plain': page('Plain items', `<ul>
<li>Alpha item with <a href="https://example.com/a">a link</a> and <code>code</code>.</li>
<li><strong>Bold</strong> item</li>
<li><div>Wrapped <a href="https://example.com/w">inline link</a> only</div></li>
<li>Parent item<ul><li>Child item</li></ul></li>
</ul>
<ol><li>First</li><li>Second</li></ol>`),
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

const extract = async (route) => {
  const tab = await browser.newPage();
  await tab.goto(base + route, { waitUntil: 'load' });
  const r = await tab.evaluate(`(${AGENT_FN})({})`);
  await tab.close();
  const md = String(r?.markdown || '');
  // The page body only: from the fixture's h1 to the end of the main region.
  const start = md.indexOf('# ');
  const end = md.indexOf('<!-- AI: MAIN CONTENT END -->');
  return md.slice(start < 0 ? 0 : start, end < 0 ? md.length : end);
};

try {
  const w = await extract('/wrapped');
  check('/wrapped: no words glued at a block boundary', !/sentence\.(?:Alpha|Docs)|titlefile|DocsALPHA/.test(w));
  check('/wrapped: the paragraphs of the item stay apart', /Alpha summary sentence\.\s*\n[\s\S]*Alpha detail sentence\./.test(w));
  check('/wrapped: the link inside the item keeps its URL', w.includes('[Docs](https://example.com/docs)'));
  check('/wrapped: code inside the item stays code', w.includes('`ALPHA_CODE`'));
  check('/wrapped: a hidden span is not in the link', !w.includes('(opens in new tab)'));
  check('/wrapped: a visibility:hidden copy does not double a label', w.includes('[Overview](https://example.com/?tab=one)') && !w.includes('Overview Overview'));
  check('/wrapped: a hidden="until-found" panel is kept', w.includes('Security scan passed.'));
  check('/wrapped: the button label keeps a space between its block spans', /Alpha title file\.json/.test(w));
  check('/wrapped: the plain item next to it is unchanged', w.includes('- Plain item with [a link](https://example.com/plain) and `PLAIN_CODE`.'));

  const b = await extract('/blocks');
  check('/blocks: a <pre> in an item is a fence under its bullet', /^1\. Install the package:\s*\n\s*\n\s+```[^\n]*\n\s*npm install example-pkg\n\s+```/m.test(b), b.slice(b.indexOf('1.'), b.indexOf('1.') + 160).replace(/\n/g, '\\n'));
  check('/blocks: a <table> in an item keeps its rows', /\|\s*Plan\s*\|\s*Price\s*\|/.test(b) && /\|\s*Free\s*\|\s*0\s*\|/.test(b));
  check('/blocks: two paragraphs in a wrapper stay two paragraphs', /^3\. First paragraph of step three\.\s*\n\s*\n\s*Second paragraph of step three\./m.test(b));
  check('/blocks: the numbering runs on', /^2\. Compare the plans:/m.test(b) && /^4\. Step four with a nested list$/m.test(b));
  check('/blocks: the nested list is under its item', /^4\. Step four with a nested list\n\s+- Nested one\n\s+- Nested two$/m.test(b));

  const p = await extract('/plain');
  const want = [
    '- Alpha item with [a link](https://example.com/a) and `code`.',
    '- **Bold** item',
    '- Wrapped [inline link](https://example.com/w) only',
    '- Parent item',
    '1. First',
    '2. Second',
  ];
  const lines = p.split('\n');
  const miss = want.filter((l) => !lines.includes(l));
  // 1.7.0 printed the third line as «- Wrapped inline link only» (the <div> through textContent): the link is new.
  check('/plain: inline-only items print as one line each (a <div> wrapper keeps its link)', miss.length === 0, miss.join(' | '));
  check('/plain: the child item follows its parent', /^- Parent item\n\s+- Child item$/m.test(p));
} catch (e) {
  check('suite ran', false, String(e?.stack || e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
