/** _tmp-foot-drift.ts —— 支撑脚偏移分解（单腿 R 支撑，零扰动）
 *  读：脚位移动(dx,dz)/世界偏航yaw/俯仰pitch、CoP(x,z)/fz、踝三轴 applied 及通道分解、
 *      小腿/大腿/盆骨的世界偏航（链扭转）、脚 yaw 轴被动通道（stiff/damp/limit）。
 *  用法：node tools/run.mjs _tmp-foot-drift
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;
const DEG = 180 / Math.PI;
const idx = body.indexByKey;

const yawOf = (k: string): number => { const q = body.bodies[idx.get(k)!]!.rotation(); return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * DEG; };
const pitchOf = (k: string): number => { const q = body.bodies[idx.get(k)!]!.rotation(); const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z); return Math.atan2(-ux, uy) * DEG; };
const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };
const bdOf = (n: string, ax: number): { stiff: number; act: number; servo: number; ff: number; damp: number; lum: number } => { const i = body.dofByName(n, ax); return i >= 0 ? (dr.lastBreakdown[i] ?? {}) : {}; };

let tLift = -1;
let base: { x: number; z: number; yaw: number } | null = null;
let maxdx = 0, maxdz = 0, maxdyaw = 0;
console.log('t      | 脚 dx dz (cm) Δyaw° | pitch° | CoPx CoPz fz | 踝0τ(通) | 踝1τ(通) | 踝2τ(通) | 胫yaw 腿yaw 盆yaw | 踝1通道 stiff/damp/ff');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) { tLift = t; const ft = body.bodies[idx.get('foot_r')!]!.translation(); base = { x: ft.x, z: ft.z, yaw: yawOf('foot_r') }; } continue; }
  const dtL = t - tLift;
  if (dtL < 0.02) continue;
  const ft = body.bodies[idx.get('foot_r')!]!.translation();
  const dx = (ft.x - base!.x) * 100, dz = (ft.z - base!.z) * 100;
  const dyaw = yawOf('foot_r') - base!.yaw;
  maxdx = Math.max(maxdx, Math.abs(dx)); maxdz = Math.max(maxdz, Math.abs(dz)); maxdyaw = Math.max(maxdyaw, Math.abs(dyaw));
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[1]!;
  const b0 = bdOf('foot_r', 0), b1 = bdOf('foot_r', 1), b2 = bdOf('foot_r', 2);
  const fmt = (b: { stiff?: number; act?: number; servo?: number; ff?: number; damp?: number; lum?: number }): string =>
    `${(b.stiff ?? 0).toFixed(0)}/${(b.damp ?? 0).toFixed(0)}/${(b.ff ?? 0).toFixed(0)}`;
  console.log(
    `${t.toFixed(2)} | ${dx.toFixed(1).padStart(6)} ${dz.toFixed(1).padStart(6)} ${dyaw.toFixed(1).padStart(6)} | ${pitchOf('foot_r').toFixed(1).padStart(6)} |` +
    ` ${(f.copValid ? f.copX : NaN).toFixed(2)} ${(f.copValid ? f.copZ : NaN).toFixed(2)} ${f.fz.toFixed(0).padStart(4)} |` +
    ` ${tau('foot_r', 0).toFixed(0).padStart(4)}(${fmt(b0)}) | ${tau('foot_r', 1).toFixed(0).padStart(4)}(${fmt(b1)}) | ${tau('foot_r', 2).toFixed(0).padStart(4)}(${fmt(b2)}) |` +
    ` ${yawOf('shin_r').toFixed(0).padStart(4)} ${yawOf('thigh_r').toFixed(0).padStart(4)} ${yawOf('torso').toFixed(0).padStart(4)} | ${fmt(b1)}`,
  );
}
console.log(`\n窗口最大偏移：|dx|=${maxdx.toFixed(1)}cm |dz|=${maxdz.toFixed(1)}cm |Δyaw|=${maxdyaw.toFixed(1)}°`);
