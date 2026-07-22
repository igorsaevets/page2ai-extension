# Privacy Policy — Page2AI

**Effective date:** 2026-07-20
**Last updated:** 2026-07-20

## Summary

**Page2AI does not collect, transmit, sell, or share any personal data.** Everything the extension does happens locally in your browser. There is no server component, no analytics, no telemetry, no crash reporting, and no third-party SDK.

If you never trust the summary above, the rest of this document explains — permission by permission, feature by feature — exactly what Page2AI does with what you touch and why.

## Who this policy applies to

This policy covers the Page2AI browser extension published on the Chrome Web Store (and, in the future, Firefox Add-ons and Microsoft Edge Add-ons). The publisher is **Igor Saevets** (`igorsaevets@gmail.com`), an independent open-source developer.

The source code that implements this policy is public and MIT-licensed at [github.com/igorsaevets/page2ai-extension](https://github.com/igorsaevets/page2ai-extension). Anything you read here can be verified against that source.

## What data Page2AI accesses

Page2AI reads the **content of the single web page you explicitly acted on** — the page that was in the active tab at the moment you clicked the Page2AI toolbar icon or pressed the `Alt+Shift+M` keyboard shortcut.

That access is scoped by the browser's `activeTab` permission — a one-shot, gesture-gated grant. Page2AI **cannot** read pages you didn't act on. It **cannot** read pages in other tabs. It **cannot** read pages you visit later without a new gesture.

Specifically, Page2AI reads:

- The rendered HTML of the current page (`document.documentElement.outerHTML`).
- Text content, headings, links, tables, code blocks, images (as URLs, not bytes).
- Optional metadata: JSON-LD, OpenGraph, Microdata, Twitter cards, page state such as Next.js `__NEXT_DATA__` when present.
- Optional: content of tabbed panels on the page (the extension may click hidden tabs to capture them), and dropdown/details panels that are collapsed. These clicks are simulated inside the page's own DOM; they do not create requests to remote servers other than what the page itself would have loaded.

Page2AI converts this content into Markdown text on your machine and:

- Copies it to your system clipboard (via the `clipboardWrite` permission).
- Optionally lets you save it as a `.md` file via a standard browser download.

**No content is transmitted to any server operated by Page2AI, the publisher, or any third party.**

## What data Page2AI stores

Page2AI uses the browser's `chrome.storage.local` API to remember your extension preferences between sessions:

- Which profile you last selected (`auto`, `docs`, `marketing`, etc.).
- Small UI preferences (e.g. whether the log panel is expanded).

Page2AI also uses `chrome.storage.session` (cleared automatically when Chrome is closed) to cache the most recent extraction result for the current tab, so that if you close the popup while extraction is running, reopening it restores the result instead of forcing you to re-run.

**Neither of these storage areas ever leaves your browser.** They are readable only by the Page2AI extension itself, on your device, and they are wiped when you uninstall the extension.

## What data Page2AI does NOT do

- **No analytics.** No Google Analytics, Mixpanel, Amplitude, PostHog, Sentry, or any other analytics SDK.
- **No telemetry.** No crash reports, no usage counters, no ping-home, no "check for updates" call to any server other than the browser's own extension update mechanism.
- **No accounts.** There is no sign-up, sign-in, or user identifier of any kind.
- **No advertising.** No ads. No ad targeting. No sale of data (because there is no data to sell).
- **No cross-site tracking.** Page2AI cannot correlate visits across sites — it doesn't run on any page you didn't explicitly act on.
- **No remote code.** All JavaScript that runs in your browser ships inside the extension bundle you installed from the Chrome Web Store. Page2AI does not fetch or `eval` remote code.
- **No cloud service.** There is no Page2AI server. The domain in the extension listing points to the source code repository on GitHub, not to a service.

## Permissions — a permission-by-permission walkthrough

Page2AI requests only these Chrome extension permissions:

### `activeTab`

**What Chrome grants:** Access to the tab you are currently looking at, and only from the moment you activate the extension (click toolbar icon, press hotkey) until you navigate away or close the tab.

**Why Page2AI needs it:** To read the page content that you asked to convert.

**What Page2AI does with it:** Runs the extraction script inside that one tab, on-demand.

**What Page2AI does NOT do with it:** Access other tabs, keep the access around, use it after you close the popup.

### `scripting`

**What Chrome grants:** The ability to programmatically inject scripts into a tab (subject to the tab-access rules above).

**Why Page2AI needs it:** To place the extraction script into the tab you activated. Without it, the extension would need `content_scripts` in the manifest, which would inject on every page you visit — a much broader access model.

**What Page2AI does with it:** Injects `/extractor.js` into the current tab, one time, on your action.

### `clipboardWrite`

**What Chrome grants:** The ability to write text to your system clipboard from the extension popup without an extra confirmation.

**Why Page2AI needs it:** So the Markdown result lands in your clipboard automatically when extraction finishes — the whole reason you clicked the extension.

**What Page2AI does with it:** Writes the generated Markdown once, at the end of extraction.

**What Page2AI does NOT do with it:** Read your clipboard. There is no `clipboardRead` permission requested.

### `storage`

**What Chrome grants:** Access to the extension's own storage areas (`storage.local`, `storage.session`, `storage.sync`).

**Why Page2AI needs it:** To remember your profile preference between sessions (`storage.local`) and to cache the current tab's extraction result while Chrome is open (`storage.session`). Page2AI does not use `storage.sync`.

## Third parties

Page2AI does not use any third-party service, SDK, or dependency at runtime. The extension is compiled from open-source code and bundles everything it needs.

The extension is built with these open-source tools (which run only on the developer's machine at build time, not in your browser):

- [WXT](https://wxt.dev) — WebExtension framework (MIT).
- [TypeScript](https://www.typescriptlang.org/) — language and compiler (Apache-2.0).
- [Vite](https://vitejs.dev/) — bundler used by WXT (MIT).

None of these tools embed any tracking or phone-home code in the shipped extension.

## Children

Page2AI does not knowingly collect any information from anyone, of any age. There is nothing to collect.

## Changes to this policy

If this policy changes materially (for example, if a future version of Page2AI introduces optional cloud sync), the change will be announced in [CHANGELOG.md](CHANGELOG.md), reflected in the CWS listing, and posted at the top of this document with a new **Effective date**. Prior versions remain accessible in the git history of this repository.

## Contact

- **Issues, questions, bug reports:** [github.com/igorsaevets/page2ai-extension/issues](https://github.com/igorsaevets/page2ai-extension/issues)
- **Email:** [igorsaevets@gmail.com](mailto:igorsaevets@gmail.com)

## Google Limited Use compliance statement

Page2AI's use and transfer of information received from Google APIs (via Chrome Web Store publishing) will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Because Page2AI collects no user data, it does not use or transfer any user data to any purpose covered by that policy.
