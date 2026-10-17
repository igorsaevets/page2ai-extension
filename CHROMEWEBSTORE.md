# CHROMEWEBSTORE.md: Page2AI on the Chrome Web Store

> Last Updated: 2026-10-17. The store record for item `dlpaaijcnbbmlfeohlphjpnbbcnomnno`: what the
> Developer Dashboard holds, field by field, and why each permission is requested.
> Title, Summary and Detailed description were read from the public listing on 2026-10-17
> (version 1.4.0, updated October 16, 2026). Until that day this file was `assets/store/listing.md`, the v1.0
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

### Detailed description (dashboard field, live text on 2026-10-17)
````
Page2AI turns any webpage into a clean, AI-ready Markdown document with one click — ready to paste into your LLM, coding agent, or RAG pipeline.

Everything runs inside your browser. No servers, no accounts, no telemetry, no cloud.

WHAT MAKES IT DIFFERENT

• Profile-aware extraction — auto-detects the site kind (docs, marketing, research, dashboard) and tunes the strategy per profile. Manual override in one click.
• Tab & dropdown capture — pulls code from hidden tabs (Python vs TypeScript vs cURL vs …) with DOM-position-aware dedup, so you get the code from every tab, not just the active one.
• Code blocks with language hints — ```python, ```js, ```bash preserved verbatim so LLMs read them correctly.
• MDX / JSX post-processing — Mintlify components (<Note>, <CodeGroup>, <Tabs>, <AccordionGroup>) become plain Markdown.
• llms.txt short path — if the site publishes an official .md alongside the page, Page2AI uses it directly.
• Quality gate — post-extraction check on <pre> count vs a plain-text baseline; automatic fallback if under-extraction is detected.
• Structured-data appendix — JSON-LD, OpenGraph, Microdata, Next.js __NEXT_DATA__ hoisted into a machine-readable appendix at the end.
• Cached-result recovery — close the popup mid-run, reopen it, your result is waiting (badge shows ✓).
• Dark mode, live progress log, PII masking (opt-in).

HANDLES JAVASCRIPT-HEAVY SITES

Modern web apps often defeat plain-text readers with client-side rendering, hidden tab content, or code shown one language at a time. The profile system detects the page kind and applies rules that surface content plain readers miss.

FOR WHOM

• Researchers feeding docs to their AI assistant.
• Developers preparing README-ready snippets from API docs.
• Writers clipping web articles into their notes app.
• Anyone who used MarkDownload-style clipping — this is a modern replacement.

PRIVACY

Page2AI does not send data anywhere. No analytics, no telemetry, no crash reports, no cloud service, no accounts, no remote code. The extension only reads the page you explicitly click on (via activeTab), converts it to Markdown on your device, and copies it to your clipboard. Everything else is preferences stored locally in chrome.storage.

MINIMUM PERMISSIONS

• activeTab — read only the page you clicked on.
• scripting — inject the reader script into that page.
• clipboardWrite — copy the result to your clipboard.
• storage — remember your profile preference between sessions.

No <all_urls>. No host_permissions. No tabs API. Chrome will not warn you that this extension can read all your data on all sites — because it cannot.

ALSO AVAILABLE ON FIREFOX

addons.mozilla.org/en-US/firefox/addon/page2ai-webpage-to-markdown/

FOR AI AGENTS (MCP)

Optional MCP server lets AI agents call Page2AI directly through the Model Context Protocol. Install with: npm i @page2ai/mcp — source at github.com/igorsaevets/page2ai-mcp.

OPEN SOURCE

MIT-licensed. Full source at github.com/igorsaevets/page2ai-extension. Verify every claim in this listing against the code.

HOTKEY

Alt+Shift+M opens the popup; Enter runs the extraction.

BUILT BY

Igor Saevets, AI Expert and Entrepreneur.
````
_3180 characters (limit 16,000). Plain text: the store does not render Markdown. This wording went in
with the resubmission of 2026-09-07, after the keyword-spam rejection in section 8._

---


### Detailed description: change for the release after 1.4.0 (not in the dashboard yet)

The extension now takes the content only from the page (BL-49, Igor 2026-10-17), so two bullets of the live text
above become false. When that release is live, change the Detailed description field in the same dashboard session:

1. Delete the bullet that begins `• MDX / JSX post-processing`: the clean-up it describes ran only on the Markdown
   copies the extension no longer reads.
2. Replace the bullet that begins `• llms.txt short path` with this line:

````text
• Only the page you see — Page2AI converts the page in your tab and nothing else. It never swaps in the site's llms.txt or a Markdown copy, which can be older than the page.
````

3. Screenshots 2 and 3 (section 2) show the popup's `official-md` status line. Replace them with new captures of the
   same pages (`scripts/gen-screenshots-real.mjs`) before that version is submitted.

The PRIVACY paragraph of the description stays as it is: it is true of that release. It was not complete for
1.4.0, which asks the site for `llms.txt` and a Markdown copy of the page (PRIVACY.md, Network requests), so do
not quote it as a description of 1.4.0 (T136 panel, grokbuild).

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
Size: 1280x800 PNG (or 640x400)
Orientation: landscape only (portrait not supported by CWS)
Content: real Page2AI popup + real extraction result on real docs pages
```

