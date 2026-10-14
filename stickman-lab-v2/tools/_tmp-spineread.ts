/** _tmp-spineread.ts —— 单腿站立脊柱回读：逐节力矩 vs 重力需求 + 关节受力(压缩)
 *  用法：node tools/run.mjs _tmp-spineread [axis=0|2] [t0=2.3] [t1=5.6]
 *  输出① 摘要：各关节以上质量/静载/τmax
 *  输出② 时序：spine1/2/3 的 θ(°) / applied τ / need τ（静态重力矩） / Fy(压缩 N)
 *  输出③ 快照(t=2.4/3.4/4.4)：每节每轴全通道分解（pair/span/伺服/前馈/阻尼/被动/限位/饱和）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const axis = Number(ARGS[0] ?? 0);
const T0 = Number(ARGS[1] ?? 2.3);
const T1 = Number(ARGS[2] ?? 5.6);
if (axis !== 0 && axis !== 2 && axis !== 1) throw new Error('axis ∈ {0,1,2}');

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;
const idx = body.indexByKey;

const joints = (w.sk as unknown as { joints: Array<{ name: string; parentKey: string; childKey: string }> }).joints;
const childMap = new Map<string, string[]>();
for (const j of joints) {
  if (!childMap.has(j.parentKey)) childMap.set(j.parentKey, []);
  childMap.get(j.parentKey)!.push(j.childKey);
}
const massOf = (k: string): number => { const i = idx.get(k); return i === undefined ? 0 : body.bodies[i]!.mass(); };
function subtree(k: string, out: string[]): number {
  out.push(k);
  let m = massOf(k);
  for (const c of childMap.get(k) ?? []) m += subtree(c, out);
  return m;
}
const SPINES = ['spine1', 'spine2', 'spine3'] as const;
const ABOVE: Record<string, string[]> = {};
const MASS: Record<string, number> = {};
for (const sn of SPINES) {
  const j = joints.find((x) => x.name === sn)!;
  const keys: string[] = [];
  MASS[sn] = subtree(j.childKey, keys);
  ABOVE[sn] = keys;
}
const deg = (r: number): number => (r * 180) / Math.PI;
const dofsOf = (sn: string, ax: number): number => body.dofByName(sn, ax);
const tauAp = (i: number): number => (i >= 0 ? w.executor.ledger[i]!.applied : 0);

console.log(`── 脊柱链（axis=${axis}）──`);
for (const sn of SPINES) {
  const j = joints.find((x) => x.name === sn)!;
  const cells = ([0, 2] as const).map((ax) => {
    const i = dofsOf(sn, ax); if (i < 0) return `${ax}:-`;
    return `${ax}: τmax=${body.dofs[i]!.tauMax.toFixed(0)}`;
  });
  console.log(`  ${sn}: 承载质量=${MASS[sn]!.toFixed(2)}kg 静载=${(MASS[sn]! * 9.81).toFixed(0)}N 上段=${j.childKey} ${cells.join(' ')}`);
}

const cPos = new Float64Array(3);
function upperCoM(keys: string[], out: Float64Array): number {
  let M = 0; out.fill(0);
  for (const k of keys) {
    const i = idx.get(k)!; const rb = body.bodies[i]!; const m = rb.mass();
    const t = rb.translation();
    out[0]! += m * t.x; out[1]! += m * t.y; out[2]! += m * t.z; M += m;
  }
  for (let c = 0; c < 3; c++) out[c]! /= M;
  return M;
}
/** 关节对子树的需求力矩（静态重力）about 指定轴 */
function needTau(sn: string, ax: number): number {
  const i = dofsOf(sn, ax); if (i < 0) return 0;
  const d = body.dofs[i]!;
  const M = upperCoM(ABOVE[sn]!, cPos);
  const r = [cPos[0]! - d.anchorWorld[0]!, cPos[1]! - d.anchorWorld[1]!, cPos[2]! - d.anchorWorld[2]!];
  const F = [0, -M * 9.81, 0];
  const cx = r[1]! * F[2]! - r[2]! * F[1]!;
  const cy = r[2]! * F[0]! - r[0]! * F[2]!;
  const cz = r[0]! * F[1]! - r[1]! * F[0]!;
  const u = d.axisWorld;
  return -(u[0]! * cx + u[1]! * cy + u[2]! * cz);
}
/** 关节对子树的竖直压缩力（N，向上为正） */
function needFy(sn: string): number {
  return MASS[sn]! * 9.81;
}

