import puppeteer from 'puppeteer-core';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 300 });
await page.goto('http://localhost:5174/?seed=4242&x=132&z=-198', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.spawner, { timeout: 240000, polling: 500 });
await page.evaluate(() => { window.__setSpeed(50); const w = window.__rts; setInterval(() => { w.cam.tx = w.hooks.shipX; w.cam.tz = w.hooks.shipZ; }, 500); });
for (let k = 0; k < 3; k++) {
  await new Promise((r) => setTimeout(r, 50000));
  const got = await page.evaluate(() => {
    const w = window.__rts; const st = w.spawner.tierStash;
    let n = 0, ghost = 0, hidden = 0, noBar = 0;
    for (const [, e] of st) {
      n++;
      const hb = e.fx?.get?.('health');
      if (!hb || !hb.group) { noBar++; continue; }
      if (hb.group.visible === false) hidden++; else ghost++;
    }
    return `T=${Math.round(w.simT)}s 收纳=${n} 血条已藏=${hidden} 幽灵=${ghost} 无血条=${noBar}`;
  });
  console.log(got);
}
await browser.close();
