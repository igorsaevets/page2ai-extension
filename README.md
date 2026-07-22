<div align="center">
  <img src="public/icon/128.png" width="96" height="96" alt="Page2AI">
  <h1>Page2AI</h1>
  <p><strong>Convert any webpage to clean, AI-ready Markdown.</strong></p>
  <p>Chrome extension. 100% local. Open source. MIT.</p>
  <p>
    <a href="#install"><img src="https://img.shields.io/badge/Chrome-Install-4285F4?logo=googlechrome&logoColor=white" alt="Install"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-4f46e5" alt="MIT"></a>
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-4f46e5" alt="v1.0.0"></a>
    <a href="PRIVACY.md"><img src="https://img.shields.io/badge/data-never%20leaves-10b981" alt="Local only"></a>
  </p>
</div>

---

**Page2AI** is a one-click Chrome extension that turns any webpage into a clean Markdown document, ready to paste into Claude, ChatGPT, Cursor, or your RAG pipeline. Everything runs inside your browser — no servers, no accounts, no telemetry.

## Features

- **Profile-aware extraction.** Auto-detects the site kind (docs, marketing, research, dashboard, WordPress marketing) and tunes the strategy per profile.
- **Tab dedup & code capture.** DOM-position-aware capture of tabbed panels (Python vs TypeScript vs cURL) with dedup — you get the code from every tab, not just the active one.
- **MDX / JSX post-processing.** Turns Mintlify components (`<Note>`, `<CodeGroup>`, `<Tabs>`) into clean Markdown.
- **`llms.txt` discovery.** If the site publishes an official `.md` alongside the page, Page2AI uses it directly (short path, best fidelity).
- **Quality gate.** Counts `<pre>` blocks vs plain-text baseline to catch under-extraction, then falls back automatically.
- **Structured data hoisting.** JSON-LD, OpenGraph, Microdata and internal state (Next.js `__NEXT_DATA__`, etc.) go into a machine-readable appendix.
- **PII masking.** Optional patterns for emails, phones, SSN-like strings.
- **One hotkey.** `Alt+Shift+M` opens the popup; Enter runs the extraction.
- **One-click clipboard + download.** Markdown lands in your clipboard automatically, plus a `.md` file if you want it.

## Install

### Chrome Web Store
_Coming soon — link will be added after first CWS review._

### Load unpacked (developers / early adopters)

```powershell
# 1. Clone and build
git clone https://github.com/igorsaevets/page2ai-extension.git
cd page2ai-extension
npm install
npm run build

# 2. In Chrome / Edge / Brave: chrome://extensions
#    → enable "Developer mode"
#    → "Load unpacked"
#    → select page2ai-extension\.output\chrome-mv3\
```

Pin the toolbar icon and hit `Alt+Shift+M` on any page.

## Usage

1. Open the page you want to convert.
2. Click the Page2AI toolbar icon (or `Alt+Shift+M`).
3. Pick a profile — or leave it on **Auto** (recommended).
4. Click **Extract**. Live progress shows in the popup.
5. Markdown is copied to your clipboard automatically. Optional: click **Download `.md`**.

**Profiles:** `auto` (default), `docs` (Mintlify, Docusaurus, MkDocs), `marketing`, `wordpress-marketing`, `research`, `dashboard`. See [`lib/core/profiles.ts`](page2ai-extension/lib/core/profiles.ts) for the tuning behind each.

## Privacy

**Page2AI does not send any data anywhere.**

- No analytics, no telemetry, no crash reports.
- No cloud service. No account. No sign-in.
- Nothing is stored beyond your local preferences (`chrome.storage.local`).
- Nothing is shared cross-site or cross-tab beyond the tab you clicked on.

The extension only reads the page you explicitly acted on (`activeTab` gesture). Full details: [PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the currently active tab **only** after you click the toolbar icon or hit `Alt+Shift+M`. Not persistent, not blanket. |
| `scripting` | Programmatically inject the extraction script into that tab. |
| `clipboardWrite` | Copy the generated Markdown to your clipboard. |
| `storage` | Persist your profile preference and last-used options locally. |

**No `host_permissions`. No `<all_urls>`. No `tabs` API.** Chrome will not warn you that the extension can "read all your data on all sites", because it can't.

## Architecture

```
popup (drives UX)
   ↓ chrome.runtime.sendMessage
background service worker (thin)
   ↓ chrome.scripting.executeScript
extractor.js (isolated world, on-demand)
   ↓ chrome.runtime.sendMessage → background → storage.session → popup
result: markdown + quality report
```

- **`lib/core/`** — pure extraction library, 13 modules, ~4300 lines of strict TypeScript. Ported from a battle-tested DevTools console script (Rev-032v2) that predates the extension by ~2 years.
- **`entrypoints/background.ts`** — thin service worker; injects the extractor and caches the result to `storage.session` keyed by tab id (badge shows ✓ when ready).
- **`entrypoints/extractor.ts`** — unlisted script; runs in the tab's isolated world; sends progress + result via `runtime.sendMessage`.
- **`entrypoints/popup/`** — vanilla TS + CSS, no framework. Profile selector, progress log with 300-entry ring buffer, auto-clipboard, download, cached-result recovery.

Built with [WXT](https://wxt.dev) (WebExtension framework), Manifest V3, TypeScript strict.

## Contributing

Bug reports and PRs are welcome. Please open an issue before large PRs so we can discuss scope.

Development:

```powershell
npm run dev          # WXT dev server + HMR
npm run build        # Production build → .output\chrome-mv3\
npm run compile      # tsc --noEmit type check
npm run icons        # Regenerate PNG icons from SVG sources
```

## Credits

Built by [Igor Saevets](https://github.com/igorsaevets), AI Expert and Entrepreneur.

Prototype: `Sequential AI Markdown Exporter Rev-032v2` (2024 lines of DevTools console script), refined through 32 revisions before being ported to a proper extension in July 2026.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Igor Saevets.
