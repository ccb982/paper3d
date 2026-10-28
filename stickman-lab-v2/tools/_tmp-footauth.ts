/** _tmp-footauth: 脚端的「力链承接能力」实测
 *
 *  用户设计：髋回正力矩 → 传到脚 → 在脚上被地面反力抵消
 *  ⇒ 脚必须有承接权限：
 *     ① 踝 roll 角度余量（能再转多少来产生额向 CoP 偏移）
 *     ② CoP 侧向余量（CoP 到脚掌边缘还有多远）
 *     ③ fz 余量（还能不能多加载）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;
const copBuf = new Float64Array(3);
const W = body.sk.massTotal * 9.81;

const geom = (sd: 'l' | 'r'): void => {
  console.log(`\n──── ${sd} 侧 ────`);
  for (const ax of [0, 1, 2] as const) {
    const i = body.dofByName(`foot_${sd}`, ax);
    if (i < 0) continue;
    const d = body.dofs[i]!;
    const ang = d.angle * 57.3;
    const lo = d.min * 57.3, hi = d.max * 57.3;
    const margin = Math.min(d.max - d.angle, d.angle - d.min) * 57.3;
    console.log(`  foot_${sd}/${ax}: 角=${ang.toFixed(2)}° 限位=[${lo.toFixed(1)},${hi.toFixed(1)}]° 余量=${margin.toFixed(2)}°` +
      ` ${margin <= 0.1 ? '  ★ 顶死' : ''}${d.preRing ? ' [preRing锁死]' : ''}`);
  }
  // 脚掌几何
  const fi = body.indexByKey.get(`foot_${sd}`)!;
  const fp = body.bodies[fi]!.translation();
  const ai = body.dofByName(`foot_${sd}`, 2);
  const ak = body.dofs[ai]!.anchorWorld;
  console.log(`  脚中心 x=${(fp.x * 100).toFixed(1)} z=${(fp.z * 100).toFixed(1)}  踝锚点 x=${(ak[0]! * 100).toFixed(1)} z=${(ak[2]! * 100).toFixed(1)}`);
  // CoP
  const fz = body.footNormalForce(sd, w.dt);
  const ok = body.footCoP(sd, w.dt, copBuf);
  if (ok) {
    const copX = copBuf[0]!;
    const copZ = copBuf[2]!;
    const footHalfW = 0.05;    // 脚半宽（court.ts: halfWid = 0.10/2）
    const halfL = 0.156 * (w.sk.cfg?.height ?? 1.8) / 2;
    console.log(`  fz=${fz.toFixed(0)}N  CoP=(${(copX * 100).toFixed(1)}, ${(copZ * 100).toFixed(1)})cm` +
      `  侧向余量=${((footHalfW - Math.abs(copZ - fp.z)) * 100).toFixed(1)}cm  纵向余量=${((halfL - Math.abs(copX - fp.x)) * 100).toFixed(1)}cm`);
  }
};

console.log(`W=${W.toFixed(0)}N  释放时刻 t=${court.settle}s`);
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
}
console.log('\n════ 释放瞬间（静置期结束）════');
geom('l');
geom('r');

for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
}
console.log('\n════ 释放后 1.5s ════');
geom('l');
geom('r');
console.log(`\nfall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
