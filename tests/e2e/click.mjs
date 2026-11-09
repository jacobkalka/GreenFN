// Usage: node tests/e2e/click.mjs <prefix> <steps.json>  (steps: {click: selector} | {keys}|{sim}|{shot}|{eval}|{wait})
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const prefix = process.argv[2];
const steps = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
// test defaults: low graphics (fast software rendering) and the first-run quick start dismissed
await page.addInitScript((q) => {
  try {
    const k = 'greenfn.profile.v1';
    const d = JSON.parse(localStorage.getItem(k) || '{"v":1}');
    d.tutorialSeen = true;
    d.settings = d.settings || {};
    d.settings.graphics = Object.assign({}, d.settings.graphics, { quality: q });
    localStorage.setItem(k, JSON.stringify(d));
  } catch (e) {}
}, process.env.Q || 'low');
await page.goto(`http://localhost:${process.env.PORT || 8080}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__gfn, null, { timeout: 20000 });
await page.waitForTimeout(800);
let i = 0;
const held = new Set();
for (const st of steps) {
  if (st.pre) await page.evaluate(st.pre);
  if (st.reload) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__gfn, null, { timeout: 30000 });
    await page.waitForTimeout(500);
  }
  if (st.click) await page.click(st.click, { timeout: 30000 });
  if (st.keys) {
    for (const k of [...held]) if (!st.keys.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of st.keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  }
  if (st.press) await page.keyboard.press(st.press);
  if (st.sim) await page.evaluate((t) => window.__gfn.simulate(t), st.sim);
  if (st.wait) await page.waitForTimeout(st.wait);
  if (st.eval) { const r = await page.evaluate(st.eval); if (r !== undefined && r !== null) console.log(`eval[${i}]:`, JSON.stringify(r)); }
  if (st.shot) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png` });
  }
  i++;
}
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
