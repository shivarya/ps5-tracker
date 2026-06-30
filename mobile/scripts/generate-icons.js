// One-off PS5-console-themed icon generator for this personal app (no Play Store listing,
// so no need for the full play-store-assets pipeline used by split-app/tracking-app/expense-tracker).
// Renders a simplified PS5 console silhouette — two curved white panels with a blue accent line,
// evoking the real console's shape — onto each required asset size via sharp's SVG rasterizer.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const BG = '#0E1B12';
const ACCENT = '#2F6FED';

// PS5's signature silhouette: two curved "flame"/wing panels (white front, black back) that
// taper to points top and bottom and bow outward through the middle, with the black console
// body visible as the gap between them and a blue accent light at the base.
const WING = 'M0,-46 C10,-40 17,-18 14,4 C12,20 6,34 0,46 ' +
             'C-6,34 -12,20 -14,4 C-17,-18 -10,-40 0,-46 Z';

function consoleSvg(size, { transparentBg = false, scale = 0.78 } = {}) {
  const bg = transparentBg ? 'none' : BG;
  const dotY = 33 * (scale / 0.78);
  return `
<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" fill="${bg}" />
  <g transform="translate(50 50)">
    <g transform="translate(-7 0) rotate(-16) scale(${scale})">
      <path d="${WING}" fill="#F4F4F4" />
    </g>
    <g transform="translate(7 0) rotate(16) scale(${scale})">
      <path d="${WING}" fill="#1A1A1A" stroke="#3A3A3A" stroke-width="0.5" />
    </g>
    <rect x="-3" y="${dotY}" width="6" height="6" rx="1.5" fill="${ACCENT}" />
  </g>
</svg>`;
}

// Android's status-bar notification icon is forced to a flat silhouette by the OS — it uses
// only the alpha channel and tints everything with app.json's expo-notifications "color", so a
// full-color render here would be pointless (and the dark "back wing" would vanish into its own
// stroke). Render both wings as solid white on transparent instead.
function notificationSvg(size) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(50 50)">
    <g transform="translate(-7 0) rotate(-16) scale(0.78)"><path d="${WING}" fill="#FFFFFF" /></g>
    <g transform="translate(7 0) rotate(16) scale(0.78)"><path d="${WING}" fill="#FFFFFF" /></g>
  </g>
</svg>`;
}

async function render(svg, size, outPath) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
  console.log('wrote', path.relative(process.cwd(), outPath), `${size}x${size}`);
}

async function main() {
  await render(consoleSvg(1024), 1024, path.join(ASSETS_DIR, 'icon.png'));
  // Android adaptive icons mask to an inner ~66% safe zone — shrink so the wingtips survive
  // the circular/squircle crop instead of getting clipped.
  await render(consoleSvg(1024, { scale: 0.52 }), 1024, path.join(ASSETS_DIR, 'android-icon-foreground.png'));
  await render(consoleSvg(1024, { transparentBg: true }), 1024, path.join(ASSETS_DIR, 'splash-icon.png'));
  await render(consoleSvg(48), 48, path.join(ASSETS_DIR, 'favicon.png'));
  await render(notificationSvg(256), 256, path.join(ASSETS_DIR, 'notification-icon.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
