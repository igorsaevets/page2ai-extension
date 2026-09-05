import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifestVersion: 3,
  manifest: ({ mode, browser }) => ({
    name: 'Page2AI — Webpage to Markdown',
    description: 'Convert any webpage to clean, AI-ready Markdown. 100% local, open source.',
    // Chrome accepts the MV3 object form; Mozilla's validator rejects it outright
    // ("MANIFEST_FIELD_INVALID: /author must be string"), so Firefox gets a string.
    // Caught by `web-ext lint` before the AMO upload, not by AMO after it.
    author: browser === 'firefox' ? 'Igor Saevets' : { email: 'support@igorsaevets.com' },
    homepage_url: 'https://github.com/igorsaevets/page2ai-extension',
    permissions: ['activeTab', 'scripting', 'clipboardWrite', 'storage'],
    commands: {
      // Opens the popup, which drives extraction. Ctrl+Shift+M is taken by
      // Chrome's profile switcher, so Alt+Shift+M (MarkDownload's convention).
      _execute_action: {
        suggested_key: {
          default: 'Alt+Shift+M',
          mac: 'Alt+Shift+M',
        },
      },
    },
    action: {
      default_title: 'Page2AI — Extract as Markdown',
    },
    // Firefox-only: stable extension ID, min supported Firefox, zero data collection
    // declaration. Required for AMO submission (Nov 3 2025+ policy).
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'page2ai@igorsaevets.com',
          // 140.0, not 128.0: `data_collection_permissions` landed in Firefox 140
          // (Android 142). Declaring 128 makes the manifest claim support on versions
          // that ignore the key, which `web-ext lint` flags as
          // KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION.
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: ['none'],
          },
        },
        // Android got the same key two releases later. Declaring it separately keeps
        // desktop at 140 instead of pushing every desktop user to 142 for no reason.
        gecko_android: {
          strict_min_version: '142.0',
        },
      },
    }),
    // The e2e build grants localhost host access so the smoke test can call
    // scripting.executeScript without the activeTab user gesture. Never ships.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
    // real-test drives extraction against real public sites (docs, blogs, gov).
    // Broad host access is required because there is no user gesture in the
    // headless runner. Never ships — produces its own .output/chrome-mv3-real-test.
    ...(mode === 'real-test' ? { host_permissions: ['<all_urls>'] } : {}),
  }),
});
