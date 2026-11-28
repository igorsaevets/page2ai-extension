#!/usr/bin/env node
// Unit test for dedupeTabPanelDuplicates in lib/core/md-postprocess.ts (P2A-102). The pass removes main-flow content
// that a captured tab panel already carries. A code block is one unit: it gives way whole, fences included, when its
// lines are one of the panels' code blocks, and stays as written otherwise; no run of prose lines reaches into it.
// Each input is the renderer's shape (a panel under its tab button, then the main flow), each want the exact output.
// Extension 1.7.5 fails 11 of the 16 pass cases and the chain case. Node 24 strips the types, so the module is imported
// as it ships.
//
//   node scripts/md-tabpanels.test.mjs
//   PP_MODULE=<path to another md-postprocess.ts> node scripts/md-tabpanels.test.mjs   (run it on another build)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.PP_MODULE || join(ROOT, 'lib/core/md-postprocess.ts');
const { dedupeTabPanelDuplicates, postProcessMarkdown, createFenceTracker } = await import(pathToFileURL(MOD).href);
const { DEFAULTS } = await import(pathToFileURL(join(ROOT, 'lib/constants.ts')).href);

const L = (...lines) => lines.join('\n');
const same = (s) => [s, s];
const F = '```';
const C = '<!-- AI: TAB PANEL CONTENT ALREADY EXPORTED ABOVE (deduplicated) -->';
// a captured panel as renderButton writes it
const P = (name, ...body) => [
  `[Tab Button: ${name}]`, '', `<!-- AI: TAB PANEL START: ${name} -->`, '', ...body, '', `<!-- AI: TAB PANEL END: ${name} -->`, '',
];
const X = P('a.ts', F, 'x1()', 'x2()', 'x3()', F);

