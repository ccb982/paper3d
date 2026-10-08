/**
 * probe-sensors.ts —— M1 验收：感知读数在站立时是否合理
 * 用法：node tools/run.mjs probe-sensors [seconds]
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';
import { Sensors } from '../src/core/sensors';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECONDS = Number(ARGS[0] ?? 5);

const w = new World();
const bal = new BalanceController(w, {
  gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
  postureTone: 8, lateralControl: true,
});
w.controller = bal;
w.reset();
const sn = new Sensors(w);
const weight = w.sk.massTotal * 9.81;

console.log(`════ M1 Sensors（站立 ${SECONDS}s）════ 体重 ${weight.toFixed(0)}N`);
const N = Math.round(SECONDS / w.dt);
for (let s = 0; s < N; s++) {
  w.advance(1);
  sn.update(w.dt);
  if (s % Math.round(0.5 / w.dt) === 0) {
    const [L, R] = sn.feet;
    const v = Math.hypot(sn.comVel[0]!, sn.comVel[1]!, sn.comVel[2]!);
    const pitch = sn.torsoTilt[0]! * 180 / Math.PI;
    const roll = sn.torsoTilt[1]! * 180 / Math.PI;
    console.log(
      `t=${(s * w.dt).toFixed(1)}s  com=(${sn.com[0]!.toFixed(3)},${sn.com[2]!.toFixed(3)}) |v|=${v.toFixed(3)}  ` +
      `support=${sn.support.padEnd(4)}  Fz L/R=${L!.fz.toFixed(0)}/${R!.fz.toFixed(0)}N  ` +
      `CoP L=(${L!.copX.toFixed(3)},${L!.copZ.toFixed(3)}) R=(${R!.copX.toFixed(3)},${R!.copZ.toFixed(3)})  ` +
      `tilt=${pitch.toFixed(1)}°/${roll.toFixed(1)}°`,
    );
  }
}
const tot = sn.totalFz();
console.log('');
console.log(`末态：ΣFz=${tot.toFixed(0)}N（${(tot / weight * 100).toFixed(0)}% 体重）  support=${sn.support}`);
console.log(`判定：${sn.support === 'both' && Math.abs(tot - weight) / weight < 0.2 ? '读数合理' : '读数异常'}`);
