/** _tmp-lat-source.ts —— "横向神秘推力"消融（单腿保持期，逐写手冻结为纯C）
 *  用法：node tools/run.mjs _tmp-lat-source [base|freezeHip0|freezeAnk0|freezeSpine0|freezeHipYaw|freezeSwing]
 *  输出：+0.5/1.0/1.5/2.0s 的 CoM dz/dx、足R fz、足R偏航；框内/破框
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ABL = ARGS[0] ?? 'base';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const dr = (ctl.warner as unknown as { drive: any }).drive;
const body = w.body;
const idx = body.indexByKey;

const freezePair = (pred: (name: string, axis: number) => boolean): void => {
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (pred(d.name, d.axis)) return o(i, c, d.angle);
    return o(i, c, ref);
  };
};
if (ABL === 'freezeHip0') freezePair((n, a) => /^hip_/.test(n) && a === 0);
if (ABL === 'freezeAnk0') freezePair((n, a) => /^foot_/.test(n) && a === 0);
if (ABL === 'freezeSpine0') freezePair((n, a) => /^spine/.test(n) && a === 0);
if (ABL === 'freezeSwing') freezePair((n) => /_l$/.test(n));
if (ABL === 'freezeHipYaw') {
  const o = dr.setTorque.bind(dr);
  dr.setTorque = (i: number, t: number) => {
    const d = body.dofs[i]!;
    if (/^hip_/.test(d.name) && d.axis === 1) return o(i, 0);
    return o(i, t);
  };
}

let tLift = -1, inBox = 0, firstBreach = -1;
const marks: Record<string, string> = {};
let minFz = 1e9, maxYaw = 0;
let pitch0 = 0, roll0 = 0;
const DEG = 180 / Math.PI;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) {
    if (!isLiftDone()) continue;
    tLift = t;
    pitch0 = ctl.sensors.torsoTilt[0]! * DEG;
    roll0 = ctl.sensors.torsoTilt[1]! * DEG;
    continue;
  }
  const pitchRel = ctl.sensors.torsoTilt[0]! * DEG - pitch0;
  const tiltRel = ctl.sensors.torsoTilt[1]! * DEG - roll0;
  const ok = Math.abs(pitchRel) <= 20 && Math.abs(tiltRel) <= 10;
  if (ok) inBox += w.dt; else if (firstBreach < 0) firstBreach = t;
  const dtL = t - tLift;
  if (dtL <= 2.0) {
    const fr = ctl.sensors.feet[1]!;
    minFz = Math.min(minFz, fr.fz);
    const q = body.bodies[idx.get('foot_r')!]!.rotation();
    const yaw = Math.abs(Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * DEG);
    if (yaw < 170) maxYaw = Math.max(maxYaw, yaw);
  }
  for (const m of [0.5, 1.0, 1.5, 2.0]) {
    const key = `+${m.toFixed(1)}`;
    if (dtL >= m && !marks[key]) {
      marks[key] = `dz=${(ctl.sensors.com[2]! * 100).toFixed(1)} dx=${(ctl.sensors.com[0]! * 100).toFixed(1)} fz=${ctl.sensors.feet[1]!.fz.toFixed(0)}`;
    }
  }
}
console.log(
  `${ABL.padEnd(12)} | 框=${inBox.toFixed(2)}s 破=${firstBreach > 0 ? (firstBreach - tLift).toFixed(2) : 'never'} 足R最低fz=${minFz.toFixed(0)} 最大|yaw|=${maxYaw.toFixed(0)}° | ` +
  ['+0.5', '+1.0', '+1.5', '+2.0'].map((k) => `${k}: ${marks[k] ?? '-'}`).join(' | '),
);
