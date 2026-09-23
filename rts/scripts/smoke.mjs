// RTS 冒烟探针：开页面 → 等地形 → 收集错误 → 截图
// 用法（在 全新的游戏 目录跑，借用其 puppeteer-core）：node ../rts/scripts/smoke.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });
await page.goto('http://localhost:5174/?seed=4242&x=120&z=-80', { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise((r) => setTimeout(r, 20000));
const info = await page.evaluate(() => {
  const w = window;
  return {
    hasRts: !!w.__rts,
    drawCalls: w.__rts?.renderer?.info?.render?.calls ?? null,
    triangles: w.__rts?.renderer?.info?.render?.triangles ?? null,
    cam: w.__rts?.cam ? { x: +w.__rts.cam.tx.toFixed(0), z: +w.__rts.cam.tz.toFixed(0), dist: w.__rts.cam.dist } : null,
    children: w.__rts?.scene?.children?.length ?? null,
  };
});
console.log('info =', JSON.stringify(info));
console.log('errors =', errs.length ? errs.slice(0, 6).join('\n') : '(none)');
await page.screenshot({ path: '../rts/smoke.png' });
await browser.close();
