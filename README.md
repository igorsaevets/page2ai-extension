<div align="center">

<img src="public/icon/128.png" width="96" height="96" alt="Page2AI">

# Page2AI

**Convert any webpage to clean, LLM-ready Markdown in one click.**

Browser extension for Chrome and Firefox. Built for Claude, ChatGPT, Cursor, Obsidian, and RAG pipelines. 100% local. Open source. MIT.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dlpaaijcnbbmlfeohlphjpnbbcnomnno?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)
[![Firefox Add-ons](https://img.shields.io/amo/v/page2ai-webpage-to-markdown?logo=firefox&logoColor=white&label=Firefox%20Add-ons)](https://addons.mozilla.org/en-US/firefox/addon/page2ai-webpage-to-markdown/)
[![License MIT](https://img.shields.io/badge/License-MIT-4f46e5.svg)](LICENSE)
[![Build](https://github.com/igorsaevets/page2ai-extension/actions/workflows/build.yml/badge.svg)](https://github.com/igorsaevets/page2ai-extension/actions/workflows/build.yml)
[![GitHub stars](https://img.shields.io/github/stars/igorsaevets/page2ai-extension?style=social)](https://github.com/igorsaevets/page2ai-extension/stargazers)

<br>

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)** — live since **2026-07-30** (v1.0.2, approved after a 9-day review).
Prefer to verify before trusting a README? The same anonymous check this file carried while the
listing was in review still works:

```
curl -s 'https://clients2.google.com/service/update2/crx?prodversion=140.0&acceptformat=crx2,crx3&x=id%3Ddlpaaijcnbbmlfeohlphjpnbbcnomnno%26uc'
```

<br>

<sub>Demo GIF recording in progress. Check back soon.</sub>

</div>

---

## Works with

Any tool that reads Markdown. That covers pretty much every LLM built for developers:

- **LLMs**: Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, xAI Grok, Mistral, Cohere
- **AI IDEs**: Cursor, GitHub Copilot, Windsurf, Zed, Continue
- **Notes**: Obsidian, Notion, Logseq, Roam, Reflect
- **Frameworks**: LangChain, LlamaIndex, Vercel AI SDK, OpenAI Agents SDK, Anthropic MCP, Haystack

## Why

Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, Cursor: all work better with clean Markdown context. But most docs sites render dynamically. They hide code samples behind tabs (Python vs TypeScript vs cURL). They dump navigation, tracking scripts, and marketing widgets into the DOM.

Page2AI grabs the actual content. It captures hidden tabs. It outputs Markdown with a YAML frontmatter that includes OpenGraph, Twitter Card, and JSON-LD metadata. Useful for anyone building RAG pipelines, AI workflows, or knowledge bases.

## Install

Works in Chrome, Firefox, Edge, Brave, Arc, Vivaldi, and other Chromium browsers.

### Chrome Web Store (recommended)

**[Page2AI on the Chrome Web Store](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)** —
approved and live since **2026-07-30** (submitted 2026-07-21, a 9-day review). One click, and the
browser keeps it updated.

While the listing was in review, this README refused to advertise it and published an anonymous
check instead. The check stays, because a README should stay verifiable either way:

```bash
./scripts/is-published.sh
# or, without cloning:
curl -s 'https://clients2.google.com/service/update2/crx?prodversion=140.0&acceptformat=crx2,crx3&x=id%3Ddlpaaijcnbbmlfeohlphjpnbbcnomnno%26uc'
```

`status="ok"` plus a version means it is live. `error-unknownApplication` means it is not.

### Firefox Add-ons

**[Page2AI on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/page2ai-webpage-to-markdown/)** —
approved and public since **2026-07-31** (v1.3.0). Works in Firefox, Firefox Developer Edition, and Firefox Nightly.

### Install from a release

Every tagged version ships a signed-by-CI zip on the
[releases page](https://github.com/igorsaevets/page2ai-extension/releases). Download it, unzip it,
then `chrome://extensions` -> Developer mode -> Load unpacked -> select the unzipped folder.

### Build from source

```powershell
git clone https://github.com/igorsaevets/page2ai-extension.git
cd page2ai-extension
npm install
npm run build

# chrome://extensions -> Developer mode -> Load unpacked -> select .output\chrome-mv3\
```

## Usage

1. Open any webpage. Documentation, blog post, research paper, product page.
2. Hit `Alt+Shift+M` or click the toolbar icon.
3. Click **Extract**, or leave the profile on **Auto** (recommended).
4. Markdown lands in your clipboard. Paste it into Claude, ChatGPT, Cursor, or your RAG pipeline.

Progress log runs live in the popup. If you close the popup mid-extraction, the badge shows a checkmark when the result is ready. Reopen it to recover.

## For AI Agents (MCP Server)

The same extraction engine is available as an [MCP server](https://modelcontextprotocol.io) for AI coding assistants. Your agent reads any webpage as clean Markdown — the same output the extension produces, called programmatically.

**Hosted (zero install):**

```
https://page2ai-mcp-remote.vercel.app/api/mcp
```

Point Claude Code, Cursor, Windsurf, Cline, or any MCP-compatible client at this URL. Nothing to install.

**Local:**

```bash
npm install -g @page2ai/mcp
```

Same engine, your machine, no cloud.

**Core library** for custom pipelines:

```bash
npm install @page2ai/core
```

Source and docs: [page2ai-mcp](https://github.com/igorsaevets/page2ai-mcp) | [page2ai-core](https://github.com/igorsaevets/page2ai-core).

## Compared to other extensions

| Capability | Page2AI | Web2MD | Obsidian Web Clipper | MarkSnip | SingleFile |
|---|:---:|:---:|:---:|:---:|:---:|
| Free & open source | ✅ MIT | ❌ $9/mo Pro | ✅ | ✅ | ✅ |
| Hidden-tab code capture (Python + TS + cURL) | ✅ | ⚠️ Reddit/X only | ❌ | ❌ | N/A |
| Auto site-profile detection | ✅ 5 profiles | ⚠️ per-site rules | ❌ | ❌ | N/A |
| Client-rendered (SPA) pages | ✅ readiness gate | ❌ | ❌ | ❌ | ✅ full-page snapshot |
| MDX / JSX components (Mintlify, Docusaurus, Starlight, Shiki, Nextra) | ✅ | ❌ | ❌ | ❌ | N/A |
| Rich frontmatter (OG, Twitter, JSON-LD, article:*) | ✅ | ❌ | ⚠️ Obsidian-only | ❌ | N/A |
| Table colspan handling | ✅ | ❌ | ❌ | ❌ | N/A |
| Recursive blockquotes (bold, links, nested) | ✅ | ❌ | ⚠️ partial | ❌ | N/A |
| Quality gate + auto-fallback | ✅ | ❌ | ❌ | ❌ | N/A |
| `llms.txt` short-path | ✅ | ❌ | ❌ | ❌ | N/A |
| 100% local, zero telemetry | ✅ | ❌ | ✅ | ✅ | ✅ |
| Minimum permissions (no `<all_urls>`) | ✅ | ❌ | ❌ | ❌ | ❌ |

## Features

**Profile-aware extraction.** Auto-detects the site kind (docs, marketing, research, dashboard, WordPress marketing) and tunes strategy per profile.

**Hidden-tab code capture.** DOM-position-aware capture of tabbed panels (Python vs TypeScript vs cURL) with dedup. You get code from every tab, not just the active one.

**MDX / JSX post-processing.** Turns Mintlify components (`<Note>`, `<CodeGroup>`, `<Tabs>`, `<AccordionGroup>`), Docusaurus admonitions, Starlight cards, and Shiki-highlighted blocks into clean Markdown.

**`llms.txt` discovery.** If the site publishes an official `.md` alongside the page, Page2AI uses that directly. Short path, higher fidelity.

**Client-rendered page support.** Pages that build their content in the browser used to come out as an empty shell, because "the DOM stopped changing" and "the page is ready" are different questions: an empty root with a fetch in flight is perfectly quiescent. Page2AI waits for *content* instead. It samples the primary content root, requires the signal to hold still, and refuses to proceed while an `aria-busy`, `role="progressbar"` or skeleton element is still showing. An already-rendered page pays one measurement and no wait. When the gate does engage, the frontmatter says so.

**Quality gate.** Counts `<pre>` blocks vs a plain-text baseline to catch under-extraction. Falls back to permissive rendering automatically.

**Rich frontmatter YAML.** Every extraction ships with OpenGraph, Twitter Card, JSON-LD Article, `article:published`/`modified`/`author`, and canonical URL. RAG pipelines that read only the frontmatter get the full context.

**Table colspan handling.** Merged header cells expand into proper Markdown table structure.

**Recursive blockquote rendering.** Bold, links, code, nested blockquotes inside `> ...` are preserved.

**Structured-data appendix.** JSON-LD, OpenGraph, Microdata, and framework internal state (Next.js `__NEXT_DATA__`, Nuxt, Remix) get hoisted into a machine-readable appendix.

**PII masking (opt-in).** Emails, phones, and SSN-like patterns can be replaced with placeholders.

**One hotkey.** `Alt+Shift+M` opens the popup. Enter runs extraction.

## Privacy

Page2AI does not send data anywhere.

- No analytics. No telemetry. No crash reports.
- No cloud service. No account. No sign-in.
- Nothing stored beyond your local preferences (`chrome.storage.local`).
- Nothing shared cross-site or cross-tab beyond the tab you clicked.

The extension only reads the page you explicitly acted on (`activeTab` gesture). Full details in [PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab only after you click the toolbar icon or hit `Alt+Shift+M`. Not persistent. Not blanket. |
| `scripting` | Inject the extraction script into that tab. |
| `clipboardWrite` | Copy generated Markdown to your clipboard. |
| `storage` | Store your profile preference locally. |

No `host_permissions`. No `<all_urls>`. No `tabs` API. Chrome will not warn you that this extension can read all your data on all sites, because it cannot.

## Ecosystem

Page2AI runs on and interoperates with open technical standards from the US AI developer ecosystem:

- **Chrome Extensions Manifest V3** (Google). Modern extension model.
- **[WXT framework](https://wxt.dev)** (open source, MIT). Cross-browser WebExtension framework.
- **CommonMark / GitHub Flavored Markdown**. The lingua franca of LLM context windows.
- **JSON-LD** (W3C standard). Surfaced in the frontmatter for schema-aware RAG pipelines.
- **[`llms.txt` proposal](https://llmstxt.org)**. Used as a short-path when the site publishes one.
- **[Model Context Protocol](https://modelcontextprotocol.io)** (Anthropic). AI agent integration via MCP server.
- **Chrome Web Store** (Google). Distribution for Chromium browsers with automated review and updates.
- **Firefox Add-ons** (Mozilla). Distribution for Firefox with automated review.
- **GitHub** (Microsoft). Code hosting, CI/CD, release automation.

Downstream consumers of Page2AI Markdown include US-based AI platforms (Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, xAI Grok) and AI-native developer tools (Cursor, GitHub Copilot, Windsurf, Vercel AI SDK, LangChain, LlamaIndex).

See [docs/USE_CASES.md](docs/USE_CASES.md) for adoption examples and metrics.

## Architecture

```
popup (drives UX)
   -> chrome.runtime.sendMessage
background service worker (thin)
   -> chrome.scripting.executeScript
extractor.js (isolated world, on-demand)
   -> chrome.runtime.sendMessage -> background -> storage.session -> popup
result: markdown + quality report
```

- `lib/core/`: extraction library, 13 modules, ~4,300 lines of strict TypeScript. Ported from a DevTools console script (Rev-032v2) after 32 revisions of field iteration.
- `entrypoints/background.ts`: thin service worker. Injects the extractor, caches result to `storage.session` keyed by tab id.
- `entrypoints/extractor.ts`: unlisted script. Runs in the tab's isolated world. Sends progress and result via `runtime.sendMessage`.
- `entrypoints/popup/`: vanilla TypeScript + CSS, no framework. Profile selector, progress log with 300-entry ring buffer, auto-clipboard, download, cached-result recovery.

Built with [WXT](https://wxt.dev), Manifest V3, TypeScript strict.

## Contributing

Bug reports, site profile reports, and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Development:

```powershell
npm run dev          # WXT dev server + HMR
npm run build        # Production build -> .output\chrome-mv3\
npm run compile      # tsc --noEmit type check
npm run icons        # Regenerate PNG icons from SVG sources
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Latest: **v1.3.0** (July 2026). Client-rendered (SPA) page support with an A/B end-to-end suite, plus end-to-end tests in CI.

## Credits

Built by [Igor Saevets](https://github.com/igorsaevets), AI Expert and Entrepreneur.

Prototype: `Sequential AI Markdown Exporter Rev-032v2`. 2,024 lines of DevTools console script, 32 revisions of field iteration. Ported to a proper extension in July 2026.

## License

MIT. See [LICENSE](LICENSE). Copyright © 2026 Igor Saevets.
