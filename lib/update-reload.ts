// When the browser has an update of Page2AI ready, reload into it as soon as no Agent
// Bridge request is in flight.
//
// Chrome installs a downloaded update only once the extension is idle, which in MV3
// means its service worker is not running, and «If an extension's service worker is
// constantly being triggered by events, it may never reach an idle state, and the update
// will be deferred until the browser is restarted» (developer.chrome.com, «Extension
// update lifecycle», 2025-09-08). A connected bridge pings every 20 s, which is exactly
// what keeps the worker running (Chrome 116+), so without this the side of the bridge
// that updates fast would stop updating for as long as an MCP client stays open.
// Firefox applies an update at once when nothing listens and at the next reload when
// something does, so the listener must reload.

export const UPDATE_POLL_MS = 5_000;
// Above the longest bridge convert (timeout_ms is capped at 60 s), so a request in
// flight finishes; a stuck one does not hold the update past this.
export const UPDATE_MAX_WAIT_MS = 120_000;

export function reloadWhenIdle(isBusy: () => Promise<boolean>, reload: () => void): void {
  const started = Date.now();
  const tick = async (): Promise<void> => {
    // A check that fails counts as idle: the update must not hang on it.
    const busy = await isBusy().catch(() => false);
    if (!busy || Date.now() - started >= UPDATE_MAX_WAIT_MS) reload();
    else setTimeout(() => void tick(), UPDATE_POLL_MS);
  };
  void tick();
}
