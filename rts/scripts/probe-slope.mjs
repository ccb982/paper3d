// ============================================================
// probe-slope —— 坡面通过率冒烟（常规对局：引擎发令/随便令；标准位）
// 用法：npm run probe:slope   （前置：dev server；RTS_URL 可覆盖）
// 标准测试位（用户定）：seed=4242 ship=(-17,-267) landing=(131,-206) cam=(31,-242)
//   地形：z<=-242 台地(y≈6)；z>=-238 低地(y≈0)；z≈-240 一线是坡面（可爬段 x∈[-12,-2]）
// 口径：
//   · 不手动发令、不开直控——只用常规引擎流程；T+10s scrubDay 触发波次上攻
//   · "尝试"=低地出生且接近坡面（minZ ≤ -236）；"通过"=上到台地（y>4.5 且 z≤-244）
//   · 输出：尝试数/通过数/通过率/用时；未通过样本末位置；回收/卡死计数
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);
const RUN_S = Number(process.env.RUN_S ?? 240);       // 墙钟秒
const SCRUB_AT = Number(process.env.SCRUB_AT ?? 10);  // 墙钟秒：拨日程触发波次（0.5=黄昏→第一波）

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}${RTS_URL.includes('?') ? '&' : '?'}seed=${SEED}&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
console.log('[就绪] 世界加载（常规引擎；标准位 ship=(-17,-267)）');

await page.evaluate(() => {
  window.__sl = new Map();
  setInterval(() => {
    const w = window.__rts; if (!w?.swarm) return;
    const t = performance.now() / 1000;
    for (const e of (w.enemies ?? [])) {
      const uid = e.swarmUid;
      let a = window.__sl.get(uid);
      if (!a) { a = { uid, low: false, minZ: Infinity, maxY: -Infinity, crossed: false, tCross: 0, last: null, t0: t }; window.__sl.set(uid, a); }
      const x = e.entity.position.x, z = e.entity.position.z, y = e.entity.position.y;
      if (z >= -238 && y < 2.5) a.low = true;
      if (z < a.minZ) a.minZ = z;
      if (y > a.maxY) a.maxY = y;
      if (!a.crossed && y > 4.5 && z <= -242) { a.crossed = true; a.tCross = t; }   // 台地线 z<=-242
      a.last = `${x | 0},${z | 0},y${y.toFixed(1)}`;
    }
  }, 500);
});

let scrubbed = false;
const scrub2 = new Set();
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < RUN_S) {
  await new Promise((r) => setTimeout(r, 1000));
  const el = (Date.now() - t0) / 1000;
  if (!scrubbed && el >= SCRUB_AT) {
    scrubbed = true;
    await page.evaluate(() => window.__rts.swarm.data.scrubDay(0.5));
    console.log(`[波次] T+${SCRUB_AT}s scrubDay(0.5)`);
  }
  // ★ 逐步拨日程逼到总攻（环收成船点 → 敌人必须上坡）
  for (const [at, v] of [[60, 0.8], [120, 1.0]]) {
    if (!scrub2.has(at) && el >= at) {
      scrub2.add(at);
      await page.evaluate((vv) => window.__rts.swarm.data.scrubDay(vv), v);
      console.log(`[波次] T+${at}s scrubDay(${v})`);
    }
  }
  if (Math.round(el) % 30 === 0) {
    const s = await page.evaluate(() => ({ l3: window.__rts.enemies?.length ?? 0, pool: window.__rts.swarm?.pool?.count ?? 0 }));
    console.log(`  T+${Math.round(el)}s L3=${s.l3} 池=${s.pool}`);
  }
}

const res = await page.evaluate(() => {
  const w = window.__rts;
  const attempted = [], passed = [], failed = [];
  for (const a of window.__sl.values()) {
    const attempt = a.low && a.minZ <= -236;   // 低地出生且贴近坡面
    if (!attempt) continue;
    attempted.push(a);
    if (a.crossed) passed.push(a); else failed.push(a);
  }
  const dt = (a) => (a.tCross - a.t0).toFixed(0);
  return {
    attempted: attempted.length, passed: passed.length,
    rate: attempted.length ? +(passed.length / attempted.length * 100).toFixed(0) : null,
    times: passed.map((a) => +dt(a)).sort((x, y) => x - y),
    failed: failed.slice(0, 8).map((a) => `#${a.uid} 末(${a.last}) 最近z=${a.minZ | 0} maxY=${a.maxY.toFixed(1)} low=${a.low}`),
    stuck: w.shadowBridge?.timers?.dbg ? { stuckTotal: w.shadowBridge.timers.dbg.stuckTotal, expiredTotal: w.shadowBridge.timers.dbg.expiredTotal } : null,
    ledger: w.swarm?.ledger ? { spawned: w.swarm.ledger.spawned, alive: w.swarm.ledger.alive, recalled: w.swarm.ledger.recalled, kills: w.swarm.ledger.kills } : null,
    nav: w.swarm?.navDbg ? { seg: w.swarm.navDbg.seg, feasOk: w.swarm.navDbg.feasOk, localNull: w.swarm.navDbg.localNull, fail: w.swarm.navDbg.fail } : null,
  };
});
console.log('════════ 坡面通过率（常规引擎/无手动令） ════════');
console.log(`尝试 ${res.attempted} · 通过 ${res.passed} · 通过率 ${res.rate}%`);
if (res.times.length) console.log(`通过用时(墙钟秒)：${res.times.slice(0, 12).join('/')}`);
for (const f of res.failed) console.log('  未通过:', f);
console.log(`回收/卡死 ${JSON.stringify(res.stuck)}`);
console.log(`账本 ${JSON.stringify(res.ledger)} · nav ${JSON.stringify(res.nav)}`);
await browser.close();
