// ★ 地形坑洞管线端到端验证：
//   ① L1 = 纯初始（挖掘后语义类不变） ② 独立掩码 HoleMask 吸收破坏（含初始破坏）
//   ③ 敌用动态公式表 HoleTable 打分（深×近；digRect → onTerrainDig → 掩码窗扫 → 2Hz 重排）
//   ④ 任意挖掘（玩家子弹/工程兵共用 onTerrainDig）→ L3 战壕表也标记（玩家挖的坑也算战壕）
// 前置：npm run dev（vite 5173）
// 运行：node scripts/tmp/l1-trench-e2e.mjs [seed]
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({
  meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1560,900'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.text().startsWith('[L1]')) console.log(m.text().slice(0, 150)); });
await page.setViewport({ width: 1560, height: 900 });
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&l1view=1&l1dbg=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__l1 && !!window.__holeMask && !!window.__holeTable', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
const run = (fn, ...args) => page.evaluate(fn, ...args);

const before = await run(() => {
  const l = window.__l1, m = window.__holeMask, t = window.__holeTable, a = m.anchor;
  let dug = 0;
  for (let iz = 0; iz < 288; iz++) for (let ix = 0; ix < 288; ix++) {
    if (m.depthAt(a.x - 144 + ix + 0.5, a.z - 144 + iz + 0.5) >= 0.15) dug++;
  }
  return {
    l1Ready: l.isReady,
    maskDug: dug,                               // 初始破坏（落地前已存在）
    holes: t.holes.length,
    topScore: +(t.holes[0]?.score ?? 0).toFixed(3),
    topDepth: +(t.holes[0]?.maxDepth ?? 0).toFixed(2),
    clsBefore: l.classAt(a.x + 28, a.z - 16),
  };
});
console.log('① 初始 →', JSON.stringify(before));

// ★ 模拟敌人战壕路径：digRect → ChunkManager.onTerrainDig → holeMaskDirty → 全表重扫 → 2Hz 重排
const spots = await run(() => {
  const a = window.__l1.anchor;
  return [[a.x + 28, a.z - 16], [a.x - 36, a.z + 12], [a.x + 40, a.z + 30]];
});
let dugCalls = 0;
for (const [x, z] of spots) {
  for (let k = 0; k < 2; k++) {
    const ok = await run((X, Z) => {
      const m = window.__ppMode();
      return !!(m.chunks && m.chunks.digRect) && !!m.chunks.digRect(X, Z, 4, 2);
    }, x, z);
    if (ok) dugCalls++;
  }
}
console.log('② digRect 成功调用', dugCalls, '次');
await new Promise((r) => setTimeout(r, 2600));   // 等 1 拍掩码全表重扫 + 2Hz 表重排
const after = await run(() => {
  const l = window.__l1, m = window.__holeMask, t = window.__holeTable, a = m.anchor;
  const raster = window.__ppMode().raster;
  let dug = 0;
  for (let iz = 0; iz < 288; iz++) for (let ix = 0; ix < 288; ix++) {
    if (m.depthAt(a.x - 144 + ix + 0.5, a.z - 144 + iz + 0.5) >= 0.15) dug++;
  }
  // 同口径对账：采样点吸附到 4m 格心（掩码就是按格心采样 levelDepth 的）
  // 三个挖点各自 ±8m 邻域：统计 max 深 + 逐格掩码↔真源差
  const sx = a.x - 144, sz = a.z - 144;
  const spots = [[a.x + 28, a.z - 16], [a.x - 36, a.z + 12], [a.x + 40, a.z + 30]];
  let spotMaxDepth = 0, mismatches = 0, pairs = 0;
  for (const [px, pz] of spots) {
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      const wx = sx + Math.floor(px + dx - sx) + 0.5;
      const wz = sz + Math.floor(pz + dz - sz) + 0.5;
      const md = m.depthAt(wx, wz);
      const rd = Math.max(0, raster.levelDepthAt(wx, wz));
      pairs++;
      if (Math.abs(md - rd) > 0.06) mismatches++;
      if (md > spotMaxDepth) spotMaxDepth = md;
    }
  }
  // ④ L3 战壕表：任意挖掘也应标记（玩家子弹与 digRect 共用 onTerrainDig）
  const ts = window.__swarm?.commander?.terrainScore;
  let trenchNear = 0, tsDbg = { has: !!ts };
  if (ts) {
    tsDbg.ready = ts.ready; tsDbg.stamp = ts.stamp;
    tsDbg.atSpot = ts.isTrenchAt(spots[0][0], spots[0][1]);
    tsDbg.passAtSpot = ts.isPassableAt ? ts.isPassableAt(spots[0][0], spots[0][1]) : 'n/a';
    for (const [px, pz] of spots) {
      for (let dx = -8; dx <= 8; dx += 2) for (let dz = -8; dz <= 8; dz += 2) {
        if (ts.isTrenchAt(px + dx, pz + dz)) trenchNear++;
      }
    }
  }
  return {
    maskDug: dug,
    spotMaxDepth: +spotMaxDepth.toFixed(3),
    mismatches, pairs, trenchNear, tsDbg,
    depth1: +m.depthAt(sx + Math.floor(a.x + 28 - sx) + 0.5,
      sz + Math.floor(a.z - 16 - sz) + 0.5).toFixed(3),
    holes: t.holes.length,
    topScore: +(t.holes[0]?.score ?? 0).toFixed(3),
    hasDugHole: t.holes.some((h) => h.maxDepth >= 0.3),
    clsAfter: l.classAt(a.x + 28, a.z - 16),
    farDepth: +m.depthAt(a.x + 150, a.z + 150).toFixed(2),
  };
});
console.log('③ 挖掘后 →', JSON.stringify(after, null, 1));

// ④ 玩家子弹路径（CombatSystem → resolveImpact → playBulletImpact → onTerrainDig）：
//    "玩家挖的，敌人也能看见"（敌人读 HoleTable + TerrainScore 战壕表）
const pb = await run(() => {
  const m = window.__ppMode();
  const px = m.player.position.x, pz = m.player.position.z;
  const raster = m.raster;
  const cand = [];
  for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [6, 6], [-6, -6], [10, 0], [0, -10]]) {
    const x = px + dx, z = pz + dz;
    if (raster.tileDefAt(x, z).genRole !== 'ground') continue;
    cand.push([x, z]);
  }
  // ★ 坑洞"逐级缩小"（坡降 0.5m/层）：必须成片挖（3×3 格心、1m 间距），逐遍加深；
  //   单点连打只会停在 ~2 层（顶部面积不够，下层挖不动）
  const shot = (x, z) => m.chunks.playBulletImpact(m.chunks.resolveImpact(x, raster.surfaceHeightAt(x, z), z));
  const trace = [];
  if (cand.length) {
    const [x, z] = cand[0];
    for (let pass = 1; pass <= 4; pass++) {
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) shot(x + dx, z + dz);
      trace.push({ pass, depth: +raster.levelDepthAt(x, z).toFixed(3) });
    }
  }
  for (let i = 1; i < cand.length; i++) {   // 其余候选点各 2 遍（多点验证）
    const [x, z] = cand[i];
    for (let pass = 0; pass < 2; pass++) {
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) shot(x + dx, z + dz);
    }
  }
  return { cand, px, pz, trace };
});
await new Promise((r) => setTimeout(r, 2600));   // 等 2Hz 工事表重排
const pbAfter = await run((cand) => {
  const mask = window.__holeMask, t = window.__holeTable;
  const ts = window.__swarm?.commander?.terrainScore;
  let dugMax = 0, spot = null;
  for (const [x, z] of cand) { const d = mask.depthAt(x, z); if (d > dugMax) { dugMax = d; spot = [x, z]; } }
  let scoreAtSpot = 0, holesNear = 0, trench = 0;
  if (spot) {
    scoreAtSpot = t.scoreAt(spot[0], spot[1]);
    holesNear = t.holes.filter((h) => Math.hypot(h.cx - spot[0], h.cz - spot[1]) < 12).length;
    if (ts) {
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        if (ts.isTrenchAt(spot[0] + dx, spot[1] + dz)) trench++;
      }
    }
  }
  return { spots: cand.length, dugMax: +dugMax.toFixed(2), scoreAtSpot: +scoreAtSpot.toFixed(3), holesNear, trench };
}, pb.cand);
console.log('④ 玩家子弹 →', JSON.stringify(pbAfter));
console.log('   trace =', JSON.stringify(pb.trace));

