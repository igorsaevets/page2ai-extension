# CHROMEWEBSTORE.md: Page2AI on the Chrome Web Store

> Last Updated: 2026-10-25 (1.6.0 listing texts prepared; not yet submitted — the stores serve 1.5.1). The store record for item `dlpaaijcnbbmlfeohlphjpnbbcnomnno`: what the
> Developer Dashboard holds, field by field, and why each permission is requested.
> Title and Summary were read from the public listing on 2026-10-17 (version 1.4.0, updated October 16,
> 2026); the Detailed description is the dashboard field as saved on 2026-10-18 (T140). Until 2026-10-17 this file was `assets/store/listing.md`, the v1.0
> submission draft, and its three text fields still held the v1.0 wording (now in section 8).
> The file name is the one the Chrome team's `chrome-extensions` agent skill
> (GoogleChrome/modern-web-guidance) keeps current whenever the extension changes.

---

## 1. Store listing tab

### Title (from the package)
```
Page2AI — Webpage to Markdown
```
_29 characters. It is `name` in `wxt.config.ts`, so the store takes it from the uploaded package and it
changes only with a new version. The v1.0 draft title is in section 8._

### Summary (from the package)
```
Convert any webpage to clean, AI-ready Markdown. 100% local, open source.
```
_73 characters (limit 132). It is `description` in `wxt.config.ts`: a dashboard edit cannot reach it,
only a new version can (learned in September 2026)._

