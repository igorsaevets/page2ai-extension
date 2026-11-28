#!/usr/bin/env node
// Unit test for the code fence tracker of lib/core/md-postprocess.ts (P2A-101). Every pass of postProcessMarkdown runs
// here, the optional ones switched on, and each must leave a code block as the renderer wrote it wherever its fence
// stands: on a list item's marker line (`1. ````), behind a quote's `>`, or both. Each input is the renderer's output
// for a page shape (as the agent script writes it), each want the exact output: code lines unchanged, and outside code
// the passes still at work (a cleanup after the block proves the tracker left the fence where the code ends).
// Extension 1.7.4 fails every case but one. Node 24 strips the types, so the module is imported as it ships.
//
//   node scripts/md-fences.test.mjs
//   PP_MODULE=<path to another md-postprocess.ts> node scripts/md-fences.test.mjs   (run it on another build)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.PP_MODULE || join(ROOT, 'lib/core/md-postprocess.ts');
const { postProcessMarkdown, createFenceTracker } = await import(pathToFileURL(MOD).href);
const { DEFAULTS } = await import(pathToFileURL(join(ROOT, 'lib/constants.ts')).href);
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

const L = (...lines) => lines.join('\n');
const same = (s) => [s, s];
const LATER = ['', '```', 'c()', '    d()', '```']; // a top-level block after the case: it must keep its indented line

const CASES = [
  ['a list item that opens with a code block, then prose, then a block',
    ...same(L('1. ```', '   a = 1', '   ```', '', 'Then:', '', '```', 'def f():', '    return 1', '```'))],
  ['a bullet whose block holds an indented line', ...same(L('- ```', '  def f():', '      return 1', '  ```', ...LATER))],
  ['item 10 opens with a block', ...same(L('10. ```', '    a()', '        b()', '    ```', ...LATER))],
  ['a nested item opens with a block', ...same(L('- One', '   - ```', '     a()', '         b()', '     ```', ...LATER))],
  ['quoted code keeps its indentation, blank lines and the quote marks of blank lines',
    ...same(L('> ```', '> def f():', '>     return 1', '> ', '> ', '> x = 2', '> ```', ...LATER))],
  ['a nested quote', ...same(L('> > ```', '> > x()', '> >     y()', '> > ', '> > z()', '> > ```', ...LATER))],
  ['a list item in a quote', ...same(L('> 1. ```', '>    x()', '>        y()', '>    ```', ...LATER))],
  ['a quote in a list item (its first blank quote line loses its trailing space, as before)',
    L('- > ', '  > ```', '  > x()', '  >     y()', '  > ```', ...LATER),
    L('- >', '  > ```', '  > x()', '  >     y()', '  > ```', ...LATER)],
  ['quoted code holding ``` in a ~~~ fence; the punctuation cleanup runs after it',
    L('> ~~~', '> ```js', '> x = 1', '>     y = 2', '> ```', '> ~~~', '', 'After **Vim** , text.'),
    L('> ~~~', '> ```js', '> x = 1', '>     y = 2', '> ```', '> ~~~', '', 'After **Vim**, text.')],
  ['repeated lines of quoted code are not collapsed', ...same(L('> ```', '> x', '> x', '> x', '> x', '> ```'))],
  ['link-shaped lines of quoted code are neither deduplicated nor squeezed',
    ...same(L('> ```', '> [a](b)  [a](b)', '>     [c](d)', '> ```'))],
  ['trailing spaces and tabs, a line of spaces and a diff line of one space stay',
    ...same(L('```', 'a = 1   ', 'b = 2\t', '  ', '@@ -1 +1 @@', ' a', ' ', '-b', '+c', '```'))],
  ['a line of spaces in code under a list item stays', ...same(L('- Step:', '', '   ```', '   a = 1', '     ', '   b = 2', '   ```'))],
  ['a line that opens with a code span holding ``` is prose: the cleanup after it runs',
    L('```a``` b', '', 'such as **Vim** , and more'), L('```a``` b', '', 'such as **Vim**, and more')],
  ['two blank lines of a prose quote stay two quote lines, not `> >`',
    L('> One.', '> ', '> ', '> Two.'), L('> One.', '>', '>', '> Two.')],
];

let failed = 0;
const report = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n${detail}`}`);
};
for (const [name, input, want] of CASES) {
  const got = postProcessMarkdown(input, CFG);
  report(name, got === want, `      input ${JSON.stringify(input)}\n      want  ${JSON.stringify(want)}\n      got   ${JSON.stringify(got)}`);
}

// The tracker alone: which lines are fences, and when a fence closes.
const states = (lines) => {
  const t = createFenceTracker();
  return lines.map((l) => `${t.check(l.trim()) ? 'F' : '-'}${t.inFence ? 'in' : 'out'}`).join(' ');
};
const TRACKER = [
  ['a closing fence has nothing after it', ['```', '``` not a close', 'x', '```'], 'Fin Fin -in Fout'],
  ['a longer run of the same character closes, the other character does not', ['````', '~~~~~', '`````'], 'Fin Fin Fout'],
  ['a marker needs a space before the fence; a quote does not', ['-```', '*```', '1.```', '>```', 'x', '> ```'],
    '-out -out -out Fin -in Fout'],
  ['an ordered marker with `)`, a `+` bullet, and nested markers', ['1) ```', '```', '+ - ```', '   ```'], 'Fin Fout Fin Fout'],
];
for (const [name, lines, want] of TRACKER) {
  const got = states(lines);
  report(`tracker: ${name}`, got === want, `      lines ${JSON.stringify(lines)}\n      want  ${want}\n      got   ${got}`);
}

// Linear time on a line of many prefixes (ledger E-1130: an ambiguous pattern backtracked exponentially there).
{
  const deep = ['> '.repeat(150) + 'x', '- 1. > '.repeat(60) + 'y', ' '.repeat(5000) + 'z', '> '.repeat(150) + '```'];
  const t = createFenceTracker();
  const t0 = performance.now();
  let opened = false;
  for (let i = 0; i < 500; i++) for (const l of deep.slice(0, 3)) t.check(l.trim());
  opened = createFenceTracker().check(deep[3].trim());
  const ms = performance.now() - t0;
  report(`tracker: 1,500 lines of 150 prefixes read in ${ms.toFixed(1)} ms (limit 1000), the 150-deep fence opens`,
    ms < 1000 && opened, `      ms ${ms}, opened ${opened}`);
}

const total = CASES.length + TRACKER.length + 1;
console.log(`${total - failed}/${total} passed (${MOD})`);
process.exit(failed ? 1 : 0);
