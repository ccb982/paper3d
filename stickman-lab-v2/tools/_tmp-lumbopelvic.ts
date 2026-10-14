/** _tmp-lumbopelvic.ts —— 脊柱↔盆骨传力回读（单腿 R 支撑）
 *  量：spine1（腰骶接口）逐轴 applied、支撑髋 hip_r 逐轴 applied、踝/膝、盆骨(躯干)世界姿态与角速度、
 *      上身重力矩需求（about spine1 各轴）、逐帧同号性/传导比。
 *  用法：node tools/run.mjs _tmp-lumbopelvic [t0=2.3] [t1=4.2]
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T0 = Number(ARGS[0] ?? 2.3);
const T1 = Number(ARGS[1] ?? 4.2);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const idx = body.indexByKey;

// 上身（spine1 关节以上）质量与 CoM
const joints = (w.sk as unknown as { joints: Array<{ name: string; parentKey: string; childKey: string }> }).joints;
const childMap = new Map<string, string[]>();
for (const j of joints) {
  if (!childMap.has(j.parentKey)) childMap.set(j.parentKey, []);
  childMap.get(j.parentKey)!.push(j.childKey);
}
function subtree(k: string, out: string[]): void {
  out.push(k);
  for (const c of childMap.get(k) ?? []) subtree(c, out);
}
const upperKeys: string[] = [];
subtree(joints.find((j) => j.name === 'spine1')!.childKey, upperKeys);
let upperM = 0; for (const k of upperKeys) upperM += body.bodies[idx.get(k)!]!.mass();
const cPos = new Float64Array(3);
function upperCoM(out: Float64Array): void {
  let M = 0; out.fill(0);
  for (const k of upperKeys) {
    const rb = body.bodies[idx.get(k)!]!; const m = rb.mass(); const t = rb.translation();
    out[0]! += m * t.x; out[1]! += m * t.y; out[2]! += m * t.z; M += m;
  }
  for (let c = 0; c < 3; c++) out[c]! /= M;
}
function needTau(sn: string, ax: number): number {
  const i = body.dofByName(sn, ax); if (i < 0) return 0;
  const d = body.dofs[i]!;
  upperCoM(cPos);
  const r = [cPos[0]! - d.anchorWorld[0]!, cPos[1]! - d.anchorWorld[1]!, cPos[2]! - d.anchorWorld[2]!];
  const F = [0, -upperM * 9.81, 0];
  const cx = r[1]! * F[2]! - r[2]! * F[1]!;
  const cy = r[2]! * F[0]! - r[0]! * F[2]!;
  const cz = r[0]! * F[1]! - r[1]! * F[0]!;
  const u = d.axisWorld;
  return -(u[0]! * cx + u[1]! * cy + u[2]! * cz);
}
const D = (deg: number): number => (deg * 180) / Math.PI;
const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };
const sat = (n: string, ax: number): string => { const i = body.dofByName(n, ax); return i >= 0 && w.executor.ledger[i]!.saturated ? '*' : ' '; };
const torsoIdx = idx.get('torso')!;
function pelvisPose(): { pitch: number; roll: number; wz: number } {
  const rb = body.bodies[torsoIdx]!;
  const q = rb.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
  const pitch = Math.atan2(-ux, uy);
  const roll = Math.atan2(uz, uy);
  const av = rb.angvel();
  return { pitch: D(pitch), roll: D(roll), wz: av.z };
}

console.log(`spine1 接口以上质量=${upperM.toFixed(2)}kg（静载 ${(upperM * 9.81).toFixed(0)}N）`);
console.log('t     | sp1/0(侧)  τ need 同号 | sp1/2(矢)  τ need | hip_r/0  hip_r/2 | ankle/0 ankle/2 | 盆骨pitch° rate | comZ   vz  | fzR%');
for (let s = 0; s < Math.round((T1 + 0.05) / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < T0) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const sp1l = tau('spine1', 0), sp1s = tau('spine1', 2);
  const needL = needTau('spine1', 0), needS = needTau('spine1', 2);
  const hipL = tau('hip_r', 0), hipS = tau('hip_r', 2);
  const p = pelvisPose();
  const W = body.sk.massTotal * 9.81;
  const sameSign = sp1l * hipL >= 0 ? '+' : '✗';
  console.log(
    `${t.toFixed(2)} |${sat('spine1', 0)}${sp1l.toFixed(0).padStart(6)} ${needL.toFixed(0).padStart(5)}   ${sameSign}  |${sat('spine1', 2)}${sp1s.toFixed(0).padStart(6)} ${needS.toFixed(0).padStart(5)} | ${hipL.toFixed(0).padStart(6)} ${hipS.toFixed(0).padStart(6)} | ${tau('foot_r', 0).toFixed(0).padStart(5)} ${tau('foot_r', 2).toFixed(0).padStart(5)} | ${p.pitch.toFixed(1).padStart(6)} ${p.wz.toFixed(2).padStart(6)} | ${ctl.sensors.com[2]!.toFixed(3)} ${ctl.sensors.comVel[2]!.toFixed(3)} | ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}`,
  );
}
