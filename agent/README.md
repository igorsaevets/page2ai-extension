# Page2AI agent script

The Page2AI extension's own extractor as a plain page script, for AI agents that open pages through a browser
automation tool. The agent gets the Markdown the popup would give, also on pages behind a sign-in that a
fetch-based tool cannot reach, and only the Markdown lands on disk, never the raw page.

## Build

    npm ci
    npm run build:agent

`.output/agent/` then holds:

| File | Shape | For |
|---|---|---|
| `page2ai-agent.fn.js` | an async function expression that extracts and returns the result; defines nothing | Chrome DevTools MCP `evaluate_script` with `sourcePath` |
| `page2ai-agent.js` | a classic script that defines `window.__page2aiAgent = { version, extract(options) }`, frozen, non-enumerable, non-configurable | Playwright MCP `--init-script` |
| `page2ai-agent.SHA256SUMS` | checksums of both | `sha256sum -c page2ai-agent.SHA256SUMS` |

The build fails if the bundle contains an extension API, `eval`, a Trusted Types sink, a console call, or a network
call other than the two `fetch` calls of the official-Markdown lookup. The code is not minified, so it can be read
before it is run.

## Use

**Chrome DevTools MCP** (`chrome-devtools-mcp`): call `evaluate_script` with `sourcePath` set to the absolute path of
`page2ai-agent.fn.js` and `filePath` set to where the result should go. The server writes `JSON.stringify(result)`
and always replaces the file extension with `.json`. Both paths must be inside the client's MCP roots or a
`--filesystemRoot` directory. For a profile, run `page2ai-agent.js` once with `format: "script"`, then call
`evaluate_script` with `function: "() => __page2aiAgent.extract({ profile: 'docs' })"` and `filePath`.

**Playwright MCP** (`@playwright/mcp`): start the server with `--init-script /path/to/page2ai-agent.js`, then call
`browser_evaluate` with `function: "() => __page2aiAgent.extract()"` and `filename`. Relative file names resolve
against the workspace root, and the file must stay inside it.

**The result** is one JSON object: `markdown`, `status` (`ok`, or `fallback-after-crash` when the extractor failed), `title`, `url`, `profile`,
`filename`, `page2ai` (the build), `log` (the progress lines the popup shows) and the extractor's counters.
To get the Markdown alone: `jq -r .markdown result.json > page.md`.

## What it does to the page, measured

The script runs in the page's main world, next to the page's own scripts. The extension runs in an isolated world.
`.e2e/e2e-agent.mjs` extracts each test page both ways and requires equal Markdown; `.e2e/e2e-tab-panels.mjs` with
`PAGE2AI_E2E_TARGET=agent` runs the never-click checks through the script.

- Pages that enforce Trusted Types or a strict CSP: it works, through both MCP servers. Code evaluated over the
  DevTools protocol is exempt from `script-src`, and the bundle has no Trusted Types sink.
- It makes no network request: the content comes only from the page (BL-49). The build fails if the bundle uses
  a browser network API or anything else that makes the browser load an address (an element it creates or points
  at a URL, a navigation, a global reached by a computed name, a copy made in the page's document). These are
  static checks against a regression, not a sandbox; the proof at run time is `.e2e/e2e-agent.mjs`, which serves
  an `llms.txt` and `.md` copies, makes every route answer a Markdown Accept header with its copy, and requires
  that neither world requests anything but the page and that no CSP report reaches the server. Builds from `main` before this change asked
  the page's own site for `llms.txt` three times per run, through the page's `fetch` wrappers and its CSP: on a
  page with `connect-src 'none'` and a `report-uri`, that was three violation reports per run.
- It never writes to the console, which page scripts can read.
- The page cannot replace `window.__page2aiAgent` once the init script has defined it, and the define script refuses
  to overwrite one that something else defined first. A page can still see that the name exists.
- Chrome DevTools MCP serializes the result with the page's own `JSON.stringify`. A page that replaces it controls
  what is written to the file. An old `Array.prototype.toJSON` (Prototype.js) turns `log` into a string, while
  `markdown` survives. Playwright MCP serializes outside the page and is not affected.
- Page state comes only from the DOM (`__NEXT_DATA__`). JS globals such as `__NUXT__` are never read or called,
  which is also all the extension could ever see.

## Where to get it

The script runs with the page's privileges, on signed-in pages too, so take it from a fixed release and check it
before use.

**From a GitHub Release.** Every release after v1.4.0 carries `page2ai-agent.js`, `page2ai-agent.fn.js` and
`page2ai-agent.SHA256SUMS` next to the Chrome zip, built from the release tag by the `agent-build` and
`agent-release` jobs of `.github/workflows/publish-chrome.yml`. v1.4.0 and earlier do not have them. Name the
version in the URL: `releases/latest/download/...` also works, but it moves to the next release without notice.

    V=vX.Y.Z   # a release from https://github.com/igorsaevets/page2ai-extension/releases
    for f in page2ai-agent.js page2ai-agent.fn.js page2ai-agent.SHA256SUMS; do
      curl -fsSLO "https://github.com/igorsaevets/page2ai-extension/releases/download/$V/$f"
    done
    sha256sum -c page2ai-agent.SHA256SUMS    # macOS: shasum -a 256 -c page2ai-agent.SHA256SUMS

With the GitHub CLI: `gh release download vX.Y.Z --repo igorsaevets/page2ai-extension --pattern 'page2ai-agent*'`.
In PowerShell, each line prints the file name and OK or FAILED:

    Get-Content page2ai-agent.SHA256SUMS | ForEach-Object { $sum, $name = $_ -split '\s+', 2; if ((Get-FileHash $name -Algorithm SHA256).Hash -eq $sum) { "$name OK" } else { "$name FAILED" } }

Line 1 of each script names its build, `version+commit`. The checksums prove that your files are the ones on the
release; they do not prove who made the release, because whoever can change the release can change all three.
To tie the files to the source, check out the tag, build it as below and compare the checksum files.

**From this repository:** `npm ci` and `npm run build:agent` (see Build). The release workflow uploads only the
files a release lacks and stops when the release already holds a different one; it never replaces a published file.
