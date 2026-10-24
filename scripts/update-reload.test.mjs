#!/usr/bin/env node
// Unit test for lib/update-reload.ts (T180). Chrome installs a downloaded update only when the extension is idle,
// and a connected Agent Bridge pings every 20 s, which keeps the service worker running: with no handler the
// update waits for the browser's restart. The handler reloads once no bridge request is in flight, and after the
// longest wait whatever runs. Node 24 strips the types, so the module is imported as it ships; time is faked.
//
//   node scripts/update-reload.test.mjs                                  (the policy)
//   node scripts/update-reload.test.mjs .output/chrome-mv3/background.js (also: the built worker wires it up)
//   UR_MODULE=<path to another update-reload.ts> node scripts/update-reload.test.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.UR_MODULE || join(ROOT, 'lib/update-reload.ts');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -- ${detail}` : ''}`);
};

if (!existsSync(MOD)) {
  check('lib/update-reload.ts exists', false, `${MOD} is missing: no update handler, an update waits for the browser's restart`);
  process.exit(1);
}

// ── fake clock: setTimeout and Date.now under the test's control ──────────
let now = 0;
let timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
Date.now = () => now;
const advance = async (ms) => {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > end) break;
    timers.shift();
    now = next.at;
    next.fn();
    for (let i = 0; i < 5; i++) await Promise.resolve(); // let an async isBusy settle
  }
  now = end;
};
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const { reloadWhenIdle, UPDATE_POLL_MS, UPDATE_MAX_WAIT_MS } = await import(pathToFileURL(MOD).href);

// 1. Nothing in flight: reload at once.
{
  now = 0; timers = [];
  let reloads = 0;
  reloadWhenIdle(async () => false, () => { reloads++; });
  await settle();
  check('idle: reloads at once', reloads === 1, `reloads=${reloads}`);
}

// 2. A bridge request in flight: no reload until it ends, then one.
{
  now = 0; timers = [];
  let reloads = 0;
  let busy = true;
  reloadWhenIdle(async () => busy, () => { reloads++; });
  await settle();
  await advance(UPDATE_POLL_MS * 3);
  check('busy: waits while a request is in flight', reloads === 0, `reloads=${reloads}`);
  busy = false;
  await advance(UPDATE_POLL_MS);
  check('busy: reloads once the request ended', reloads === 1, `reloads=${reloads}`);
  await advance(UPDATE_POLL_MS * 4);
  check('busy: reloads only once', reloads === 1, `reloads=${reloads}`);
}

// 3. Busy for ever (a stuck request): reload at the longest wait, not never.
{
  now = 0; timers = [];
  let reloads = 0;
  reloadWhenIdle(async () => true, () => { reloads++; });
  await settle();
  await advance(UPDATE_MAX_WAIT_MS - UPDATE_POLL_MS);
  check('stuck: no reload before the longest wait', reloads === 0, `reloads=${reloads}`);
  await advance(UPDATE_POLL_MS * 2);
  check('stuck: reloads at the longest wait', reloads === 1, `reloads=${reloads}`);
}

// 4. A failing busy check counts as idle: an update must not hang on it.
{
  now = 0; timers = [];
  let reloads = 0;
  reloadWhenIdle(async () => { throw new Error('storage gone'); }, () => { reloads++; });
  await settle();
  check('a throwing busy check: reloads', reloads === 1, `reloads=${reloads}`);
}

check('the longest wait is above a bridge convert timeout (60 s) and below 10 min',
  UPDATE_MAX_WAIT_MS > 60_000 && UPDATE_MAX_WAIT_MS < 600_000, `UPDATE_MAX_WAIT_MS=${UPDATE_MAX_WAIT_MS}`);

// 5. The built worker registers the handler (a policy no run calls would prove nothing).
const artifact = process.argv[2];
if (artifact) {
  const js = existsSync(artifact) ? readFileSync(artifact, 'utf8') : '';
  check(`${artifact}: listens for onUpdateAvailable`, js.includes('onUpdateAvailable'), js ? 'not in the bundle' : 'file missing');
  check(`${artifact}: calls runtime.reload`, /runtime\.reload\(/.test(js), 'no runtime.reload( in the bundle');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
