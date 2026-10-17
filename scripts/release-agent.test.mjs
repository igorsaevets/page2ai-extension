#!/usr/bin/env node
// Fake-gh test for scripts/release-agent.sh. No network and no token: a fake `gh`, first on PATH, plays the three
// release calls the script makes (api, release upload, release download) on a directory tree, and every case
// asserts the exit code, the message, and what reached the "release".
//
//   node scripts/release-agent.test.mjs
//   On Windows point CWS_TEST_BASH at Git Bash ("C:\Program Files\Git\bin\bash.exe"), as for cws-v2.test.mjs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASH = process.env.CWS_TEST_BASH || 'bash';
const TAG = 'v1.5.0';
const VERSION = '1.5.0+abc1234';
const FILES = ['page2ai-agent.js', 'page2ai-agent.fn.js', 'page2ai-agent.SHA256SUMS'];
const ZIP = 'page2ai-extension-1.5.0-chrome.zip';

// The fake answers the calls release-agent.sh makes and nothing else (exit 2 on anything unexpected). A release is
// a directory: releases/<tag>/assets/* are its files, releases/<tag>/immutable marks it immutable, `latest` names
// the latest tag. FAKE_GH_CORRUPT_UPLOAD (a file name) stores that upload with one byte added; FAKE_GH_BAD_DIGEST
// reports a wrong digest for that file.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
root=$FAKE_GH_ROOT
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
release_json() {
  local d="$root/releases/$1" sep= f name digest imm=false
  [ ! -e "$d/immutable" ] || imm=true
  printf '{"tag_name":"%s","draft":false,"immutable":%s,"assets":[' "$1" "$imm"
  for f in "$d"/assets/*; do
    [ -e "$f" ] || continue
    name=\${f##*/}
    digest="sha256:$(sha256sum < "$f" | cut -c1-64)"
    [ "$name" != "\${FAKE_GH_BAD_DIGEST:-}" ] || digest="sha256:$(printf '%064d' 0)"
    printf '%s{"name":"%s","digest":"%s","state":"uploaded"}' "$sep" "$name" "$digest"
    sep=,
  done
  printf ']}\\n'
}
case "$1 \${2:-}" in
  "api repos/"*)
    case "$2" in
      */releases/latest) tag=$(cat "$root/latest") ;;
      */releases/tags/*) tag=\${2##*/tags/} ;;
      *) echo "fake gh: unexpected api path $2" >&2; exit 2 ;;
    esac
    [ -d "$root/releases/$tag" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    release_json "$tag" ;;
  "release upload")
    tag=$3; shift 3; files=()
    while [ $# -gt 0 ]; do case "$1" in --repo) shift 2 ;; -*) echo "fake gh: unexpected flag $1" >&2; exit 2 ;; *) files+=("$1"); shift ;; esac; done
    for f in "\${files[@]}"; do
      [ ! -e "$root/releases/$tag/assets/\${f##*/}" ] || { echo "asset under the same name already exists: \${f##*/}" >&2; exit 1; }
    done
    for f in "\${files[@]}"; do
      cp "$f" "$root/releases/$tag/assets/\${f##*/}"
      [ "\${f##*/}" != "\${FAKE_GH_CORRUPT_UPLOAD:-}" ] || printf 'x' >> "$root/releases/$tag/assets/\${f##*/}"
    done ;;
  "release download")
    tag=$3; shift 3; pats=(); dir=.
    while [ $# -gt 0 ]; do case "$1" in --pattern) pats+=("$2"); shift 2 ;; --dir) dir=$2; shift 2 ;; --repo) shift 2 ;; *) echo "fake gh: unexpected $1" >&2; exit 2 ;; esac; done
    mkdir -p "$dir"; n=0
    for f in "$root/releases/$tag/assets"/*; do
      for p in "\${pats[@]}"; do
        # shellcheck disable=SC2053
        if [[ \${f##*/} == $p ]]; then
          [ ! -e "$dir/\${f##*/}" ] || { echo "\${f##*/} already exists" >&2; exit 1; }
          cp "$f" "$dir/"; n=$((n + 1)); break
        fi
      done
    done
    [ "$n" -gt 0 ] || { echo "no assets match the file pattern" >&2; exit 1; } ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 2 ;;
