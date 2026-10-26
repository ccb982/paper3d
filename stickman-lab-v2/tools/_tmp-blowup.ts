/** _tmp-blowup: 抓「正常蹲下 → 过一会弹飞」的第一现场。
 *
 *  复刻 main.ts 的真实帧序：
 *    supportClean(r,l) → advance(1) → maybeSquatHandoff() → squatFrame(court)
 *  每帧记录全身最大线速度；一旦越过阈值，就把**当帧的全部提案**按 src 汇总打印，
 *  并回看前 3 帧的账（谁在涨），以及最大速度那个刚体的速度/位置。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 20);
const VTH = Number(process.env.VTH ?? 3);
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
Math.random = mulberry32(101);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
// ★ 只读对照实验：LIMFIX=1 → 下蹲期间就套用 squat 状态的关节限位（髋放宽到 -120..175°）
//   不改 baseState（伺服目标表仍是 stand），只改 min/max/tauMax/velMax。
if (String(process.env.LIMFIX ?? '0') === '1') w.applyJointLimits('squat');
// ★ 只读对照实验 2：LIMFIX=2 → **只**放宽髋矢状（轴2）限位到 -120..175°，其余（τmax/velMax/其他轴）原样
if (String(process.env.LIMFIX ?? '0') === '2') {
  for (const d of w.body.dofs) if (/^hip_/.test(d.name) && d.axis === 2) { d.min = -120 / 57.29578; d.max = 175 / 57.29578; }
  const hd0 = w.body.dofByName('hip_l', 2);
  const _h = w.body.dofs[hd0]!;
  console.log(`[LIMFIX=2] hip_l/2 min=${(_h.min * 57.3).toFixed(0)}° max=${(_h.max * 57.3).toFixed(0)}° engineLimited=${_h.engineLimited} tauMax=${_h.tauMax}`);
}
ctl.actions.play('squatDown');

const body = w.body;
const keyOf = new Map<number, string>();
for (const [k, i] of body.indexByKey) keyOf.set(i, k);

let court: CourtState | null = null;
let pending = true, armed = false;
let gateLast = -1;
const jt = 5 / 57.29578;
const ang = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : NaN; };
const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };

function maxVel(): { v: number; idx: number; lin: { x: number; y: number; z: number }; ang: { x: number; y: number; z: number } } {
  let best = { v: -1, idx: -1, lin: { x: 0, y: 0, z: 0 }, ang: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i < body.bodies.length; i++) {
    const rb = body.bodies[i]!;
    const lv = rb.linvel();
    const av = rb.angvel();
    const v = Math.hypot(lv.x, lv.y, lv.z);
    if (v > best.v) best = { v, idx: i, lin: lv, ang: av };
  }
  return best;
}

/** 帧账：dofIndex → 当帧提案（src/kind/tau） */
function ledger(log: Array<[number, string, number, string]>): Map<string, { tau: number; n: number; kind: string }> {
  const m = new Map<string, { tau: number; n: number; kind: string }>();
  for (const [dof, kind, param, src] of log) {
    const nm = body.dofs[dof]?.name ?? String(dof);
    const ax = body.dofs[dof]?.axis ?? -1;
    const k = `${nm}/${ax}  ${src}  ${kind}`;
    const cur = m.get(k);
    if (cur) { cur.tau = param; cur.n++; } else m.set(k, { tau: param, n: 1, kind });
  }
  return m;
}

let lastPrint = -1;
let blew = false;
interface Fr { t: number; maxV: number; rb: string; dof: string; dofV: number; top: Array<[string, number]> }
const ring: Fr[] = [];
const RING_N = 720;   // 1.5s @480Hz

/** 当前 |ω| 最大的自由度 + 它的全部提案 */
function hotDof(lg: Map<string, { tau: number; n: number; kind: string }>): { name: string; vel: number; list: string } {
  let bi = -1, bv = 0;
  for (let i = 0; i < body.dofs.length; i++) {
    const v = Math.abs(body.dofs[i]!.vel);
    if (v > bv) { bv = v; bi = i; }
  }
  if (bi < 0) return { name: '-', vel: 0, list: '' };
  const d = body.dofs[bi]!;
  const nm = `${d.name}/${d.axis}`;
  const parts: string[] = [];
  for (const [k, v] of lg) if (k.startsWith(nm + '  ')) parts.push(`${k.split('  ')[1]}=${v.tau.toFixed(0)}`);
  return { name: nm, vel: d.vel, list: parts.join(' ') };
}

