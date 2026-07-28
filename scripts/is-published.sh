#!/usr/bin/env bash
# Is Page2AI actually live in the Chrome Web Store?
#
# Asks Chrome's own update service, the endpoint a real browser uses to fetch
# extension updates. It answers for published items only, and it answers to
# anybody: no account, no OAuth token, no dashboard.
#
# Use this instead of a dashboard screenshot or an API "OK". Twice in one week a
# system we asked told us what we wanted to hear:
#   - a green Actions run over a step that had failed (continue-on-error), and
#   - POST /publish returning {"status":["OK"]} while publishing nothing.
# Neither of those is the destination. This is.
#
#   ./scripts/is-published.sh              # our extension
#   ./scripts/is-published.sh <other-id>   # any extension, e.g. to sanity-check
#
# Exit 0 = live, 1 = not live, 2 = could not tell.

set -euo pipefail

ITEM_ID="${1:-dlpaaijcnbbmlfeohlphjpnbbcnomnno}"
ENDPOINT="https://clients2.google.com/service/update2/crx"
QUERY="prodversion=140.0&acceptformat=crx2,crx3&x=id%3D${ITEM_ID}%26uc"

XML=$(curl -sS --max-time 30 "${ENDPOINT}?${QUERY}")
echo "$XML"
echo

if grep -q 'status="ok"' <<<"$XML"; then
  VERSION=$(sed -n 's/.*version="\([^"]*\)".*/\1/p' <<<"$XML" | head -1)
  echo "LIVE. Published version: ${VERSION:-unknown}"
  exit 0
fi

if grep -q 'error-unknownApplication' <<<"$XML"; then
  echo "NOT LIVE. Google's update service has no published CRX for ${ITEM_ID}."
  echo "An item that is still in review answers exactly like this, so this does not"
  echo "distinguish 'in review' from 'rejected' from 'never submitted'. For that,"
  echo "read the Developer Dashboard, or run the cws-status workflow."
  exit 1
fi

echo "UNDETERMINED. Unexpected response above."
exit 2
