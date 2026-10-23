"""Answer Chrome's extension site-access prompt in the e2e TEST browser, by Windows UI Automation.

Windows only; needs pywinauto (UIA backend). Chrome draws the prompt itself, outside any page,
so neither puppeteer nor a browser-automation extension can click it (T167, 2026-10-23).
Usage: python .e2e/click-allow.py <log of e2e-bridge.mjs run with MANUAL_GRANT=1>
Waits for the harness to print `browser pid: N` (the Chrome it launched with a throwaway profile),
then looks ONLY at windows of that process for a button named Allow / Разрешить, prints the
dialog's texts, clicks it, and exits 0. Exits 1 if nothing appears in 120 s. Never touches any
other Chrome (Igor's own browser runs other PIDs).
"""
import re
import sys
import time

from pywinauto import Desktop

ALLOW = {'Allow', 'Разрешить'}
log_path = sys.argv[1]
deadline = time.time() + 150

pid = None
while time.time() < deadline and pid is None:
    try:
        m = re.search(r'browser pid: (\d+)', open(log_path, encoding='utf-8', errors='replace').read())
        pid = int(m.group(1)) if m else None
    except OSError:
        pass
    time.sleep(0.3)
if pid is None:
    print('NO PID in the harness log')
    sys.exit(1)
print(f'watching Chrome pid {pid}')

while time.time() < deadline:
    for w in Desktop(backend='uia').windows(process=pid):
        try:
            buttons = w.descendants(control_type='Button')
        except Exception:
            continue
        for b in buttons:
            if b.window_text() not in ALLOW:
                continue
            texts = [t.window_text() for t in w.descendants(control_type='Text') if t.window_text().strip()]
            print('DIALOG window:', w.window_text())
            print('DIALOG texts :', ' / '.join(texts[:12]))
            print('BUTTONS      :', ' / '.join(x.window_text() for x in buttons if x.window_text())[:300])
            try:
                b.invoke()
            except Exception:
                b.click_input()
            print('CLICKED', b.window_text())
            sys.exit(0)
    time.sleep(0.5)
print('NO DIALOG within the deadline')
sys.exit(1)
