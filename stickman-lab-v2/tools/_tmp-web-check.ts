/** _tmp-web-check: 复现网页快照的关节状态 + 测被动张力目标（pose vs rest）
 *
 *  用户网页实测（放开 t=2.07s）：
 *    knee_l/1 = 13.25°   ← 膝额状轴（小腿相对大腿张开）⇒ 「膝盖内收」
 *    foot_l/0 = 14.73°   ← 踝内翻/外翻，限位 ±14° ⇒ 也超限
 *    hip_l/0  =  2.61°
 *    hip_l/2 = 98.48°  knee_l/2 = −80.79°  foot_l/2 = 27.44°
 *  ★ 用户：「还是关节内收 膝盖和踝不严格竖直」
 *
 *  本探针：
 *    ① 复现网页的逐关节读数（对照）
 *    ② 测「小腿相对大腿张开角」= 膝额状轴读数的物理含义 + 踝的实际姿态
 *    ③ A/B：被动张力目标 'pose' vs 'rest'
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

const run = (cfg: Record<string, string>, until: number): string[] => {
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
  const out: string[] = [];
  for (let s = 0; s < Math.round(until / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  // 逐关节读数（对照网页）
  for (const nm of ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r']) {
    const parts: string[] = [];
    for (const ax of [0, 1, 2]) {
      const i = body.dofByName(nm, ax);
      parts.push(`${(body.dofs[i]!.angle * D).toFixed(2)}`);
    }
    out.push(`  ${nm.padEnd(8)} 角0/1/2 = ${parts.join(' / ')}`);
  }
  // 物理几何：膝/踝的横向位置 + 小腿朝向
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ay = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[1]!;
  out.push(`  膝vs踝L=${((az('knee_l') - az('foot_l')) * 100).toFixed(2)}cm  R=${((az('knee_r') - az('foot_r')) * 100).toFixed(2)}cm`);
  out.push(`  髋vs踝L=${((az('hip_l') - az('foot_l')) * 100).toFixed(2)}cm  R=${((az('hip_r') - az('foot_r')) * 100).toFixed(2)}cm`);
  // 小腿轴（膝→踝）相对竖直
  const shinTilt = (side: 'l' | 'r'): number => {
    const kx = body.dofs[body.dofByName(`knee_${side}`, 2)]!.anchorWorld;
    const fx = body.dofs[body.dofByName(`foot_${side}`, 2)]!.anchorWorld;
    const dz = fx[2]! - kx[2]!;
    const dy = fx[1]! - kx[1]!;
    return Math.atan2(dz, -dy) * D;   // 正 = 小腿往外（+z）
  };
  out.push(`  小腿倾斜 L=${shinTilt('l').toFixed(2)}° R=${shinTilt('r').toFixed(2)}°（正=往外）`);
  const kneeY = ay('knee_l'), footY = ay('foot_l');
  out.push(`  膝y=${(kneeY * 100).toFixed(1)}cm 踝y=${(footY * 100).toFixed(1)}cm`);
  out.push(`  判死：${court.fall >= 0 ? `t=${court.fall.toFixed(2)} ${court.reason}` : '未判死'}`);
  return out;
};

console.log('\n════ A/B：被动张力目标 zero / pose / 关 ════');
console.log('── ① 目标=zero（新默认，几何零=腿竖直） ──');
console.log(run({}, 2.1).join('\n'));
console.log('── ② 目标=pose（钉住摆姿 = 网页当前行为） ──');
console.log(run({ SQC_LT_TARGET: 'pose' }, 2.1).join('\n'));
console.log('── ③ 关被动张力（对照） ──');
console.log(run({ SQC_LEG_TENSION: '0' }, 2.1).join('\n'));
console.log('── ④ zero + 放宽踝限位到 ±20 ──');
console.log(run({}, 4.1).join('\n'));
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
