# Changelog

All notable changes to Page2AI are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Tab-panel content visible in the DOM was dropped when its capture failed, and code-toolbar buttons were clicked as if they were tabs** ([#11](https://github.com/igorsaevets/page2ai-extension/issues/11)), reproduced on `ai.google.dev/gemini-api/docs/thinking`, where 4 of 5 sample groups lost their code entirely (the streaming `Alice…` sample was nowhere in the output). Three mechanisms, all fixed. (1) *Duplicate panel ids:* Google's devsite gives every tab group the same panel ids (`tabpanel-python`…), and `aria-controls` resolution via document-wide `getElementById` always returned the first group's panel — every later group captured group 1's content, saw a "duplicate" and exported nothing; ids now resolve near the button (closest ancestor containing a match) before falling back to the document. (2) *Weak dedupe signature:* panels were deduplicated by their first+last 200 chars, and code samples for the same API share exactly those (same imports, same closing lines) — different content was suppressed as duplicate; the signature now includes length and a full-text hash, so only byte-identical panels dedupe, and their skipped location says `TAB PANEL DUPLICATE OF A PANEL EXPORTED ABOVE` instead of pretending the content moved. A panel is marked as relocated only at the moment its content is actually exported, and a panel too large to relocate stays in place in full rather than exporting truncated. (3) *Toolbar chrome as tabs:* buttons inside `<pre>`/code toolbars and feedback/rating widgets (`Dark code theme`, `Copy code sample`, `Helpful`) were discovered as tab groups and clicked — a theme toggle click persists in the reader's site preferences; the exclusion is structural (localized labels defeat text patterns) and matches the live devsite markup (`devsite-thumb-rating`, measured — the thumbs carry no "feedback" class, which is how the first cut of this rule missed them; caught by the review panel). A button with real tab semantics (`role="tab"` or `aria-controls`) is exempt, so genuine tab widgets on pages about feedback products still capture. A truncated delta export no longer suppresses the full in-place render of a visible panel, and a malformed `aria-controls` id degrades to the document lookup instead of aborting the tab phase. On the reproduced page: code blocks 4 → 16, zero capture failures, extraction ~11 s faster. Covered by a new e2e suite (`.e2e/e2e-tab-panels.mjs`, in CI): duplicate-id, true-duplicate, toolbar-not-clicked (with click counters) and oversize-panel fixtures, 16 checks, 9 of which fail on the pre-fix build. The dev harness now also saves the extractor's progress stream (`<slug>.progress.txt`) — the record that located all three mechanisms.

- **Extraction died — and could navigate the user away — on pages whose tab widgets change the URL without pushing a history entry** ([#10](https://github.com/igorsaevets/page2ai-extension/issues/10)), Google's developer docs (`ai.google.dev`) being the reproduced case. Tab capture undid URL drift with `history.back()`; on replace-style drift there is no entry to go back to, so the browser left the page entirely, the injected extractor died mid-run and the popup waited forever. The restore now picks its mechanism by the `history.length` delta since the last restore: strict growth means the click pushed an entry above ours, so `back()` pops it cleanly (no Back-button pollution, the site's own `popstate` handling fires); no growth means replace-style drift, restored with `history.replaceState` — same document, a navigation is impossible by construction — putting back the history state captured at extraction start, not the widget's. The baseline resyncs after every restore because `history.length` never shrinks on `back()`. Covered by a new e2e suite (`.e2e/e2e-url-drift.mjs`, in CI): replace-drift and push-drift fixtures, both must complete, capture both tab panels, leave the tab on the page and leave the history stack unpolluted. Also adds `.e2e/extract-url.mjs`, a dev utility that runs any live URL through the real extension pipeline (`--lang en-US` by default so results do not depend on the machine locale) and saves markdown + quality meta + the rendered page's innerText — the harness that caught the bug.

- **Duplicate H1 when the page's own `<h1>` equals `document.title`** ([#8](https://github.com/igorsaevets/page2ai-extension/issues/8), port of [page2ai-core#9](https://github.com/igorsaevets/page2ai-core/issues/9)). The output opens with a synthetic title heading, and the DOM walk then rendered the page's own `<h1>` — on most well-formed pages the same string, so files started with two identical H1s (reproduced in-browser on `example.com` and `iana.org/help/example-domains`). The first heading the walk meets is now skipped when its normalized `textContent` equals the title; the dedupe window closes at that first heading either way, so an identical heading later in the page is content and still renders. The comparison runs on `textContent`, not the rendered markdown, so escaping cannot defeat it. The official-markdown short path got the matching treatment: a mirror whose first line is the same H1 no longer duplicates it. Covered by a new e2e suite (`.e2e/e2e-title-dedupe.mjs`, in CI): duplicate, distinct-title, later-identical-heading, markdown-specials, empty-title (over-removal guard) and official-mirror fixtures, 13 checks.

## [1.3.0] - 2026-07-27

### Added

- **Client-rendered (SPA) page support.** Pages that render their content in the browser after load were previously captured as an empty shell. The extractor now waits for content before it reads anything.

  The existing `waitForDomToSettle` helper answers "has the DOM stopped changing", and on a client-rendered page that is the wrong question: an empty `<div id="root">` with a fetch in flight is perfectly quiescent, so a settle-based wait resolves immediately and the shell gets converted. The new gate in `lib/core/spa-readiness.ts` waits for *content* instead. It samples a two-part signal (character count and content-element count of the primary content root), requires it to hold still across consecutive samples, and refuses to release while an explicit loading indicator (`aria-busy`, `role="progressbar"`, skeleton / spinner / shimmer classes) is present. A page that is already rendered pays a single measurement and skips the wait entirely.

- **Readiness reported in the output.** When the gate engages, the frontmatter carries `client_render_wait` (`ready` or `timeout`), `client_render_wait_ms`, `client_render_chars` and, on a timeout, `client_render_blocked_by` naming the selector that was still showing. A short page and a page we gave up on are no longer indistinguishable.

- **Five configuration knobs**: `spaReadinessMode` (`off` / `auto` / `always`, default `auto`), `spaMinContentChars` (200), `spaPollIntervalMs` (150), `spaMaxWaitMs` (6000), `spaStableSamples` (2). The `dashboard` profile ships `always` with a 10 s budget, since a dashboard is a single-page app by definition.

- **`.e2e/e2e-spa.mjs`** — an A/B end-to-end suite, 16 checks. The same client-rendered fixture is extracted with the gate off and on in the same browser, and the control half is *required to fail* to render the late content. A suite whose control passes is not testing the feature.

- **End-to-end tests now run in CI** on every push and pull request, against a real Chrome, alongside the type-check and build.

### Changed

- Character count is no longer part of the release condition, only of the decision to start waiting and of how long stability must hold. The first implementation gated release on the character floor and the new e2e suite caught it: a genuinely short page that had finished rendering could never satisfy the floor, so the gate burned its whole budget and reported a timeout on a page that had been ready for seconds.

[1.3.0]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.3.0

## [1.2.0] - 2026-07-23

### Added

- **Table colspan support.** Cells with `colspan="N"` now expand into N cells in Markdown output (content plus empty padding cells). Fixes misaligned tables on pages with merged header cells, which show up often in API pricing tables and model comparison charts. Capped at 20 to prevent abuse.

### Fixed

- **Blockquotes preserve rich formatting.** Previously, blockquotes were flattened to plain text via `innerText`, losing bold, links, inline code, and nested structure. Now rendered recursively, so `> **Note:** see [link](url)` is preserved instead of becoming `> Note: see link`.

### Performance

- **`renderLiInlineText` no longer clones the DOM subtree.** Replaced `cloneNode(true)` plus `querySelectorAll().forEach(remove)` with a `skipTags` parameter to `renderInlineChildren`. Avoids creating and immediately discarding a full DOM clone for every `<li>`. On pages with hundreds of list items (API reference docs, changelogs), this reduces GC pressure.
- **`innerText` replaced with `textContent` in hot paths.** Table cells, badges, inline text fallback, and detail summaries no longer trigger synchronous layout reflow. `textContent` is O(n) DOM traversal vs `innerText`'s forced layout computation. On pages with large tables (100+ cells), extraction is noticeably faster.

### Internal

- `renderInlineChildren` gains optional `skipTags?: Set<string>` parameter.
- `LI_BLOCK_SKIP` constant: set of 8 block-level tags skipped during LI inline rendering.
- e2e smoke tests extended to 36 checks (+2: blockquote rich formatting, table colspan expansion).

[1.2.0]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.2.0

## [1.1.0] - 2026-07-22

### Added

- **Code block language detection from sibling/parent elements.** `renderCodeBlock` now searches for language labels outside the `<pre>`/`<code>` element. Checks `data-language`/`data-lang` attributes up the DOM chain (code, pre, parent, grandparent), CSS `language-xxx` classes, language label elements matched by CSS selectors (`.lang-label`, `.code-language`, etc.), and single-word sibling text validated against a 130+ entry known-languages set. Covers Docusaurus, Starlight, Shiki, Expressive Code, GitHub Docs, and other modern doc frameworks. Fixes the reported "Shell" label not appearing in Markdown fence info string.
- **Code block title extraction.** Captures titles from `data-title`/`data-filename`/`data-code-title` attributes, `figcaption`, and elements matched by title selectors (`.codeBlockTitle`, `.remark-code-title`, `.code-title`, etc.). Titles appear in the fence info string as `title="..."`, e.g. `` ```json title="config.json: Main configuration" ``. Fixes the reported missing "opencode.json: Chat Completions adapter (fallback)" content.
- **Mermaid diagram detection.** `<pre class="mermaid">` blocks now get `lang=mermaid` in the fence info string.
- **Language inference from filename.** When a code block has a title containing a file extension but no explicit language, the language is inferred (e.g. `config.json` becomes `json`).

### Fixed

- **Shiki line numbers no longer leak into code text.** `extractShiki()` now filters out `.line-number` and `.ln` elements from the collected lines.
- **Deep DOM stack overflow protection.** `renderNode` now returns empty for depth > 120, preventing stack overflow on maliciously or accidentally deep DOM trees.

### Internal

- `extractNearbyMeta(pre)` helper with `normalizeLang()` validation, `KNOWN_LANGS` set, `CODE_TITLE_SELECTORS`, `CODE_LANG_SELECTORS`.
- e2e smoke tests extended to 34 checks (+3: sibling language label, title in fence info, data-language attribute).

[1.1.0]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.1.0

## [1.0.2] - 2026-07-20

### Fixed

- **Tab capture no longer accumulates unbounded wall time on multi-group pages.** Every individual click was already bounded by [`waitForDomToSettle`](page2ai-extension/lib/core/dom.ts:507)'s `tabClickWaitMs` (default 700 ms), but a page with 30+ tab groups times up to 16 buttons each could still stretch tab-phase wall time past a minute on the aggregate, blocking the rest of extraction (dropdowns, main render, quality gate). New cumulative `tabPhaseBudgetMs` (default 60,000 ms) triggers sticky abort via the `state.tabCaptureAborted` flag introduced in 1.0.1 when exceeded. Progress log records exactly how many groups were skipped.
- **Test-harness race fixed.** `.test/real-sites-{retry,test}.mjs` used to poll `chrome.storage.session` on a 1-second interval with a hard deadline. If the extractor finished a few milliseconds before deadline, the `PAGE2AI_RESULT` message reached the SW listener but background's `storage.session.set` had not flushed yet. Harness reported a false timeout (session #8 vLLM regression). Harness now installs an extra SW listener that stamps a per-tab result marker. Polling tightens to 100 ms once the marker is set, and a 5-second grace poll runs if the deadline expires with a marker present.

### Added

- **`perTabHardTimeoutMs` config field** (default 5,000 ms). Defense-in-depth hard timeout around `captureCurrentTabPanel`. Today's implementation is synchronous inside so the timeout is theatre, but it guards against future changes that add async waits (network fetches, additional MutationObserver settles) inside the capture path.
- **`utils.withHardTimeout<T>` helper**. Promise.race pattern that resolves to `null` (or a caller-provided fallback) instead of rejecting on timeout, so callers can treat "no capture" and "timed out" uniformly.

### Internal

- `ExtractorState` gains `tabPhaseStartMs: number | null`.
- e2e smoke still passes 31/31 (frontmatter enrichment + tab capture) with no config overrides. New defaults do not activate on the fixture page.

[1.0.2]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.2

## [1.0.1] - 2026-07-20

### Added

- **Rich frontmatter.** Every extraction now includes discovered OpenGraph (`og_title`, `og_description`, `og_image`, `og_type`, `og_site_name`, `og_locale`), Twitter Card (`twitter_card`, `twitter_title`, `twitter_description`, `twitter_image`), `article:*` (`published`, `modified`, `author`, `section`, `tags[]`), `<meta name="author">`, `<meta name="keywords">`, and JSON-LD fallbacks for author/dates as YAML keys. RAG/LLM pipelines that only read frontmatter now see everything. Dedup: keys are omitted when equal to `title`/`description` already present.

### Fixed

- **Tab capture no longer hangs on multi-group SPA pages after URL drift.** The abort flag used to be scoped to a single tab group's inner loop, so the next group re-clicked on the drifted URL and reset the flag. A page with 12 tab groups would run out the 240 s per-page cap. Abort is now sticky on `ExtractorState.tabCaptureAborted` and breaks the outer `for (const g of gs)` loop.

### Internal

- `ExtractorState` gains `tabCaptureAborted: boolean`.
- `buildFrontmatter` uses shared `yq` helper (single-source YAML escape). `findJsonLdField` reads scalar / Person.name / arrays from the JSON-LD graph.
- e2e smoke asserts 14 additional frontmatter fields (total 31/31 checks passing).

[1.0.1]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.1

## [1.0.0] - 2026-07-20

Initial public release.

### Added

- **One-click extraction.** Click the toolbar icon or press `Alt+Shift+M`, get the current page as clean Markdown in your clipboard.
- **Profile system.** Auto-detects the site type (docs, marketing, WordPress-marketing, research, dashboard) and adjusts strategy. Manual override in the popup.
- **`llms.txt` short path.** If the site publishes an official `.md` sibling for the page, Page2AI uses it directly (with a fidelity check).
- **Tab / dropdown capture.** Extracts code samples from hidden tabs (Python vs TypeScript vs cURL vs ...) with DOM-position-aware dedup. Captures collapsed `<details>` and dropdown menus.
- **MDX / JSX post-processing.** Mintlify `<Note>`, `<CodeGroup>`, `<Tabs>`, `<AccordionGroup>` become clean Markdown.
- **Quality gate.** Post-extraction check on `<pre>` count vs plain-text baseline. Automatic fallback to a permissive rendering if under-extraction is detected.
- **Structured data appendix.** JSON-LD, OpenGraph, Microdata, and framework state (Next.js `__NEXT_DATA__`, Nuxt, Remix) are hoisted into a machine-readable appendix at the end of the document.
- **PII masking (opt-in).** Email, phone, and SSN-like patterns can be replaced with placeholders.
- **Cached result recovery.** If you close the popup during a long extraction, reopening it restores the finished result from `chrome.storage.session` (badge shows a checkmark).
- **Progress log.** Live per-step progress with 300-entry ring buffer, filtered by tab.
- **Dark mode.** Popup follows `prefers-color-scheme`.

### Security & privacy

- **Minimum permissions**: `activeTab`, `scripting`, `clipboardWrite`, `storage`. No `<all_urls>`, no `host_permissions`, no `tabs` API. Chrome will not warn the user that the extension can read all sites, because it cannot.
- **On-demand injection** via `chrome.scripting.executeScript`. No `content_scripts` registered in the manifest, so the extension runs on zero pages until you act.
- **No network requests** to any server operated by Page2AI or the publisher. See [PRIVACY.md](PRIVACY.md).
- **No remote code.** Everything runs from the bundled extension package.

### Technical

- Manifest V3, service worker background.
- Built with [WXT](https://wxt.dev) 0.20.27 + TypeScript 5.9 (strict).
- Extraction core ported from `Sequential AI Markdown Exporter Rev-032v2` (2024-line DevTools console script, 32 revisions of field iteration) into 13 typed modules (~4300 lines).
- End-to-end verified in real Chrome via puppeteer-core (17 injection-path checks + 11 popup-UX checks).

### Field-tested profiles

Verified against real production pages: uscis.gov (marketing profile), docs.openwebui.com (docs + `llms.txt` short path), docs.x.ai (docs + tab capture), and others.

[1.0.0]: https://github.com/igorsaevets/page2ai-extension/releases/tag/v1.0.0
