/**
 * _probe-pad-debug.ts —— +x 轻推轨迹：com / pad 目标 / 实际踝力矩 / CoP
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';
import { Sensors } from '../src/core/sensors';
import { FootPad } from '../src/core/footPad';

const w = new World();
const bal = new StabilityWarner(w, {
  gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
  postureTone: 8, lateralControl: false, postureSkipAnkles: true, ankleStrategy: false,
});
w.controller = bal;
w.reset();
const sn = new Sensors(w);
const pad = new FootPad(w);
pad.enabled = true;
pad.auto = true;
pad.comTargetX = 0; pad.comTargetZ = 0;

const flexL = w.body.dofByName('foot_l', 2);
let pushed = false;
const N = Math.round(2.0 / w.dt);
for (let s = 0; s < N; s++) {
  const t = s * w.dt;
  if (!pushed && t >= 0.5) {
    for (const b of w.body.bodies) b.applyImpulse({ x: b.mass() * 0.12, y: 0, z: 0 }, true);
    pushed = true;
  }
  sn.update(w.dt);
  w.advance(1, () => pad.step(w.dt, sn));
  if (s % 12 === 0) {
    const gt = pad.getTarget('l');
    console.log(
      `t=${t.toFixed(2)} com.x=${sn.com[0]!.toFixed(4)} v.x=${sn.comVel[0]!.toFixed(3)}` +
      ` padL=(${gt.dx.toFixed(3)},${gt.dz.toFixed(3)}) τL=${w.executor.ledger[flexL]!.applied.toFixed(1)}` +
      ` CoP_L.x=${sn.feet[0]!.copX.toFixed(3)} FzL=${sn.feet[0]!.fz.toFixed(0)}`,
    );
  }
}
