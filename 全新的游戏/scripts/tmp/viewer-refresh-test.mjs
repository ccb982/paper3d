import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox','--disable-gpu-sandbox','--window-size=1560,900'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1560, height: 900 });
await page.goto('http://127.0.0.1:5199/terrain-viewer.html', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
const before = await page.$eval('#stats', (el) => el.textContent.slice(0, 60));
await page.click('#refresh');
await new Promise((r) => setTimeout(r, 1500));
const hint = await page.$eval('#hint', (el) => el.textContent);
const btn = await page.$eval('#refresh', (el) => el.textContent);
const after = await page.$eval('#stats', (el) => el.textContent.slice(0, 60));
console.log(JSON.stringify({ btn, hint, statsSame: before === after, before }, null, 2));
await page.screenshot({ path: 'scripts/tmp/viewer-refresh.png' });
await browser.close();
