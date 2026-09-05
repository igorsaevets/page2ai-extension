// Compose a wide docs-site hero image (1600×900) using the freshly generated
// 1280×800 store shots as raw input.
//
// Layout: two-panel composition —
//   left  60%  → USCIS EB-1 (government long-form)  cropped 1600×540 stretch
//   right 40%  → the extension popup rendered LARGE (roughly full height)
// centered under a wordmark strip. Produces docs-hero-1600x900.png.
//
// Run: node scripts/gen-docs-hero.mjs
//   (requires the store shots to exist — run gen-screenshots-real.mjs first)

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const inShots = [
  path.resolve(root, 'assets/store/screenshot-1-uscis-eb1-1280x800.png'),
  path.resolve(root, 'assets/store/screenshot-2-openwebui-tools-1280x800.png'),
  path.resolve(root, 'assets/store/screenshot-3-xai-grok-45-1280x800.png'),
];

for (const p of inShots) {
  if (!existsSync(p)) {
    console.error(`FATAL: missing ${p} — run gen-screenshots-real.mjs first`);
    process.exit(2);
  }
}

const outDir = path.resolve(root, 'assets/store');
mkdirSync(outDir, { recursive: true });

const W = 1600;
const H = 900;
const bgColor = { r: 15, g: 15, b: 21 }; // matches popup dark-mode bg

// Layout: three shots in a fanned stack, centered. Each shot 900×565.
// Rotate slightly for depth, drop-shadow behind each.
const cardW = 900;
const cardH = 565;

async function makeCard(inPath, rotDeg) {
  const buf = await sharp(inPath)
    .resize(cardW, cardH, { fit: 'cover', position: 'top' })
    .toBuffer();
  // Add a subtle border for card feel
  const bordered = await sharp(buf)
    .extend({
      top: 2,
      bottom: 2,
      left: 2,
      right: 2,
      background: { r: 63, g: 63, b: 78, alpha: 1 },
    })
    .rotate(rotDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return bordered;
}

async function makeShadowFor(cardBuf) {
  const meta = await sharp(cardBuf).metadata();
  const w = meta.width;
  const h = meta.height;
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: w - 20,
            height: h - 20,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0.6 },
          },
        })
          .png()
          .toBuffer(),
        top: 10,
        left: 10,
      },
    ])
    .blur(24)
    .png()
    .toBuffer();
}

const bgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="35%" r="80%">
      <stop offset="0%" stop-color="#1a1a24" stop-opacity="1"/>
      <stop offset="70%" stop-color="#0f0f15" stop-opacity="1"/>
      <stop offset="100%" stop-color="#08080c" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g font-family="ui-sans-serif, system-ui, 'Segoe UI', sans-serif" fill="#ececf1">
    <text x="80" y="86" font-size="52" font-weight="700">Page2AI</text>
    <text x="80" y="126" font-size="22" fill="#9c9cab">Turn any webpage into clean, AI-ready Markdown</text>
    <text x="80" y="828" font-size="16" fill="#6b6b76">100% local · open source · MIT · docs · marketing · government · long-form</text>
  </g>
</svg>`.trim();

const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();

const cards = [
  { file: inShots[2], rot: -6, cx: 380, cy: 470 }, // xai-grok (back-left)
  { file: inShots[0], rot: 0,  cx: 800, cy: 500 }, // uscis (center front)
  { file: inShots[1], rot: 6,  cx: 1220, cy: 470 }, // openwebui (back-right)
];

const composited = [];
for (const c of cards) {
  const card = await makeCard(c.file, c.rot);
  const shadow = await makeShadowFor(card);
  const cardMeta = await sharp(card).metadata();
  const left = Math.round(c.cx - cardMeta.width / 2);
  const top = Math.round(c.cy - cardMeta.height / 2);
  composited.push({ input: shadow, left: left + 8, top: top + 20 });
  composited.push({ input: card, left, top });
}

const outPath = path.resolve(outDir, 'docs-hero-1600x900.png');
await sharp(bg)
  .composite(composited)
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log(`OK → ${path.relative(root, outPath)} (${W}×${H})`);
