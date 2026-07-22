# Chrome Web Store — Page2AI listing draft

> Copy each field into the Chrome Web Store Developer Dashboard when submitting.
> All limits verified against `developer.chrome.com` on 2026-07-20.

---

## 1. Store listing tab

### Title (visible in search + install button)
```
Page2AI — Webpage to Markdown
```
_29 chars. Well under Google's soft cap (~45)._

### Summary (visible in search results)
```
Convert any webpage to clean, AI-ready Markdown. 100% local, no data collected. Open source. One click or Alt+Shift+M.
```
_118 chars. Under the official 132-char limit ([source](https://developer.chrome.com/docs/webstore/best-listing#item_summary))._

### Category
```
Workflow & Planning
```
_Best fit — official examples include "document editors" and "tools to help users perform tasks more efficiently" ([source](https://developer.chrome.com/docs/webstore/best-practices#choose-category-well))._

### Language
```
English (Worldwide)
```

### Detailed description
```
Page2AI turns any webpage into a clean, AI-ready Markdown document with one click. Paste it straight into Claude, ChatGPT, Cursor, or your RAG pipeline.

Everything runs inside your browser. No servers. No accounts. No telemetry. No cloud.

WHAT MAKES IT DIFFERENT

• Profile-aware extraction — auto-detects the site kind (docs, marketing, research, dashboard) and tunes the strategy per profile. Manual override in one click.
• Tab & dropdown capture — extracts code from hidden tabs (Python vs TypeScript vs cURL vs …) with DOM-position-aware dedup, so you get the code from every tab, not just the active one.
• MDX / JSX post-processing — Mintlify components (<Note>, <CodeGroup>, <Tabs>, <AccordionGroup>) become plain Markdown.
• llms.txt short path — if the site publishes an official .md alongside the page, Page2AI uses it directly.
• Quality gate — post-extraction check on <pre> count vs a plain-text baseline; automatic fallback if under-extraction is detected.
• Structured-data appendix — JSON-LD, OpenGraph, Microdata, Next.js __NEXT_DATA__ hoisted into a machine-readable appendix at the end.
• Cached-result recovery — close the popup mid-extraction, reopen it, your result is waiting (badge shows ✓).
• Dark mode, live progress log, PII masking (opt-in).

PRIVACY

Page2AI does not send data anywhere. No analytics, no telemetry, no crash reports, no cloud service, no accounts, no remote code. The extension only reads the tab you explicitly click on (via activeTab), converts it to Markdown on your device, and copies it to your clipboard. Everything else is preferences stored locally in chrome.storage.

MINIMUM PERMISSIONS

• activeTab — read only the tab you clicked on.
• scripting — inject the extraction script into that tab.
• clipboardWrite — copy the Markdown to your clipboard.
• storage — remember your profile preference between sessions.

No <all_urls>. No host_permissions. No tabs API. Chrome will not warn you that this extension can read all your data on all sites — because it cannot.

OPEN SOURCE

MIT-licensed. Full source at github.com/igorsaevets/page2ai-extension. Verify every claim in this listing against the code.

HOTKEY

Alt+Shift+M opens the popup; Enter runs the extraction.

BUILT BY

Igor Saevets, AI Expert and Entrepreneur.
```

_~2100 chars. Well under the 16000-char soft cap. Uses text-only formatting (CWS descriptions do not render Markdown)._

---

## 2. Graphic assets

### Store icon
```
File: assets/store/icon-128.png
Size: 128×128 PNG
Artwork: 96×96 centered, 16px transparent padding per side
Background: #4f46e5 (indigo-600) with 22% rounded corners (Chrome may render additional UI chrome)
```

### Small promotional tile (REQUIRED)
```
File: assets/store/promo-small-440x280.png
Size: 440×280 PNG
Content: brand mark + tagline "Any webpage → clean, AI-ready Markdown"
```

### Screenshots (1–5, at least 1 REQUIRED)
```
Files: assets/store/screenshot-{1..N}-1280x800.png
Size: 1280×800 PNG (or 640×400)
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

- Personally identifiable information → NO
- Health information → NO
- Financial and payment information → NO
- Authentication information → NO
- Personal communications → NO
- Location → NO
- Web history → NO
- User activity → NO
- Website content → NO
- Other → NO

_Rationale: Page2AI reads webpage content only in-memory during a single extraction the user actively triggered, converts it, writes it to the clipboard, and drops it. Nothing is stored beyond the current tab's session cache (`chrome.storage.session`, cleared when Chrome closes) and the user's own profile preference (`chrome.storage.local`, on-device only). No "collection" in the sense the CWS form defines — nothing leaves the device._

### Certifications (all THREE must be checked)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
```
https://github.com/igorsaevets/page2ai-extension/blob/main/PRIVACY.md
```
_Required even for local-only extensions — CWS User Data FAQ Q14 ([source](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq))._

---

## 4. Permissions justifications

Enter each of the four below into the corresponding "justify" text box on the Privacy practices tab.

### `activeTab` — justification
```
Grants Page2AI access to the currently active tab only when the user explicitly acts on the extension — clicking the toolbar icon or pressing the Alt+Shift+M keyboard shortcut. Required to read the page content the user asked to convert. Not persistent, not blanket, and cannot be used to read any other tab or any tab the user did not act on.
```

### `scripting` — justification
```
Required to programmatically inject the extraction script (extractor.js) into the active tab after the user acts on the extension. Using scripting.executeScript with activeTab is the minimal-privilege alternative to declaring content_scripts in the manifest — with content_scripts, the extension would inject on every page the user visits; with scripting + activeTab it injects only on the one tab the user explicitly triggered.
```

### `clipboardWrite` — justification
```
Required to copy the generated Markdown result to the user's clipboard automatically at the end of extraction — the primary reason the user invoked the extension. Page2AI does not request clipboardRead and never reads the user's clipboard contents.
```

### `storage` — justification
```
Used exclusively to persist the user's own extension preferences locally on their device: (1) chrome.storage.local remembers the last-selected extraction profile (auto, docs, marketing, research, dashboard, wordpress-marketing) between sessions; (2) chrome.storage.session caches the most-recent extraction result per tab so that closing the popup mid-extraction and reopening it restores the finished result. No data is transmitted anywhere.
```

### Remote code — required question
```
Answer: No, I am not using remote code.
```

_Rationale: All JavaScript executed by Page2AI ships inside the extension bundle installed from the Chrome Web Store. The extension performs no eval(), Function() constructor calls, dynamic import() of remote URLs, or fetch()-then-execute of remote scripts. It does not fetch code — it only reads the DOM of the page the user is already viewing. ([Definition per developer.chrome.com](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).)_

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
_Valid choice for a free, hobbyist, open-source utility with no monetization. Google requires a declaration before publishing — you cannot skip. ([source](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq).)_

---

## 6. Support URLs

### Homepage URL
```
https://github.com/igorsaevets/page2ai-extension
```

### Support URL
```
https://github.com/igorsaevets/page2ai-extension/issues
```

### Privacy policy URL (repeat from §3)
```
https://github.com/igorsaevets/page2ai-extension/blob/main/PRIVACY.md
```

### Verified publisher (OPTIONAL)
Skip for v1.0 — requires domain ownership via Google Search Console TXT record, only unlocks a "verified" badge, not required to publish.

---

## Submission pre-flight checklist

Before clicking **Submit for Review**, confirm:

- [ ] All four permission justifications entered (§4)
- [ ] Privacy policy URL entered and reachable (§3, §6)
- [ ] Single-Purpose statement entered (§3)
- [ ] Data collection: all items marked "not collected" (§3)
- [ ] All three certifications checked (§3)
- [ ] Icon 128×128 uploaded (§2)
- [ ] Small promo tile 440×280 uploaded (§2)
- [ ] At least one screenshot 1280×800 uploaded (§2)
- [ ] Trader status declared (§5)
- [ ] Category set to Workflow & Planning (§1)

Common rejection triggers to avoid ([source](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)):
- Blank description → we ship ~2100 chars.
- Missing icon / screenshot / promo tile → all included.
- Privacy fields contradicting behavior → we align (nothing collected, matches PRIVACY.md).
- Keyword spam (>5 repetitions of same keyword in description) → we do not spam.
- Unattributed testimonials → we have none.
