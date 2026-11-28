// Page2AI e2e suite for code blocks (P2A-093): the agent script (the extension's extractor, bundled by
// scripts/build-agent.mjs) on fixture pages. Each block's text in the Markdown must be the text Chrome copies from the
// block (Selection.toString of its <code>, which skips unselectable content as Ctrl+C does), and a literal pins it.
//
//  /starlight — Expressive Code blocks as Starlight writes them: every line a <div class="ec-line">, no newline
//               character between lines, a blank line as <div class="code">\n</div>, indentation in a span, a
//               line-number gutter with user-select: none. 1.7.3 printed a block with no indented line as one line.
//  /layouts   — <br> lines (Docusaurus), lines that are spans displayed as blocks, a table, a <p>, text that Chrome
//               does not copy (display: none, visibility: hidden, user-select: none).
//  /hidden    — blocks Chrome does not show or copy: inside a closed <details>, a <code> with no box of its own
//               (no layout to read: the walk goes by tags, @page2ai/core's codeText rule). The extractor prints each
//               with one line per line.
//  /plain     — blocks whose lines are newline characters, Shiki .line spans and indented code: the output these
//               always had, line for line (the control).
//
// Run:  npm i --no-save puppeteer-core
//       npm run build:agent
//       node .e2e/e2e-code-blocks.mjs
// AGENT_FN=<path> runs the suite on another build (the negative control: 1.7.3 must fail the /starlight and /layouts
// checks and pass /plain).

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

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>pre{font:14px/20px monospace} .expressive-code figure{position:relative}
.ec-line{direction:ltr;unicode-bidi:isolate;display:grid;grid-template-areas:'gutter code';grid-template-columns:auto 1fr;position:relative}
.ec-line .gutter{grid-area:gutter} .expressive-code .ec-line .gutter > *{pointer-events:none;user-select:none;-webkit-user-select:none}
.ec-line .code{grid-area:code;position:relative;box-sizing:content-box;white-space:pre-wrap}
.expressive-code .copy{display:flex;position:absolute;inset-block-start:0;inset-inline-end:0}
.blockline{display:block} .nosel{user-select:none;-webkit-user-select:none}</style></head>
<body><main><h1>${title}</h1>
<p>Fixture prose so that the extractor keeps the main region of this page as the content of the page.</p>
${body}
<p>Closing paragraph of the fixture page, also prose, so the main region is long enough to be kept.</p></main></body></html>`;

// An Expressive Code frame as Starlight renders it (markup copied from docs.astro.build, styles cut).
const ecLine = (code) => `<div class="ec-line"><div class="code">${code}</div></div>`;
const ecFrame = (title, lines, extra = '') =>
  `<div class="expressive-code"><figure class="frame has-title not-content"><figcaption class="header"><span class="title">${title}</span></figcaption>` +
  `<pre data-language="sh"><code>${lines}</code></pre>${extra}</figure></div>`;
const copyButton = '<div class="copy"><div aria-live="polite"></div><button title="Copy to clipboard" data-copied="Copied!" data-code="x"><div></div></button></div>';

const CASES = {
  '/starlight': [
    ['ec-five-lines', 'five unindented Expressive Code lines are five lines',
      ecFrame('Terminal', ['cd scanners', 'python fetch_failures.py --selftest', 'python fetch_failures.py --since 2026-11-01',
        'python other_clis_t265.py', 'python export_t271.py'].map((l) => ecLine(`<span style="--0:#fff">${l}</span>`)).join(''), copyButton),
      'cd scanners\npython fetch_failures.py --selftest\npython fetch_failures.py --since 2026-11-01\npython other_clis_t265.py\npython export_t271.py'],
    ['ec-blank-line', 'a blank Expressive Code line is one blank line',
      ecFrame('deploy.yml', [ecLine('name: Deploy'), ecLine('\n'), ecLine('on:'), ecLine('<span class="indent">  </span>push:')].join(''), copyButton),
      'name: Deploy\n\non:\n  push:'],
    ['ec-indented', 'indented Expressive Code lines keep their indentation',
      ecFrame('app.py', [ecLine('def main():'), ecLine('<span class="indent">    </span>run()')].join('')),
      'def main():\n    run()'],
    ['ec-gutter', 'a user-select: none line-number gutter is left out',
      ecFrame('gutter.sh', ['echo one', 'echo two'].map((l, i) =>
        `<div class="ec-line"><div class="gutter"><div class="ln" aria-hidden="true">${i + 1}</div></div><div class="code">${l}</div></div>`).join('')),
      'echo one\necho two'],
  ],
  '/layouts': [
    ['br-lines', '<br> lines without indentation are lines',
      '<pre class="prism-code"><code><span class="token-line"><span class="token plain">cd my-website</span><br></span><span class="token-line"><span class="token plain">npx docusaurus start</span><br></span></code></pre>',
      'cd my-website\nnpx docusaurus start'],
    ['css-block-lines', 'spans displayed as blocks are lines',
      '<pre><code><span class="blockline">alpha()</span><span class="blockline">beta()</span></code></pre>',
      'alpha()\nbeta()'],
    ['table-lines', 'a table in code: cells by a tab, rows by a line',
      '<pre><code><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></code></pre>',
      'a\tb\nc\td'],
    ['not-copied', 'text Chrome does not copy is left out',
      '<pre><code>keep1<span style="display:none">DROP1</span>\nkeep2<span style="visibility:hidden">DROP2</span>\n<span class="nosel">$ </span>keep3</code></pre>',
      'keep1\nkeep2\nkeep3'],
  ],
  '/hidden': [
    ['hidden-ec', 'a block in a closed <details> is printed with its lines',
      '<details><summary>Show the commands</summary>' + ecFrame('Terminal', ['npm ci', 'npm test'].map((l) => ecLine(l)).join('')) + '</details>',
      'npm ci\nnpm test'],
    ['contents-code', 'a <code> with no box of its own (display: contents) goes by tags: one line per line',
      '<pre><code style="display:contents">' + ['git add .', 'git commit'].map((l) => ecLine(l)).join('') + '</code></pre>',
      'git add .\ngit commit'],
  ],
  '/plain': [
    ['newline-lines', 'newline characters stay lines',
      '<pre><code>line one\nline two\n  indented three</code></pre>', 'line one\nline two\n  indented three'],
    ['shiki-lines', 'Shiki .line spans with newlines stay lines',
      '<pre class="shiki"><code><span class="line"><span>const a = 1;</span></span>\n<span class="line"><span>  const b = 2;</span></span></code></pre>',
      'const a = 1;\n  const b = 2;'],
    ['one-line', 'a one-line block stays one line', '<pre><code>npm install example-pkg</code></pre>', 'npm install example-pkg'],
  ],
};

const ROUTES = Object.fromEntries(Object.entries(CASES).map(([route, cases]) => [route,
  page(route.slice(1), cases.map(([id, , html]) => `<h2>${id}</h2>\n${html}`).join('\n<p>Text between blocks.</p>\n'))]));

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

// The fenced block after the `## <id>` heading, without its fence lines.
const blockAfter = (md, id) => {
  const lines = md.split('\n');
  const h = lines.findIndex((l) => l.trim() === `## ${id}`);
  if (h < 0) return null;
  const open = lines.findIndex((l, i) => i > h && /^\s*(`{3,}|~{3,})/.test(l));
  if (open < 0) return null;
  const indent = /^\s*/.exec(lines[open])[0].length;
  const fence = /^\s*(`{3,}|~{3,})/.exec(lines[open])[1];
  const close = lines.findIndex((l, i) => i > open && l.trim() === fence);
  if (close < 0) return null;
  return lines.slice(open + 1, close).map((l) => l.slice(Math.min(indent, /^\s*/.exec(l)[0].length))).join('\n');
};

try {
  for (const [route, cases] of Object.entries(CASES)) {
    const tab = await browser.newPage();
    await tab.goto(base + route, { waitUntil: 'load' });
    // What Chrome copies from each block's <code>, read before the extractor runs (it can change the page).
    const copied = await tab.evaluate(() => [...document.querySelectorAll('pre')].map((pre) => {
      const el = pre.querySelector('code') || pre;
      const s = getSelection();
      s.removeAllRanges();
      s.selectAllChildren(el);
      const t = s.toString();
      s.removeAllRanges();
      // checkVisibility() is false under display: none and inside content Chrome does not render (a closed <details>).
      const rendered = typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;
      return { rendered, text: t.replace(/\u00a0/g, ' ').replace(/^\n+|\n+$/g, '') };
    }));
    const r = await tab.evaluate(`(${AGENT_FN})({})`);
    await tab.close();
    const md = String(r?.markdown || '');
    if (process.env.DUMP === route.slice(1)) console.log(md); // DUMP=hidden prints that page's Markdown
    cases.forEach(([id, what, , want], i) => {
      const got = blockAfter(md, id);
      const chrome = copied[i];
      const vsChrome = chrome.rendered ? got === chrome.text : true;
      check(`${route} ${id}: ${what}`, got === want && vsChrome,
        got === want && vsChrome ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}, Chrome copies ${chrome.rendered ? JSON.stringify(chrome.text) : '(not rendered)'}`);
    });
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
