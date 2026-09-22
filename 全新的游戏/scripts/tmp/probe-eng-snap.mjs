// 工兵行动快照记录（水/山地差样本）：500ms 采样 → 原始轨迹 + 地形标注（水/高度/可走）
// 用法：node scripts/tmp/probe-eng-snap.mjs [seed1 seed2 ...]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const SEEDS = process.argv.slice(2).map(Number).filter((n) => n > 0);
const seeds = SEEDS.length ? SEEDS : [4242, 7, 99];
const OUT = '.workbuddy/tmp/2026-09-23_eng-snap';
mkdirSync(OUT, { recursive: true });
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });

const dump = (page) => page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm, pm = window.__ppMode().player.position;
  const T = c.terrainScore;
  const info = {}, traces = {}, tasks = {};
  for (const s of sw.squads.all()) {
    if (!s.builders) continue;
    for (const [uid, m] of s.members) {
      info[uid] = { sid: s.id, role: c.builderRoles.get(s.id) ?? '?', n: s.members.size, x: +m.x.toFixed(1), z: +m.z.toFixed(1) };
      const t = c.memberTasks.taskOf(uid);
      tasks[uid] = t ? { x: t.x, z: t.z } : null;
    }
  }
  for (const [uid, a] of window.__engTrk || new Map()) {
    if (info[uid]) traces[uid] = a.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  }
  const agg = [];
  for (const [uid, a] of Object.entries(traces)) {
    if (a.length < 4) continue;
    let path = 0, stall = 0, water = 0, inW = 0, hMin = 1e9, hMax = -1e9, dHSum = 0, dHN = 0, blocked = 0;
    const hAt = (x, z) => { const f = T.featsAt(x, z, pm.x, pm.z); return f && f.pass ? f.h : null; };
    for (let i = 0; i < a.length; i++) {
      const [x, z] = a[i];
      if (T.isWaterAt(x, z)) inW++;
      if (i === 0) continue;
      const d = Math.hypot(x - a[i - 1][0], z - a[i - 1][1]);
      path += d;
      if (d < 0.3) stall++;
      const mx = (x + a[i - 1][0]) / 2, mz = (z + a[i - 1][1]) / 2;
      if (T.isWaterAt(mx, mz)) water++;
      if (c.blockedAt(mx, mz)) blocked++;
      const h0 = hAt(a[i - 1][0], a[i - 1][1]), h1 = hAt(x, z);
      if (h0 !== null && h1 !== null) {
        if (h1 < hMin) hMin = h1; if (h1 > hMax) hMax = h1;
        dHSum += Math.abs(h1 - h0); dHN++;
      }
    }
    const net = Math.hypot(a[a.length - 1][0] - a[0][0], a[a.length - 1][1] - a[0][1]);
    const t = tasks[uid];
    agg.push({
      uid, ...info[uid], snaps: a.length,
      path: +path.toFixed(1), net: +net.toFixed(1), ratio: +(path / Math.max(net, 0.5)).toFixed(1), stall,
      waterFrac: +(water / Math.max(a.length - 1, 1)).toFixed(2), inWaterFrac: +(inW / a.length).toFixed(2), blocked: +(blocked / Math.max(a.length - 1, 1)).toFixed(2),
      hMin: hMin > 1e8 ? null : +hMin.toFixed(1), hMax: hMax < -1e8 ? null : +hMax.toFixed(1), dHMean: dHN ? +(dHSum / dHN).toFixed(2) : null,
      atTask: t ? +Math.hypot(t.x - a[a.length - 1][0], t.z - a[a.length - 1][1]).toFixed(1) : null,
      task: t ? `${Math.round(t.x)},${Math.round(t.z)}` : '-',
    });
  }
  const fort = (() => { const f = c.fortify; if (!f) return null; return { claims: [...f.claims].map(([id, s2]) => `#${id}->S${s2}`), safety: f.safety.map((v) => Number.isFinite(v) ? +v.toFixed(2) : null) }; })();
  return { agg, traces, fort, t: Date.now() };
});

for (const seed of seeds) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[seed ${seed} pageerror]`, String(e).slice(0, 160)));
  await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(seed));
  await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => window.__ppEnterWorld());
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => window.__ppMode().finishDock());
  await page.waitForFunction('!!window.__commander', { timeout: 120000 });
  await page.evaluate(() => {
    window.__engTrk = new Map();
    const sw = window.__swarm;
    setInterval(() => {
      for (const s of sw.squads.all()) {
        if (!s.builders) continue;
        for (const [uid, m] of s.members) {
          let a = window.__engTrk.get(uid);
          if (!a) { a = []; window.__engTrk.set(uid, a); }
          a.push([m.x, m.z]);
          if (a.length > 400) a.shift();
        }
      }
    }, 500);
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.1);
  console.log(`\n===== seed ${seed} 工兵行动快照 =====`);
  const s = await dump(page);
  writeFileSync(`${OUT}/snap-${seed}.json`, JSON.stringify(s, null, 1));
  if (s.fort) console.log(`认领: ${s.fort.claims.join(' ')} | 安全值[${s.fort.safety.join(',')}]`);
  const rows = s.agg.sort((a, b) => b.ratio - a.ratio);
  for (const r of rows.slice(0, 12)) {
    console.log(`#${r.uid} 队${r.sid}/${r.role} 路径${r.path}/净${r.net}=${r.ratio} 停滞${r.stall}/${r.snaps} 水${r.waterFrac}/位${r.inWaterFrac} 挡${r.blocked} 高[${r.hMin}~${r.hMax}] dH${r.dHMean} 位${r.x},${r.z} 任务${r.task}(离${r.atTask})`);
  }
  await page.close();
}
await browser.close();
console.log(`\n原始快照已存: ${OUT}/snap-<seed>.json`);
