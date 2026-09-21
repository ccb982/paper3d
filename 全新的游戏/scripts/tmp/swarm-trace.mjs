// 敌人轨迹取证：跑一局 → 冻结/绕圈排行 + 每队命令时间线 + 全局工程进度；存 swarm-trace.json
// 运行：node scripts/tmp/swarm-trace.mjs [seed] [waitSec]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const WAIT = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 90;
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
  headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'],
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
console.log(`采样中… ${WAIT}s`);
await new Promise((r) => setTimeout(r, WAIT * 1000));

const sum = await page.evaluate(() => window.__trace.summary());
console.log('\n== 单位排行（冻结优先）==');
console.log('uid\trole\tsquad\tn\tpath\tnet\tfrozenS');
for (const r of sum.slice(0, 25)) console.log(`${r.uid}\t${r.role}\t${r.squad}\t${r.n}\t${r.path}\t${r.net}\t${r.frozenS}`);

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