esac
`;

const sha = (data) => createHash('sha256').update(data).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'release-agent-test-'));
const binDir = join(work, 'bin');
mkdirSync(binDir);
writeFileSync(join(binDir, 'gh'), FAKE_GH);
chmodSync(join(binDir, 'gh'), 0o755);
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';

let n = 0;
// A build as scripts/build-agent.mjs writes it: two scripts whose line 1 names the build, and their sums.
function build(version = VERSION, edit = (files) => files) {
  const dir = join(work, `build-${++n}`);
  mkdirSync(dir);
  const files = edit([
    ['page2ai-agent.js', `// Page2AI agent script ${version} (classic script: defines window.__page2aiAgent). MIT\n(() => {})();\n`],
    ['page2ai-agent.fn.js', `// Page2AI agent script ${version} (function expression). MIT\nasync (options) => ({});\n`],
  ]);
  for (const [name, text] of files) writeFileSync(join(dir, name), text);
  const sums = files.map(([name, text]) => `${sha(text)}  ${name}`);
  writeFileSync(join(dir, 'page2ai-agent.SHA256SUMS'), `${sums.join('\n')}\n`);
  return dir;
}
// A fake GitHub: the tag's release holds `assets` ({name: content}) and is the latest release.
function github({ release = true, assets = { [ZIP]: 'zip bytes' }, immutable = false } = {}) {
  const root = join(work, `gh-${++n}`);
  if (release) {
    mkdirSync(join(root, 'releases', TAG, 'assets'), { recursive: true });
    for (const [name, text] of Object.entries(assets)) writeFileSync(join(root, 'releases', TAG, 'assets', name), text);
    if (immutable) writeFileSync(join(root, 'releases', TAG, 'immutable'), '');
  } else {
    mkdirSync(root);
  }
  writeFileSync(join(root, 'latest'), TAG);
  return root;
}
function run(args, root, extra = {}) {
  const log = join(work, `log-${++n}`);
  writeFileSync(log, '');
  const env = {
    ...process.env,
    [pathKey]: `${binDir}${delimiter}${process.env[pathKey]}`,
    GITHUB_ACTIONS: '',
    GITHUB_REPOSITORY: 'igorsaevets/page2ai-extension',
    FAKE_GH_ROOT: root ?? join(work, 'no-gh'),
    FAKE_GH_LOG: log,
    ...extra,
  };
  const r = spawnSync(BASH, ['scripts/release-agent.sh', ...args], { cwd: ROOT, env, encoding: 'utf8' });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls, uploads: calls.filter((c) => c.startsWith('release upload')) };
}
const onRelease = (root, name) => {
  const p = join(root, 'releases', TAG, 'assets', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail.trim().split('\n').join('\n       ')}` : ''}`);
  }
}

console.log('check');
{
  const r = run(['check', build(), VERSION]);
  check('a whole build passes', r.code === 0 && /both scripts match/.test(r.out), r.out);
}
{
  const dir = build();
  writeFileSync(join(dir, 'page2ai-agent.fn.js'), `${readFileSync(join(dir, 'page2ai-agent.fn.js'), 'utf8')}// changed\n`);
  const r = run(['check', dir, VERSION]);
  check('a script that does not match the sums fails', r.code === 1 && /does not match/.test(r.out), r.out);
}
{
  const r = run(['check', build('1.4.0+abc1234'), VERSION]);
  check('line 1 naming another build fails', r.code === 1 && /line 1 of page2ai-agent\.js/.test(r.out), r.out);
}
{
  const dir = build(VERSION, (files) => [...files, ['extra.js', 'x\n']]);
  const r = run(['check', dir, VERSION]);
  check('a sums file listing a third file fails', r.code === 1 && /must list exactly/.test(r.out), r.out);
}
{
  const r = run(['check', build(), '1.5.0']);
  check('a version without the commit is refused', r.code === 1 && /must look like/.test(r.out), r.out);
}

