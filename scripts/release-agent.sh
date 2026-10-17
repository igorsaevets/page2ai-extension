#!/usr/bin/env bash
# Puts the agent script (agent/README.md, BL-45 C) on the GitHub Release of a tag, for the agent-build and
# agent-release jobs of .github/workflows/publish-chrome.yml.
#
#   bash scripts/release-agent.sh check <dir> <version>          the build in <dir> is whole: the two scripts match
#                                                                 page2ai-agent.SHA256SUMS, which lists exactly them,
#                                                                 and line 1 of each names <version> (1.5.0+abc1234)
#   bash scripts/release-agent.sh plan                           read-only rehearsal on the latest release: download
#                                                                 one of its files, compare it with GitHub's digest,
#                                                                 list what attach would upload
#   bash scripts/release-agent.sh attach <tag> <dir> <version>   check, upload the files the release lacks, refuse to
#                                                                 replace one that differs, then download all three
#                                                                 back from the release and check them there
#
# plan and attach need GITHUB_REPOSITORY (owner/repo) and a gh CLI that can reach it (GH_TOKEN in CI). Nothing here
# talks to the Chrome Web Store: whatever fails, the store copy and the release's zip stay as they are.
#
# Recovery when the agent-release job fails on a tag: re-run that job alone (`gh run rerun <run-id> --job <job-id>`).
# If the workflow at the tag is itself broken, build the tag locally and run attach with your own gh login.
set -euo pipefail

SUMS=page2ai-agent.SHA256SUMS
SCRIPTS=(page2ai-agent.js page2ai-agent.fn.js)
FILES=("${SCRIPTS[@]}" "$SUMS")
REPO=
# Global, not local: the EXIT trap runs after the function that set it has returned.
TMP=

in_actions() { [ "${GITHUB_ACTIONS:-}" = true ]; }
# Workflow commands go to stdout, where the runner reads them.
die() {
  if in_actions; then echo "::error::$*"; else echo "ERROR: $*" >&2; fi
  exit 1
}
# jq on Windows ends its lines with CRLF; drop the CR so local runs compare like CI.
jqr() { jq -r "$@" | tr -d '\r'; }
has_asset() { jq -e --arg n "$2" 'any(.assets[]; .name == $n)' <<<"$1" >/dev/null; }
# From stdin: given a file name holding a backslash (a Windows path), sha256sum escapes it and starts its line with a backslash.
sha256_of() { sha256sum < "$1" | cut -c1-64; }

need_repo() {
  REPO=${GITHUB_REPOSITORY:-}
  [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "GITHUB_REPOSITORY must be owner/repo, got '$REPO'"
}

cmd_check() {
  local dir=$1 version=$2 f listed line
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+[0-9a-f]{7}$ ]] || die "check: the version must look like 1.5.0+abc1234, got '$version'"
  for f in "${FILES[@]}"; do
    [ -f "$dir/$f" ] || die "check: $dir/$f is missing"
  done
  listed=$(cut -c67- "$dir/$SUMS" | tr -d '\r' | LC_ALL=C sort | tr '\n' ' ')
  [ "$listed" = "page2ai-agent.fn.js page2ai-agent.js " ] || die "check: $SUMS must list exactly ${SCRIPTS[*]}; it lists: $listed"
  (cd "$dir" && sha256sum --strict --quiet -c "$SUMS") || die "check: a script in $dir does not match $SUMS"
  for f in "${SCRIPTS[@]}"; do
    IFS= read -r line < "$dir/$f" || true
    [[ "$line" == "// Page2AI agent script $version ("* ]] || die "check: line 1 of $f does not name build $version: ${line:0:90}"
  done
  echo "check: $dir holds build $version; both scripts match $SUMS"
}

