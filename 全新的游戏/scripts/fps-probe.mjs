// ============================================================
// fps-probe —— 帧率取证探针（puppeteer-core）
//   1) 启动本地 Chrome 打开 ?perf=1（暴露 window.__ppWp / __ppDig）
//   2) 等玩家进入战场（__ppWp.chunks > 0）
//   3) 连续采样 20s 的 rAF 帧间隔 + worldPerf / digPerf 分项
//
// 用法：
//   npm run dev            （另一个终端，端口默认 5173）
//   node scripts/fps-probe.mjs
//
// 环境变量：
//   PROBE_URL   默认 http://localhost:5173/?perf=1
//   CHROME_PATH 默认本机 Chrome
//   PROBE_SEC   采样时长（秒，默认 20）
// ============================================================
import puppeteer from 'puppeteer-core';

// 默认复现用户 HUD 里的世界（seed 1679464028）；wipe 只清探针专用临时 profile 的存档
const URL = process.env.PROBE_URL || 'http://localhost:5173/?perf=1&wipe=1&seed=1679464028';
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
// ★ 采样阶段：explore = 落地后主路径（默认）；flight = 航行期 coarseOnly 路径
const SEC = Number(process.env.PROBE_SEC || 20);
const MODE = process.env.PROBE_MODE || 'explore';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  protocolTimeout: 600000, // 页面偶发长任务时不至于把 CDP 通道判死
  defaultViewport: { width: 1600, height: 900 },
  args: [
    '--window-size=1600,900',
    // 后台/失焦时不要降频，否则采样不准
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/错误|Error|error|Failed|失败|警告|WARN/.test(t)) console.log(`[page:${m.type()}]`, t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
console.log('页面已打开，等待 boot 暴露 __ppEnterWorld…');

// ?perf=1 会暴露 window.__ppEnterWorld()（main.ts）→ 免手动操作直接进世界
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', {
  timeout: 120000,
  polling: 200,
});
await new Promise((r) => setTimeout(r, 4000)); // 让存档 / 预创建层就绪
const enter = await page.evaluate(() => {
  try { window.__ppEnterWorld(); return 'ok'; } catch (e) { return `throw:${String(e)}`; }
});
console.log('已调用 __ppEnterWorld ->', enter, '，等待区块加载…');

// ★ 阶段切换：explore = 落地后主路径；flight = 航行期 coarseOnly 路径
const switched = await page.evaluate((mode) => {
  try {
    const m = window.__ppMode && window.__ppMode();
    const c = m && m.chunks;
    if (mode === 'landing' && c && typeof c.rushTerrain === 'function') {
      // ★ 真实按 F 落地：先回航行态（模拟空中），3 秒后触发进近 + 闸门请求
      c.setCoarseMode(true);
      setTimeout(() => {
        c.rushTerrain(c.playerX || 0, c.playerZ || 0, 0, 1, 8);
        if (typeof c.requestFineMode === 'function') c.requestFineMode();
      }, 3000);
      return 'landing';
    }
    if (c && typeof c.setCoarseMode === 'function') {
      c.setCoarseMode(mode === 'flight');
      return mode === 'flight' ? 'flight' : 'explore';
    }
    return 'no-chunks';
  } catch (e) { return `throw:${String(e)}`; }
}, MODE);
console.log(`切换到 ${switched} …`);

