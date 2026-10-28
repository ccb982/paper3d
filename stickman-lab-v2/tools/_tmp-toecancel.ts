/** _tmp-toecancel: 「髋回正力 → 传到脚 → 被地面反力抵消」的链路验证
 *
 *  用户设计：髋发侧向力矩把髋拉水平；该力矩沿链传到脚，
 *            由地面反力在脚上抵消 ⇒ 身体不平移。
 *
 *  验证点：
 *   ① 施加髋力矩后，CoP 是否移动？移动多少？有没有跑出脚掌？
 *   ② 脚的 fz 是否变化（= 力矩确实传到了脚）？
 *   ③ 身体（CoM）平移了多少（= 抵消了多少）？
 *   ④ 踝 roll 角度——它顶死限位时还能不能继续转？
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;
const TAU = Number(E.TAU ?? 15);
const DUR = Number(E.DUR ?? 0.4);
const WHICH = String(E.WHICH ?? 'hip_l/0');
const SIDES = String(E.SIDES ?? 'l');

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;
const copBuf = new Float64Array(3);
const halfW = 0.05;
const halfL = 0.156 * (w.sk.cfg?.height ?? 1.8) / 2;

interface FootSnap { fz: number; copX: number; copZ: number; roll: number; ok: boolean }
const snap = (sd: 'l' | 'r'): FootSnap => {
  const fz = body.footNormalForce(sd, w.dt);
  const ok = body.footCoP(sd, w.dt, copBuf);
  const ri = body.dofByName(`foot_${sd}`, 0);
  return {
    fz,
    copX: ok ? copBuf[0]! : NaN,
    copZ: ok ? copBuf[1]! : NaN,   // out[0]=CoPx, out[1]=CoPz, out[2]=法向力
    roll: ri >= 0 ? body.dofs[ri]!.angle * 57.3 : NaN,
    ok,
  };
};
const footCenter = (sd: 'l' | 'r'): { x: number; z: number } => {
  const bi = body.indexByKey.get(`foot_${sd}`)!;
  const t = body.bodies[bi]!.translation();
  return { x: t.x, z: t.z };
};

const sides = SIDES.split(',') as Array<'l' | 'r'>;
const s0 = sides.map((sd) => ({ sd, ...snap(sd) }));
const c0 = sides.map((sd) => ({ sd, ...footCenter(sd) }));
const com0 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };

const [tn, ta] = WHICH.split('/');
const dofIdx = body.dofByName(tn!, Number(ta));

for (let s = 0; s < Math.round((2.0 + DUR + 0.2) / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const rel = court.t - court.settle;
  if (rel > 0 && rel < DUR && dofIdx >= 0) {
    propose({ dof: dofIdx, kind: 'ext', pri: PRI.direct, tau: TAU, src: 'toeProbe', channel: 'probe' });
  }
}

console.log(`\n════ 施加 ${WHICH} τ=${TAU}N·m × ${DUR}s ════`);
for (let i = 0; i < sides.length; i++) {
  const sd = sides[i]!;
  const a = s0[i]!, b = snap(sd), fc = c0[i]!;
  const mz = (Math.abs(b.copZ - fc.z) > halfW ? ' ★出脚掌(侧)' : '');
  const mx = (Math.abs(b.copX - fc.x) > halfL ? ' ★出脚掌(纵)' : '');
  console.log(`[${sd}] fz ${a.fz.toFixed(0)}→${b.fz.toFixed(0)}N (Δ${(b.fz - a.fz).toFixed(0)})` +
    `  CoPz ${(a.copZ * 100).toFixed(1)}→${(b.copZ * 100).toFixed(1)}cm (Δ${((b.copZ - a.copZ) * 100).toFixed(2)})` +
    `  侧余量 ${((halfW - Math.abs(b.copZ - fc.z)) * 100).toFixed(1)}cm${mz}`);
  console.log(`      CoPx ${(a.copX * 100).toFixed(1)}→${(b.copX * 100).toFixed(1)}cm  纵余量 ${((halfL - Math.abs(b.copX - fc.x)) * 100).toFixed(1)}cm${mx}`);
  console.log(`      踝roll ${a.roll.toFixed(2)}→${b.roll.toFixed(2)}°`);
}
const com2 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
console.log(`  身体平移: ΔCoM_z=${((com2.z - com0.z) * 100).toFixed(2)}cm  ΔCoM_x=${((com2.x - com0.x) * 100).toFixed(2)}cm`);
console.log(`  fall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
