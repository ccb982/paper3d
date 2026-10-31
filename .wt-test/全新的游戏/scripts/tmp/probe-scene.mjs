// 场景测绘：ASCII 地形图（墙B/水~/高#/坡+/平.）+ 工兵队位置/订单目标/认领点
// 用法：node scripts/tmp/probe-scene.mjs [seed]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const SEED = Number(process.argv[2]) || 4242;
const WAIT = Number(process.argv[3]) || 45000;
const OUT = '.workbuddy/tmp/2026-09-23_eng-snap';
mkdirSync(OUT, { recursive: true });
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
const t0 = Date.now();
while (Date.now() - t0 < WAIT) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.1);

const out = await page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm, M = window.__ppMode();
  const pm = M.player.position;
  const ship = { x: 30, z: 30 };   // 会话恒定（探针同口径）
  const squads = [];
  for (const s of sw.squads.all()) {
    if (!s.builders) continue;
    let cx = 0, cz = 0, n = 0;
    for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
    cx /= n; cz /= n;
    const st = sw.tactics.board.get(s.id);
    const o = st?.order;
    const corr = st?.corridor ?? o?.corridor;
    const fidx = c.corps.focus.get(s.id), aidx = c.corps.assign.get(s.id);
    const fp = fidx !== undefined && c.buildPieces[fidx] ? c.buildPieces[fidx] : null;
    const ap = aidx !== undefined && aidx >= 0 && c.buildPieces[aidx] ? c.buildPieces[aidx] : null;
    let tks = [];
    for (const [uid] of s.members) {
      const t = c.memberTasks.taskOf(uid);
      tks.push(t ? `${t.x | 0},${t.z | 0}` : '-');
    }
    const near = [];
    for (const q of c.buildPieces) {
      const d = Math.hypot(q.x - cx, q.z - cz);
      if (d < 40) near.push(`${q.kind}${q.pri}@${q.x | 0},${q.z | 0}${c.corps.built.has(`${q.x},${q.z}`) ? '*' : ''}${c.corps.gated(q) ? 'g' : ''}d${d | 0}`);
    }
    squads.push({
      id: s.id, n, x: +cx.toFixed(1), z: +cz.toFixed(1),
      kind: o?.kind ?? '-', tgt: o?.target ? `${o.target.x | 0},${o.target.z | 0}` : '-',
      goal: st?.pathGoalX !== undefined ? `${st.pathGoalX | 0},${st.pathGoalZ | 0}` : '-',
      corr: Array.isArray(corr) ? `${corr.length}点 首${corr[0]?.x | 0},${corr[0]?.z | 0} 末${corr[corr.length - 1]?.x | 0},${corr[corr.length - 1]?.z | 0}` : '-',
      focus: fp ? `${fp.kind}${fp.pri}@${fp.x | 0},${fp.z | 0}${c.corps.built.has(`${fp.x},${fp.z}`) ? '*已建' : ''}` : '-',
      assign: ap ? `${ap.kind}${ap.pri}@${ap.x | 0},${ap.z | 0}` : '-',
      tasks: tks.join('|'), near: near.slice(0, 8).join(' '),
    });
  }
  // ASCII 地形图（以第一支工兵队为中心；墙B 水~ 高#(>4m) 坡+(>1.5m) 平. 空' '）
  const bx = squads.length ? squads[0].x : pm.x, bz = squads.length ? squads[0].z : pm.z;
  const X0 = Math.round(bx) - 160, X1 = Math.round(bx) + 60, Z0 = Math.round(bz) - 90, Z1 = Math.round(bz) + 90;
  const lines = [`图 x∈[${X0},${X1}] z∈[${Z0},${Z1}] 步4m；列标=十位数字`];
  let colHdr = '     ';
  for (let x = X0; x <= X1; x += 4) colHdr += (Math.abs(Math.round(x / 10)) % 10);
  lines.push(colHdr);
  for (let z = Z0; z <= Z1; z += 6) {
    let row = String(z).padStart(4, ' ') + ' ';
    for (let x = X0; x <= X1; x += 4) {
      let ch;
      if (c.blockedAt(x, z)) ch = 'B';
      else if (c.isWaterAt(x, z)) ch = '~';
      else {
        const f = c.terrainScore.featsAt(x, z, pm.x, pm.z);
        if (!f) ch = '?';
        else if (!f.pass) ch = 'x';
        else if (f.h > 4) ch = '#';
        else if (f.h > 1.5) ch = '+';
        else ch = '.';
      }
      for (const s of squads) {
        if (Math.hypot(s.x - x, s.z - z) < 3.5) ch = 'S';
        if (s.tgt !== '-' ) { const [tx, tz] = s.tgt.split(',').map(Number); if (Math.hypot(tx - x, tz - z) < 3.5) ch = '@'; }
        if (s.goal !== '-') { const [tx, tz] = s.goal.split(',').map(Number); if (Math.hypot(tx - x, tz - z) < 3.5) ch = 'G'; }
      }
      if (Math.hypot(pm.x - x, pm.z - z) < 3.5) ch = 'P';
      if (Math.hypot(ship.x - x, ship.z - z) < 3.5) ch = 'H';
      row += ch;
    }
    lines.push(row);
  }
  const fort = c.fortify;
  const fclaims = fort ? [...fort.claims].map(([id, sec]) => {
    const t = fort.sectorPoint ? fort.sectorPoint(sec) : null;
    return `#${id}->S${sec}${t ? `:${t.x | 0},${t.z | 0}` : ''}`;
  }) : [];
  return {
    squads, fclaims,
    ship, pm: { x: +pm.x.toFixed(0), z: +pm.z.toFixed(0) },
    map: lines.join('\n'),
    pass: c.passTable?.stats ?? null,
  };
});
console.log(`seed ${SEED} 船(会话)${out.ship.x},${out.ship.z} 玩家${out.pm.x},${out.pm.z} 表=${JSON.stringify(out.pass)}`);
console.log('认领: ' + out.fclaims.join(' '));
for (const s of out.squads) console.log(`队${s.id} n=${s.n} 位${s.x},${s.z} 令${s.kind}→${s.tgt} 目标${s.goal} 走廊${s.corr}`);
console.log(out.map);
writeFileSync(`${OUT}/scene-${SEED}.txt`, out.map + '\n\n' + JSON.stringify(out.squads, null, 1) + '\n' + out.fclaims.join(' '));
console.log(`已存 ${OUT}/scene-${SEED}.txt`);
await page.close();
await browser.close();