### Category
```
Workflow & Planning
```
_Best fit. Official examples include "document editors" and "tools to help users perform tasks more efficiently" ([source](https://developer.chrome.com/docs/webstore/best-practices#choose-category-well))._

### Language
```
English (Worldwide)
```

### Detailed description (1.6.0 text, prepared 2026-10-25; the dashboard still holds the 1.5.0 text below it in git history — paste this with the 1.6.0 package)
````
Page2AI turns any webpage into a clean, AI-ready Markdown document with one click — ready to paste into your LLM, coding agent, or RAG pipeline.

Everything runs inside your browser. No publisher servers, no accounts, no telemetry, no cloud. The one opt-in exception is the Agent Bridge below: it talks only to a process on your own machine.

WHAT MAKES IT DIFFERENT

• Profile-aware extraction — auto-detects the site kind (docs, marketing, research, dashboard) and tunes the strategy per profile. Manual override in one click.
• Tab & dropdown capture — pulls code from hidden tabs (Python vs TypeScript vs cURL vs …) with DOM-position-aware dedup, so you get the code from every tab, not just the active one.
• Code blocks with language hints — ```python, ```js, ```bash preserved verbatim so LLMs read them correctly.
• Only the page you see — Page2AI converts the page in your tab and nothing else. It never swaps in the site's llms.txt or a Markdown copy, which can be older than the page.
• Quality gate — post-extraction check on <pre> count vs a plain-text baseline; automatic fallback if under-extraction is detected.
• Structured-data appendix — JSON-LD, OpenGraph, Microdata, Next.js __NEXT_DATA__ hoisted into a machine-readable appendix at the end.
• Cached-result recovery — close the popup mid-run, reopen it, your result is waiting (badge shows ✓).
• Dark mode, live progress log, and masking inside the framework-state appendix (opt-in): email addresses, phone numbers, tokens and API keys found in a page's embedded app state are replaced with placeholders before that appendix is written. The page's visible text is not rewritten.
• Agent Bridge (opt-in, off by default) — let an AI agent on your own machine read pages through your browser: pages behind your sign-in, or pages only JavaScript can render. Details under FOR AI AGENTS.

HANDLES JAVASCRIPT-HEAVY SITES

Modern web apps often defeat plain-text readers with client-side rendering, hidden tab content, or code shown one language at a time. The profile system detects the page kind and applies rules that surface content plain readers miss.

FOR WHOM

• Researchers feeding docs to their AI assistant.
• Developers preparing README-ready snippets from API docs.
• Writers clipping web articles into their notes app.
• Anyone who used MarkDownload-style clipping — this is a modern replacement.

PRIVACY

Page2AI does not send data to the publisher or to any third party. No analytics, no telemetry, no crash reports, no accounts, no remote code. By itself the extension only reads the page you explicitly click on (via activeTab), converts it to Markdown on your device, and copies it to your clipboard. The Agent Bridge is the one opt-in exception: turn its switch on and Page2AI connects to a Page2AI MCP server process on your own machine (an address only your own machine can reach) and sends it the Markdown of pages it opens in background tabs, so your AI agent can read pages behind your sign-in. Turn the switch off and that stops, and the site access it needed is given back. Your preferences, the bridge switch and its pairing key (chrome.storage.local), and the current tab's result (chrome.storage.session, cleared when you close the browser) stay in chrome.storage on your device. Full text: PRIVACY.md in the source repository.

MINIMUM PERMISSIONS

• activeTab — read only the page you clicked on.
• scripting — inject the reader script into that page.
• clipboardWrite — copy the result to your clipboard.
• storage — remember your profile preference between sessions, keep the current tab's result until you close the browser, and hold the Agent Bridge switch and its key.
• alarms — only while the Agent Bridge switch is on: retry its connection to your own machine every 30 seconds. Chrome shows no install warning for it.

No <all_urls> at install. No host_permissions in the package: Page2AI cannot read any site until you act. Site access for http and https pages is asked for only when you turn the Agent Bridge on, and removed when you turn it off. Without it, an update never disables the extension.

ALSO AVAILABLE ON FIREFOX

addons.mozilla.org/en-US/firefox/addon/page2ai-webpage-to-markdown/

FOR AI AGENTS (MCP)

Optional MCP server lets AI agents call Page2AI directly through the Model Context Protocol: npx -y page2ai-mcp — source at github.com/igorsaevets/page2ai-mcp. With this extension's Agent Bridge switch on and its pairing key pasted into the server, the agent can also read pages through your browser (signed-in and JavaScript-rendered pages); without it, the server fetches public pages itself.

OPEN SOURCE

MIT-licensed. Full source at github.com/igorsaevets/page2ai-extension. Verify every claim in this listing against the code.

HOTKEY

Alt+Shift+M opens the popup; Enter runs the extraction.

BUILT BY

Igor Saevets, AI Expert and Entrepreneur.
````
_4,816 characters (limit 16,000), counted 2026-10-25. Plain text: the store does not render Markdown. This is the 1.6.0 text, prepared ahead of the package and not yet in the dashboard; the dashboard still holds the 1.5.0 text (3,125 characters) saved and submitted for review on 2026-10-18 at 01:46 UTC (T140), public since the review passed the same day (section 7). The rest is the wording of the 2026-09-07 resubmission, after the keyword-spam rejection in section 8._

---


### Detailed description: the change for 1.5.0 (applied 2026-10-18)

Since 1.5.0 the extension takes the content only from the page (BL-49, Igor 2026-10-17), so two bullets of the
2026-09-07 text were false for it. T140 changed the saved dashboard field in place: it deleted the bullet that
began `• MDX / JSX post-processing` (that clean-up ran only on the Markdown copies the extension no longer reads)
and replaced the bullet that began `• llms.txt short path` with `• Only the page you see`. The SHA-256 of the field
before and after each step matched the public text and the text above. Screenshots 1-3 were replaced in the same
session (section 2): the old ones showed the label v1.3.0, and 2 and 3 the popup's `official-md` status line.

The PRIVACY paragraph of the description is true of 1.5.0. It was not complete for 1.4.0, which asked the site
for `llms.txt` and a Markdown copy of the page (PRIVACY.md, Network requests), so do not quote it as a
description of 1.4.0 (T136 panel, grokbuild).

### Detailed description: the change for 1.6.0 (prepared 2026-10-25, to apply with the 1.6.0 package)

1.6.0 adds the Agent Bridge (opt-in): background tabs, optional site access and the `alarms` permission. The 1.5.0 PRIVACY paragraph ("only reads the page you explicitly click on", four permissions, "No host_permissions … because it cannot") would be false for the 1.6.0 package, so the description at the top of this section is rewritten for 1.6.0: a bridge bullet, a rewritten PRIVACY paragraph, five install-time permissions plus the optional grant, and `npx -y page2ai-mcp` in FOR AI AGENTS (was `npm i @page2ai/mcp`). PRIVACY.md carries the matching full text ("The Agent Bridge (1.6.0, opt-in)").

**Reviewer note for 1.6.0 (paste into the review notes field):** New in 1.6.0: the opt-in Agent Bridge. Off by default. When the user turns its switch on, the extension connects to a Page2AI MCP server process on the user's own machine (ws://127.0.0.1:3025, loopback only), paired by a random key both sides prove they know before any page opens (the key never crosses the connection). It then opens pages the local server names in background tabs and returns their Markdown over that local connection. That is why it requests optional site access (http/https) at switch-on and removes it at switch-off; the package itself declares no host_permissions, so an update does not disable the extension. The `alarms` permission only retries that local connection every 30 seconds while the switch is on. Non-web schemes, sign-in providers' pages and non-public IP literals are refused before opening and again on the landed page. To test: install the MCP server (`npx -y page2ai-mcp`), turn Agent Bridge on, paste the popup's key into the server's PAGE2AI_BRIDGE_KEY, restart the MCP client, and ask the agent for a signed-in page; PRIVACY.md, "The Agent Bridge", describes the whole flow.

## 2. Graphic assets

### Store icon
```
File: assets/store/icon-128.png
Size: 128x128 PNG
Artwork: 96x96 centered, 16px transparent padding per side
Background: #4f46e5 (indigo-600) with 22% rounded corners (Chrome may render additional UI chrome)
```

### Small promotional tile (REQUIRED)
```
File: assets/store/promo-small-440x280.png
Size: 440x280 PNG
Content: brand mark + tagline "Any webpage -> clean, AI-ready Markdown"
```

### Screenshots (1 to 5, at least 1 REQUIRED)
```
Files: assets/store/screenshot-{1..N}-1280x800.png
Size: 1280x800 (or 640x400), JPEG or 24-bit PNG with no alpha channel (the dashboard's rule)
In the dashboard since 2026-10-18: screenshot-1-uscis-eb1, -2-openwebui-tools, -3-xai-grok-45, in that order
Orientation: landscape only (portrait not supported by CWS)
Content: real Page2AI popup + real extraction result on real docs pages
```
_`scripts/gen-screenshots-real.mjs` captures them from the built extension and takes the popup's version label
from its manifest. Since T140 it writes RGB: until then its PNGs carried an alpha channel (opaque everywhere),
which the dashboard's rule excludes. The dashboard serves the files in `assets/store` byte for byte._

### Marquee promo tile (OPTIONAL)
```
Not shipped in v1.0. Only needed for CWS "featured" placement, which we do not need for launch.
```

---

## 3. Privacy practices tab

### Single Purpose statement
```
Page2AI converts a web page into a clean Markdown document. The page is the one in the active browser tab when the user invokes the extension — or, only when the user has turned on the opt-in Agent Bridge switch, a page the user's own local Page2AI MCP server supplies, opened in a background tab. One conversion, two ways to name the page; the Markdown goes to the user's clipboard or to that local process.
```

### Data collection disclosures

For each item in the CWS privacy form, tick **NO / not collected** — except Website content, which is **YES** since 1.6.0 (see its rationale):

- Personally identifiable information: NO
- Health information: NO
- Financial and payment information: NO
- Authentication information: NO
- Personal communications: NO
- Location: NO
- Web history: NO
- User activity: NO
- Website content: YES (the page text the user asked to convert; loopback-only transfer, below)
- Other: NO

_Website content rationale (paste with the YES above): Page2AI reads the page the user asked to convert and turns it into Markdown. By default the Markdown goes to the user's clipboard and nowhere else. With the opt-in Agent Bridge switch on (1.6.0, off by default), the Markdown is instead sent over a loopback connection (`ws://127.0.0.1:3025`) to the Page2AI MCP server process on the user's own machine, which the user paired with a key; that process passes it to the AI agent the user is talking to. The publisher receives nothing, operates no server for the extension, and has no access to page content at any point. Storage is on-device only: the current tab's session cache (`chrome.storage.session`, cleared when Chrome closes), the profile preference, and the bridge switch and pairing key (`chrome.storage.local`). The whole flow is disclosed in PRIVACY.md ("The Agent Bridge"). Every other item stays NO: Page2AI collects nothing else, and what it reads is used for this single purpose only — never sold, never for advertising, creditworthiness or any unrelated purpose. (Changed at the T188 panel: three reviewer models and the User Data FAQ's local-processing disclosure both say a page-reading extension declares Website content even when processing stays on the device; versions up to 1.5.1 shipped with NO, 1.6.0 declares YES rather than argue the definition.)_

### Certifications (all THREE must be checked)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
```
https://github.com/igorsaevets/page2ai-extension/blob/main/PRIVACY.md
```
_Required even for local-only extensions per CWS User Data FAQ Q14 ([source](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq))._

---

## 4. Permissions justifications

Enter each of the six below into the corresponding "justify" text box on the Privacy practices tab (the last two are new with 1.6.0).

### `activeTab` justification
```
Grants Page2AI access to the currently active tab only when the user explicitly acts on the extension by clicking the toolbar icon or pressing the Alt+Shift+M keyboard shortcut. Required to read the page content the user asked to convert. Not persistent, not blanket, and cannot be used to read any other tab or any tab the user did not act on.
```

### `scripting` justification
```
Required to programmatically inject the extraction script (extractor.js) into the active tab after the user acts on the extension. Using scripting.executeScript with activeTab is the minimal-privilege alternative to declaring content_scripts in the manifest. With content_scripts, the extension would inject on every page the user visits. With scripting + activeTab it injects only on the one tab the user explicitly triggered.
```

### `clipboardWrite` justification
```
Required to copy the generated Markdown result to the user's clipboard automatically at the end of extraction, which is the primary reason the user invoked the extension. Page2AI does not request clipboardRead and never reads the user's clipboard contents.
```

### `storage` justification
```
Used exclusively to persist the user's own extension preferences locally on their device: (1) chrome.storage.local remembers the last-selected extraction profile (auto, docs, marketing, research, dashboard, wordpress-marketing) between sessions; (2) chrome.storage.session caches the most-recent extraction result per tab so that closing the popup mid-extraction and reopening it restores the finished result; (3) since 1.6.0, chrome.storage.local also holds the Agent Bridge on/off switch and the random pairing key the user pastes into their local MCP server. No data is transmitted anywhere by storage itself.
```

### `alarms` justification (new in 1.6.0)
```
Used for one timer only: while the user leaves the Agent Bridge switch on, wake the service worker every 30 seconds to retry the bridge's connection to the Page2AI MCP server on the user's own machine (ws://127.0.0.1:3025). A plain timer dies when Chrome puts the service worker to sleep, so a server started after the browser would never be reached. The alarm is created only while the switch is on, cleared when it is turned off, carries no data, and contacts no one: it only retries a connection to the user's own machine. Chrome shows no install warning for alarms.
```

### Optional site access justification (new in 1.6.0; `optional_host_permissions`: `http://*/*`, `https://*/*`)
```
Requested only when the user turns on the Agent Bridge switch in the popup, and removed when the switch is turned off. The bridge opens pages in background tabs for the user's own local MCP server; activeTab covers only the tab the user invoked the extension on, so it cannot cover a tab the bridge opened. The package declares no host_permissions of its own, so at install and after every update the extension cannot read any site until the user grants this, and because the grant is optional, an update adding it does not disable the extension. Without the grant the bridge refuses before opening any tab, and the user's own popup extractions are unaffected.
```

### Remote code (required question)
```
Answer: No, I am not using remote code.
```

_Rationale: All JavaScript executed by Page2AI ships inside the extension bundle installed from the Chrome Web Store. The extension performs no eval(), Function() constructor calls, dynamic import() of remote URLs, or fetch()-then-execute of remote scripts. It does not fetch code, it only reads the DOM of the page the user is already viewing. ([Definition per developer.chrome.com](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).)_

---

## 5. Distribution tab

### Visibility
```
Public
```

### Regions
```
All regions
```

### Pricing
```
Free
```

### In-app purchases
```
No
```

### Trader status
```
Non-Trader (recommended)
```
_Valid choice for a free, hobbyist, open-source utility with no monetization. Google requires a declaration before publishing. You cannot skip. ([source](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq).)_

---

## 6. Support URLs

### Homepage URL
```
https://github.com/igorsaevets/page2ai-extension
```
_The dashboard field as read on 2026-10-18 (T140). Until then this file held the v1.0 plan to point it at the
listing itself._

### Support URL
```
https://github.com/igorsaevets/page2ai-extension/issues
```

### Privacy policy URL (repeat from section 3)
```
https://github.com/igorsaevets/page2ai-extension/blob/main/PRIVACY.md
```

### Verified publisher (OPTIONAL)
Skip for v1.0. Requires domain ownership via Google Search Console TXT record. Only unlocks a "verified" badge, not required to publish.

---

## 7. Version history

| Version | CHANGELOG date | On the Chrome Web Store |
|---|---|---|
| 1.5.1 | 2026-10-18 | Published 2026-10-18 (UTC): Chrome's update service served 1.5.1 from 22:22Z, 37 min after the API submit (21:45:49Z); CRX = the release zip per entry. Uploaded and submitted from tag `v1.5.1` through the API |
| 1.5.0 | 2026-10-17 | Published 2026-10-17 (UTC): Chrome's update service served 1.5.0 from 23:24Z, 31 min after the API submit; CRX = the release zip per entry. Uploaded and submitted from tag `v1.5.0` through the API; served until 1.5.1 |
| 1.4.0 | 2026-10-16 | Published 2026-10-17 (UTC), served until 1.5.0. Uploaded and submitted from tag `v1.4.0` through the API |
| 1.3.0 | 2026-07-27 | Published; served until 1.4.0 |
| 1.2.0 | 2026-07-23 | Not recorded here |
| 1.1.0 | 2026-07-22 | Not recorded here |
| 1.0.2 | 2026-07-20 | Published 2026-07-30, the first approved version |
| 1.0.1, 1.0.0 | 2026-07-20 | Not recorded here |

Listing-only changes: a rewrite was rejected on 2026-09-05 (section 8); the next text was resubmitted on
2026-09-07 and approved. On 2026-10-18 at 01:46 UTC (T140) the Detailed description change for 1.5.0
(section 1) and screenshots 1-3 from the 1.5.0 build were submitted for review with automatic publishing; at
01:47 UTC the API reported «Published revision: PUBLISHED 1.5.0 at 100%» and «Submitted revision:
PENDING_REVIEW 1.5.0 at 100%». Google approved it the same day: the public listing showed the new description
and screenshots at 21:29 UTC (no poll ran between 10:33 UTC, which still saw the old listing, and 21:29), and at
21:32 UTC the API reported «Submitted revision: none».

## 8. Review notes and rejection history

- **2026-09-05, Keyword Spam (reference "Yellow Argon").** The rejected line listed nine sites the
  extension handles (Reddit, X/Twitter, StackOverflow, GitHub, MDN and four kinds of docs sites),
  which is the first example on the store's keyword-stuffing page. The fix: describe what the
  converter handles (pages rendered by scripts, hidden tabs, code widgets, docs frameworks), not
  the sites, and keep any per-site list on the docs site. Kept since: no sentence names five or
  more sites or products.
- **The v1.0 draft wording, do not reuse.** Title: `Page2AI: Page to Markdown for Claude & ChatGPT`.
  Summary: `Convert any webpage to clean Markdown in one click. Perfect for Claude, ChatGPT, Cursor,
  Obsidian, RAG pipelines. 100% local.` (five names in one sentence). The v1.0 detailed
  description is in the git history of `assets/store/listing.md`.
- **Permissions.** A new permission that shows a warning disables the installed extension until
  each user accepts it (developer.chrome.com/docs/extensions/develop/concepts/permission-warnings).
  `activeTab` shows no warning and gives the URL and title of the tab the user acted on
  (developer.chrome.com/docs/extensions/develop/concepts/activeTab), so `tabs` is not needed for
  that. The popup is opened by the toolbar button or Alt+Shift+M, which is the gesture that
  grants `activeTab`.

---

## Submission pre-flight checklist

Before clicking **Submit for Review**, confirm:

- [ ] All four permission justifications entered (section 4)
- [ ] Privacy policy URL entered and reachable (section 3, section 6)
- [ ] Single-Purpose statement entered (section 3)
- [ ] Data collection: all items marked "not collected" (section 3)
- [ ] All three certifications checked (section 3)
- [ ] Icon 128x128 uploaded (section 2)
- [ ] Small promo tile 440x280 uploaded (section 2)
- [ ] At least one screenshot 1280x800, JPEG or 24-bit PNG without alpha, uploaded (section 2)
- [ ] Trader status declared (section 5)
- [ ] Category set to Workflow & Planning (section 1)

Common rejection triggers to avoid ([source](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)):
- Blank description: we ship ~2500 chars.
- Missing icon / screenshot / promo tile: all included.
- Privacy fields contradicting behavior: we align (nothing collected, matches PRIVACY.md).
- Keyword spam (>5 repetitions of same keyword in description): we do not spam.
- Unattributed testimonials: we have none.