await page.waitForFunction(
  () => {
    const wp = window.__ppWp;
    return !!wp && typeof wp.chunks === 'number' && wp.chunks > 0;
  },
  { timeout: 90000, polling: 500 },
).catch(async (e) => {
  const mode = await page.evaluate(() => {
    try { return String(window.__ppMode && window.__ppMode()); } catch (err) { return `err:${String(err)}`; }
  }).catch(() => 'unreadable');
  await page.screenshot({ path: 'scripts/.fps-probe-stuck.png' }).catch(() => {});
  throw new Error(`等待区块加载超时（mode=${mode}）：${e.message}`);
});
// 等入场队列排空（精细块装配 1 块/帧 + 装饰/物理分区冷却队列）
// ★ landing 模式：这段等待期**保持粗块**（模拟真实航行），否则精细块会提前
//   装配完、program 提前编译，落地那一刻就无从复现「首次精细化」的冻结。
if (MODE === 'landing') {
  await page.evaluate(() => {
    try {
      const m = window.__ppMode && window.__ppMode();
      const c = m && m.chunks;
      if (c && typeof c.setCoarseMode === 'function') c.setCoarseMode(true);
    } catch { /* ignore */ }
  });
}
await new Promise((r) => setTimeout(r, 12000));
// 页面内自行记帧（evaluate 立即返回 → 不会像长 Promise 那样占住 CDP 通道）
await page.evaluate(() => {
  const p = { frames: [], snap: [], last: performance.now(), t0: performance.now(), on: true };
  window.__fpsProbe = p;
  const loop = () => {
    if (!p.on) return;
    const now = performance.now();
    p.frames.push(now - p.last);
    p.last = now;
    const wp = window.__ppWp;
    if (wp) {
      p.snap.push({
        pre: wp.pre, world: wp.world, chunks: wp.chunks,
        ai: wp.ai, entity: wp.entity, phys: wp.phys, post: wp.post,
        swarmMs: wp.swarmMs, engineMs: wp.engineMs, total: wp.total,
      });
    }
    if (now - p.t0 > 120000) { p.on = false; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
console.log(`检测到战场，开始采样 ${SEC}s…`);
// ★ PROBE_FLY=1：按住 W 让舰船真飞（静止时前向锥不滚动，测不出铺块压力）
const FLY = process.env.PROBE_FLY === '1';
if (FLY) {
  await page.bringToFront();
  await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.focus(); });
  await page.keyboard.down('KeyW');
  console.log('已按住 W 飞行…');
}
await new Promise((r) => setTimeout(r, SEC * 1000));
if (FLY) await page.keyboard.up('KeyW').catch(() => {});
await page.evaluate(() => { window.__fpsProbe && (window.__fpsProbe.on = false); });

const result = await page.evaluate(() => {
  const p = window.__fpsProbe;
  const frames = p ? p.frames : [];
  const wp = { ...(window.__ppWp || {}) };
  const dig = { ...(window.__ppDig || {}) };
  const clean = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    }
    return out;
  };
  const sorted = [...frames].sort((a, b) => a - b);
  const sum = frames.reduce((a, b) => a + b, 0);
  const pct = (p2) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p2))];
  return {
    frames: frames.length,
    avgMs: +(sum / frames.length).toFixed(2),
    fps: +(1000 / (sum / frames.length)).toFixed(1),
    p50: +pct(0.5).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    hitch33: +(frames.filter((x) => x > 33).length / frames.length * 100).toFixed(1),
    hitch50: +(frames.filter((x) => x > 50).length / frames.length * 100).toFixed(1),
    worldPerf: clean(wp),
    digPerf: clean(dig),
    // ★ 每帧 worldPerf 快照的均值（瞬时值噪声大，均值才反映持续开销）
    segAvg: (() => {
      const a = p ? p.snap : [];
      if (!a.length) return {};
      const keys = Object.keys(a[0]);
      const out = {};
      for (const k of keys) {
        out[k] = +(a.reduce((s, x) => s + (x[k] || 0), 0) / a.length).toFixed(2);
      }
      return out;
    })(),
  };
});

console.log('\n===== 帧率 =====');
console.log(
  `fps ${result.fps} | avg ${result.avgMs}ms | p50 ${result.p50} | p95 ${result.p95} | max ${result.max}`,
);
console.log(`掉帧 >33ms: ${result.hitch33}% | >50ms: ${result.hitch50}% | 样本 ${result.frames} 帧`);

console.log('\n===== 分段均值（每帧，ms）=====');
console.log(JSON.stringify(result.segAvg, null, 2));

console.log('\n===== worldPerf =====');
console.log(JSON.stringify(result.worldPerf, null, 2));

console.log('\n===== digPerf =====');
console.log(JSON.stringify(result.digPerf, null, 2));

await browser.close();
