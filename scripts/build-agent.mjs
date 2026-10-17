// Builds the Page2AI agent script (agent/entry.ts, BL-45 option C) into .output/agent/ and checks the result.
//
//   page2ai-agent.js     a classic script that defines window.__page2aiAgent = { version, extract(options) }
//                        as a frozen, non-configurable property: for Playwright MCP --init-script, which runs it
//                        before the page's own scripts, so the page cannot replace it afterwards.
//   page2ai-agent.fn.js  an async function expression that extracts and returns the result, defining nothing:
//                        for Chrome DevTools MCP evaluate_script sourcePath (its default format "function").
//   SHA256SUMS           checksums of both, in `sha256sum -c` format.
//
// The build fails when the bundle contains an extension API, a Trusted Types sink, eval, a network API other
// than the two known fetch calls of the official-Markdown lookup, a console call, or a module statement.
//
// Run: npm run build:agent

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.output', 'agent');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
if (!commit) {
  try {
    commit = execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    commit = 'unknown';
  }
}
const version = `${pkg.version}+${commit}`;

const BUNDLE_NAME = '__page2aiAgentBundle';
const GLOBAL_NAME = '__page2aiAgent';

const out = await build({
  configFile: false,
  root,
  envDir: false, // never read env files: nothing from them may end up in a script that runs in other people's pages
  logLevel: 'warn',
  resolve: { alias: [{ find: /^~\//, replacement: `${root}/` }] },
  define: { __PAGE2AI_AGENT_VERSION__: JSON.stringify(version) },
  build: {
    write: false,
    minify: false, // readable on purpose: whoever injects it into a signed-in page should be able to audit it
    target: 'es2022',
    copyPublicDir: false,
    lib: { entry: path.join(root, 'agent', 'entry.ts'), formats: ['iife'], name: BUNDLE_NAME, fileName: 'agent' },
  },
});

const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
const chunks = outputs.filter((o) => o.type === 'chunk');
if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.length}`);
const iife = chunks[0].code.trim();
const head = `var ${BUNDLE_NAME} = (function(exports) {`;
if (!iife.startsWith(head)) {
  throw new Error(`unexpected bundle shape (the wrappers below rely on it): ${JSON.stringify(iife.slice(0, 80))}`);
}

const banner = (use) =>
  `// Page2AI agent script ${version} (${use}). MIT, https://github.com/igorsaevets/page2ai-extension/tree/main/agent\n` +
  `// Runs the Page2AI extractor in the page's main world and returns { markdown, status, title, url, log, ... }.\n`;

// Both wrappers keep the bundle's `var` inside a function, so neither leaks a global of its own.
const fnScript =
  banner('function expression: Chrome DevTools MCP evaluate_script sourcePath') +
  `async (options) => {\n${iife}\nreturn ${BUNDLE_NAME}.extract(options);\n}\n`;

const defineScript =
  banner(`classic script: defines window.${GLOBAL_NAME}; Playwright MCP --init-script`) +
  `(() => {\n${iife}\n` +
  `const api = Object.freeze({ version: ${BUNDLE_NAME}.version, extract: ${BUNDLE_NAME}.extract });\n` +
  `const prev = Object.getOwnPropertyDescriptor(globalThis, ${JSON.stringify(GLOBAL_NAME)});\n` +
  `if (prev && prev.value && prev.value.version === api.version && Object.isFrozen(prev.value)) return;\n` +
  `if (prev) throw new Error('Page2AI: window.${GLOBAL_NAME} is already defined by something else; not overwriting it');\n` +
  `Object.defineProperty(globalThis, ${JSON.stringify(GLOBAL_NAME)}, { value: api, writable: false, enumerable: false, configurable: false });\n` +
  `})();\n`;

// --- static checks: what may never be inside a script that runs with the page's privileges -------------------
const FORBIDDEN = [
  ['extension API', /\b(?:chrome|browser)\s*\.\s*(?:runtime|storage|scripting|tabs|downloads|action|i18n|permissions|management|alarms|contextMenus|identity|webRequest|declarativeNetRequest|offscreen|sidePanel)\b/],
  ['eval / Function constructor', /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/],
  ['Trusted Types sink', /\.(?:innerHTML|outerHTML)\s*=(?!=)|insertAdjacentHTML|document\.write|\bDOMParser\b|createContextualFragment|\bsrcdoc\b|setHTMLUnsafe|parseHTMLUnsafe/],
  ['network API other than fetch', /\bXMLHttpRequest\b|\bsendBeacon\b|\bnew\s+WebSocket\b|\bEventSource\b|\bimportScripts\b|\bRTCPeerConnection\b/],
  ['console call', /\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace|dir|table)\s*\(/],
  ['module syntax', /^\s*(?:import|export)\s|\bimport\s*\(|\bimport\.meta\b/m],
];
// The official-Markdown lookup (lib/core/llms-txt.ts) is the only network use: the .md twins and llms.txt of the
// page's own origin (plus the trusted docs hosts). A new fetch must be a deliberate change to this number.
const EXPECTED_FETCH_CALLS = 2;

const failures = [];
for (const [what, re] of FORBIDDEN) {
  const lines = iife.split('\n').filter((l) => re.test(l));
  if (lines.length) failures.push(`${what}: ${lines.length} line(s), first: ${lines[0].trim().slice(0, 140)}`);
}
const fetchCalls = (iife.match(/\bfetch\s*\(/g) || []).length;
if (fetchCalls !== EXPECTED_FETCH_CALLS) failures.push(`fetch calls: ${fetchCalls}, expected ${EXPECTED_FETCH_CALLS}`);
if (failures.length) {
  console.error(`agent bundle check FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

// Both shapes must at least parse as what they claim to be.
new Function(`return (${fnScript.replace(/^\/\/.*\n/gm, '')});`); // an expression
new Function(defineScript); // a script

mkdirSync(outDir, { recursive: true });
const files = [
  ['page2ai-agent.js', defineScript],
  ['page2ai-agent.fn.js', fnScript],
];
const sums = [];
for (const [name, code] of files) {
  writeFileSync(path.join(outDir, name), code);
  const sha = createHash('sha256').update(code).digest('hex');
  sums.push(`${sha}  ${name}`);
  console.log(`${name}: ${Buffer.byteLength(code)} bytes, sha256 ${sha}`);
}
writeFileSync(path.join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`agent script ${version}: OK (no extension API, no eval, no Trusted Types sink, ${fetchCalls} fetch calls)`);
