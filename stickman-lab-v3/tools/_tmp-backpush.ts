/** _tmp-backpush.ts —— 后倒救援测试（用户："向后倒没人救"）
 *  用法：node tools/run.mjs _tmp-backpush [pushN=18]
 *  确定性单腿；抬腿+1.2s 在躯干施加向后冲量（−x）→ 每 0.1s 回读 pitch 链各轴（踝电机/膝/髋/脊柱）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const PUSH = Number(ARGS[0] ?? 18);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const dr = (ctl.warner as unknown as {
  drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }> };
}).drive;
const axes: Array<[string, number]> = [
  ['foot_r', 2], ['knee_r', 2], ['hip_r', 2], ['spine1', 2], ['spine2', 2], ['spine3', 2],
];
const dIdx = axes.map(([n, a]) => w.body.dofByName(n, a));
const ixT = w.body.indexByKey.get('torso') ?? -1;
let tLift = -1, nextMark = 0, pushed = false;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); } continue; }
  if (!pushed && t - tLift > 1.2 && ixT >= 0) {
    const rb = w.body.bodies[ixT]! as unknown as { applyImpulse(v: { x: number; y: number; z: number }, wake: boolean): void };
    rb.applyImpulse({ x: -PUSH, y: 0, z: 0 }, true);   // 向后推
    pushed = true;
    console.log(`>>> 后推 ${PUSH} @+${(t - tLift).toFixed(2)}s`);
  }
  if (t >= nextMark) {
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const cells = axes.map(([n, a], k) => {
      const i = dIdx[k]!;
      if (i < 0) return `${n}/${a}:-`;
      const d0 = w.body.dofs[i]!;
      if (d0.engineMotor) {
        const mt = (d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0;
        return `${n}/${a}:电${mt.toFixed(0)}`;
      }
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      const net = b.act + b.servo + b.stiff + b.damp;
      return `${n}/${a}:净${net.toFixed(0).padStart(4)}`;
    });
    console.log(`+${(t - tLift).toFixed(1)}s 前=${pitch.toFixed(1).padStart(6)}° | ${cells.join(' ')}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 3.2) break;
}
