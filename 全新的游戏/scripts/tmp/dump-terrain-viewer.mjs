// ============================================================
// 生成「地形表可视化」自包含网页
//   左排 = 新 L1 语义表；右排 = 地形**创建时**的原始地形表（地块/基准高度/结构语义）
// 前置：npm run dev -- --port 5199 --strictPort
// 运行：node scripts/tmp/dump-terrain-viewer.mjs
// 产物：terrain-viewer.html（双击即可打开；数据已内嵌）
// ============================================================
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
page.on('console', (m) => { if (m.text().startsWith('[L1]')) console.log(m.text().slice(0, 150)); });
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession());
await page.goto('http://localhost:5199/?perf=1&swarmdbg=1&l1dbg=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__l1', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));

const data = await page.evaluate(() => {
  const l1 = window.__l1;
  const mode = window.__ppMode();
  const raster = mode.raster;              // TS private → 运行时可取（调试页专用）
  const anchor = l1.anchor;
  const side = 73, cell = 4, R = 144;
  const sx = anchor.x - R, sz = anchor.z - R;
  const N = side * side;
  const xy = (i) => { const ix = i % side, iz = (i - ix) / side; return [sx + ix * cell + cell / 2, sz + iz * cell + cell / 2]; };
  // ---- L1 ----
  const l1cls = new Array(N), aspect = new Array(N), slope = new Array(N), blocked = new Array(N), pass = new Array(N), region = new Array(N), width = new Array(N), dhx = new Array(N), dhz = new Array(N);
  const o = { x: 0, z: 0 };
  for (let i = 0; i < N; i++) {
    const [x, z] = xy(i);
    l1cls[i] = l1.classAt(x, z);
    aspect[i] = Math.round(l1.aspectAt(x, z) * 1000) / 1000;
    slope[i] = Math.round(l1.slopeAt(x, z) * 1000) / 1000;
    blocked[i] = l1.losBlockedAt(x, z) ? 1 : 0;
    pass[i] = l1.isPassableAt(x, z) ? 1 : 0;
    region[i] = l1.regionIdAt(x, z);
    width[i] = Math.round(l1.widthAt(x, z) * 1000) / 1000;
    l1.downhillInto(x, z, o);
    dhx[i] = Math.round(o.x * 1000) / 1000; dhz[i] = Math.round(o.z * 1000) / 1000;
  }
  // ---- 创建时原始地形 ----
  const base = new Array(N), cur = new Array(N), role = new Array(N), color = new Array(N), keyIdx = new Array(N);
  const keys = [];
  const keyMap = new Map();
  const roleNames = { ground: 0, platform: 1, liquid: 2, pit: 3, '': 4 };
  for (let i = 0; i < N; i++) {
    const [x, z] = xy(i);
    base[i] = Math.round(raster.baseSurfaceHeightAt(x, z) * 100) / 100;
    cur[i] = Math.round(raster.surfaceHeightAt(x, z) * 100) / 100;
    const td = raster.tileDefAt(x, z);
    role[i] = roleNames[td.genRole] ?? 4;
    const c = raster.terrainColorAt(x, z);
    color[i] = (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
    let ki = keyMap.get(td.key);
    if (ki === undefined) { ki = keys.length; keys.push(td.key); keyMap.set(td.key, ki); }
    keyIdx[i] = ki;
  }
  // ---- 统计 ----
  const names = ['中性', '高地', '低谷', '迎船坡', '背船坡', '关口', '走廊', '开阔地', '隐蔽', '陡壁', '水', '坑'];
  const hist = {}; for (const n of names) hist[n] = 0;
  for (const c of l1cls) hist[names[c]]++;
  const roleHist = [0, 0, 0, 0, 0];
  for (const r of role) roleHist[r]++;
  let bmin = 1e9, bmax = -1e9, dug = 0;
  for (let i = 0; i < N; i++) {
    bmin = Math.min(bmin, base[i]); bmax = Math.max(bmax, base[i]);
    if (Math.abs(cur[i] - base[i]) > 0.05) dug++;
  }
  const l1st = l1.stats();
  // 最多出现的 8 类地块（图例用）
  const keyCount = new Map();
  for (const ki of keyIdx) keyCount.set(ki, (keyCount.get(ki) ?? 0) + 1);
  const topKeys = [...keyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([ki, n]) => ({ key: keys[ki], n }));
  return {
    anchor: { x: anchor.x, z: anchor.z }, cell, side, keys, topKeys,
    l1: { cls: l1cls, aspect, slope, blocked, pass, region, width, dhx, dhz },
    gen: { base, cur, role, color, keyIdx, roleNames: ['ground', 'platform', 'liquid', 'pit', '?'] },
    statsText:
      `L1：构建 ${l1st.buildMs}ms · 区块 ${l1st.regionCount} · ` + names.map((n) => `${n} ${hist[n]}`).join(' / ') + '\n'
      + `创建时地形：基准高 [${bmin.toFixed(1)}, ${bmax.toFixed(1)}]m · genRole ` +
      `ground ${roleHist[0]} / platform ${roleHist[1]} / liquid ${roleHist[2]} / pit ${roleHist[3]}` +
      ` · 已被挖改 ${dug} 格（|当前-基准| > 0.05m）`,
  };
});

data.generatedAt = new Date().toLocaleString('zh-CN');
const tpl = fs.readFileSync('scripts/terrain-viewer-template.html', 'utf8');
const html = tpl.replace('/*__DATA__*/ null', JSON.stringify(data));
fs.writeFileSync('terrain-viewer.html', html);
console.log(`[viewer] terrain-viewer.html 已生成（${(html.length / 1024).toFixed(0)} KB）`);
await browser.close();
