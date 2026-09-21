// ============================================================
// L1 真地形回读：进世界 → 等语义表构建 → 拉 stats + 关键区块（含舰船相对位置）
// 运行：先 `npm run dev -- --port 5199 --strictPort`，再 `node scripts/tmp/l1-readback.mjs`
// ============================================================
import puppeteer from 'puppeteer-core';

const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = () => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[L1]')) console.log(t);
});
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession());
await page.goto('http://localhost:5199/?perf=1&l1dbg=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());   // 落地 → 触发 S0 勘察 + L1 构建
await page.waitForFunction('!!window.__l1', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(() => {
  const l1 = window.__l1;
  const st = l1.stats();
  const regs = l1.regions();
  const a = st.anchor;
  const brief = (r) => ({
    id: r.id, area: r.area,
    rep: { x: Math.round(r.rx), z: Math.round(r.rz), dShip: Math.round(Math.hypot(r.rx - a.x, r.rz - a.z)) },
    h: [Math.round(r.minH * 10) / 10, Math.round(r.maxH * 10) / 10],
    aspect: Math.round(r.aspect * 100) / 100,
  });
  const top = (cls) => regs.filter((r) => r.cls === cls).sort((x, y) => y.area - x.area).slice(0, 5).map(brief);
  // 抽样：舰船 30~110m 环带内各类占比（敌人主要活动圈）
  const clsNames = ['中性', '高地', '低谷', '迎船坡', '背船坡', '关口', '走廊', '开阔地', '隐蔽', '陡壁', '水', '坑'];
  const band = {};
  for (const n of clsNames) band[n] = 0;
  let bandN = 0;
  for (let z = a.z - 144; z <= a.z + 144; z += 4) {
    for (let x = a.x - 144; x <= a.x + 144; x += 4) {
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < 30 || d > 110) continue;
      band[clsNames[l1.classAt(x, z)]]++;
      bandN++;
    }
  }
  // 可见率随距离（LOS 遮挡是否合理衰减）+ 抬升视线对照（+8m：仍被挡 → 逻辑可疑）
  const visBand = (d0, d1, lift) => {
    let vis = 0, n = 0;
    for (let dz = -d1; dz <= d1; dz += 6) {
      for (let dx = -d1; dx <= d1; dx += 6) {
        const d = Math.hypot(dx, dz);
        if (d < d0 || d > d1) continue;
        n++;
        let blocked = false;
        const x = a.x + dx, z = a.z + dz;
        const eyeH = l1.rawHeightAt(a.x, a.z) + 1.6 + lift;
        const targetH = l1.rawHeightAt(x, z) + 0.4;
        const steps = Math.max(2, Math.ceil(d / 2));
        for (let si = 1; si < steps; si++) {
          const t = si / steps;
          const lineH = eyeH + (targetH - eyeH) * t;
          if (l1.rawHeightAt(a.x + dx * t, a.z + dz * t) > lineH + 0.2) { blocked = true; break; }
        }
        if (!blocked) vis++;
      }
    }
    return n ? Math.round((vis / n) * 1000) / 10 : 0;
  };
  // 坡向核验：迎船坡平均 aspect > 0、背船坡 < 0（真地形）
  const aspStat = (cls) => {
    let sum = 0, n = 0;
    for (let z = a.z - 144; z <= a.z + 144; z += 4) {
      for (let x = a.x - 144; x <= a.x + 144; x += 4) {
        if (l1.classAt(x, z) !== cls) continue;
        sum += l1.aspectAt(x, z); n++;
      }
    }
    return { n, mean: n ? Math.round((sum / n) * 100) / 100 : 0 };
  };
  return {
    stats: st,
    slopeAspect: { 迎船坡: aspStat(3), 背船坡: aspStat(4) },
    visibility: { '30-60m': visBand(30, 60, 0), '60-90m': visBand(60, 90, 0), '90-120m': visBand(90, 120, 0), '120-144m': visBand(120, 144, 0), '30-144m_抬升8m': visBand(30, 144, 8) },
    top: {
      高地: top(1), 低谷: top(2), 迎船坡: top(3), 背船坡: top(4),
      关口: top(5), 走廊: top(6), 隐蔽: top(8),
    },
    band30_110: { cells: bandN, 占比: Object.fromEntries(Object.entries(band).map(([k, v]) => [k, Math.round((v / bandN) * 1000) / 10 + '%'])) },
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
