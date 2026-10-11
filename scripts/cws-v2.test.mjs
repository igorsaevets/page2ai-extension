#!/usr/bin/env node
// Mock-API test for scripts/cws-v2.sh. No network: a loopback server plays Google's
// OAuth token endpoint and the three Chrome Web Store API V2 methods, and every case
// asserts the exit code, what the script sent, and that no credential reached its output.
//
//   node scripts/cws-v2.test.mjs
//   On Windows point CWS_TEST_BASH at Git Bash ("C:\Program Files\Git\bin\bash.exe"):
//   a bare `bash` there is the WSL stub.
//
// Response shapes follow the V2 reference (developer.chrome.com/docs/webstore/api/
// reference/rest, read 2026-10-11) and Google's JSON error envelope.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASH = process.env.CWS_TEST_BASH || 'bash';
const PUB = 'test-publisher-0001';
const ITEM = 'dlpaaijcnbbmlfeohlphjpnbbcnomnno';
const ITEM_PATH = `/v2/publishers/${PUB}/items/${ITEM}`;
const CRED = {
  id: 'fake-client-id.apps.googleusercontent.com',
  secret: 'fake-client-secret-Q7xR',
  refresh: '1//fake-refresh-token-Z9wT',
  access: 'ya29.fake-access-token-K3vM',
};

const ok = (body) => ({ status: 200, body });
const gerr = (code, status, message, reason) => ({
  status: code,
  body: { error: { code, status, message, ...(reason ? { details: [{ reason }] } : {}) } },
});
const statusBody = (extra = {}) => ({
  name: `publishers/${PUB}/items/${ITEM}`,
  itemId: ITEM,
  publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest',
  publishedItemRevisionStatus: {
    state: 'PUBLISHED',
    distributionChannels: [{ deployPercentage: 100, crxVersion: '1.3.0' }],
  },
  takenDown: false,
  warned: false,
  ...extra,
});

let plan = {};
let seen = [];

