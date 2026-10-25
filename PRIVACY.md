# Privacy Policy: Page2AI

**Effective date:** 2026-07-20
**Last updated:** 2026-10-25 (version 1.6.0: the optional Agent Bridge)

## Summary

Page2AI does not collect, sell, or share any personal data. It converts the page in your browser. There is no server operated by the publisher, no analytics, no telemetry, no crash reporting, no third-party SDK. Up to version 1.4.0 it also asked the site you were reading for a Markdown copy of the page; version 1.5.0, released 2026-10-17, makes no network request of its own. Version 1.6.0 adds one opt-in exception you control: the Agent Bridge, off by default, connects to a Page2AI MCP server process running on your own machine and, only while you leave it on, sends that process the Markdown of pages it asks for. Nothing is ever sent to the publisher. See [Network requests](#network-requests) and [The Agent Bridge (1.6.0, opt-in)](#the-agent-bridge-160-opt-in).

If you don't want to trust the summary, the rest of this document walks through what Page2AI does with what you touch, permission by permission, feature by feature.

## Who this policy applies to

This policy covers the Page2AI browser extension published on the Chrome Web Store and on Firefox Add-ons (addons.mozilla.org). The publisher is **Igor Saevets** (`support@igorsaevets.com`), an independent open-source developer.

The source code that implements this policy is public and MIT-licensed at [github.com/igorsaevets/page2ai-extension](https://github.com/igorsaevets/page2ai-extension). Anything you read here can be verified against that source.

## What data Page2AI accesses

Page2AI reads the content of the single web page you explicitly acted on. That is the page that was in the active tab at the moment you clicked the Page2AI toolbar icon or pressed the `Alt+Shift+M` keyboard shortcut.

That access is scoped by the browser's `activeTab` permission, which is a one-shot, gesture-gated grant. Page2AI cannot read pages you didn't act on. It cannot read pages in other tabs. It cannot read pages you visit later without a new gesture.

Specifically, Page2AI reads:

- The rendered HTML of the current page (`document.documentElement.outerHTML`).
- Text content, headings, links, tables, code blocks, images (as URLs, not bytes).
- Optional metadata: JSON-LD, OpenGraph, Microdata, Twitter cards, page state such as Next.js `__NEXT_DATA__` when present.
- Optional: content of tabbed panels on the page (the extension may click hidden tabs to capture them), and dropdown/details panels that are collapsed. These clicks are simulated inside the page's own DOM. They do not create requests to remote servers other than what the page itself would have loaded.

Page2AI converts this content into Markdown text on your machine and:

- Copies it to your system clipboard (via the `clipboardWrite` permission).
- Optionally lets you save it as a `.md` file via a standard browser download.

No content is transmitted to any server operated by Page2AI, the publisher, or any third party.

## The Agent Bridge (1.6.0, opt-in)

The popup has an **Agent Bridge** switch, off by default. It exists so that an AI agent running on your own machine (through the Page2AI MCP server, `@page2ai/mcp` 0.6.0 or later) can ask your browser for a page it cannot read itself: a page behind your sign-in, or one that only JavaScript in a real browser can render.

While the switch is on:

- Page2AI keeps a WebSocket connection to `ws://127.0.0.1:3025` — an address on your own machine, reachable only from your own machine. An alarm retries the connection every 30 seconds while the switch is on, so a server you start later is found without reopening the browser.
- The server can ask Page2AI to open a web address in a background tab. Page2AI opens it in your browser, with your cookies and the page's own scripts, exactly as your browser shows it, runs the same extractor the popup runs, and sends the resulting Markdown back over that local connection to the server process. That process belongs to the MCP client you configured (for example Claude Desktop, Claude Code or Cursor); what it does with the Markdown — normally, passing it to the AI model you are talking to — is governed by that client's and that model's terms, not by this policy.
- The extension applies the output choices the agent asked for (`include_images`, `include_frontmatter`); it does not substitute the popup's own settings.
- Page2AI refuses some addresses before opening them: anything that is not `http:` or `https:`, the sign-in pages of Google, Microsoft, Apple and AWS, and addresses written as loopback, private, link-local or other non-public IP literals (or a `localhost` name). After a tab loads, the page it actually landed on is checked again with the same rules before the extractor runs, and the result is checked once more when it arrives. A public page can still redirect your browser to an address on your own network before that second check runs; in that case the browser has loaded the page, but its content is not extracted and is not returned to the server.
- A result with no page text of its own, or one produced after the extractor crashed, is answered with an error, not sent as if it were the page.
- Background tabs opened for the agent stay the agent's: extracting one from the popup is refused, and a bridge result is never shown in the popup or copied to your clipboard.
- The connection is paired with a key. The first time you turn the switch on, Page2AI makes a random key, shows it in the popup (*Show*, *Copy key*, *New key*) and stores it on this device only. You paste it into the MCP server's `PAGE2AI_BRIDGE_KEY` setting. On every connection both sides prove they know the key before any page is opened; the key itself never crosses the connection. A program that is not your server gets nothing. *New key* replaces the key; servers holding the old one stop connecting.

Turning the switch off disconnects at once and gives back the site access described under [Permissions](#permissions-walkthrough). Page2AI sends nothing to the publisher, ever: the bridge's only peer is a process on your own machine, at an address only your own machine can reach.

## Network requests

**Since version 1.5.0, released 2026-10-17, Page2AI makes no network request of its own, and 1.6.0 keeps that rule with one opt-in exception.** It reads only the page in your tab, and no longer asks
the site for an `llms.txt` index or a Markdown copy of the page, because such a copy can be older than the page or
differ from it. It copies parts of the page into a separate document in which the browser loads nothing. The agent
script built from the same code makes none either. Its build fails if the bundle uses a browser network API or
anything else that makes the browser load an address ([`scripts/build-agent.mjs`](scripts/build-agent.mjs)), and an
end-to-end test in Chrome fails if the extension or the agent script requests anything but the page
([`.e2e/e2e-agent.mjs`](.e2e/e2e-agent.mjs)).

**Versions up to 1.4.0 asked the site you were reading for a Markdown copy of the page** each time you invoked
the extension:

- They requested `/llms.txt`, `/docs/llms.txt` and `/llms-full.txt` from that site, with your cookies for it, as
  following a link on it would. No setting turned these three requests off.
- With the Docs or Research profile they also requested the page's address with `.md` and with `/index.md` added,
  on that site, whether or not such a file existed, and any `.md` address for the page that the page's
  `<link rel="alternate">` or the site's `llms.txt` named, if it was on that site or on one of ten documentation hosts
  (`developers.openai.com`, `platform.openai.com`, `platform.claude.com`, `docs.anthropic.com`, `code.claude.com`, `docs.github.com`, `docs.vercel.com`, `supabase.com`, `docs.stripe.com`, `langchain-ai.github.io`). They stopped at the first one that answered with Markdown. Auto-detect, the popup's default, picked Docs
  when the page looked like documentation; the Marketing, WordPress and Dashboard profiles made none of these `.md`
  requests. Requests to the site carried your cookies for it. Requests to one of the ten hosts carried none, but,
  like any request a page makes, they showed that host your IP address and, under the browser's default referrer
  policy, the site you were on.
- When they copied a part of the page to read its text (a tab's label, or the text around a group of tabs), the
  browser could load images, video or audio in that part that the page had not loaded yet, from wherever the page
  loads them.

None of these requests went to the author of Page2AI or to an analytics or other service.

The one exception is the Agent Bridge in 1.6.0, and only while you leave its switch on. Page2AI then holds a WebSocket connection to `ws://127.0.0.1:3025` on your own machine and retries it every 30 seconds by alarm. The background tabs it opens for the local server load their pages from those pages' own servers, with your cookies, as any tab you open yourself does. Page2AI fetches nothing else, from anywhere, in any version since 1.5.0.

To capture content the page shows only on demand, the extension scrolls the page and opens its tabs and collapsed
sections, as you would. The page may then load more of its own content, from wherever it loads it, exactly as when
you scroll or click it yourself. Those requests come from the page, not from Page2AI.

## What data Page2AI stores

Page2AI uses the browser's `chrome.storage.local` API to remember your extension preferences between sessions:

- Which profile you last selected (`auto`, `docs`, `marketing`, etc.).
- Small UI preferences (for example, whether the log panel is expanded).

Page2AI also uses `chrome.storage.session` (cleared automatically when Chrome is closed) to cache the most recent extraction result for the current tab. If you close the popup while extraction is running, reopening it restores the result instead of forcing you to re-run. Results produced for the Agent Bridge are not cached there; they go straight to the local server.

Since 1.6.0, `chrome.storage.local` also holds the Agent Bridge switch (on or off) and its pairing key: a random value Page2AI makes on this device, shown in the popup so you can paste it into your MCP server. It is stored only in this browser profile, is never synced, and a new key replaces it from the popup at any time.

Neither of these storage areas ever leaves your browser. They are readable only by the Page2AI extension itself, on your device, and they are wiped when you uninstall the extension.

## What data Page2AI does NOT do

- **No analytics.** No Google Analytics, Mixpanel, Amplitude, PostHog, Sentry, or any other analytics SDK.
- **No telemetry.** No crash reports, no usage counters, no ping-home, no "check for updates" call to any server other than the browser's own extension update mechanism.
- **No accounts.** There is no sign-up, sign-in, or user identifier of any kind.
- **No advertising.** No ads. No ad targeting. No sale of data (because there is no data to sell).
- **No cross-site tracking.** Page2AI cannot correlate visits across sites, because it doesn't run on any page you didn't explicitly act on.
- **No remote code.** All JavaScript that runs in your browser ships inside the extension bundle you installed from the Chrome Web Store. Page2AI does not fetch or `eval` remote code.
- **No publisher server.** There is no server run by the publisher for the extension to talk to. The domain in the extension listing points to the source code repository on GitHub, not to a service. The Agent Bridge (1.6.0, opt-in) talks only to a process on your own machine.

## Permissions: walkthrough

Page2AI requests only these Chrome extension permissions:

### `activeTab`

**What Chrome grants:** Access to the tab you are currently looking at, and only from the moment you activate the extension (click toolbar icon, press hotkey) until you navigate away or close the tab.

**Why Page2AI needs it:** To read the page content that you asked to convert.

**What Page2AI does with it:** Runs the extraction script inside that one tab, on-demand.

**What Page2AI does NOT do with it:** Access other tabs, keep the access around, use it after you close the popup.

### `scripting`

**What Chrome grants:** The ability to programmatically inject scripts into a tab (subject to the tab-access rules above).

**Why Page2AI needs it:** To place the extraction script into the tab you activated. Without it, the extension would need `content_scripts` in the manifest, which would inject on every page you visit. That is a much broader access model.

**What Page2AI does with it:** Injects `/extractor.js` into the current tab, one time, on your action.

### `clipboardWrite`

**What Chrome grants:** The ability to write text to your system clipboard from the extension popup without an extra confirmation.

**Why Page2AI needs it:** So the Markdown result lands in your clipboard automatically when extraction finishes, which is the whole reason you clicked the extension.

**What Page2AI does with it:** Writes the generated Markdown once, at the end of extraction.

**What Page2AI does NOT do with it:** Read your clipboard. There is no `clipboardRead` permission requested.

### `storage`

**What Chrome grants:** Access to the extension's own storage areas (`storage.local`, `storage.session`, `storage.sync`).

**Why Page2AI needs it:** To remember your profile preference between sessions (`storage.local`) and to cache the current tab's extraction result while Chrome is open (`storage.session`). Page2AI does not use `storage.sync`.

### `alarms` (since 1.6.0)

**What Chrome grants:** A timer that can wake the extension's service worker even after the browser has put it to sleep. Chrome shows no install warning for this permission.

**Why Page2AI needs it:** While the Agent Bridge switch is on, retrying the connection to the local MCP server every 30 seconds. A plain timer dies with the sleeping service worker, so a server started after the browser would never be reached. The alarm is created only while the switch is on and cleared when you turn it off.

**What Page2AI does NOT do with it:** Anything else. It carries no data and contacts nobody; it only wakes the extension to retry a connection to your own machine.

### Optional site access (since 1.6.0, only on your action)

**What Chrome grants:** Access to pages on `http://*/*` and `https://*/*` — but only after you grant it, and only for as long as it stays granted. The extension ships with **no** `host_permissions` of its own: at install, and after every update, it cannot read any site until you act.

**Why Page2AI needs it:** Only for the Agent Bridge. `activeTab` covers the one tab you invoked Page2AI on; it cannot cover a background tab the bridge opens for your local server. Turning the Agent Bridge switch on asks Chrome for this access; turning the switch off gives it back (`permissions.remove`). Because the access is optional rather than required, an update that adds it does not disable the extension for existing users.

**What Page2AI does with it:** Injects the extractor into background tabs the bridge opens, and nowhere else. Your own popup extractions keep working through `activeTab` whether or not you ever grant this.

## Third parties

Page2AI does not use any third-party service, SDK, or dependency at runtime. The extension is compiled from open-source code and bundles everything it needs.

The extension is built with these open-source tools (which run only on the developer's machine at build time, not in your browser):

- [WXT](https://wxt.dev): WebExtension framework (MIT).
- [TypeScript](https://www.typescriptlang.org/): language and compiler (Apache-2.0).
- [Vite](https://vitejs.dev/): bundler used by WXT (MIT).

None of these tools embed any tracking or phone-home code in the shipped extension.

## Children

Page2AI does not knowingly collect any information from anyone, of any age. There is nothing to collect.

## Changes to this policy

If this policy changes materially (for example, if a future version of Page2AI introduces optional cloud sync), the change will be announced in [CHANGELOG.md](CHANGELOG.md), reflected in the CWS listing, and posted at the top of this document with a new **Effective date**. Prior versions remain accessible in the git history of this repository.

## Contact

- **Issues, questions, bug reports:** [github.com/igorsaevets/page2ai-extension/issues](https://github.com/igorsaevets/page2ai-extension/issues)
- **Email:** [support@igorsaevets.com](mailto:support@igorsaevets.com)

## Google Limited Use compliance statement

Page2AI's use and transfer of information received from Google APIs (via Chrome Web Store publishing) will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Page2AI collects no user data. The only transfer it can make is the one you switch on yourself: with the Agent Bridge on, the Markdown of a page your own local MCP server asked for is sent to that process on your own machine, for the single purpose of giving it to the agent you are talking to. It is never sent to the publisher or to any third party, and never used for any other purpose.
