/** _tmp-freeze-left: 修限位后剩余的 23.6° 大腿拧转来自哪里
 *
 *  现状（已修 knee 轴1 限位）：
 *    Δ大腿yaw = +23.6°（原 +48.2°）
 *    冻结期读数漂移：knee_l/1  +14.5 → +3.2（自己往 0 跑）
 *                  hip_l/1    0 → +8.6（髋扭转轴在涨）
 *    ⇒ 拧转现在由**髋扭转轴 hip/1** 承担（膝那个已被治住）
 *
 *  本探针 A/B：谁在推 hip/1？
 *    ① 现状
 *    ② 关矢状基础力 SQC_PAIR_OFF=1
 *    ③ 关踝前馈 SQC_ANKLE_FF=0
 *    ④ 关髋软限位 SQC_HIP_SOFT=0
 *    ⑤ 关回正写手 SQC_HIP_STRATEGY=0
 *    ⑥ 关踝被动 SQC_FRONTAL_PASSIVE=0
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

const ORIG = { ...E };
const setEnv = (cfg: Record<string, string>): void => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
};

const run = (): { dThigh: number; hip1: number; knee0: number; knee1: number; hip0: number } => {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const t0 = yaw('thigh_l');
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  return {
    dThigh: yaw('thigh_l') - t0,
    hip1: ang('hip_l', 1), knee0: ang('knee_l', 0), knee1: ang('knee_l', 1), hip0: ang('hip_l', 0),
  };
};

console.log('\n════ 剩余 23.6° 大腿拧转的归因（修限位后）════');
const cases: Array<[string, Record<string, string>]> = [
  ['① 现状', {}],
  ['② 关矢状基础力', { SQC_PAIR_OFF: '1' }],
  ['③ 关踝前馈', { SQC_ANKLE_FF: '0' }],
  ['④ 关髋软限位', { SQC_HIP_SOFT: '0' }],
  ['⑤ 关回正写手', { SQC_HIP_STRATEGY: '0' }],
  ['⑥ 关踝被动', { SQC_FRONTAL_PASSIVE: '0' }],
];
for (const [name, cfg] of cases) {
  setEnv(cfg);
  const r = run();
  console.log(
    `  ${name.padEnd(16)} Δ大腿yaw=${r.dThigh.toFixed(1).padStart(7)} | 终态 hip0=${r.hip0.toFixed(1).padStart(6)} hip1=${r.hip1.toFixed(1).padStart(6)}` +
    ` knee0=${r.knee0.toFixed(1).padStart(6)} knee1=${r.knee1.toFixed(1).padStart(6)}`,
  );
}
setEnv({});