### Marquee promo tile (OPTIONAL)
```
Not shipped in v1.0. Only needed for CWS "featured" placement, which we do not need for launch.
```

---

## 3. Privacy practices tab

### Single Purpose statement
```
Page2AI extracts the content of the active browser tab and converts it into a clean Markdown document, then places that Markdown on the user's clipboard.
```

### Data collection disclosures

For each item in the CWS privacy form, tick **NO / not collected**:

- Personally identifiable information: NO
- Health information: NO
- Financial and payment information: NO
- Authentication information: NO
- Personal communications: NO
- Location: NO
- Web history: NO
- User activity: NO
- Website content: NO
- Other: NO

_Rationale: Page2AI reads webpage content only in-memory during a single extraction the user actively triggered, converts it, writes it to the clipboard, and drops it. Nothing is stored beyond the current tab's session cache (`chrome.storage.session`, cleared when Chrome closes) and the user's own profile preference (`chrome.storage.local`, on-device only). No "collection" in the sense the CWS form defines. Nothing leaves the device._

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

Enter each of the four below into the corresponding "justify" text box on the Privacy practices tab.

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
Used exclusively to persist the user's own extension preferences locally on their device: (1) chrome.storage.local remembers the last-selected extraction profile (auto, docs, marketing, research, dashboard, wordpress-marketing) between sessions; (2) chrome.storage.session caches the most-recent extraction result per tab so that closing the popup mid-extraction and reopening it restores the finished result. No data is transmitted anywhere.
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
https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno
```
_After CWS approval, points listing to itself. Before approval, use the GitHub repo URL._

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
| 1.4.0 | 2026-10-16 | Live; the listing says updated October 16, 2026. Uploaded and submitted from tag `v1.4.0` through the API |
| 1.3.0 | 2026-07-27 | Published; served until 1.4.0 |
| 1.2.0 | 2026-07-23 | Not recorded here |
| 1.1.0 | 2026-07-22 | Not recorded here |
| 1.0.2 | 2026-07-20 | Published 2026-07-30, the first approved version |
| 1.0.1, 1.0.0 | 2026-07-20 | Not recorded here |

Listing-only changes: a rewrite was rejected on 2026-09-05 (section 8); the text now live was
resubmitted on 2026-09-07 and approved.

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
- [ ] At least one screenshot 1280x800 uploaded (section 2)
- [ ] Trader status declared (section 5)
- [ ] Category set to Workflow & Planning (section 1)

Common rejection triggers to avoid ([source](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)):
- Blank description: we ship ~2500 chars.
- Missing icon / screenshot / promo tile: all included.
- Privacy fields contradicting behavior: we align (nothing collected, matches PRIVACY.md).
- Keyword spam (>5 repetitions of same keyword in description): we do not spam.
- Unattributed testimonials: we have none.
