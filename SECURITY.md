# Security Policy

## Supported versions

Only the latest release receives security updates.

| Version | Supported |
|---------|-----------|
| 1.2.x   | ✅        |
| < 1.2   | ❌        |

## Reporting a vulnerability

If you find a security issue in Page2AI (unexpected data exfiltration, ability to read pages the user did not act on, extension escalating beyond declared permissions, etc.), please **do not open a public issue**.

Instead:

1. Email **igorsaevets@gmail.com** with subject `[Page2AI Security] <short description>`.
2. Include: what you found, how to reproduce, potential impact, suggested fix if you have one.
3. Expect a response within 3 business days.

Coordinated disclosure. I'll credit you in the fix commit and CHANGELOG unless you prefer to stay anonymous.

## Scope

Page2AI runs entirely on the user's device with these permissions:

- `activeTab`: only the tab the user clicks on
- `scripting`: inject extraction script into that tab
- `clipboardWrite`: write Markdown to clipboard
- `storage`: local preferences only

There is no backend, no telemetry, no remote code execution, no `host_permissions`, no `<all_urls>`. If you find a way for Page2AI to violate any of these, it's a security bug.