const checks = [
  ['digRect 生效（调用 >0）', dugCalls > 0],
  ['挖点邻域掩码记深（≥0.15m）', after.spotMaxDepth >= 0.15],
  ['掩码与真源 levelDepth 逐格同源（邻域差=0）', after.mismatches === 0],
  ['掩码破坏格数增长', after.maskDug > before.maskDug],
  ['L1 语义类不受挖掘影响（纯初始）', after.clsAfter === before.clsBefore],
  ['坑洞表出现深坑条目（≥0.3m）', after.holes === 0 || after.hasDugHole],
  ['坑洞表分数在 [0,1]', after.topScore >= 0 && after.topScore <= 1],
  ['表外深度 = 0', after.farDepth === 0],
  ['任意挖掘 → L3 战壕表标记（玩家挖的坑也算战壕）', after.trenchNear > 0],
  ['玩家子弹能挖深（≥0.4m）', pbAfter.dugMax >= 0.4],
  ['敌人工事表看得见玩家挖的坑（分>0 或洞邻近）', pbAfter.scoreAtSpot > 0 || pbAfter.holesNear > 0],
  ['敌人战壕表看得见玩家挖的坑', pbAfter.trench > 0],
];
let fail = 0;
for (const [msg, okk] of checks) { console.log(okk ? '  PASS ' + msg : '  FAIL ' + msg); if (!okk) fail++; }
await page.screenshot({ path: 'scripts/tmp/l1-trench-e2e.png' });
await browser.close();
console.log(fail === 0 ? 'DONE ✓' : `DONE ✗（${fail} 项失败）`);
process.exit(fail === 0 ? 0 : 1);
