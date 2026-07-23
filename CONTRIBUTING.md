# Contributing to Page2AI

Thanks for wanting to contribute! Page2AI is an open-source Chrome extension that converts webpages to LLM-ready Markdown.

## Ways to help

- **Report site issues.** If extraction fails or looks bad on a specific site, [open a Site Report](https://github.com/igorsaevets/page2ai-extension/issues/new?template=site-report.md). The profile system relies on real-world feedback.
- **Fix a bug.** See [issues labeled `good first issue`](https://github.com/igorsaevets/page2ai-extension/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- **Add a new site profile.** See [`lib/core/profiles.ts`](lib/core/profiles.ts) for the tuning surface.
- **Improve extraction.** See [`lib/core/html-to-md.ts`](lib/core/html-to-md.ts) and [`lib/core/tab-handler.ts`](lib/core/tab-handler.ts).

## Development setup

```powershell
git clone https://github.com/igorsaevets/page2ai-extension.git
cd page2ai-extension
npm install
npm run dev          # WXT dev server + HMR
npm run compile      # tsc --noEmit
npm run build        # Production build -> .output\chrome-mv3\
npm run icons        # Regenerate PNG icons from SVG
```

Load `.output/chrome-mv3/` via `chrome://extensions` → Developer mode → Load unpacked.

## Testing

E2E tests run against a real Chrome instance via puppeteer-core:

```powershell
npm i --no-save puppeteer-core@25.3.0
node .e2e/e2e-smoke.mjs   # 36 checks: injection + frontmatter + tabs + colspan + blockquote
node .e2e/e2e-popup.mjs   # 11 checks: full popup UX
```

## PR checklist

1. Fork + branch (`fix/`, `feat/`, `docs/` prefix).
2. `npm run compile` clean.
3. `npm run build` clean.
4. Manual test on at least 2 real sites you care about.
5. Fill out the PR template.

## Code style

- TypeScript strict. No `any` without a comment justifying it.
- No inline comments describing WHAT the code does. Only WHY (non-obvious constraints, workarounds, subtle invariants).
- Prefer editing existing files over adding new ones.
- Follow the extraction pipeline structure in `lib/core/`. Don't add framework-level abstractions.

## License

By contributing you agree that your contributions will be licensed under MIT.