cmd_plan() {
  local json tag name digest f
  need_repo
  json=$(gh api "repos/$REPO/releases/latest") || die "plan: cannot read the latest release of $REPO"
  tag=$(jqr .tag_name <<<"$json")
  [ "$(jqr .immutable <<<"$json")" != true ] || die "plan: $tag is an immutable release, so immutable releases are on for $REPO. attach adds files after the publish job has published the release, which an immutable release refuses: move the agent files into the release before it is published."
  name=$(jqr '.assets[0].name // empty' <<<"$json")
  if [ -n "$name" ]; then
    digest=$(jqr '.assets[0].digest // empty' <<<"$json")
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    gh release download "$tag" --repo "$REPO" --pattern "$name" --dir "$TMP"
    if [ -z "$digest" ]; then
      echo "plan: downloaded $name from $tag; GitHub reports no digest for it"
    elif [ "sha256:$(sha256_of "$TMP/$name")" = "$digest" ]; then
      echo "plan: downloaded $name from $tag; it matches GitHub's digest"
    else
      die "plan: $name downloaded from $tag does not match GitHub's digest $digest"
    fi
  fi
  for f in "${FILES[@]}"; do
    if has_asset "$json" "$f"; then
      echo "plan: $tag has its own $f; on a new tag attach compares a same-name file and never replaces it"
    else
      echo "plan: attach would upload $f"
    fi
  done
  echo "plan: OK, the release path of $REPO is readable (latest release $tag); nothing was uploaded"
}

cmd_attach() {
  local tag=$1 dir=$2 version=$3 json f digest
  local -a todo=()
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "attach: the tag must look like v1.5.0, got '$tag'"
  [[ "$version" == "${tag#v}+"* ]] || die "attach: build $version is not a build of $tag"
  cmd_check "$dir" "$version"
  need_repo
  json=$(gh api "repos/$REPO/releases/tags/$tag") || die "attach: $REPO has no published release $tag. The publish job creates it; read that job's log. Nothing attached."
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  for f in "${FILES[@]}"; do
    if has_asset "$json" "$f"; then
      gh release download "$tag" --repo "$REPO" --pattern "$f" --dir "$TMP/before"
      cmp -s "$TMP/before/$f" "$dir/$f" || die "attach: $tag already has a different $f. Not replacing a published file: whoever downloaded it holds the old checksum. Find out where it came from before deleting it by hand."
      echo "attach: $tag already has $f with the same bytes"
    else
      todo+=("$dir/$f")
    fi
  done
  if [ "${#todo[@]}" -gt 0 ]; then
    [ "$(jqr .immutable <<<"$json")" != true ] || die "attach: $tag is an immutable release, so files can no longer be added to it; they have to go in before the release is published."
    gh release upload "$tag" "${todo[@]}" --repo "$REPO"
    echo "attach: uploaded ${#todo[@]} file(s) to $tag"
  fi
  # Ask the destination: download all three back and check them the way a user would.
  gh release download "$tag" --repo "$REPO" --pattern "${FILES[0]}" --pattern "${FILES[1]}" --pattern "${FILES[2]}" --dir "$TMP/after"
  (cd "$TMP/after" && sha256sum --strict --quiet -c "$SUMS") || die "attach: the scripts on $tag do not match the $SUMS there"
  for f in "${FILES[@]}"; do
    cmp -s "$TMP/after/$f" "$dir/$f" || die "attach: $f on $tag differs from the build"
  done
  json=$(gh api "repos/$REPO/releases/tags/$tag")
  for f in "${FILES[@]}"; do
    digest=$(jq -r --arg n "$f" '.assets[] | select(.name == $n) | .digest // empty' <<<"$json" | tr -d '\r')
    [ -z "$digest" ] || [ "$digest" = "sha256:$(sha256_of "$dir/$f")" ] || die "attach: GitHub's digest of $f on $tag is not the build's"
  done
  echo "attach: OK, $tag carries ${FILES[*]} of build $version; downloaded back from the release and checked"
}

case "${1:-}" in
  check) [ $# -eq 3 ] || die "usage: $0 check <dir> <version>"; cmd_check "$2" "$3" ;;
  plan) [ $# -eq 1 ] || die "usage: $0 plan"; cmd_plan ;;
  attach) [ $# -eq 4 ] || die "usage: $0 attach <tag> <dir> <version>"; cmd_attach "$2" "$3" "$4" ;;
  *) die "usage: $0 check <dir> <version> | plan | attach <tag> <dir> <version>" ;;
esac
