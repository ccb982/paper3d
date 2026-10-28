/** _tmp-court-final: 修复后的蹲下法庭全程（冻结 2s → 放开 → 判死）
 *
 *  验证两件事：
 *   ① 冻结期大腿不再拧（膝盖不朝内）
 *   ② 放开后能不能站住（判死时间 / 原因）
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
const kz = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
const ank = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;

console.log('\n════ 蹲下法庭全程（修复后）════');
console.log('  t   | 释放 | 大腿yawL 大腿vs小腿 | 膝vs踝L 膝vs踝R | comZ  comY | 髋z   膝z   踝z | 判死');
let last = -1;
for (let s = 0; s < Math.round(8.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (Math.round(t * 10) % 20 !== 0) continue;
  const c = ctl.sensors.com;
  console.log(
    ` ${t.toFixed(2)} | ${court.released ? '是' : '冻结'} |` +
    ` ${yaw('thigh_l').toFixed(1).padStart(7)} ${(yaw('thigh_l') - yaw('shin_l')).toFixed(1).padStart(8)} |` +
    ` ${((kz('knee_l') - ank('foot_l')) * 100).toFixed(1).padStart(6)} ${((kz('knee_r') - ank('foot_r')) * 100).toFixed(1).padStart(6)} |` +
    ` ${(c[2]! * 100).toFixed(1).padStart(5)} ${(c[1]! * 100).toFixed(1).padStart(5)} |` +
    ` ${(kz('hip_l') * 100).toFixed(1).padStart(5)} ${(kz('knee_l') * 100).toFixed(1).padStart(5)} ${(kz('foot_l') * 100).toFixed(1).padStart(5)} |` +
    ` ${court.fall >= 0 ? `判死 t=${court.fall.toFixed(2)} ${court.reason}` : ''}`,
  );
  last = t;
}
console.log(`\n★ 判死：${court.fall >= 0 ? `t=${court.fall.toFixed(2)}s  ${court.reason}` : '未判死（站住了）'}`);
console.log(`★ env：KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'} LT_K=${E.SQC_LT_K ?? '60'} LT_B=${E.SQC_LT_B ?? '3'}`);
void last;
