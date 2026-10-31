import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox','--disable-gpu-sandbox','--window-size=1560,1240','--allow-file-access-from-files'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1560, height: 1240 });
await page.goto('file:///C:/Users/22641/Desktop/%E6%9E%B6%E6%9E%84%E9%87%8D%E7%BD%AE/%E5%85%A8%E6%96%B0%E7%9A%84%E6%B8%B8%E6%88%8F/terrain-viewer.html', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'scripts/tmp/viewer-shot.png', fullPage: true });
console.log('shot ok');
await browser.close();
