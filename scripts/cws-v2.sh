#!/usr/bin/env bash
# Chrome Web Store API V2 client for the release workflows.
#
#   bash scripts/cws-v2.sh status                  read-only item status
#   bash scripts/cws-v2.sh upload <zip> [version]  upload a new package (draft only)
#   bash scripts/cws-v2.sh publish                 submit the uploaded package for review
#
# Why plain curl and not a marketplace action: the store credentials go to Google's
# two hosts and nowhere else, and one implementation serves both publish-chrome.yml
# and cws-status.yml. Google stops serving API V1 on 2026-10-15
# (https://developer.chrome.com/blog/cws-api-v2). V2 reference, read 2026-10-11:
#   https://developer.chrome.com/docs/webstore/using-api
#   https://developer.chrome.com/docs/webstore/api/reference/rest
#
# Required environment:
#   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
#       OAuth client and refresh token, scope https://www.googleapis.com/auth/chromewebstore
#   CWS_PUBLISHER_ID   Developer Dashboard > Publisher > Settings (new in V2)
#   CWS_ITEM_ID        the extension ID
# Optional: CWS_POLL_SECONDS (10) and CWS_MAX_POLLS (30) bound the wait while the
# store is still processing an upload. CWS_API_ROOT and CWS_TOKEN_URI exist for
# scripts/cws-v2.test.mjs and accept only Google's hosts or a loopback test server.
#
# Nothing secret is printed: no `set -x`, no `curl -v`, the access token is masked
# in GitHub Actions before its first use, and a failure prints Google's error code,
# status and message only.
set -euo pipefail

