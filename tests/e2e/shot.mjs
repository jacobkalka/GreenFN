// Usage: node tests/e2e/shot.mjs <out.png> [waitMs] [jsBeforeShot]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || 'shot.png';
const wait = Number(process.argv[3] || 2500);
const js = process.argv[4] || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${process.env.PORT || 8080}/`, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(600); }
await page.screenshot({ path: out });
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
