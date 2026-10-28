/** _tmp-ka: 踝被动刚度参数扫描（找「管住踝」又不制造扭转的组合）
 *
 *  已实测（_tmp-ankle2.ts）：
 *    A 只写踝额状轴(0)  → Δ大腿yaw +35.3°  ✘（该轴世界轴偏水平 29° ⇒ 泄漏）
 *    内置写踝额状+扭转   → Δ大腿yaw −11.1°  ✔
 *  ⇒ 踝**扭转轴(1)**的刚力是好的，踝**额状轴(0)**的角弹簧是坏的。
 *
 *  本探针：扫描 SQC_LT_K_ANKLE（额状/扭转共用）与是否关踝前馈，
 *  指标 = 冻结期 Δ大腿yaw / 踝额状读数 / 膝vs踝（竖直度）/ 踝扭转读数
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

const run = (cfg: Record<string, string>): string => {
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
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const t0 = yaw('thigh_l');
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  const d = yaw('thigh_l') - t0;
  return `Δ大腿yaw=${d.toFixed(1).padStart(7)} | 踝额状 L=${ang('foot_l', 0).toFixed(1).padStart(6)} 扭转 L=${ang('foot_l', 1).toFixed(1).padStart(6)}` +
    ` | 膝额状 L=${ang('knee_l', 1).toFixed(1).padStart(6)}` +
    ` | 膝vs踝 L=${((az('knee_l') - az('foot_l')) * 100).toFixed(1).padStart(6)} R=${((az('knee_r') - az('foot_r')) * 100).toFixed(1).padStart(6)}` +
    ` | 判死 ${court.fall >= 0 ? court.fall.toFixed(2) : '无'}`;
};

console.log('\n════ 踝被动刚度扫描 ════');
const cases: Array<[string, Record<string, string>]> = [
  ['默认 KA=30', {}],
  ['KA=0（踝无被动）', { SQC_LT_K_ANKLE: '0' }],
  ['KA=10', { SQC_LT_K_ANKLE: '10' }],
  ['KA=60', { SQC_LT_K_ANKLE: '60' }],
  ['KA=30 + 关踝前馈', { SQC_ANKLE_FF: '0' }],
  ['KA=0 + 关踝前馈', { SQC_ANKLE_FF: '0', SQC_LT_K_ANKLE: '0' }],
  ['KA=30 + 踝扭转刚度×3', { SQC_LT_K_ANKLE: '30' }],
  ['关踝前馈 + 关矢状基础力', { SQC_ANKLE_FF: '0', SQC_PAIR_OFF: '1' }],
];
for (const [name, cfg] of cases) console.log(`  ${name.padEnd(26)} ${run(cfg)}`);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
