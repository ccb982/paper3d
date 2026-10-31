/**
 * _probe-roll-cal.ts —— 内外翻指令 → 实际 CoP 外移（独立装配，不被控制回路的 auto 覆盖）
 * World + Sensors + StabilityWarner(基建) + FootPad；逐档 dz，每档前归零。
 */
import './_boot';
import { World } from '../src/core/world';
import { Sensors } from '../src/core/sensors';
import { StabilityWarner } from '../src/core/stability';
import { FootPad } from '../src/core/footPad';

const w = new World();
const sn = new Sensors(w);
const bal = new StabilityWarner(w, {
  gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
  postureTone: 8, ankleStrategy: false, postureSkipAnkles: true,
} as never);
const pad = new FootPad(w);
pad.auto = false;
w.advance(0, () => {});
const step = (n: number) => {
  w.advance(n, () => { sn.update(w.dt); bal.contributeBaseline(); pad.step(w.dt, sn); });
};
step(Math.round(1.5 / w.dt));
const inv = w.body.dofByName('foot_l', 0);
const cop = new Float64Array(3);
console.log(`基线：滚角=${w.body.dofs[inv]!.angle.toFixed(3)}`);
for (const dz of [0.02, 0.04, 0.06, 0.08, 0.10]) {
  pad.setTarget('l', 0, 0); pad.setTarget('r', 0, 0);
  step(Math.round(0.4 / w.dt));
  pad.setTarget('l', 0, dz);
  let sumCop = 0, sumRoll = 0, maxW = 0, n = 0;
  for (let s = 0; s < Math.round(1.0 / w.dt); s++) {
    step(1);
    const ok = w.body.footCoP('l', w.dt, cop);
    if (ok && s > 48) {
      sumCop += cop[1] - sn.feet[0]!.z;
      sumRoll += w.body.dofs[inv]!.angle;
      n++;
    }
    if (s > 48) maxW = Math.max(maxW, Math.abs(w.body.dofs[inv]!.vel));
  }
  console.log(
    `dz=${dz.toFixed(2)} → CoP偏移=${(sumCop / Math.max(n, 1) * 100).toFixed(1)}cm  滚角=${(sumRoll / Math.max(n, 1)).toFixed(3)}  |ω|峰=${maxW.toFixed(1)}`
  );
}
