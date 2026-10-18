#!/usr/bin/env node
// Unit test for cleanupPunctuation in lib/core/md-postprocess.ts (P2A-016). Node 24 strips the types, so the module
// is imported as it ships. Each case is an input and the exact output: the space the renderer's join leaves before
// a mark that ends a word goes, a space the page itself has before a token stays.
//
//   node scripts/md-postprocess.test.mjs
//   PP_MODULE=<path to another md-postprocess.ts> node scripts/md-postprocess.test.mjs   (run it on another build)
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.PP_MODULE || join(ROOT, 'lib/core/md-postprocess.ts');
const { cleanupPunctuation } = await import(pathToFileURL(MOD).href);
const ON = { cleanupPunctuation: true };

const same = (s) => [s, s];
const CASES = [
  // P2A-016: the space is part of the page's text
  ['dotted word in prose', ...same('A lookup used to replace it with the .md twin.')],
  ['inline code: ls .', ...same('Run `ls .` to list it.')],
  ['inline code: a ? b : c', ...same('Pick `x = a ? b : c` here.')],
  ['inline code: a double-backtick span', ...same('Use `` a ` b ; c `` as is.')],
  ['list item that starts with a dot', ...same('- .gitignore')],
  ['ordered item that starts with a dot', ...same('1. .gitignore')],
  ['heading that starts with a dot', ...same('## .NET 8 release notes')],
  ['quote that starts with a dot', ...same('> .md files are plain text')],
  ['indented continuation line', ...same('   .md continuation line')],
  ['list item that is an image', ...same('- ![logo](https://example.com/l.svg)')],
  ['heading that opens with an image', ...same('#### ![image](https://example.com/i.svg) News')],
  ['image after a word', ...same('Support Team Member ![rank](https://example.com/r.png)')],
  ['relative path in a command', ...same('Run sudo sh ./get-docker.sh --dry-run')],
  ['CSS names', ...same('Use the :hover state and !important.')],
  ['spaced ellipsis', ...same('He said ... nothing.')],
  ['ellipsis inside link text', ...same('- [{#if ...}](https://example.com/if)')],
  ['narrow no-break space before a mark', ...same('Bonjour\u202f!')],
  ['a mark followed by a mark', ...same('wait ?!')],
  ['emoticon', ...same('great :)')],
  // the renderer joins inline parts with a space: those spaces still go
  ['bold, then a comma', 'such as **Vim** , **Neovim** , and more', 'such as **Vim**, **Neovim**, and more'],
  ['bold, then a period at the end', 'ship a **static site** .', 'ship a **static site**.'],
  ['link, then a period', 'see [the docs](https://example.com/d) .', 'see [the docs](https://example.com/d).'],
  ['code inside bold, then a period', '**Less than `max_tokens` .** Thinking', '**Less than `max_tokens`.** Thinking'],
  ['bold inside link text, then a period', '[read **this** .](https://example.com/r)', '[read **this**.](https://example.com/r)'],
  ['code spans, then marks outside them', 'Click `foo` , then `bar` .', 'Click `foo`, then `bar`.'],
  ['colon at the end of a line', '**Warning** :', '**Warning**:'],
  ['list item text, then a colon', '- **Search** : the whole site', '- **Search**: the whole site'],
  // the lines the step never touches
  ['frontmatter and body', '---\ntitle: "a ."\n---\nbody .', '---\ntitle: "a ."\n---\nbody.'],
  ['fenced code', ...same('```\nls .\nx = a ? b : c\n```')],
  ['table row', ...same('| a . | b , |')],
];

let failed = 0;
for (const [name, input, want] of CASES) {
  const got = cleanupPunctuation(input, ON);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      input ${JSON.stringify(input)}\n      want  ${JSON.stringify(want)}\n      got   ${JSON.stringify(got)}`}`);
}
const off = cleanupPunctuation('word . and **Vim** ,', { cleanupPunctuation: false });
if (off !== 'word . and **Vim** ,') failed++;
console.log(`${off === 'word . and **Vim** ,' ? 'PASS' : 'FAIL'}  option off: text unchanged`);
console.log(`${CASES.length + 1 - failed}/${CASES.length + 1} passed (${MOD})`);
process.exit(failed ? 1 : 0);