API_ROOT=${CWS_API_ROOT:-https://chromewebstore.googleapis.com}
TOKEN_URI=${CWS_TOKEN_URI:-https://oauth2.googleapis.com/token}
POLL_SECONDS=${CWS_POLL_SECONDS:-10}
MAX_POLLS=${CWS_MAX_POLLS:-30}
LOOPBACK='^http://127\.0\.0\.1:[0-9]+(/[A-Za-z0-9._/-]*)?$'
ACCESS_TOKEN=

in_actions() { [ "${GITHUB_ACTIONS:-}" = true ]; }
# Workflow commands go to stdout, where the runner reads them.
die() {
  if in_actions; then echo "::error::$*"; else echo "ERROR: $*" >&2; fi
  exit 1
}
warn() {
  if in_actions; then echo "::warning::$*"; else echo "WARNING: $*" >&2; fi
}
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi
}
# jq on Windows ends its lines with CRLF; drop the CR so local runs compare like CI.
jqr() { jq -r "$@" | tr -d '\r'; }

check_config() {
  local name
  for name in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID CWS_ITEM_ID; do
    [ -n "${!name:-}" ] || die "$name is empty. In GitHub Actions it comes from a repository secret named in the workflow's env block."
  done
  [[ $CWS_ITEM_ID =~ ^[a-p]{32}$ ]] || die "CWS_ITEM_ID is not a Chrome extension ID (32 letters a-p)."
  [[ $CWS_PUBLISHER_ID =~ ^[A-Za-z0-9._-]+$ ]] || die "CWS_PUBLISHER_ID contains characters a publisher ID never has."
  if [ "$API_ROOT" != https://chromewebstore.googleapis.com ] && ! [[ $API_ROOT =~ $LOOPBACK ]]; then
    die "CWS_API_ROOT must be https://chromewebstore.googleapis.com or a loopback test server."
  fi
  if [ "$TOKEN_URI" != https://oauth2.googleapis.com/token ] && ! [[ $TOKEN_URI =~ $LOOPBACK ]]; then
    die "CWS_TOKEN_URI must be https://oauth2.googleapis.com/token or a loopback test server."
  fi
  [[ $POLL_SECONDS =~ ^[0-9]+$ && $MAX_POLLS =~ ^[0-9]+$ ]] || die "CWS_POLL_SECONDS and CWS_MAX_POLLS must be whole numbers."
  command -v curl >/dev/null || die "curl is required."
  command -v jq >/dev/null || die "jq is required."
  ITEM_URL="$API_ROOT/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_ITEM_ID"
  UPLOAD_URL="$API_ROOT/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_ITEM_ID:upload"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/body.json"

fetch_token() {
  local code detail
  code=$(curl -sS --max-time 30 --retry 2 -o "$BODY" -w '%{http_code}' -X POST "$TOKEN_URI" \
    --data-urlencode "client_id=$CWS_CLIENT_ID" \
    --data-urlencode "client_secret=$CWS_CLIENT_SECRET" \
    --data-urlencode "refresh_token=$CWS_REFRESH_TOKEN" \
    --data-urlencode "grant_type=refresh_token") \
    || die "The token request did not complete (network error or timeout)."
  ACCESS_TOKEN=$(jqr '.access_token // empty' "$BODY" 2>/dev/null || true)
  if [ "$code" != 200 ] || [ -z "$ACCESS_TOKEN" ]; then
    detail=$(jqr '[.error, .error_description] | map(select(. != null) | tostring) | join(": ")' "$BODY" 2>/dev/null || true)
    die "Token exchange failed: HTTP $code ${detail:-(no error body)}. invalid_grant means the refresh token was revoked or has expired."
  fi
  rm -f "$BODY"
  if in_actions; then echo "::add-mask::$ACCESS_TOKEN"; fi
  echo "Token exchange: OK"
}

# api METHOD URL [curl options...]: prints the HTTP status, leaves the reply in $BODY.
api() {
  local method=$1 url=$2
  shift 2
  curl -sS --max-time 300 -o "$BODY" -w '%{http_code}' -X "$method" \
    -H "Authorization: Bearer $ACCESS_TOKEN" "$@" "$url"
}

# fail_api WHAT HTTP_STATUS: stop with Google's own explanation of the failure.
fail_api() {
  local detail
  detail=$(jqr '[.error.code, .error.status, .error.message, (.error.details[]?.reason)]
                | map(select(. != null) | tostring) | join(" | ")' "$BODY" 2>/dev/null || true)
  if [ -z "$detail" ]; then
    detail="non-JSON reply: $(head -c 300 "$BODY" 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
  fi
  die "$1 failed: HTTP $2: $detail"
}

fetch_status() {
  local code
  code=$(api GET "$ITEM_URL:fetchStatus" --retry 2) \
    || die "fetchStatus did not complete (network error or timeout)."
  [ "$code" = 200 ] || fail_api fetchStatus "$code"
}

cmd_status() {
  local item report
  fetch_token
  fetch_status
  item=$(jqr '.itemId // empty' "$BODY")
  [ "$item" = "$CWS_ITEM_ID" ] || die "fetchStatus answered for a different item. Check CWS_ITEM_ID."
  report=$(jqr '
    def rev: if . == null then "none" else
      "\(.state // "UNKNOWN") \([.distributionChannels[]? | "\(.crxVersion // "?") at \(.deployPercentage // "?")%"] | join(", "))" end;
    "Published revision: \(.publishedItemRevisionStatus | rev)",
    "Submitted revision: \(.submittedItemRevisionStatus | rev)",
    "Last upload in 24 h: \(.lastAsyncUploadState // "none")",
    "Taken down: \(.takenDown // false); warned: \(.warned // false)"' "$BODY")
  echo "$report"
  summary "### Chrome Web Store API V2 status" "" "- ${report//$'\n'/$'\n'- }" ""
  if [ "$(jqr '.takenDown // false' "$BODY")" = true ]; then
    die "The store reports this item as TAKEN DOWN for a policy violation."
  fi
  if [ "$(jqr '.warned // false' "$BODY")" = true ]; then
    warn "The store has WARNED this item for a policy violation; it will be taken down unless resolved."
  fi
}

cmd_upload() {
  local zip=$1 want=$2 code state version polls=0
  [ -n "$zip" ] || die "usage: cws-v2.sh upload <zip> [expected-version]"
  [ -f "$zip" ] || die "No such file: $zip"
  fetch_token
  echo "Uploading $(basename "$zip") ($(wc -c <"$zip" | tr -d ' ') bytes)"
  code=$(api POST "$UPLOAD_URL" -H "X-Goog-Upload-Protocol: raw" \
      -H "X-Goog-Upload-File-Name: $(basename "$zip")" -T "$zip") \
    || die "The upload did not complete (network error or timeout)."
  [ "$code" = 200 ] || fail_api upload "$code"
  state=$(jqr '.uploadState // empty' "$BODY")
  version=$(jqr '.crxVersion // empty' "$BODY")
  # The media.upload page spells the pending value UPLOAD_IN_PROGRESS, the UploadState
  # enum page spells it IN_PROGRESS. Accept both.
  while [ "$state" = IN_PROGRESS ] || [ "$state" = UPLOAD_IN_PROGRESS ]; do
    if [ "$polls" -ge "$MAX_POLLS" ]; then
      die "The store is still processing the upload after $MAX_POLLS checks. Nothing was submitted. Run the 'Chrome Web Store status' workflow later and publish from it."
    fi
    polls=$((polls + 1))
    sleep "$POLL_SECONDS"
    fetch_status
    state=$(jqr '.lastAsyncUploadState // empty' "$BODY")
    echo "Upload still processing, check $polls: ${state:-no state}"
  done
  [ "$state" = SUCCEEDED ] || die "The store did not accept the package: upload state ${state:-missing}."
  if [ -n "$want" ] && [ -n "$version" ] && [ "$version" != "$want" ]; then
    die "The store read version $version from the package, expected $want."
  fi
  if [ -n "$want" ] && [ -z "$version" ]; then
    warn "The upload finished asynchronously, so the store did not report the package version to compare with $want."
  fi
  echo "Upload: SUCCEEDED, package version ${version:-not reported}"
  summary "Chrome Web Store upload: SUCCEEDED, package version ${version:-not reported}"
}

cmd_publish() {
  local code state line
  fetch_token
  code=$(api POST "$ITEM_URL:publish" -H "Content-Type: application/json" \
      --data '{"publishType":"DEFAULT_PUBLISH"}') \
    || die "The publish request did not complete (network error or timeout)."
  [ "$code" = 200 ] || fail_api publish "$code"
  while IFS= read -r line; do
    if [ -n "$line" ]; then warn "Store warning: $line"; fi
  done < <(jqr '.warningInfo.warnings[]? | "\(.reason // "UNKNOWN"): \(.description // "")"' "$BODY")
  state=$(jqr '.state // empty' "$BODY")
  case "$state" in
    PENDING_REVIEW | PUBLISHED | PUBLISHED_TO_TESTERS | STAGED) ;;
    *) die "The publish request answered with item state ${state:-missing}." ;;
  esac
  echo "Publish: accepted, item state $state"
  echo "Accepted is not live. The anonymous job of the 'Chrome Web Store status' workflow says when it is."
  summary "Chrome Web Store publish: accepted, item state $state"
}

case "${1:-}" in
  status) check_config; cmd_status ;;
  upload) check_config; cmd_upload "${2:-}" "${3:-}" ;;
  publish) check_config; cmd_publish ;;
  *)
    echo "usage: cws-v2.sh status | upload <zip> [expected-version] | publish" >&2
    exit 2
    ;;
esac
