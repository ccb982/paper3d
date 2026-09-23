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
// ★ 换种子实时切换（输入框改值 → applySeed）
await page.evaluate(() => {
  const inp = document.querySelector('input');
  if (inp) inp.value = '99';
  window.__rts.select.applySeed();
});
await new Promise((r) => setTimeout(r, 2500));
const seed2 = await page.evaluate(() => window.__rts?.raster?.worldSeed ?? null);
console.log('换图后 seed =', seed2);
await page.screenshot({ path: '../rts/sel-seed99.png' });
await page.evaluate(() => {
  const inp = document.querySelector('input');
  if (inp) inp.value = '4242';
  window.__rts.select.applySeed();
});
await new Promise((r) => setTimeout(r, 2500));
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
await new Promise((r) => setTimeout(r, 800));
console.log('B-0 0.8s =', JSON.stringify(await page.evaluate(() => {
  const sw = window.__rts?.swarm;
  const n0 = sw?.pool?.count ?? null;
  let ok = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    try {
      const r = sw.spawn({ mobIndex: i % 2, x: 60 + Math.cos(a) * 30, y: 0, z: -40 + Math.sin(a) * 30, hp: 50, maxHp: 50, defense: 1, attackPower: 1, speed: 4.5, meleeDamage: 2, meleeRange: 1.5, scale: 1.6, tier: 1, aggro: 0, wanderSpeed: 1.2 }, true);
      if (r >= 0) ok++;
    } catch (e) { ok = -999; break; }
  }
  return { n0, spawned: ok, n1: sw?.pool?.count ?? null };
})));
await new Promise((r) => setTimeout(r, 1500));
console.log('B-0b 2.3s =', JSON.stringify(await page.evaluate(() => ({ n: window.__rts?.swarm?.pool?.count ?? null }))));
await new Promise((r) => setTimeout(r, 1500));
console.log('B0 3s =', JSON.stringify(await page.evaluate(() => {
  const sw = window.__rts?.swarm;
  const n0 = sw?.pool?.count ?? null;
  let ret = null;
  try {
    ret = sw.spawn({ mobIndex: 0, x: 60, y: 0, z: -40, hp: 22, maxHp: 22, defense: 0, attackPower: 0, speed: 4.5, meleeDamage: 2, meleeRange: 1.5, scale: 1.6, tier: 1, aggro: 0, wanderSpeed: 1.2 }, true);
  } catch (e) { ret = 'ERR:' + String(e).slice(0, 120); }
  return { phase: window.__rts?.phase ?? null, n0, n1: sw?.pool?.count ?? null, ret };
})));
await new Promise((r) => setTimeout(r, 22000));
  const world = await page.evaluate(() => ({
    phase: window.__rts?.phase ?? null,
    drawCalls: window.__rts?.renderer?.info?.render?.calls ?? null,
    triangles: window.__rts?.renderer?.info?.render?.triangles ?? null,
    fine: window.__rts?.chunks?.meshes?.size ?? null,
    coarse: window.__rts?.chunks?.coarseMeshes?.size ?? null,
    vis: window.__rts?.chunks?.terrainVisuals?.size ?? null,
    swarmN: window.__rts?.swarm?.pool?.count ?? null,
    swarmAlive: (() => { const p = window.__rts?.swarm?.pool; if (!p) return null; let n = 0; for (let i = 0; i < p.count; i++) if (p.hp[i] > 0) n++; return n; })(),
    cam: window.__rts?.cam ?? null,
  }));
  console.log('B 世界 =', JSON.stringify(world));
  await page.screenshot({ path: '../rts/world.png' });
} catch (err) {
  console.log('SMOKE ERROR =', String(err).slice(0, 300));
}
console.log('errors =', errs.length ? errs.slice(0, 5).join('\n') : '(none)');
await browser.close();
