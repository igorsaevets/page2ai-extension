import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const CHROME_PATH = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const iconBuf = await readFile(resolve(root, 'public/icon/128.png'));
const iconDataUrl = `data:image/png;base64,${iconBuf.toString('base64')}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 440px; height: 280px; overflow: hidden;
    background: linear-gradient(135deg, #4338ca 0%, #4f46e5 55%, #6d28d9 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .row {
    display: flex; align-items: center; height: 100%;
    padding: 0 32px; box-sizing: border-box; gap: 26px;
  }
  .logo {
    width: 128px; height: 128px; flex: 0 0 128px;
    filter: drop-shadow(0 6px 16px rgba(0,0,0,0.20));
  }
  .text {
    color: #ffffff; line-height: 1.12;
    text-shadow: 0 1px 2px rgba(0,0,0,0.14);
  }
  .name {
    font-size: 34px; font-weight: 800; letter-spacing: -0.025em;
    margin-bottom: 10px;
  }
  .tag {
    font-size: 17px; font-weight: 500; opacity: 0.97;
  }
  .arrow { font-weight: 700; padding: 0 2px; }
  .badge {
    display: inline-block; margin-top: 12px;
    background: rgba(255,255,255,0.14);
    color: #ffffff; font-size: 11px; font-weight: 600;
    padding: 4px 9px; border-radius: 12px; letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="row">
    <img class="logo" src="${iconDataUrl}" alt="Page2AI">
    <div class="text">
      <div class="name">Page2AI</div>
      <div class="tag">Any webpage <span class="arrow">→</span> clean,<br>AI-ready Markdown</div>
      <div class="badge">100% LOCAL &nbsp;&middot;&nbsp; OPEN SOURCE</div>
    </div>
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluateHandle('document.fonts.ready');
  const outFinal = resolve(root, 'assets/store/promo-small-440x280.png');
  await mkdir(dirname(outFinal), { recursive: true });
  // Snap at 2x (880x560) for antialiased typography, then downsize to spec 440x280.
  const buf2x = await page.screenshot({ omitBackground: false, type: 'png' });
  await sharp(buf2x)
    .resize(440, 280, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(outFinal);
  console.log(`ok ${outFinal.replace(root, '.')} (spec 440x280)`);
} finally {
  await browser.close();
}
