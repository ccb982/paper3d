/** _tmp-drift: 关键测量 —— 逻辑轴↔物理平面的对应关系是否稳定？
 *
 *  若不稳定 ⇒ jointPlane() 这个「按世界轴分类」的思路本身是错的，
 *  所有按 frontalAxis()/torsionAxis() 选轴的写手都是靠不住的。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { jointPlane } from '../src/core/servo/jointPlane';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const PLANE_ZH: Record<string, string> = { frontal: '额', sagittal: '矢', torsion: '扭' };
const WATCH = ['hip_l/0', 'hip_l/1', 'hip_l/2', 'knee_l/0', 'knee_l/1', 'knee_l/2', 'foot_l/0', 'foot_l/1', 'foot_l/2'];

console.log('\n════ 逻辑轴 → 物理平面 随姿态的漂移（蹲姿释放前 2s）════');
console.log(' t     | ' + WATCH.map((x) => x.split('/')[1].padStart(4)).join(' '));
let next = 0;
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (t + 1e-9 < next) continue;
  next = t + 0.25;
  const cells: string[] = [];
  for (const k of WATCH) {
    const [nm, ax] = k.split('/');
    const pl = jointPlane(body, nm, Number(ax)) ?? '?';
    cells.push(PLANE_ZH[pl]!.padStart(4));
  }
  console.log(` ${t.toFixed(2)} | ${cells.join(' ')}`);
}
console.log('\n  列 = 逻辑轴号；值 = 该轴此刻被判定的物理平面');
console.log('  ★ 若同一列的值随时间变了 ⇒ 按平面选轴的写法（frontalAxis/torsionAxis）不可靠');