const CASES = [
  ['a block that shares its last lines and closing fence with a panel stays whole (the P2A-102 repro)',
    ...same(L(...X, 'Main flow:', '', F, 'import y', 'x1()', 'x2()', 'x3()', F, '', 'After the block.'))],
  ['a block that shares its opening fence and first lines with a panel stays whole',
    ...same(L(...X, 'Main flow:', '', F, 'x1()', 'x2()', 'import z', 'z()', F, '', 'After the block.'))],
  ['a block that shares three middle lines with a panel stays whole',
    ...same(L(...X, 'Main flow:', '', F, 'import y', 'x1()', 'x2()', 'x3()', 'y()', F, '', 'After the block.'))],
  ['a whole duplicate of a panel block gives way, fences included',
    L(...X, 'Main flow:', '', F, 'x1()', 'x2()', 'x3()', F, '', 'After the block.'),
    L(...X, 'Main flow:', '', C, '', 'After the block.')],
  ['a whole duplicate with a blank line in it gives way whole',
    L(...P('a.ts', F, 'a1()', 'a2()', 'a3()', '', 'b1()', F), 'Main flow:', '', F, 'a1()', 'a2()', 'a3()', '', 'b1()', F, '', 'After.'),
    L(...P('a.ts', F, 'a1()', 'a2()', 'a3()', '', 'b1()', F), 'Main flow:', '', C, '', 'After.')],
  ['blank lines do not count: a line of one space (as Chrome copies it) where the panel has an empty line',
    L(...P('a.ts', F, 'a()', '', 'b()', F), 'Main flow:', '', F, 'a()', ' ', 'b()', F, '', 'After.'),
    L(...P('a.ts', F, 'a()', '', 'b()', F), 'Main flow:', '', C, '', 'After.')],
  ['the same lines in another order are another block: it stays',
    ...same(L(...X, 'Main flow:', '', F, 'x3()', 'x2()', 'x1()', F, '', 'After.'))],
  ['a duplicate on a list item marker line keeps the marker',
    L(...P('npm', F, 'npm i x', 'npx x', F), '1. Install:', '', '2. ```', '   npm i x', '   npx x', '   ```', '', '3. Done.'),
    L(...P('npm', F, 'npm i x', 'npx x', F), '1. Install:', '', `2. ${C}`, '', '3. Done.')],
  ['a quoted block is compared with its quote marks: it stays',
    ...same(L(...P('a.ts', F, 'a()', 'b()', F), '> ```', '> a()', '> b()', '> ```', '', 'After.'))],
  ['a ~~~ block that shares its first lines with a panel stays whole',
    ...same(L(...P('a.ts', '~~~', 'a()', 'b()', '~~~'), 'Main flow:', '', '~~~', 'a()', 'b()', 'c()', '~~~', '', 'After.'))],
  ['a ```` block holding ``` lines, duplicated whole, gives way whole',
    L(...P('md', '````', '```js', 'a()', '```', '````'), 'Main flow:', '', '````', '```js', 'a()', '```', '````', '', 'After.'),
    L(...P('md', '````', '```js', 'a()', '```', '````'), 'Main flow:', '', C, '', 'After.')],
  ['prose lines that touch a block are not a run with its fence',
    ...same(L(...P('a.ts', '- one', '- two', F, 'x()', F), '- one', '- two', F, 'y()', F, '', 'After.'))],
  ['a panel marker inside code is code: the dedupe after the block still runs',
    L(...P('Tab', '- one', '- two', '- three'), F, '<!-- AI: TAB PANEL START: sample -->', F, '', '- one', '- two', '- three', '', 'After.'),
    L(...P('Tab', '- one', '- two', '- three'), F, '<!-- AI: TAB PANEL START: sample -->', F, '', C, '', 'After.')],
  ['a block the page never closes stays as written',
    ...same(L(...X, 'Main flow:', '', F, 'x1()', 'x2()', 'x3()'))],
  // unchanged behaviour outside code
  ['a run of three prose lines of one panel gives way',
    L(...P('Tab', '- one', '- two', '- three'), 'Main flow:', '', '- one', '- two', '- three', '', 'After the list.'),
    L(...P('Tab', '- one', '- two', '- three'), 'Main flow:', '', C, '', 'After the list.')],
  ['two prose lines of a panel stay', ...same(L(...P('Tab', '- one', '- two', '- three'), '- one', '- two', '', 'After.'))],
];

let failed = 0;
for (const [name, input, want] of CASES) {
  const got = dedupeTabPanelDuplicates(input);
  if (got === want) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      want ${JSON.stringify(want.split('\n'))}\n      got  ${JSON.stringify(got.split('\n'))}`);
  }
}

// The whole chain, every optional pass on: after the P2A-102 shape the prose is prose (the block closed) and the block
// keeps all its lines.
{
  const CFG = {
    ...DEFAULTS,
    collapseShortAdjacentLines: true,
    cleanupPunctuation: true,
    dedupeAdjacentLinks: true,
    dedupeConsecutiveDuplicates: true,
    suppressRepeatedImages: true,
    aggressiveCleanup: true,
    compactLinkLabels: true,
  };
  const md = postProcessMarkdown(
    L(...X, 'Main flow:', '', F, 'import y', 'x1()', 'x2()', 'x3()', F, '', 'After the block, **Vim** , text.'), CFG);
  const t = createFenceTracker();
  let proseAfter = false;
  for (const line of md.split('\n')) {
    if (t.check(line.trim())) continue;
    if (!t.inFence && line.startsWith('After the block')) proseAfter = line === 'After the block, **Vim**, text.';
  }
  const keeps = md.includes(L(F, 'import y', 'x1()', 'x2()', 'x3()', F));
  const ok = proseAfter && keeps && !t.inFence;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  chain: the block keeps its lines and fence, the prose after it is cleaned as prose` +
    (ok ? '' : ` (block kept: ${keeps}, prose after: ${proseAfter}, open fence at the end: ${t.inFence})`));
}

const total = CASES.length + 1;
console.log(`${total - failed}/${total} passed (${MOD})`);
process.exit(failed ? 1 : 0);
