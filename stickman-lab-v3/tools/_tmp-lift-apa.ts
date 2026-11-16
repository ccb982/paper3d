/** _tmp-lift-apa.ts —— 抬腿期 APA 对照回读（A→B 相，零扰动）
 *  人体标准（Rogers&Pai 1990/95；PM&R 2015）：摆脚离地前，CoM 先移到支撑脚上方；
 *  支撑侧臀中肌"提前+足量"预激活；离地瞬间髋力矩≈静态单腿需求(40-60N·m)，无尖峰。
 *  本探针：t=1.5~2.4s 每0.02s：摆脚fz、撑脚fz、CoM−撑脚(z,x)、CoM速度、hip_r/0 applied/sat、
 *          盆骨roll、大腿世界倾、支撑髋 pair dev。
 *  用法：node tools/run.mjs _tmp-lift-apa
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ABL = ARGS[0] ?? 'base';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dr = (ctl.warner as unknown as { drive: any }).drive;
const DEG = 180 / Math.PI;
if (ABL === 'noFollow') {
  // 消融：去掉支撑髋 λ 的"重力矩跟随"项 −(W×dLat)/effK（近似还原 +项）
  const effKp = Math.max(60, (dr.opt.musclePairK as number) * 0.8);
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (d.name === 'hip_r' && d.axis === 0) {
      const Wtot = body.sk.massTotal * 9.81;
      const dLat = ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z;
      return o(i, c, ref + (Wtot * dLat) / effKp);
    }
    return o(i, c, ref);
  };
}

const hip0 = body.dofByName('hip_r', 0);
const hip2 = body.dofByName('hip_r', 2);
const hipA = (): [number, number, number] => { const a = body.dofs[hip2]!.anchorWorld; return [a[0]!, a[1]!, a[2]!]; };
const tIdx = body.indexByKey.get('torso')!;

console.log('t      | 摆fz 撑fz | CoM−撑脚 dx,dz(cm) | CoM vz,vx(cm/s) | hip0τ sat | hip0 λ,θ(°) | 盆roll° 腿倾° | 摆hip2τ 摆knee2τ');
for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 1.50) continue;
  if (s % Math.round(0.02 / w.dt) !== 0) continue;
  const hipL = body.dofByName('hip_l', 2), kneeL = body.dofByName('knee_l', 2);
  const tauL = hipL >= 0 ? w.executor.ledger[hipL]!.applied : 0;
  const tauK = kneeL >= 0 ? w.executor.ledger[kneeL]!.applied : 0;
  const fSw = ctl.sensors.feet[0]!.fz, fSt = ctl.sensors.feet[1]!.fz;
  const fz = ctl.sensors.feet[1]!;
  const com = ctl.sensors.com;
  const dx = (com[0]! - fz.x) * 100, dz = (com[2]! - fz.z) * 100;
  const tauA = hip0 >= 0 ? w.executor.ledger[hip0]!.applied : 0;
  const sat = hip0 >= 0 && w.executor.ledger[hip0]!.saturated ? '*' : ' ';
  const lam = hip0 >= 0 ? (dr.pairRef[hip0] ?? 0) : 0;
  const th = hip0 >= 0 ? body.dofs[hip0]!.angle : 0;
  const q = body.bodies[tIdx]!.rotation();
  const roll = Math.atan2(2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)) * DEG;
  const ha = hipA(); const ka = body.dofs[body.dofByName('knee_r', 2)]!.anchorWorld;
  const legTilt = Math.atan2(ka[2]! - ha[2]!, -(ka[1]! - ha[1]!)) * DEG;
  console.log(
    `${t.toFixed(2)}  | ${fSw.toFixed(0).padStart(4)} ${fSt.toFixed(0).padStart(4)} | ${dx.toFixed(1).padStart(6)} ${dz.toFixed(1).padStart(6)} | ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[0]! * 100).toFixed(1).padStart(5)} | ${tauA.toFixed(0).padStart(7)} ${sat} | ${(lam * DEG).toFixed(1).padStart(5)} ${(th * DEG).toFixed(1).padStart(5)} | ${roll.toFixed(1).padStart(5)} ${legTilt.toFixed(1).padStart(5)} | ${tauL.toFixed(0).padStart(7)} ${tauK.toFixed(0).padStart(7)} | ${(ctl.warner.getComTarget().z * 100).toFixed(1).padStart(6)} ${(ctl.pad.getTarget('r').dz * 100).toFixed(1).padStart(5)} ${(ctl.pad.getTarget('l').dz * 100).toFixed(1).padStart(5)} ${(fz.copValid ? fz.copZ : NaN).toFixed(3)}`,
  );
}