console.log('attach');
{
  const dir = build();
  const gh = github();
  const r = run(['attach', TAG, dir, VERSION], gh);
  const same = FILES.every((f) => onRelease(gh, f) === readFileSync(join(dir, f), 'utf8'));
  check('a release with only the zip gets all three files, checked after the upload',
    r.code === 0 && r.uploads.length === 1 && same && onRelease(gh, ZIP) === 'zip bytes' && /attach: OK/.test(r.out), r.out);
  const again = run(['attach', TAG, dir, VERSION], gh);
  check('a re-run uploads nothing and passes', again.code === 0 && again.uploads.length === 0 && /same bytes/.test(again.out), again.out);
  check('no call ever asks gh to replace a file', ![...r.calls, ...again.calls].some((c) => /clobber/.test(c)), [...r.calls, ...again.calls].join('\n'));
}
{
  const gh = github({ assets: { [ZIP]: 'zip bytes', 'page2ai-agent.js': 'another build\n' } });
  const r = run(['attach', TAG, build(), VERSION], gh);
  check('a different same-name file on the release stops it, nothing uploaded',
    r.code === 1 && r.uploads.length === 0 && /already has a different page2ai-agent\.js/.test(r.out) && onRelease(gh, 'page2ai-agent.js') === 'another build\n', r.out);
}
{
  const r = run(['attach', TAG, build(), VERSION], github({ release: false }));
  check('no release for the tag: fails, nothing uploaded', r.code === 1 && r.uploads.length === 0 && /no published release v1\.5\.0/.test(r.out), r.out);
}
{
  const r = run(['attach', TAG, build(), VERSION], github({ immutable: true }));
  check('an immutable release: fails, nothing uploaded', r.code === 1 && r.uploads.length === 0 && /immutable release/.test(r.out), r.out);
}
{
  const r = run(['attach', 'v1.6.0', build(), VERSION], github());
  check('a build of another version is refused before any call', r.code === 1 && r.calls.length === 0 && /is not a build of v1\.6\.0/.test(r.out), r.out);
}
{
  const r = run(['attach', TAG, build(), VERSION], github(), { FAKE_GH_CORRUPT_UPLOAD: 'page2ai-agent.fn.js' });
  check('a file damaged on the way to the release is caught by the check there', r.code === 1 && /do not match the page2ai-agent\.SHA256SUMS there/.test(r.out), r.out);
}
{
  const r = run(['attach', TAG, build(), VERSION], github(), { FAKE_GH_BAD_DIGEST: 'page2ai-agent.js' });
  check("GitHub's digest disagreeing with the build fails", r.code === 1 && /digest of page2ai-agent\.js/.test(r.out), r.out);
}

console.log('plan');
{
  const gh = github();
  const r = run(['plan'], gh);
  const would = (r.out.match(/attach would upload/g) || []).length;
  check('reads the latest release, checks a download against its digest, uploads nothing',
    r.code === 0 && would === 3 && /matches GitHub's digest/.test(r.out) && r.uploads.length === 0 && readdirSync(join(gh, 'releases', TAG, 'assets')).length === 1, r.out);
}
{
  const r = run(['plan'], github({ immutable: true }));
  check('an immutable latest release fails the preflight', r.code === 1 && /immutable releases are on/.test(r.out), r.out);
}
{
  const r = run(['plan'], github(), { FAKE_GH_BAD_DIGEST: ZIP });
  check('a download that does not match the digest fails the preflight', r.code === 1 && /does not match GitHub's digest/.test(r.out), r.out);
}

rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
