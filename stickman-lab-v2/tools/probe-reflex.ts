/**
 * probe-reflex.ts —— 通用恢复反射验收：分级调用 + 放弃
 * 逐级加大推力（+x），看模式序列与最终结果是否符合"垫脚→髋→放弃"。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';
import { Sensors } from '../src/core/sensors';
import { RecoveryReflexes, type RecoveryMode } from '../src/core/reflex';

interface Out { modes: string; finalCom: number; chestY: number; }

function run(dv: number): Out {
  const w = new World();
  const bal = new StabilityWarner(w, {
    gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: false,
    ankleStrategy: false, postureSkipAnkles: true,
  });
  w.controller = bal;
  w.reset();
  const sn = new Sensors(w);
  const rx = new RecoveryReflexes(w, sn);
  rx.comTargetX = 0; rx.comTargetZ = 0;
  const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
  let pushed = false, peak = 0;
  const seq: string[] = [];
  let lastMode: RecoveryMode | '' = '';
  const N = Math.round(3.0 / w.dt);
  for (let s = 0; s < N; s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: b.mass() * dv, y: 0, z: 0 }, true);
      pushed = true;
    }
    sn.update(w.dt);
    w.advance(1, () => rx.step(w.dt));
    if (rx.mode !== lastMode) { seq.push(`${t.toFixed(2)}s:${rx.mode}`); lastMode = rx.mode; }
    const e = Math.hypot(sn.com[0]!, sn.com[2]!);
    if (e > peak) peak = e;
  }
  return {
    modes: seq.join(' → '),
    finalCom: Math.hypot(sn.com[0]!, sn.com[2]!),
    chestY: w.body.bodies[chest]!.translation().y,
  };
}

console.log('════ 通用恢复反射：推力分级（+x，0.5s 施加）════');
console.log('推力Δv    模式序列                                        末|CoM|   胸y     结论');
for (const dv of [0.06, 0.12, 0.25, 0.5, 0.9]) {
  const r = run(dv);
  const ok = r.finalCom < 0.045 && r.chestY > 1.3;
  console.log(
    `${dv.toFixed(2)}m/s  ${r.modes.padEnd(46)} ${(r.finalCom * 100).toFixed(1).padStart(5)}cm  ${r.chestY.toFixed(3)}  ${ok ? '恢复' : '倒了/放弃'}`,
  );
}
console.log('\n说明：0.25/0.5 级失败可能是髋策略方向或幅度没调好（下轮修）；0.9 级应走 giveup。');
