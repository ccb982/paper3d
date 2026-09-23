// RTS 冒烟探针（严格两阶段）：选点页 → 确认 → 世界加载
// 用法（在 全新的游戏 目录跑，借用其 puppeteer-core）：node scripts/tmp/smoke-rts.mjs
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
await page.goto('http://localhost:5175/?seed=4242', { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise((r) => setTimeout(r, 15000));
const sel = await page.evaluate(() => ({
  phase: window.__rts?.phase ?? null,
  hasSelect: !!window.__rts?.select,
  spawn: window.__rts?.select?.spawn ?? null,
  canvases: document.querySelectorAll('canvas').length,
}));
console.log('A 选点页 =', JSON.stringify(sel));
await page.screenshot({ path: '../rts/sel.png' });
try {
  const diag = await page.evaluate(() => ({
    phase: window.__rts?.phase ?? null,
    hasSel: !!window.__rts?.select,
    keys: window.__rts ? Object.keys(window.__rts) : [],
  }));
  console.log('诊断 =', JSON.stringify(diag));
  await page.evaluate(() => window.__rts.select.setCenter(-200, 170));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: '../rts/sel2.png' });
  await page.evaluate(() => window.__rts.select.confirmAt(60, -40));
  await new Promise((r) => setTimeout(r, 25000));
  const world = await page.evaluate(() => ({
    phase: window.__rts?.phase ?? null,
    drawCalls: window.__rts?.renderer?.info?.render?.calls ?? null,
    triangles: window.__rts?.renderer?.info?.render?.triangles ?? null,
  }));
  console.log('B 世界 =', JSON.stringify(world));
  await page.screenshot({ path: '../rts/world.png' });
} catch (err) {
  console.log('SMOKE ERROR =', String(err).slice(0, 300));
}
console.log('errors =', errs.length ? errs.slice(0, 5).join('\n') : '(none)');
await browser.close();
