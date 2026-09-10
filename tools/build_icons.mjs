/**
 * Draw the app icons.
 *
 * Writes icon.svg for the browser tab, and the PNGs a phone wants when someone
 * adds the game to their home screen. Rendering needs a browser, so unlike the
 * other tools this one is not dependency-free:
 *
 *   npm i -D playwright && node tools/build_icons.mjs
 *
 * The icons change about once a year, so the output is committed and you should
 * not need to run this.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const GROUND = "#1b1820";
const AMBER = "#f0a83a";
const GREEN = "#47c98a";

/** The L waiting up top, and the D that has fallen and tipped over. */
const art = `
  <rect x="7" y="6" width="24" height="24" rx="5.5" fill="${AMBER}"/>
  <path fill="${GROUND}" transform="translate(13 11)" d="M0 0h3.5v10.5H9V14H0Z"/>
  <g transform="rotate(12 45 44)">
    <rect x="33" y="32" width="24" height="24" rx="5.5" fill="${GREEN}"/>
    <path fill="${GROUND}" fill-rule="evenodd" transform="translate(39 37)"
          d="M0 0h5a7 7 0 0 1 0 14H0Z M3.5 3.5h1.5a3.5 3.5 0 0 1 0 7H3.5Z"/>
  </g>`;

/**
 * `radius` rounds the corners; a phone masks the icon itself, so anything it
 * masks is drawn square. `inset` shrinks the art away from the edges, which is
 * what a maskable icon needs to survive being cropped to a circle.
 */
function svg({ radius = 14, inset = 1 } = {}) {
  const scaled = inset === 1
    ? art
    : `<g transform="translate(32 32) scale(${inset}) translate(-32 -32)">${art}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Letter Drop. The kept letter waits up top in amber, the added letter has
       fallen to the bottom in green, tipping over on the way down. -->
  <rect width="64" height="64" rx="${radius}" fill="${GROUND}"/>
${scaled}
</svg>
`;
}

const PNGS = [
  // iOS rounds the corners itself, so this one is square and full bleed.
  { file: "apple-touch-icon.png", size: 180, options: { radius: 0 } },
  { file: "icon-192.png", size: 192, options: {} },
  { file: "icon-512.png", size: 512, options: {} },
  // Android crops to whatever shape it likes, so keep the art clear of the edge.
  { file: "maskable-512.png", size: 512, options: { radius: 0, inset: 0.72 } },
];

await writeFile("icon.svg", svg());
await mkdir("icons", { recursive: true });

const browser = await chromium.launch();
for (const { file, size, options } of PNGS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const markup = svg(options).replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<body style="margin:0">${markup}</body>`);
  // Transparent outside the ground rect, so rounded corners stay rounded
  // instead of picking up a white square behind them.
  await page.screenshot({ path: `icons/${file}`, omitBackground: true });
  await page.close();
  console.log(`icons/${file}  ${size}x${size}`);
}
await browser.close();
