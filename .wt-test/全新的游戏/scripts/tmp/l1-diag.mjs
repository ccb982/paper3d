import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: false, args: ['--no-sandbox','--disable-gpu-sandbox','--window-size=1280,800'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0,300)));
page.on('console', (m) => { const t=m.text(); if (!t.startsWith('THREE.') && m.type()!=='warning') console.log('[console]', t.slice(0,200)); });
await page.goto('http://localhost:5199/?l1dbg=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise((r)=>setTimeout(r, 15000));
const info = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  hooks: Object.keys(window).filter((k)=>k.startsWith('__pp')||k.startsWith('__l1')||k.startsWith('__swarm')),
  body: (document.body?.innerText||'').slice(0,300),
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'scripts/tmp/l1-diag.png' });
await browser.close();
