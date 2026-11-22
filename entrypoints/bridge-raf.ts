// Unlisted script: builds to /bridge-raf.js. The Agent Bridge registers it for the
// host it is about to open, just before it opens the tab, and removes the
// registration once that tab has loaded (lib/agent-bridge.ts, registerRafShim).
// It runs in the page's main world at document_start.
//
// Why (P2A-084): the bridge reads in a background tab, and Chrome runs no
// requestAnimationFrame callbacks in a tab that is not shown. Renderers that draw
// in rAF never finish there. Stencil before 4.44 is the measured case: it hides
// every component (`visibility: hidden` until `.hydrated`) and renders them in a
// rAF-scheduled queue, so in the bridge's tab the page's text shrank to its shell
// and stayed there, while the same tab brought to the front rendered everything.
// Stencil 4.44+ switches to a 16 ms timer itself while `document.hidden`
// (stenciljs/core #6811, #6918); this does the same for every page the bridge opens.
//
// While the document is hidden, a frame request becomes a 16 ms timer (Chrome
// still slows timers in hidden tabs, so a page that animates costs little). When
// the tab is shown, requests go to the browser's own frames again.

export default defineUnlistedScript(() => {
  if (document.visibilityState !== 'hidden') return;
  const w = window;
  const nativeRequest = w.requestAnimationFrame;
  const nativeCancel = w.cancelAnimationFrame;
  if (typeof nativeRequest !== 'function' || typeof nativeCancel !== 'function') return;

  // Ids above any the browser hands out in a page's lifetime, so a cancel can tell
  // a timer from a real frame request.
  let next = 0x40000000;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  w.requestAnimationFrame = function requestAnimationFrame(callback: FrameRequestCallback): number {
    if (document.visibilityState !== 'hidden') return nativeRequest.call(w, callback);
    next += 1;
    const id = next;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      callback(performance.now());
    }, 16));
    return id;
  };
  w.cancelAnimationFrame = function cancelAnimationFrame(id: number): void {
    const timer = timers.get(id);
    if (timer === undefined) {
      nativeCancel.call(w, id);
      return;
    }
    clearTimeout(timer);
    timers.delete(id);
  };
});