for (let i = 0; i < Math.round(T_END / w.dt); i++) {
  g.__PROPLOG = [];
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  const proplog = g.__PROPLOG ?? [];
  g.__PROPLOG = undefined;

  // ── 复刻 maybeSquatHandoff ──
  if (pending) {
    if (ctl.actions.status.id === 'squatDown' && ctl.actions.status.active) armed = true;
    if (armed) {
      const c = ctl.sensors.com;
      const hAz = Math.abs(ang('hip_l', 2) - 103.1 / 57.29578) < jt;
      const kAz = Math.abs(ang('knee_l', 2) + 102.1 / 57.29578) < jt;
      const fAz = Math.abs(ang('foot_l', 2)) < 10 / 57.29578;
      const cX = Math.abs((c[0] ?? 0) - 0.010) < 0.03;
      const cZ = Math.abs(c[2] ?? 0) < 0.03;
      const fL = body.footNormalForce('l', w.dt) > 50, fR = body.footNormalForce('r', w.dt) > 50;
      // ★ 与 main.ts 完全同式：判据 = 姿势到位（髋/膝）+ 双脚着地；foot2/comX/comZ 已从判据里移除
      const ok = Number.isFinite(ang('hip_l', 2)) && Number.isFinite(ang('knee_l', 2)) && hAz && kAz && fL && fR;
      // ★ 门控诊断：只在髋/膝已经进圈时才报，看是哪个子条件卡住交接
      if ((hAz && kAz) && !ok && w.clock - (gateLast) >= 0.2) {
        gateLast = w.clock;
        console.log(`  [门] t=${w.clock.toFixed(2)} hip=${hAz ? '✓' : '✗'}(Δ${((ang('hip_l', 2) - 103.1 / 57.29578) * 57.3).toFixed(1)}°) ` +
          `knee=${kAz ? '✓' : '✗'} foot2=${fAz ? '✓' : '✗'}(${(ang('foot_l', 2) * 57.3).toFixed(1)}°) ` +
          `comX=${cX ? '✓' : '✗'}(${((c[0] ?? 0) * 100).toFixed(1)}cm vs 1.0) comZ=${cZ ? '✓' : '✗'}(${((c[2] ?? 0) * 100).toFixed(1)}cm) ` +
          `fzL=${fL ? '✓' : '✗'}(${body.footNormalForce('l', w.dt).toFixed(0)}) fzR=${fR ? '✓' : '✗'}(${body.footNormalForce('r', w.dt).toFixed(0)})`);
      }

      // ★ 与 main.ts 新增的兜底完全同式：动作走到「交接」相位 + 膝盖确实在蹲 ⇒ 无条件接管
      const forced = ctl.actions.status.phase === '交接' && ang('knee_l', 2) < -60 / 57.29578;
      if (ok || forced) {
        pending = false; armed = false;
        ctl.actions.abort();
        ctl.manual.clear();
        court = captureSquatCourt(w, ctl);   // 内部 switchPoseState('squat') → baseState 自动变 squat
        console.log(`[交接] t=${w.clock.toFixed(2)}s  进入 squat 伺服（${ok ? '门控全过' : '★兜底：交接相位强制'}）`);
      }
    }
  }
  if (court) squatFrame(w, ctl, court);

  const mv = maxVel();
  const lg = ledger(proplog);
  const top = [...lg.entries()]
    .map(([k, v]) => [k, Math.abs(v.tau)] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const hd = hotDof(lg);
  ring.push({ t: w.clock, maxV: mv.v, rb: keyOf.get(mv.idx) ?? String(mv.idx), dof: hd.name, dofV: hd.vel, top });
  if (ring.length > RING_N) ring.shift();

  if (w.clock - lastPrint >= 0.5) {
    lastPrint = w.clock;
    const ph = court ? (court.released ? 'released' : 'settle') : 'action';
    const hipParts: string[] = [];
    for (const [k, v] of lg) if (k.startsWith('hip_l/2  ')) hipParts.push(`${k.split('  ')[1]}=${v.tau.toFixed(0)}`);
    console.log(`t=${w.clock.toFixed(2)} ${ph} st=${ctl.actions.status.id ?? '-'}/${ctl.actions.status.active ? 'on' : 'off'} ` +
      `hip=${(ang('hip_l', 2) * 57.3).toFixed(0)}° knee=${(ang('knee_l', 2) * 57.3).toFixed(0)}° ` +
      `sp1=${(ang('spine1', 2) * 57.3).toFixed(0)}° ` +
      `maxV=${mv.v.toFixed(2)}@${keyOf.get(mv.idx) ?? mv.idx} hot=${hd.name}:${hd.vel.toFixed(1)}rad/s  ${hd.list}` +
      (process.env.LIMFIX ? `  [hipmax=${(body.dofs[body.dofByName('hip_l', 2)]!.max * 57.3).toFixed(0)}° | hip:${hipParts.join(' ') || '-'}]` : ''));
  }

  if (!blew && mv.v > VTH) {
    blew = true;
    console.log(`\n======== 第一次超阈值 t=${w.clock.toFixed(3)}s  maxV=${mv.v.toFixed(2)}m/s  刚体=${keyOf.get(mv.idx) ?? mv.idx} ========`);
    const p = body.bodies[mv.idx]!.translation();
    console.log(`  位置=(${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)},${(p.z * 100).toFixed(1)})cm  lin=(${mv.lin.x.toFixed(2)},${mv.lin.y.toFixed(2)},${mv.lin.z.toFixed(2)})  ang=(${mv.ang.x.toFixed(2)},${mv.ang.y.toFixed(2)},${mv.ang.z.toFixed(2)})`);
    console.log('  ── 回溯环形缓冲（早段每 24 帧、末段逐帧）──');
    const hdrs = '      t      maxV   刚体     热点轴            |ω|      top3 |tau|';
    console.log(hdrs);
    for (let k = 0; k < ring.length; k++) {
      const last = ring.length - 1 - k;
      if (last > 30 && k % 24 !== 0) continue;
      const h = ring[k]!;
      console.log(`  ${h.t.toFixed(3).padStart(8)}  ${h.maxV.toFixed(2).padStart(5)}  ${h.rb.padEnd(8)} ${h.dof.padEnd(14)} ${h.dofV.toFixed(1).padStart(6)}   ${h.top.slice(0, 3).map(([s, v]) => `${s.split('  ')[0]}=${v.toFixed(0)}`).join(' ')}`);
    }
    console.log('  ── 越界/贴限位检查（|angle| 超 min/max，或距限位 <2°）──');
    let nLim = 0;
    for (const d of body.dofs) {
      const lo = d.min, hi = d.max;
      const out = d.angle < lo - 1e-3 || d.angle > hi + 1e-3;
      const near = Math.abs(d.angle - lo) < 2 / 57.3 || Math.abs(d.angle - hi) < 2 / 57.3;
      if (!out && !near) continue;
      nLim++;
      console.log(`    ${`${d.name}/${d.axis}`.padEnd(14)} ang=${(d.angle * 57.3).toFixed(1).padStart(8)}°  min=${(lo * 57.3).toFixed(0).padStart(5)}° max=${(hi * 57.3).toFixed(0).padStart(5)}°  vel=${d.vel.toFixed(2).padStart(7)}  ${out ? '★越界' : '贴限位'}`);
    }
    if (nLim === 0) console.log('    （无）');
    console.log('');
    console.log('  ── 当帧全部提案（按 |tau| 排序，前 16）──');

    const list = [...lg.entries()].sort((a, b) => Math.abs(b[1].tau) - Math.abs(a[1].tau)).slice(0, 16);
    for (const [k, v] of list) {
      const [nm] = k.split('  ');
      const [n, ax] = nm!.split('/');
      const di = body.dofByName(n!, Number(ax));
      const d = di >= 0 ? body.dofs[di]! : null;
      const app = di >= 0 ? body.executor.appliedOf(di).toFixed(1) : '-';
      console.log(`    ${nm!.padEnd(12)} ${k.split('  ')[1]!.padEnd(22)} ${v.kind.padEnd(7)} tau=${v.tau.toFixed(1).padStart(8)}  applied=${app.padStart(7)}  vel=${d ? d.vel.toFixed(2).padStart(7) : '-'}  ang=${d ? (d.angle * 57.3).toFixed(0) : '-'}°`);
    }
    console.log('');
  }
}
console.log(`\n[结束] t=${w.clock.toFixed(2)} blew=${blew} court=${court ? (court.fall >= 0 ? `fall@${(court.fall - court.settle).toFixed(2)}s` : 'holding') : 'never-entered'}`);
