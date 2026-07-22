# Changelog

All notable changes to Page2AI are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] — 2026-07-20

### Fixed

- **Tab capture no longer accumulates unbounded wall time on multi-group pages.** Every individual click was already bounded by [`waitForDomToSettle`](page2ai-extension/lib/core/dom.ts:507)'s `tabClickWaitMs` (default 700 ms) — but a page with 30+ tab groups × up to 16 buttons could still stretch tab-phase wall time past a minute on the aggregate, blocking the rest of extraction (dropdowns, main render, quality gate). New cumulative `tabPhaseBudgetMs` (default 60 000 ms) — when exceeded, remaining tab groups are skipped via the same sticky `state.tabCaptureAborted` flag introduced in 1.0.1. Progress log records exactly how many groups were skipped.
- **Test-harness race fixed.** `.test/real-sites-{retry,test}.mjs` used to poll `chrome.storage.session` on a 1-second interval with a hard deadline; if the extractor finished a few milliseconds before deadline, the `PAGE2AI_RESULT` message reached the SW listener but background's `storage.session.set` hadn't flushed yet — the harness reported a false timeout (session #8 vLLM regression). Harness now installs an extra SW listener that stamps a per-tab result marker; polling tightens to 100 ms once the marker is set, and a 5-second grace poll runs if the deadline expires with a marker present.

### Added

- **`perTabHardTimeoutMs` config field** (default 5 000 ms) — defense-in-depth hard timeout around `captureCurrentTabPanel`. Today's implementation is synchronous inside so the timeout is theatre, but it guards against future changes that add async waits (network fetches, additional MutationObserver settles) inside the capture path.
- **`utils.withHardTimeout<T>` helper** — Promise.race pattern that resolves to `null` (or a caller-provided fallback) instead of rejecting on timeout, so callers can treat "no capture" and "timed out" uniformly.

### Internal

- `ExtractorState` gains `tabPhaseStartMs: number | null`.
- e2e smoke still passes 31/31 (frontmatter enrichment + tab capture) with no config overrides — new defaults do not activate on the fixture page.

[1.0.2]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.2

## [1.0.1] — 2026-07-20

### Added

- **Rich frontmatter** — every extraction now includes discovered OpenGraph (`og_title`, `og_description`, `og_image`, `og_type`, `og_site_name`, `og_locale`), Twitter Card (`twitter_card`, `twitter_title`, `twitter_description`, `twitter_image`), `article:*` (`published`, `modified`, `author`, `section`, `tags[]`), `<meta name="author">`, `<meta name="keywords">`, and JSON-LD fallbacks for author/dates as YAML keys — RAG/LLM pipelines that only read frontmatter now see everything. Dedup: keys are omitted when equal to `title`/`description` already present.

### Fixed

- **Tab capture no longer hangs on multi-group SPA pages after URL drift.** Previously the abort flag was scoped to a single tab group's inner loop, so the next group re-clicked on the drifted URL and reset the flag — a page with 12 tab groups would run out the 240 s per-page cap. Abort is now sticky on `ExtractorState.tabCaptureAborted` and breaks the outer `for (const g of gs)` loop.

### Internal

- `ExtractorState` gains `tabCaptureAborted: boolean`.
- `buildFrontmatter` uses shared `yq` helper (single-source YAML escape); `findJsonLdField` reads scalar / Person.name / arrays from the JSON-LD graph.
- e2e smoke asserts 14 additional frontmatter fields (total 31/31 checks passing).

[1.0.1]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.1

## [1.0.0] — 2026-07-20

Initial public release.

### Added

- **One-click extraction** — click the toolbar icon or press `Alt+Shift+M`, get the current page as clean Markdown in your clipboard.
- **Profile system** — auto-detects the site type (docs, marketing, WordPress-marketing, research, dashboard) and adjusts strategy; manual override in the popup.
- **`llms.txt` short path** — if the site publishes an official `.md` sibling for the page, Page2AI uses it directly (with a fidelity check).
- **Tab / dropdown capture** — extracts code samples from hidden tabs (Python vs TypeScript vs cURL vs…) with DOM-position-aware dedup; captures collapsed `<details>` and dropdown menus.
- **MDX / JSX post-processing** — Mintlify `<Note>`, `<CodeGroup>`, `<Tabs>`, `<AccordionGroup>` become clean Markdown.
- **Quality gate** — post-extraction check on `<pre>` count vs plain-text baseline; automatic fallback to a permissive rendering if under-extraction is detected.
- **Structured data appendix** — JSON-LD, OpenGraph, Microdata, and framework state (Next.js `__NEXT_DATA__`, Nuxt, Remix) are hoisted into a machine-readable appendix at the end of the document.
- **PII masking (opt-in)** — email, phone, and SSN-like patterns can be replaced with placeholders.
- **Cached result recovery** — if you close the popup during a long extraction, reopening it restores the finished result from `chrome.storage.session` (badge shows ✓).
- **Progress log** — live per-step progress with 300-entry ring buffer, filtered by tab.
- **Dark mode** — popup follows `prefers-color-scheme`.

### Security & privacy

- **Minimum permissions**: `activeTab`, `scripting`, `clipboardWrite`, `storage`. No `<all_urls>`, no `host_permissions`, no `tabs` API — Chrome will not warn the user that the extension can read all sites, because it cannot.
- **On-demand injection** via `chrome.scripting.executeScript` — no `content_scripts` registered in the manifest, so the extension runs on zero pages until you act.
- **No network requests** to any server operated by Page2AI or the publisher. See [PRIVACY.md](PRIVACY.md).
- **No remote code** — everything runs from the bundled extension package.

### Technical

- Manifest V3, service worker background.
- Built with [WXT](https://wxt.dev) 0.20.27 + TypeScript 5.9 (strict).
- Extraction core ported from `Sequential AI Markdown Exporter Rev-032v2` (2024-line DevTools console script, 32 revisions of field iteration) into 13 typed modules (~4300 lines).
- End-to-end verified in real Chrome via puppeteer-core (17 injection-path checks + 11 popup-UX checks).

### Field-tested profiles

Verified against real production pages: uscis.gov (marketing profile), docs.openwebui.com (docs + `llms.txt` short path), docs.x.ai (docs + tab capture), and others.

[1.0.0]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.0
