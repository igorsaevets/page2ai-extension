import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifestVersion: 3,
  manifest: ({ mode, browser }) => ({
    name: 'Page2AI — Webpage to Markdown',
    description: 'Convert any webpage to clean, AI-ready Markdown. 100% local, open source.',
    author: { email: 'igorsaevets@gmail.com' },
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
          strict_min_version: '128.0',
          data_collection_permissions: {
            required: ['none'],
          },
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