function route(r) {
  if (r.url === '/token') {
    return plan.token ?? ok({
      access_token: CRED.access,
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      token_type: 'Bearer',
    });
  }
  if (r.headers.authorization !== `Bearer ${CRED.access}`) {
    return gerr(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.');
  }
  if (r.method === 'GET' && r.url === `${ITEM_PATH}:fetchStatus`) {
    const queue = plan.status ?? [ok(statusBody())];
    return queue.length > 1 ? queue.shift() : queue[0];
  }
  if (r.method === 'POST' && r.url === `/upload${ITEM_PATH}:upload` && plan.upload) return plan.upload;
  if (r.method === 'POST' && r.url === `${ITEM_PATH}:publish` && plan.publish) return plan.publish;
  return gerr(404, 'NOT_FOUND', `mock has no route for ${r.method} ${r.url}`);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rec = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(rec);
    const reply = route(rec);
    res.writeHead(reply.status, { 'content-type': 'application/json; charset=UTF-8' });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const work = mkdtempSync(join(tmpdir(), 'cws-v2-test-'));
const ZIP = join(work, 'page2ai-1.4.0-chrome.zip');
writeFileSync(ZIP, Buffer.alloc(4096, 7));

function run(args, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CWS_') || key.startsWith('GITHUB_')) delete env[key];
  }
  Object.assign(env, {
    CWS_API_ROOT: BASE,
    CWS_TOKEN_URI: `${BASE}/token`,
    CWS_CLIENT_ID: CRED.id,
    CWS_CLIENT_SECRET: CRED.secret,
    CWS_REFRESH_TOKEN: CRED.refresh,
    CWS_PUBLISHER_ID: PUB,
    CWS_ITEM_ID: ITEM,
    CWS_POLL_SECONDS: '0',
    CWS_MAX_POLLS: '3',
    ...extra,
  });
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return new Promise((resolve) => {
    const child = spawn(BASH, ['scripts/cws-v2.sh', ...args], { cwd: ROOT, env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

let failures = 0;
let checks = 0;
function check(name, cond, detail = '') {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}

// Every case: secrets never appear, and the access token only inside ::add-mask::.
function leaks(out) {
  const found = [];
  if (out.includes(CRED.secret)) found.push('client secret');
  if (out.includes(CRED.refresh)) found.push('refresh token');
  if (out.includes(CRED.id)) found.push('client id');
  const bad = out.split('\n').filter((l) => l.includes(CRED.access) && !l.startsWith('::add-mask::'));
  if (bad.length) found.push(`access token outside ::add-mask:: (${bad.length} line(s))`);
  return found;
}
function noLeak(name, out) {
  const found = leaks(out);
  check(`${name}: no credential in output`, found.length === 0, found.join(', '));
}

// The detector itself must fire, or every noLeak check above is hollow.
check('leak detector flags the client secret', leaks(`x ${CRED.secret} y`).length === 1);
check('leak detector flags the refresh token', leaks(`refresh=${CRED.refresh}`).length === 1);
check('leak detector flags an unmasked access token', leaks(`Authorization: Bearer ${CRED.access}`).length === 1);
check('leak detector accepts the mask command', leaks(`::add-mask::${CRED.access}`).length === 0);

const calls = (method, suffix) => seen.filter((r) => r.method === method && r.url.endsWith(suffix));

async function scenario(name, setup, args, extra, assert) {
  plan = setup;
  seen = [];
  const res = await run(args, extra);
  noLeak(name, res.out);
  assert(res);
  console.log(`${name}: exit ${res.code}`);
}

// --- status ---------------------------------------------------------------
await scenario('status ok', {}, ['status'], {}, ({ code, out }) => {
  check('status ok: exit 0', code === 0, out);
  check('status ok: published line', out.includes('Published revision: PUBLISHED 1.3.0 at 100%'), out);
  check('status ok: submitted none', out.includes('Submitted revision: none'), out);
  const [tok] = calls('POST', '/token');
  const form = new URLSearchParams(tok?.body.toString() ?? '');
  check('status ok: token form grant_type', form.get('grant_type') === 'refresh_token');
  check('status ok: token form client_id', form.get('client_id') === CRED.id);
  check('status ok: token form client_secret', form.get('client_secret') === CRED.secret);
  check('status ok: token form refresh_token', form.get('refresh_token') === CRED.refresh);
  check('status ok: one fetchStatus GET', calls('GET', ':fetchStatus').length === 1);
});

const summaryFile = join(work, 'summary.md');
await scenario('status in Actions', {}, ['status'],
  { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile }, ({ code, out }) => {
    check('status in Actions: exit 0', code === 0, out);
    check('status in Actions: token masked first', out.split('\n').some((l) => l === `::add-mask::${CRED.access}`), out);
    const md = readFileSync(summaryFile, 'utf8');
    check('status in Actions: step summary written', md.includes('- Published revision: PUBLISHED 1.3.0 at 100%'), md);
  });

await scenario('status wrong publisher', { status: [gerr(403, 'PERMISSION_DENIED',
  'The caller does not have permission', 'PUBLISHER_ACCESS_DENIED')] }, ['status'], {}, ({ code, out }) => {
  check('status wrong publisher: exit 1', code === 1, out);
  check('status wrong publisher: Google message shown',
    out.includes('fetchStatus failed: HTTP 403: 403 | PERMISSION_DENIED | The caller does not have permission | PUBLISHER_ACCESS_DENIED'), out);
});

await scenario('status other item', { status: [ok(statusBody({ itemId: 'abcdefghijklmnopabcdefghijklmnop' }))] },
  ['status'], {}, ({ code, out }) => {
    check('status other item: exit 1', code === 1, out);
    check('status other item: says different item', out.includes('different item'), out);
  });

await scenario('status taken down', { status: [ok(statusBody({ takenDown: true }))] }, ['status'], {}, ({ code, out }) => {
  check('status taken down: exit 1', code === 1, out);
  check('status taken down: says so', out.includes('TAKEN DOWN'), out);
});

await scenario('status warned', { status: [ok(statusBody({ warned: true }))] }, ['status'], {}, ({ code, out }) => {
  check('status warned: exit 0', code === 0, out);
  check('status warned: warning printed', out.includes('WARNED'), out);
});

await scenario('status non-JSON 502', { status: [{ status: 502, body: '<html>Bad Gateway</html>' }] },
  ['status'], {}, ({ code, out }) => {
    check('status non-JSON 502: exit 1', code === 1, out);
    check('status non-JSON 502: body excerpt shown', out.includes('non-JSON reply: <html>Bad Gateway</html>'), out);
  });

await scenario('token invalid_grant', { token: { status: 400,
  body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }, ['status'], {}, ({ code, out }) => {
  check('token invalid_grant: exit 1', code === 1, out);
  check('token invalid_grant: explained', out.includes('HTTP 400 invalid_grant: Token has been expired or revoked.'), out);
  check('token invalid_grant: no API call', seen.every((r) => r.url === '/token'));
});

// --- upload ---------------------------------------------------------------
const uploaded = (state, crxVersion) => ok({
  name: `publishers/${PUB}/items/${ITEM}`, itemId: ITEM, ...(crxVersion ? { crxVersion } : {}), uploadState: state,
});

await scenario('upload succeeded', { upload: uploaded('SUCCEEDED', '1.4.0') }, ['upload', ZIP, '1.4.0'], {}, ({ code, out }) => {
  check('upload succeeded: exit 0', code === 0, out);
  const [up] = calls('POST', ':upload');
  check('upload succeeded: hit the /upload/v2 media URI', up?.url === `/upload${ITEM_PATH}:upload`);
  check('upload succeeded: whole package sent', up?.body.length === 4096, String(up?.body.length));
  check('upload succeeded: raw upload protocol', up?.headers['x-goog-upload-protocol'] === 'raw');
  check('upload succeeded: reports version', out.includes('Upload: SUCCEEDED, package version 1.4.0'), out);
  check('upload succeeded: nothing published', calls('POST', ':publish').length === 0);
});

await scenario('upload async', {
  upload: uploaded('IN_PROGRESS'),
  status: [ok(statusBody({ lastAsyncUploadState: 'IN_PROGRESS' })), ok(statusBody({ lastAsyncUploadState: 'SUCCEEDED' }))],
}, ['upload', ZIP, '1.4.0'], {}, ({ code, out }) => {
  check('upload async: exit 0', code === 0, out);
  check('upload async: polled twice', calls('GET', ':fetchStatus').length === 2);
  check('upload async: version not reported is a warning', out.includes('did not report the package version'), out);
});

await scenario('upload async, docs spelling', {
  upload: uploaded('UPLOAD_IN_PROGRESS'),
  status: [ok(statusBody({ lastAsyncUploadState: 'SUCCEEDED' }))],
}, ['upload', ZIP], {}, ({ code, out }) => {
  check('upload async, docs spelling: exit 0', code === 0, out);
});

await scenario('upload never finishes', {
  upload: uploaded('IN_PROGRESS'),
  status: [ok(statusBody({ lastAsyncUploadState: 'IN_PROGRESS' }))],
}, ['upload', ZIP, '1.4.0'], {}, ({ code, out }) => {
  check('upload never finishes: exit 1', code === 1, out);
  check('upload never finishes: bounded polls', calls('GET', ':fetchStatus').length === 3);
});

await scenario('upload failed', { upload: uploaded('FAILED') }, ['upload', ZIP, '1.4.0'], {}, ({ code, out }) => {
  check('upload failed: exit 1', code === 1, out);
  check('upload failed: names the state', out.includes('upload state FAILED'), out);
});

await scenario('upload wrong version', { upload: uploaded('SUCCEEDED', '1.3.9') }, ['upload', ZIP, '1.4.0'], {}, ({ code, out }) => {
  check('upload wrong version: exit 1', code === 1, out);
  check('upload wrong version: names both', out.includes('version 1.3.9 from the package, expected 1.4.0'), out);
});

await scenario('upload rejected 400', { upload: gerr(400, 'INVALID_ARGUMENT',
  'The version of the uploaded package must be greater than the published version.') }, ['upload', ZIP, '1.3.0'], {}, ({ code, out }) => {
  check('upload rejected 400: exit 1', code === 1, out);
  check('upload rejected 400: Google message shown', out.includes('upload failed: HTTP 400: 400 | INVALID_ARGUMENT | The version of the uploaded package'), out);
});

await scenario('upload missing file', {}, ['upload', join(work, 'absent.zip')], {}, ({ code, out }) => {
  check('upload missing file: exit 1', code === 1, out);
  check('upload missing file: no request', seen.length === 0);
});

// --- publish --------------------------------------------------------------
const published = (state, warnings) => ok({
  name: `publishers/${PUB}/items/${ITEM}`, itemId: ITEM, state, ...(warnings ? { warningInfo: { warnings } } : {}),
});

await scenario('publish pending review', { publish: published('PENDING_REVIEW') }, ['publish'], {}, ({ code, out }) => {
  check('publish pending review: exit 0', code === 0, out);
  const [pub] = calls('POST', ':publish');
  check('publish pending review: JSON content type', (pub?.headers['content-type'] ?? '').startsWith('application/json'));
  let body = {};
  try { body = JSON.parse(pub?.body.toString() ?? '{}'); } catch { /* checked below */ }
  check('publish pending review: DEFAULT_PUBLISH', body.publishType === 'DEFAULT_PUBLISH', pub?.body.toString());
  check('publish pending review: says accepted', out.includes('Publish: accepted, item state PENDING_REVIEW'), out);
});

await scenario('publish with warnings', { publish: published('PENDING_REVIEW',
  [{ reason: 'PERMISSION_JUSTIFICATION', description: 'Justify the new permission.' }]) }, ['publish'], {}, ({ code, out }) => {
  check('publish with warnings: exit 0', code === 0, out);
  check('publish with warnings: warning shown', out.includes('Store warning: PERMISSION_JUSTIFICATION: Justify the new permission.'), out);
});

await scenario('publish rejected state', { publish: published('REJECTED') }, ['publish'], {}, ({ code, out }) => {
  check('publish rejected state: exit 1', code === 1, out);
});

await scenario('publish condition not met', { publish: gerr(400, 'FAILED_PRECONDITION',
  'Publish condition not met: the item is already pending review.') }, ['publish'], {}, ({ code, out }) => {
  check('publish condition not met: exit 1', code === 1, out);
  check('publish condition not met: message shown', out.includes('Publish condition not met'), out);
});

await scenario('publish in Actions error', { publish: published('CANCELLED') }, ['publish'], { GITHUB_ACTIONS: 'true' }, ({ code, out }) => {
  check('publish in Actions error: exit 1', code === 1, out);
  check('publish in Actions error: ::error:: annotation', out.includes('::error::The publish request answered with item state CANCELLED.'), out);
});

// --- guards ---------------------------------------------------------------
for (const [name, extra] of [
  ['guard foreign API host', { CWS_API_ROOT: 'https://example.com' }],
  ['guard userinfo trick', { CWS_API_ROOT: `http://127.0.0.1:1@example.com` }],
  ['guard foreign token host', { CWS_TOKEN_URI: 'https://example.com/token' }],
  ['guard empty publisher', { CWS_PUBLISHER_ID: '' }],
  ['guard path in publisher', { CWS_PUBLISHER_ID: '../items/x' }],
  ['guard bad item id', { CWS_ITEM_ID: 'not-an-id' }],
]) {
  await scenario(name, {}, ['status'], extra, ({ code, out }) => {
    check(`${name}: exit 1`, code === 1, out);
    check(`${name}: no request made`, seen.length === 0, seen.map((r) => r.url).join(' '));
  });
}
await scenario('guard empty publisher names the secret', {}, ['status'], { CWS_PUBLISHER_ID: '' }, ({ out }) => {
  check('guard empty publisher names the variable', out.includes('CWS_PUBLISHER_ID is empty'), out);
});

await scenario('usage', {}, ['frobnicate'], {}, ({ code }) => {
  check('usage: exit 2', code === 2);
});

server.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
