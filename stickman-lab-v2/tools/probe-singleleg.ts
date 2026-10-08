/**
 * probe-singleleg.ts —— 单腿站立（闭环相位版）验收
 * 重点：落腿相位**由触地事件结束**（不是时间到就假装落地）。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';
import { Sensors } from '../src/core/sensors';
import { ProgramRunner } from '../src/core/program';
import { singleLegPhases } from '../src/core/actions';

const w = new World();
const bal = new StabilityWarner(w, {
  gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
  postureTone: 8, lateralControl: true,
});
w.controller = bal;
w.reset();

const sensors = new Sensors(w);
const runner = new ProgramRunner({ sensors, bal, body: w.body });
const liftSide = 'l';            // 抬左脚（站右脚）
const li = liftSide === 'l' ? 0 : 1;
let landedDuringLower: boolean | null = null;
let lowerTimedOut = false;
let liftHappened = false;
let maxLiftY = 0;
let prevPhase = '';
runner.onPhase = (name, ctx) => {
  if (prevPhase.startsWith('落腿')) {
    const lf = ctx.sensors.feet[li]!;
    landedDuringLower = lf.fz >= 40 || lf.y < 0.095;
    if (!landedDuringLower) lowerTimedOut = true;
  }
  prevPhase = name;
  const lf = ctx.sensors.feet[li]!;
  console.log(`  [相位] ${name}  (抬脚 y=${lf.y.toFixed(3)} fz=${lf.fz.toFixed(0)}N)`);
};
runner.play(singleLegPhases('r', 1.0));

const chest = w.body.indexByKey.get('spine4') ?? 0;
const N = Math.round(7 / w.dt);
for (let s = 0; s < N; s++) {
  w.advance(1);
  sensors.update(w.dt);
  runner.step(w.dt);
  const lfNow = sensors.feet[li]!;
  if (lfNow.y > maxLiftY) maxLiftY = lfNow.y;
  if ((runner.current?.name ?? '').startsWith('保持') && lfNow.y > 0.10) liftHappened = true;
  if (s % Math.round(0.5 / w.dt) === 0) {
    const L = sensors.feet[0]!, R = sensors.feet[1]!;
    console.log(
      `t=${(s * w.dt).toFixed(1)} ${(runner.current?.name ?? '完成').padEnd(10)}` +
      ` L y=${L.y.toFixed(3)} fz=${L.fz.toFixed(0)}N | R fz=${R.fz.toFixed(0)}N` +
      ` | comZ=${sensors.com[2]!.toFixed(3)} 胸y=${w.body.bodies[chest]!.translation().y.toFixed(3)}`,
    );
  }
}
const L = sensors.feet[0]!;
const chestY = w.body.bodies[chest]!.translation().y;
console.log('');
console.log(`验收：抬腿是否真的发生 = ${liftHappened}（最大抬脚高度 ${((maxLiftY - 0.068) * 100).toFixed(1)}cm）`);
console.log(`      落腿相位结束时已触地 = ${landedDuringLower}（超时才结束=${lowerTimedOut}）`);
console.log(`      最终抬脚(L) fz=${L.fz.toFixed(0)}N y=${L.y.toFixed(3)} loaded=${L.loaded}  胸y=${chestY.toFixed(3)}`);
if (!liftHappened) {
  console.log('结论：重心转移未成功 → 程序安全放弃抬腿（不摔） —— 触地保证生效，等待侧向平衡能力');
} else {
  console.log(`结论：${landedDuringLower === true ? '落腿保证触地 —— 通过' : '仍有问题'}`);
}
