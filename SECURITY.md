# Security Policy

## Supported versions

Only the latest release receives security updates.

| Version | Supported |
|---------|-----------|
| 1.6.x   | ✅        |
| 1.5.x   | ✅ (until 1.6.0 is in both stores) |
| < 1.5   | ❌        |

## Reporting a vulnerability

If you find a security issue in Page2AI (unexpected data exfiltration, ability to read pages the user did not act on, extension escalating beyond declared permissions, a way to make the Agent Bridge open or return a page it should refuse, etc.), please **do not open a public issue**.

Preferred: [GitHub private vulnerability reporting](https://github.com/igorsaevets/page2ai-extension/security/advisories/new) for this repository. It opens a private thread with the maintainer, and no email address has to be guessed or harvested.

Alternative: email **support@igorsaevets.com** with subject `[Page2AI Security] <short description>`. Include: what you found, how to reproduce, potential impact, suggested fix if you have one. Expect a response within 3 business days.

Coordinated disclosure. I'll credit you in the fix commit and CHANGELOG unless you prefer to stay anonymous.

## Scope

Page2AI runs on the user's device. Its install-time permissions are:

- `activeTab`: only the tab the user clicks on
- `scripting`: inject the extraction script into that tab
- `clipboardWrite`: write Markdown to the clipboard
- `storage`: local preferences, the current tab's cached result (`storage.session`), and since 1.6.0 the Agent Bridge switch and its pairing key
- `alarms` (since 1.6.0): retry the Agent Bridge connection every 30 seconds while its switch is on; no install warning, no data

There is no backend, no telemetry, no remote code, and no `host_permissions` of its own: the package cannot read any site until the user acts. The one broader grant is optional and user-switched: turning on the Agent Bridge (1.6.0, off by default) asks for site access (`http://*/*`, `https://*/*`) so background tabs opened for the user's own local MCP server can be read; turning it off gives the access back.

The Agent Bridge listens to nothing — it connects out to `ws://127.0.0.1:3025` on the user's own machine, pairs with a random key both sides prove they know before any page opens (only a short fingerprint of the key crosses, to pick the right key), refuses non-web schemes, sign-in providers' pages and non-public IP literals before opening and again on the page a tab lands on, and answers a blank or crashed extraction with an error and no page content. The MCP server additionally resolves every requested and landed name and refuses any that resolves to a non-public address before the Markdown can reach the agent. The key is the whole credential: whoever holds it can ask Page2AI to open any web address in this browser and read its Markdown, so treat it like a password for the browser profile; *New key* in the popup is the only rotation. If you find a way for Page2AI to violate any of this, it's a security bug.
