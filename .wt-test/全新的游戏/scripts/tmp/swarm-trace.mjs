// 敌人轨迹取证：跑一局 → 冻结/绕圈排行 + 每队命令时间线 + 全局工程进度；存 swarm-trace.json
// 运行：node scripts/tmp/swarm-trace.mjs [seed] [wallSec] [simTarget]
//   wallSec = 墙上秒数上限（默认 60，勿超过 1 分钟）；simTarget = 模拟秒目标（默认 900）
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const WALL = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 60;
const SIM_TARGET = Number(process.argv[4]) > 0 ? Number(process.argv[4]) : 900;
const STEP = Number(process.argv[5]) > 0 ? Number(process.argv[5]) : 0.1;
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
  headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&swarmtrace=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__trace', { timeout: 120000 });
console.log(`推进模拟（墙上限 ${WALL}s，模拟目标 ${SIM_TARGET}s）…`);
let sim = 0;
const CHUNK = 10;
const tStart = Date.now();
while (sim < SIM_TARGET && Date.now() - tStart < WALL * 1000) {
  const t0 = Date.now();
  const d = Math.min(CHUNK, SIM_TARGET - sim);
  const done = await page.evaluate((s, st) => window.__ppRun(s, st), d, STEP);
  sim += done;
  const g = await page.evaluate(() => {
    const a = window.__trace.dump().globals;
    return a[a.length - 1] ?? null;
  });
  const err = await page.evaluate(() => (window.__ppLastError?.()) ?? null);
  const wp = await page.evaluate(() => { const w = window.__ppWp; return w ? { a: w.ai, e: w.entity, c: w.combat, u: w.ui, x: w.assembly, tot: w.total } : null; });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  if (g) console.log(`  sim=${sim}s p=${g.p} 已建=${g.built} 挖遍=${g.pass} 存活=${g.alive} (块${wall}s)${err ? ' ERR:' + err : ''}${wp ? ` WPai=${wp.a.toFixed(0)} asm=${wp.x.toFixed(0)}` : ''}`);
}

const dig = await page.evaluate(() => {
  const d = window.__trace.dump();
  const pr = d.probes;
  const digs = (d.events ?? []).filter((e) => e.kind === 'dig');
  const builds = (d.events ?? []).filter((e) => e.kind === 'build');
  const changed = pr.filter((p) => Math.abs(p.cur - p.base) >= 0.01);
  const dug = pr.filter((p) => p.cur >= 0.45);
  return {
    nProbes: pr.length, nDigs: digs.length, nBuilds: builds.length,
    firstDig: digs.length ? digs[0].t : -1, lastDig: digs.length ? digs[digs.length - 1].t : -1,
    totalPass: digs.reduce((t, x) => t + x.pass, 0),
    terrainChanged: changed.length, maxDelta: Math.max(0, ...changed.map((p) => Math.abs(p.cur - p.base))),
    dugDeep: dug.map((p) => ({ x: p.x, z: p.z, d: +p.cur.toFixed(2) })),
    digList: digs.slice(0, 20).map((e) => ({ t: e.t, x: e.x, z: e.z, pass: e.pass })),
    buildList: builds.slice(0, 20).map((e) => ({ t: e.t, x: e.x, z: e.z })),
  };
});
console.log('== 地形是否真变（权威 RasterMap.levelDepthAt 探针）==');
console.log('  探针 ' + dig.nProbes + ' 处施工块中心：变化 ' + dig.terrainChanged + ' 处，最大加深 ' + dig.maxDelta.toFixed(2) + 'm');
console.log('  深度 >= 0.45m（近似半人高战壕）的块: ' + JSON.stringify(dig.dugDeep));
console.log('== 挖坑/建块事件 ==');
console.log('  挖 ' + dig.nDigs + ' 次（总遍数 ' + dig.totalPass + '）：首次 @' + dig.firstDig + 's，末次 @' + dig.lastDig + 's；建块 ' + dig.nBuilds + ' 次');
console.log('  挖坑明细（前 20）：t | x,z | 第几遍');
for (const e of dig.digList) console.log('    ' + e.t + 's (' + e.x + ',' + e.z + ') pass' + e.pass);
console.log('  建块明细（前 20）：t | x,z');
for (const e of dig.buildList) console.log('    ' + e.t + 's (' + e.x + ',' + e.z + ')');
console.log('');
const sum = await page.evaluate(() => window.__trace.summary());
console.log('\n== 单位排行（冻结优先）==');
console.log('uid\trole\tsquad\tn\tpath\tnet\tfrozenS');
for (const r of sum.slice(0, 25)) console.log(`${r.uid}\t${r.role}\t${r.squad}\t${r.n}\t${r.path}\t${r.net}\t${r.frozenS}`);

const cov = await page.evaluate(() => window.__trace.dump().durS);
console.log(`
== 模拟覆盖：durS=${cov}s（墙上限 ${WALL}s）==`);
const g = await page.evaluate(() => window.__trace.dump().globals);
console.log('\n== 全局进度（每 15s 一行）==');
for (let i = 0; i < g.length; i += 15) {
  const r = g[i];
  console.log(`t=${r.t}s stage=${r.stage} p=${r.p} 已建=${r.built} 待建=${r.pieces} 挖遍=${r.pass} 存活=${r.alive} 玩家=(${r.px},${r.pz})`);
}

const sq = await page.evaluate(() => window.__trace.dump().squads);
console.log('\n== 小队命令线（每队最多 12 条；kind/mission/target/src）==');
for (const [id, arr] of Object.entries(sq)) {
  const tail = arr.slice(-12).map((s) => `[${s.t}s ${s.kind}/${s.mission}→(${s.tx},${s.tz}) ${s.src}]`).join(' ');
  console.log(`#${id}: ${tail}`);
}

const dump = await page.evaluate(() => window.__trace.dump());
fs.writeFileSync('scripts/tmp/swarm-trace.json', JSON.stringify(dump));
console.log('\n已存 scripts/tmp/swarm-trace.json');
await page.screenshot({ path: 'scripts/tmp/swarm-trace.png' });
await browser.close();
console.log('DONE');
