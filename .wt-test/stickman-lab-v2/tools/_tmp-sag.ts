/** _tmp-sag: 冻结期矢状大力矩的来源与扭转耦合
 *
 *  实测（_tmp-freeze-left.ts，冻结期 2s）：
 *    ① 现状                    Δ大腿yaw = +40.9°
 *    ② 关矢状基础力 PAIR_OFF=1   Δ大腿yaw = −2.4°  ★
 *    ③ 关踝前馈 ANKLE_FF=0       Δ大腿yaw = −11.9° ★
 *    ④ 关髋软限位                Δ大腿yaw = −3.8°  ★
 *    ⑥ 关踝被动 FRONTAL_PASSIVE=0 Δ大腿yaw = −6.0°  ★
 *  ⇒ 扭转是**矢状向写手经链几何耦合**出来的；被动张力被这股力推着走（±40°）。
 *
 *  本探针：冻结期各矢状向写手的实际力矩 + 关掉组合，找出最小干预集。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;
const ORIG = { ...E };

const run = (cfg: Record<string, string>, verbose = false): string => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const ex = (w as unknown as { executor?: { ledger: Array<{ applied: number; passive: number; cmd: number }> } }).executor;
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const t0 = yaw('thigh_l');
  let sum = { hip2: 0, knee2: 0, foot2: 0, hip0: 0, hip1: 0, knee0: 0, knee1: 0, foot0: 0, foot1: 0 };
  let n = 0;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (ex) {
      const g = (nm: string, ax: number): number => ex.ledger[body.dofByName(nm, ax)]?.applied ?? 0;
      sum.hip2 += g('hip_l', 2); sum.knee2 += g('knee_l', 2); sum.foot2 += g('foot_l', 2);
      sum.hip0 += g('hip_l', 0); sum.hip1 += g('hip_l', 1);
      sum.knee0 += g('knee_l', 0); sum.knee1 += g('knee_l', 1);
      sum.foot0 += g('foot_l', 0); sum.foot1 += g('foot_l', 1);
      n++;
    }
  }
  const d = yaw('thigh_l') - t0;
  const avg = (v: number): string => (n ? (v / n).toFixed(1) : '?').padStart(7);
  if (verbose) {
    console.log(`    均值力矩 N·m: hip2=${avg(sum.hip2)} knee2=${avg(sum.knee2)} foot2=${avg(sum.foot2)} | hip0=${avg(sum.hip0)} hip1=${avg(sum.hip1)} knee0=${avg(sum.knee0)} knee1=${avg(sum.knee1)} foot0=${avg(sum.foot0)} foot1=${avg(sum.foot1)}`);
  }
  return `Δ大腿yaw=${d.toFixed(1).padStart(7)}`;
};

console.log('\n════ 冻结期扭转来源 ════');
const cases: Array<[string, Record<string, string>]> = [
  ['① 现状', {}],
  ['② 关矢状基础力', { SQC_PAIR_OFF: '1' }],
  ['③ 关踝前馈', { SQC_ANKLE_FF: '0' }],
  ['④ 关踝被动', { SQC_FRONTAL_PASSIVE: '0' }],
  ['⑤ 关被动张力(新)', { SQC_LEG_TENSION: '0' }],
  ['⑥ 关踝被动+关被动张力', { SQC_FRONTAL_PASSIVE: '0', SQC_LEG_TENSION: '0' }],
  ['⑦ 关矢状基础力+关踝前馈', { SQC_PAIR_OFF: '1', SQC_ANKLE_FF: '0' }],
  ['⑧ 关踝前馈+关踝被动', { SQC_ANKLE_FF: '0', SQC_FRONTAL_PASSIVE: '0' }],
  ['⑨ 关三个矢状向', { SQC_PAIR_OFF: '1', SQC_ANKLE_FF: '0', SQC_FRONTAL_PASSIVE: '0' }],
  ['⑩ 关三个矢状向+关被动张力', { SQC_PAIR_OFF: '1', SQC_ANKLE_FF: '0', SQC_FRONTAL_PASSIVE: '0', SQC_LEG_TENSION: '0' }],
];
for (const [name, cfg] of cases) {
  console.log(`  ${name.padEnd(28)} ${run(cfg)}`);
}
console.log('\n  现状的各轴平均力矩：');
run({}, true);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
