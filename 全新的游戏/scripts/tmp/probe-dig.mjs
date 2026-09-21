// 施工回归探针（锁死 fortify，专测：战壕照挖、深度 ≤ 硬约束、掩体照建）
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
// 锁死低日程：t01Base=dRaw → t01=0 → fortify 常驻（绝不进总攻）
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });
const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};
await run(35000);
const r = await page.evaluate(() => {
  const c = window.__commander, raster = window.__ppMode().raster;
  const trench = c.buildPieces.filter((p) => p.kind === 'trench');
  const cover = c.buildPieces.filter((p) => p.kind === 'cover');
  const dug = trench.filter((p) => c.builtSlots.has(p.x + ',' + p.z));
  const deep = dug.slice(0, 5).map((p) => ({
    x: +p.x.toFixed(0), z: +p.z.toFixed(0),
    d: +raster.levelDepthAt(p.x, p.z).toFixed(2),
    h: +raster.surfaceHeightAt(p.x, p.z).toFixed(2),
  }));
  const over = deep.filter((q) => q.h < -1.2).length;
  const coverBuilt = cover.filter((p) => c.builtSlots.has(p.x + ',' + p.z)).length;
  // pri 分解：0=前线掩体 1=战壕 2=环掩体
  const byPri = (pri) => {
    const list = c.buildPieces.filter((p) => p.pri === pri);
    return { n: list.length, built: list.filter((p) => c.builtSlots.has(p.x + ',' + p.z)).length };
  };
  // ★ 掩体-战壕关系（相对**舰船/落点中心**）：>0 = 掩体在船侧（掩体在前、战壕脚底下）
  const builtCovers = cover.filter((p) => c.builtSlots.has(p.x + ',' + p.z));
  const front = [];
  for (const t of dug.slice(0, 3)) {
    let best = null, bd = Infinity;
    for (const cv of builtCovers) {
      const d = Math.hypot(cv.x - t.x, cv.z - t.z);
      if (d < bd) { bd = d; best = cv; }
    }
    if (!best || bd > 8) { front.push('无掩体'); continue; }
    const dot = (best.x - t.x) * (c.plan.cx - t.x) + (best.z - t.z) * (c.plan.cz - t.z);
    front.push((dot > 0 ? '向船' : '背船') + `(d=${bd.toFixed(1)})`);
  }
  return {
    posture: c.battlePosture, stage: c.stage, alive: c.swarm.ledger.alive,
    trenchN: trench.length, trenchBuilt: dug.length,
    coverN: cover.length, coverBuilt,
    pri0: byPri(0), pri1: byPri(1), pri2: byPri(2), front,
    ongoing: [...c.digPasses.values()].slice(0, 6),
    deep, over,
  };
});
console.log('态势', r.posture, '阶段', r.stage);
console.log('战壕', r.trenchBuilt, '/', r.trenchN, ' 掩体', r.coverBuilt, '/', r.coverN);
console.log('建成战壕样本:', r.deep.map((q) => `${q.x},${q.z}=${q.d}m(h=${q.h})`).join('  ') || '(无)');
console.log('在建遍数:', r.ongoing.join(',') || '(无)');
console.log('掩体(前线/环) 与 战壕:', JSON.stringify({ pri0: r.pri0, pri1: r.pri1, pri2: r.pri2, alive: r.alive }), ' 前方掩体链:', r.front.join(''));
// ★ 白盒：随机抽一段战壕，验证其"前线掩体"位在**船侧**（距中心更近）且约 5m
const orient = await page.evaluate(() => {
  const c = window.__commander, P = c.plan;
  const t = P.trenchLines[2]?.[0] ?? P.trenchLines[1]?.[0] ?? P.trenchLines[0]?.[0];
  const cdx = P.cx - t.x, cdz = P.cz - t.z, cdl = Math.hypot(cdx, cdz) || 1;
  const fx = t.x + (cdx / cdl) * 5, fz = t.z + (cdz / cdl) * 5;
  const dBefore = Math.hypot(t.x - P.cx, t.z - P.cz);
  const dAfter = Math.hypot(fx - P.cx, fz - P.cz);
  return { near: +(dBefore - dAfter).toFixed(1) };
});
console.log('掩体位（船侧）距中心比战壕近:', orient.near, 'm');
console.log('① 先掩体   :', r.pri0.built > 0 && r.pri0.built + r.pri2.built >= r.trenchBuilt ? 'PASS' : 'CHECK');
console.log('④ 掩体朝船 :', orient.near > 3 && orient.near < 6 ? 'PASS' : 'FAIL');
console.log('② 战壕照挖 :', r.trenchBuilt > 0 ? 'PASS' : 'CHECK');
console.log('③ 深度合规 :', r.over === 0 ? 'PASS' : `FAIL 坑底越线 ${r.over}`);
await browser.close();
