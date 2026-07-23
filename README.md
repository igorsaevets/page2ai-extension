<div align="center">

<img src="public/icon/128.png" width="96" height="96" alt="Page2AI">

# Page2AI

**Convert any webpage to clean, LLM-ready Markdown in one click.**

Chrome extension for Claude, ChatGPT, Cursor, Obsidian, and RAG pipelines. 100% local. Open source. MIT.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dlpaaijcnbbmlfeohlphjpnbbcnomnno?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)
[![Users](https://img.shields.io/chrome-web-store/users/dlpaaijcnbbmlfeohlphjpnbbcnomnno?logo=googlechrome&logoColor=white&label=Users)](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)
[![License MIT](https://img.shields.io/badge/License-MIT-4f46e5.svg)](LICENSE)
[![Build](https://github.com/igorsaevets/page2ai-extension/actions/workflows/build.yml/badge.svg)](https://github.com/igorsaevets/page2ai-extension/actions/workflows/build.yml)
[![GitHub stars](https://img.shields.io/github/stars/igorsaevets/page2ai-extension?style=social)](https://github.com/igorsaevets/page2ai-extension/stargazers)

<br>

<a href="https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno">
  <img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/HRs9MPufa1J1h5glNhut.png" height="60" alt="Install from Chrome Web Store">
</a>

<br><br>

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

### Chrome Web Store

[**Install Page2AI**](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno). One click, then hit `Alt+Shift+M` on any page.

Works in Chrome, Edge, Brave, Arc, Vivaldi, and other Chromium browsers.

### Load unpacked (developers)

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

## Compared to other extensions

| Capability | Page2AI | Web2MD | Obsidian Web Clipper | MarkSnip | SingleFile |
|---|:---:|:---:|:---:|:---:|:---:|
| Free & open source | ✅ MIT | ❌ $9/mo Pro | ✅ | ✅ | ✅ |
| Hidden-tab code capture (Python + TS + cURL) | ✅ | ⚠️ Reddit/X only | ❌ | ❌ | N/A |
| Auto site-profile detection | ✅ 5 profiles | ⚠️ per-site rules | ❌ | ❌ | N/A |
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
- **Chrome Web Store** (Google). Distribution channel with automated review and updates.
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

See [CHANGELOG.md](CHANGELOG.md). Latest: **v1.2.0** (July 2026). Table colspan support, recursive blockquotes, extraction performance work.

## Credits

Built by [Igor Saevets](https://github.com/igorsaevets), AI Expert and Entrepreneur.

Prototype: `Sequential AI Markdown Exporter Rev-032v2`. 2,024 lines of DevTools console script, 32 revisions of field iteration. Ported to a proper extension in July 2026.

## License

MIT. See [LICENSE](LICENSE). Copyright © 2026 Igor Saevets.
