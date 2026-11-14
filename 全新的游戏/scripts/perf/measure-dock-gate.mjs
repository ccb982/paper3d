// 验证：program 未就绪 → 落地用粗块（不切精细），就绪后自动切
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const mk = () => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: Array.from({ length: 30 }, () => Array(30).fill(null)), ship: Array.from({ length: 8 }, () => Array(10).fill(null)), player: Array.from({ length: 4 }, () => Array(6).fill(null)) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false },
  outOfRun: { owned: {} },
  story: { flags: {}, events: {} },
});

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5173/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());

// ★ 关键测试：进战场后**立刻**按 F（program 还没编译完，闸门应关闭）
await new Promise((r) => setTimeout(r, 1500));
const before = await page.evaluate(() => ({
  gateOpen: window.__ppMode().chunks.fineGateOpen,
  prog: window.__ppMode().renderer.info.programs.length,
}));
console.log('按 F 前：gateOpen=', before.gateOpen, ' program 数=', before.prog);

await page.evaluate(() => {
  window.__long = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: +e.startTime.toFixed(0), d: +e.duration.toFixed(0) }); });
  po.observe({ entryTypes: ['longtask'] });
});
await page.evaluate(() => window.__ppMode().requestDock(false));

// 观察：approach 期间闸门是否还关着（=用粗块）
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const st = await page.evaluate(() => ({
    gate: window.__ppMode().chunks.fineGateOpen,
    coarse: window.__ppMode().chunks.coarseOnly,
    phase: window.__ppMode().phase,
    prog: window.__ppMode().renderer.info.programs.length,
  }));
  console.log(`  ${(i + 1) * 1.5}s`, JSON.stringify(st));
  if (st.gate && st.phase === 'explore') break;
}

const out = await page.evaluate(() => ({ long: window.__long }));
await browser.close();
console.log('=== 长任务 ===');
for (const l of out.long.sort((a, b) => b.d - a.d).slice(0, 6)) console.log(JSON.stringify(l));
