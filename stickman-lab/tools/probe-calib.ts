/**
 * probe-calib.ts —— **验收阈值标定**（`架构_v2_三模块协作.md` §11 原则 1）
 *
 *   「矢状位置阈值必须**按实测反标**，不能照抄别人机器上的默认值」
 *
 * 做法：把状态机挂在**标定模式**（`gait.calib = true`）——
 *   验收照常逐项计算并记录，但**只靠最短驻留推进**，于是不会卡在被怀疑的那一项上，
 *   反而能采到「这项到底能到多少」的分布。
 *
 * 输出：每个状态的
 *   · 驻留时长 / 到达次数
 *   · 承接腿载荷 `loadFrac[recv]`：分位数 + **本状态内峰值**（交接能力的硬上界）
 *   · `sagPosRel(recv)`：分位数（SCONE 口径的矢状位置阈值就是从这里反标）
 *   · 帧域最差越界：分位数（帧域容差从这里反标）
 *   · 各验收项"从未通过"的计数（说明该项在本机不可达）
 *
 * 用法：node tools/run.mjs probe-calib   （秒数用 PD_SECS，默认 20）
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { VERIFY, STATE_ORDER, THRESHOLDS, DEFAULT_GAIT_CONFIG } = await import('../src/core/gaitState');
import type { WalkState } from '../src/core/rigState';

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const PHYS_HZ = DEFAULT_SIM.physicsHz;
const CTRL_HZ = DEFAULT_SIM.controlHz;
const PER_CTRL = Math.max(1, Math.round(PHYS_HZ / CTRL_HZ));
const DT = 1 / CTRL_HZ;
const SECS = Number(process.env.PD_SECS ?? 20);

/** 在状态内维护承接腿载荷峰值（收尾时直接取） */
function peakOf(st: St, v = Number.NEGATIVE_INFINITY): number {
  if (Number.isFinite(v)) st._peak = Math.max(st._peak, v);
  return st._peak;
}
const q = (a: number[], p: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
};
const f = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

interface St {
  n: number; dwell: number[];
  recvLoad: number[]; sagRecv: number[]; worst: number[];
  itemFail: Record<string, number>;
  peakRecvLoad: number[];
  _peak: number;
}
const stats: Record<string, St> = {};
for (const s of STATE_ORDER) {
  stats[s] = { n: 0, dwell: [], recvLoad: [], sagRecv: [], worst: [], itemFail: {}, peakRecvLoad: [], _peak: 0 };
}

const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, calib: true, minDwellSec: 0.25 },
});
let cur: WalkState = ctrl.rs.state;
let ticks = 0;
for (let i = 0; i < Math.round(SECS * PHYS_HZ) && !sim.finished; i++) {
  if (i % PER_CTRL === 0) {
    sim.doll.setMotorTargets(ctrl.step(DT));
    const rs = ctrl.rs;
    const recv = rs.lastSwing ?? rs.frontLeg();
    // ⚠ 切换那一拍：`rs.state` 已经是**新**状态，而收尾数据属于**旧**状态
    //   ⇒ 必须用 `stats[cur]` 收尾，再切 `cur`（否则驻留/峰值会错位一态）。
    if (rs.state !== cur) {
      const old = stats[cur];
      if (old.n > 0) { old.dwell.push(ticks); old.peakRecvLoad.push(peakOf(old)); }
      cur = rs.state; ticks = 0;
    }
    const st = stats[rs.state];
    ticks++;
    st.n++;
    st.recvLoad.push(rs.loadFrac[recv]);
    st.sagRecv.push(rs.sagPosRel(recv));
    const w = Math.max(rs.jq?.worstSupportErrDeg(false) ?? 0, rs.jq?.worstSwingErrDeg(false) ?? 0);
    st.worst.push(w);
    for (const v of rs.violations) st.itemFail[v.item] = (st.itemFail[v.item] ?? 0) + 1;
    peakOf(st, rs.loadFrac[recv]);
  }
  sim.advance(1);
}
// 收尾
{
  const st = stats[cur];
  if (st.n > 0) { st.dwell.push(ticks); st.peakRecvLoad.push(st._peak); }
}

