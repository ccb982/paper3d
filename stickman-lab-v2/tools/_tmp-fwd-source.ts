/** _tmp-fwd-source.ts —— "向前的力"来源消融：单腿保持期逐写手消融（一次进程只跑一项）
 *  用法：node tools/run.mjs _tmp-fwd-source [base|sagPair|spanSag|hip2|ankle2|swing|latPair]
 *  输出：抬脚时刻、框内、破框(pitch)、+0.3/0.6/0.9/1.2s 的 comX/pitchRel/vx
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
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

const dropPair = (pred: (name: string, axis: number) => boolean): void => {
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (pred(d.name, d.axis)) return o(i, 0, 0);
    return o(i, c, ref);
  };
};
if (ABL === 'sagPair') dropPair((n, a) => /^spine/.test(n) && a === 2);
if (ABL === 'latPair') dropPair((n, a) => /^spine/.test(n) && a === 0);
if (ABL === 'hip2') dropPair((n, a) => /^hip_/.test(n) && a === 2);
if (ABL === 'ankle2') dropPair((n, a) => /^foot_/.test(n) && a === 2);
if (ABL === 'swing') dropPair((n) => /_l$/.test(n));
if (ABL === 'pressHold') {
  // 去掉"蹬地方向偏置"：ref 改为当前角（纯 C 刚度，无偏置）——两侧全部 foot/2
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (/^foot_/.test(d.name) && d.axis === 2) return o(i, c, d.angle);
    return o(i, c, ref);
  };
}
if (ABL === 'swingFoot2') {
  // 只去摆动侧（_l）foot/2 的 ref 偏置
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (/^foot_l$/.test(d.name) && d.axis === 2) return o(i, c, d.angle);
    return o(i, c, ref);
  };
}
if (ABL === 'pressNeg') {
  const o = dr.commandMusclePair.bind(dr);
  dr.commandMusclePair = (i: number, c: number, ref: number) => {
    const d = body.dofs[i]!;
    if (/^foot_/.test(d.name) && d.axis === 2) return o(i, c, -Math.abs(ref));
    return o(i, c, ref);
  };
}
if (ABL === 'spanSag') {
  const o = dr.commandSpanMuscles.bind(dr);
  dr.commandSpanMuscles = (l: Array<{ dofs: number[] }>) =>
    o(l.filter((m) => !m.dofs.every((di) => body.dofs[di]!.axis === 2)));
}

let liftT = -1, firstBreach = -1, firstBreachPitch = 0, firstBreachTilt = 0, inBox = 0;
const marks: Record<string, string> = {};
let ankMark = '-';
const DT = w.dt;
const T = 5.6;
for (let s = 0; s < Math.round(T / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const U = obs({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as unknown as never, 'r');
  if (liftT < 0 && isLiftDone()) liftT = t;
  const ok = Math.abs(U.pitchRelDeg) <= 20 && Math.abs(U.tiltRelDeg) <= 10;
  if (liftT >= 0) {
    if (ok) inBox += DT;
    else if (firstBreach < 0) { firstBreach = t; firstBreachPitch = U.pitchRelDeg; firstBreachTilt = U.tiltRelDeg; }
    const dtL = t - liftT;
    for (const m of [0.3, 0.6, 0.9, 1.2]) {
      const key = `+${m.toFixed(1)}`;
      if (dtL >= m && !marks[key]) {
        marks[key] = `comX=${ctl.sensors.com[0]!.toFixed(3)} pitch=${U.pitchRelDeg.toFixed(1)} vx=${ctl.sensors.comVel[0]!.toFixed(3)}`;
      }
    }
    if (dtL >= 0.6 && ankMark === '-') {
      const i = w.body.dofByName('foot_r', 2);
      if (i >= 0) {
        const d = w.body.dofs[i]!;
        ankMark = `θ=${(d.angle * 57.3).toFixed(1)}° λ=${((dr.pairRef[i] ?? 0) * 57.3).toFixed(1)}° C=${(dr.pairC[i] ?? 0).toFixed(2)} τ=${w.executor.ledger[i]!.applied.toFixed(0)}${w.executor.ledger[i]!.saturated ? '*' : ''}`;
      }
    }
  }
}
console.log(
  `${ABL.padEnd(8)} | 框=${inBox.toFixed(2)}s 破=${firstBreach > 0 ? (firstBreach - liftT).toFixed(2) + 's(pitch' + firstBreachPitch.toFixed(1) + '° tilt' + firstBreachTilt.toFixed(1) + '°)' : 'never'} | ` +
  ['+0.3', '+0.6', '+0.9', '+1.2'].map((k) => `${k}: ${marks[k] ?? '-'}`).join(' | ') +
  ` | 踝2@+0.6 ${ankMark}`,
);
