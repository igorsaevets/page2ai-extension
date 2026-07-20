import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ mode }) => ({
    name: 'Page2MD — Webpage to Markdown',
    description: 'Convert any webpage to clean, AI-ready Markdown. 100% local, open source.',
    author: { email: 'igorsaevets@gmail.com' },
    homepage_url: 'https://github.com/igorsaevets/page2md-extension',
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
      default_title: 'Page2MD — Extract as Markdown',
    },
    // The e2e build grants localhost host access so the smoke test can call
    // scripting.executeScript without the activeTab user gesture. Never ships.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
  }),
});