log(`══ 标定：阈值反标（标定模式，最短驻留 0.25s，${SECS}s）══`);
log(`  倒=${sim.fallReason || '未倒'}  存活 ${(sim.ticksDone / CTRL_HZ).toFixed(2)}s  周期 ${ctrl.rs.cycleCount}`);
log('');
for (const s of STATE_ORDER) {
  const st = stats[s];
  if (!st.n) { log(`  ${s.padEnd(7)} — 从未出现`); continue; }
  log(`  ${s.padEnd(7)} 到达 ${String(st.n).padStart(4)} 拍  驻留中位 ${f(q(st.dwell, 0.5) / CTRL_HZ, 2)}s`
    + `  最长 ${f(Math.max(...st.dwell) / CTRL_HZ, 2)}s`);
  log(`          承接腿载荷   p10=${f(q(st.recvLoad, 0.1))} p50=${f(q(st.recvLoad, 0.5))}`
    + ` p90=${f(q(st.recvLoad, 0.9))}  **状态内峰值中位=${f(q(st.peakRecvLoad, 0.5))}** 峰值最大=${f(Math.max(...st.peakRecvLoad))}`);
  log(`          sagPosRel    min=${f(q(st.sagRecv, 0))} p50=${f(q(st.sagRecv, 0.5))} max=${f(q(st.sagRecv, 1))}  (腿长归一)`);
  log(`          帧域最差越界 p50=${f(q(st.worst, 0.5))}° p90=${f(q(st.worst, 0.9))}° max=${f(q(st.worst, 1))}°`);
  const items = Object.entries(st.itemFail).sort((a, b) => b[1] - a[1]);
  if (items.length) {
    log(`          从未通过的验收项：${items.map(([k, v]) => `${k} ${(100 * v / st.n).toFixed(0)}%`).join('、')}`);
  } else {
    log('          全部验收项在本状态内都通过过');
  }
}

log('');
log('══ 阈值清单审计（出处 + 是否已按本机标定）══');
{
  let guess = 0;
  for (const t of THRESHOLDS) {
    // ★ 数值**从配置派生**，清单不手抄 ⇒ 不会出现"清单与实际不符"
    const live = (DEFAULT_GAIT_CONFIG as unknown as Record<string, number>)[t.cfgKey];
    if (t.calibrated === 'guess') guess++;
    log(`  [${t.calibrated === 'measured' ? '实测' : t.calibrated === 'literature' ? '文献' : '**无依据**'}] `
      + `${t.cfgKey.padEnd(18)} ${String(live).padStart(7)} ${t.unit.padEnd(16)} ${t.source}`);
    if (t.measured) log(`      实测：${t.measured}`);
  }
  log('');
  log(`  共 ${THRESHOLDS.length} 个阈值，其中 **${guess} 个没有依据（guess）**。`);
  if (guess > 0) log('  ⇒ 这些数只能当"起点"，不能当验收依据；标定须等 P4（能站住）+ Q1（站距）。');
}

log('');
log('══ 阈值可达性判定（哪些项在本机根本达不到）══');
{
  const cfg = DEFAULT_CONTROLLER.gait;
  const loadThr = 0.60;
  const peakByState = STATE_ORDER.map((s) => ({ s, peak: Math.max(0, ...stats[s].peakRecvLoad) }));
  for (const { s, peak } of peakByState) {
    if (stats[s].n === 0) continue;
    const ok = peak >= loadThr;
    log(`  ${s.padEnd(7)} 承接腿峰值 ${f(peak)}  ${ok ? '>= 0.60 可达' : '< 0.60 **不可达**'}`
      + `  (缺 ${f(loadThr - peak)})`);
  }
  void cfg;
}
log('');
log('  读法：峰值 < 阈值 ⇒ 该阈值在**当前站距与机构**下不可达，');
log('        要么先做 Q1（站距收到人类尺度）/ P4（交接机构），要么按实测峰值下调阈值。');
