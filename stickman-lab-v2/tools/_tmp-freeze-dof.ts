/** _tmp-freeze-dof: 冻结期逐 DOF 快照（角/速/preRing/世界轴/施力）+ 关节世界位置
 *
 *  目的：定位「大腿相对小腿拧 55°」是哪个自由度在漂、它有没有被锁、谁在给力。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;
const D = 180 / Math.PI;

const yawBody = (key: string): number => {
  const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
  return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
};
const DOFS = ['hip_l', 'knee_l'] as const;

const dump = (tag: string): void => {
  const ex = (w as unknown as { executor?: { ledger: Array<{ applied: number; cmd: number; writes: number }> } }).executor;
  console.log(`\n── ${tag} ──  (thigh_l yaw=${yawBody('thigh_l').toFixed(1)}°  shin_l yaw=${yawBody('shin_l').toFixed(1)}°  差=${(yawBody('thigh_l') - yawBody('shin_l')).toFixed(1)}°)`);
  for (const nm of DOFS) {
    for (const ax of [0, 1, 2]) {
      const i = body.dofByName(nm, ax);
      if (i < 0) continue;
      const d = body.dofs[i]!;
      const axw = d.axisWorld;
      const l = ex?.ledger[i];
      const lim = `${(d.min * D).toFixed(0)}..${(d.max * D).toFixed(0)}`;
      console.log(
        `   ${nm}/${ax} 角=${(d.angle * D).toFixed(2)}° 速=${d.vel.toFixed(3)}  preRing=${d.preRing ? '★是' : '否'}` +
        ` 限位=${lim.padStart(10)} rest=${(d.rest * D).toFixed(1)}°` +
        ` 世界轴=[${axw[0]!.toFixed(3)},${axw[1]!.toFixed(3)},${axw[2]!.toFixed(3)}]` +
        ` 施加=${l ? l.applied.toFixed(1) : '?'}N·m`,
      );
    }
  }
  // 关节世界位置
  for (const nm of ['hip_l', 'knee_l', 'foot_l'] as const) {
    const a = body.dofs[body.dofByName(nm, 2)]!.anchorWorld;
    console.log(`   ${nm} 锚点世界 = (${(a[0]! * 100).toFixed(1)}, ${(a[1]! * 100).toFixed(1)}, ${(a[2]! * 100).toFixed(1)}) cm`);
  }
};

console.log(`\n════ 冻结期 DOF 快照（KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'} LIVE=${E.SQC_LIVE ?? '0'} GONS=${E.SQC_GONS ?? '0'} ZERO=${E.SQC_ZERO ?? '1'}）════`);
dump('t=0（摆姿刚成形，冻结开始）');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (Math.abs(t - 0.2) < 1e-6) dump('t=0.20s');
  if (Math.abs(t - 1.0) < 1e-6) dump('t=1.00s');
}
dump('t=2.00s（放开瞬间）');
