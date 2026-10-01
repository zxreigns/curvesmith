import { chromium } from 'playwright-core';
import fs from 'node:fs';
const B = 'https://curvesmith.vercel.app';
const burner = fs.readFileSync('/tmp/qa2/burner.json', 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((b) => { localStorage.setItem('curvesmith:burner', b); localStorage.setItem('curvesmith:wallet', 'Burner wallet'); localStorage.setItem('curvesmith:autofund:CvVxJC6ABCw3781neD2KKzH6c8aH2RztkNkvd8yW7bfK', '1'); }, burner);
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push('console: ' + m.text().slice(0, 200)));
const toasts = async () => (await page.locator('.toast').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 200));
await page.goto(B + '/#/pool/' + process.argv[2], { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
console.log('wallet', await page.locator('.wallet-btn').innerText().catch(() => 'none'));
await page.click('button:has-text("0.1")');
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/qa2/buy-1.png' });
await page.click('button.btn.primary.block.lg');
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1500); const t = await toasts(); if (t.some((x) => x.startsWith('✓') || /fail|error/i.test(x))) break; }
console.log('after buy', await toasts());
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/qa2/buy-2.png' });
// sell half
await page.click('.seg button:has-text("Sell"), button:has-text("Sell")');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/qa2/sell-1.png' });
console.log(JSON.stringify(logs.slice(0, 10)));
await browser.close();
