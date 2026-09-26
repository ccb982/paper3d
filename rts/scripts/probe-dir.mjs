// ============================================================
// ★ 标准测试位（用户定）：seed=4242 ship=-17,-267 landing=131,-206 cam=31,-242
// probe-dir —— 队内指挥（成员指令）追踪：按兵种统计变化频率 + "无脑"模式
// 用法：npm run probe:dir（前置 dev server）
//   采样 500ms × 120（60s）；统计每成员：
//     · kind 变化次数 / 目标变化次数与跳距（m）
//     · 空转（目标 ≈ 自身位置 < 1.5m）、反向（目标在移动方向背面）、kind 翻转
//   按兵种（squad.type）聚合输出（成员指令门 OrderGate 已删：跟队长不由门控制）
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);
const N = Number(process.env.N ?? 120);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`${RTS_URL}${RTS_URL.includes('?') ? '&' : '?'}seed=${SEED}&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
console.log(`[装载] 采样 ${N}×500ms…`);

const prev = new Map();
const stat = new Map();
const bump = (type, k) => {
  let a = stat.get(type);
  if (!a) { a = { samples: 0, kindChg: 0, tgtChg: 0, jump: 0, jumpN: 0, noop: 0, rev: 0, flip: 0, mulLt1: 0 }; stat.set(type, a); }
  a[k]++;
};

for (let s = 0; s < N; s++) {
  await new Promise((r) => setTimeout(r, 500));
  const rows = await page.evaluate(() => {
    const w = window.__rts; const sw = w.swarm; const p = sw.pool;
    const out = [];
    for (let i = 0; i < p.count; i++) {
      if (p.hp[i] <= 0) continue;
      const sq = sw.squads.squadOf(p.swarmUid[i]);
      out.push({
        uid: p.swarmUid[i], type: sq?.type ?? '?',
        kind: p.directiveKind[i], tx: p.directiveTargetX[i], tz: p.directiveTargetZ[i],
        x: p.x[i], z: p.z[i], spd: p.curSpeed[i], mul: p.directiveSpeedMul[i],
      });
    }
    return out;
  });
  for (const r of rows) {
    const pr = prev.get(r.uid);
    prev.set(r.uid, r);
    bump(r.type, 'samples');
    if (r.mul < 0.99) bump(r.type, 'mulLt1');
    const dSelf = Math.hypot(r.tx - r.x, r.tz - r.z);
    if (dSelf < 1.5) bump(r.type, 'noop');
    if (!pr) continue;
    if (r.kind !== pr.kind) bump(r.type, 'kindChg');
    const j = Math.hypot(r.tx - pr.tx, r.tz - pr.tz);
    if (j > 0.5) {
      bump(r.type, 'tgtChg');
      bump(r.type, 'jump'); stat.get(r.type).jumpN++;
      if (j > 20) bump(r.type, 'flip');   // 目标跳变 >20m = 疑似翻转/换点
    }
    const mx = r.x - pr.x, mz = r.z - pr.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.3) {
      const toT = (r.tx - r.x) / (Math.hypot(r.tx - r.x, r.tz - r.z) || 1);
      const toM = mx / ml;
      if (toT * toM < -0.5) bump(r.type, 'rev');   // 目标在移动背面
    }
  }
}
console.log('\n兵种       样本  指令kind变  目标变  平均跳距  空转%  反向%  >20m跳%  限速%');
for (const [t, a] of [...stat.entries()].sort((x, y) => y[1].samples - x[1].samples)) {
  const pc = (v) => ((v / Math.max(1, a.samples)) * 100).toFixed(1);
  console.log(`${t.padEnd(10)} ${String(a.samples).padStart(5)} ${String(a.kindChg).padStart(8)} ${String(a.tgtChg).padStart(7)} ${(a.jump / Math.max(1, a.jumpN)).toFixed(1).padStart(8)} ${pc(a.noop).padStart(6)} ${pc(a.rev).padStart(6)} ${pc(a.flip).padStart(8)} ${pc(a.mulLt1).padStart(6)}`);
}

// ★ 新引擎（唯一指挥链）健全性（重写 P4；G9 调试口契约）
{
  const ne = await page.evaluate(() => globalThis.__rts?.newEngine?.() ?? null);
  const okNe = !!ne && ne.ticks > 0 && ne.squads.count > 0 && ne.writer.issued + ne.writer.kept > 0;
  console.log(`新引擎健全性: ${okNe ? 'PASS' : 'FAIL'} ` + (ne ? JSON.stringify({ ticks: ne.ticks, squads: ne.squads.count, writer: ne.writer }) : '(无 newEngine 调试口)'));
  if (!okNe) process.exitCode = 1;
}

await browser.close();