console.log(`\n── 时序（${T0}~${T1}s，axis${axis}）：θ° | applied | need(重力矩) | Fy(N) ──`);
console.log('t     | sp1:    θ   τ_ap  τ_need | sp2:    θ   τ_ap  τ_need | sp3:    θ   τ_ap  τ_need | 躯干pitch roll | comZ   vz    | fzR%');
const SNAP_T = [2.4, 3.4, 4.4];
let snapI = 0;
const dur = T1 + 0.05;
for (let s = 0; s < Math.round(dur / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < T0) continue;
  if (snapI < SNAP_T.length && t >= SNAP_T[snapI]!) {
    snap(`t≈${SNAP_T[snapI]!.toFixed(1)}`);
    snapI++;
  }
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const cells: string[] = [];
  for (const sn of SPINES) {
    const i = dofsOf(sn, axis);
    const th = i >= 0 ? deg(body.dofs[i]!.angle) : 0;
    cells.push(`${th.toFixed(1).padStart(6)} ${tauAp(i).toFixed(0).padStart(6)} ${needTau(sn, axis).toFixed(0).padStart(7)}`);
  }
  const tilt = ctl.sensors.torsoTilt;
  const f1 = ctl.sensors.feet[1]!;
  const W = body.sk.massTotal * 9.81;
  console.log(`${t.toFixed(2)} | ${cells.join(' | ')} | ${deg(tilt[0]!).toFixed(1).padStart(6)} ${deg(tilt[1]!).toFixed(1).padStart(5)} | ${ctl.sensors.com[2]!.toFixed(3)} ${ctl.sensors.comVel[2]!.toFixed(3)} | ${(f1.fz / W * 100).toFixed(0)}`);
}
if (snapI < SNAP_T.length) while (snapI < SNAP_T.length) { snap(`(未达 t=${SNAP_T[snapI]}，段末)`); snapI++; }

function snap(tag: string): void {
  console.log(`\n══ 快照 ${tag} ══`);
  for (const sn of SPINES) {
    console.log(` ${sn}（承载 ${needFy(sn).toFixed(0)}N）:`);
    for (const ax of [0, 2, 1]) {
      const i = dofsOf(sn, ax);
      if (i < 0) continue;
      const d = body.dofs[i]!;
      const bd = dr.lastBreakdown[i] ?? {};
      const l = w.executor.ledger[i]!;
      const ref = dr.pairRef[i] ?? 0;
      const C = dr.pairC[i] ?? 0;
      const cap = dr.pairCap[i] ?? Infinity;
      let spanT = 0;
      for (const m of dr.spanMuscles as Array<{ dofs: number[]; c: number; ref: number }>) {
        if (!m.dofs.includes(i) || m.c < 1e-3) continue;
        let sum = 0; for (const dj of m.dofs) sum += body.dofs[dj]!.angle;
        spanT += (-dr.opt.musclePairK * m.c * (sum - m.ref)) / m.dofs.length;
      }
      const axisName = ax === 0 ? '侧屈' : ax === 2 ? '屈伸' : '扭转';
      console.log(
        `   ${ax}(${axisName}): θ=${deg(d.angle).toFixed(2)}° λ=${deg(ref).toFixed(2)}° C=${C.toFixed(2)} cap=${Number.isFinite(cap) ? cap.toFixed(0) : '∞'} need=${needTau(sn, ax).toFixed(0)} applied=${l.applied.toFixed(0)}` +
        `  [act=${(bd.act ?? 0).toFixed(0)} span≈${spanT.toFixed(0)} stiff=${(bd.stiff ?? 0).toFixed(0)} ff=${(bd.ff ?? 0).toFixed(0)} damp=${(bd.damp ?? 0).toFixed(0)} lum=${(bd.lum ?? 0).toFixed(0)}]` +
        ` sat=${l.saturated} writes=${l.writes} vel=${d.vel.toFixed(2)}`,
      );
    }
  }
  const tilt = ctl.sensors.torsoTilt;
  const f1 = ctl.sensors.feet[1]!;
  console.log(` 躯干 pitch=${deg(tilt[0]!).toFixed(2)}° roll=${deg(tilt[1]!).toFixed(2)}° | 支撑脚 fz=${f1.fz.toFixed(0)}N CoPz=${f1.copZ.toFixed(3)} | comZ=${ctl.sensors.com[2]!.toFixed(3)} vz=${ctl.sensors.comVel[2]!.toFixed(3)}`);
}
