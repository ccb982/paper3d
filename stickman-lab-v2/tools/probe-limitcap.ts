/**
 * probe-limitcap.ts —— 打印 limitBiasMax 的实际值，判断是否失控
 * 用法：node tools/run.mjs probe-limitcap
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const w = new World({ ...DEFAULT_WORLD_OPTIONS });
w.setGravityZero();
w.body.reset();

const nj = w.sk.joints.length;
console.log('════ limitBiasMax（rad/s）与轴惯量 ════');
console.log('joint/ax     |  τmax(N·m) |   I_轴(kg·m²) |  limitBiasMax |  马达冲量 | 限位冲量 | 比值');
for (let i = 0; i < nj; i++) {
  const j = w.sk.joints[i]!;
  for (let k = 0; k < 3; k++) {
    const tmax = Math.abs(j.maxTorque?.[k] ?? 0);
    if (tmax === 0) continue;
    const Iax = w.body.axisInertia(i, k);
    const cap = w.body.limitBiasMaxOf(i, k);
    const motorImp = tmax / 240;
    const limImp = cap * Iax * (1 / 240);
    const ratio = limImp / motorImp;
    const flag = ratio < 3 ? '  ✘ 拦不住' : ratio > 500 ? '  ⚠ 过大' : '';
    console.log(
      `${(j.name + '/' + k).padEnd(12)} | ${tmax.toFixed(1).padStart(10)} | ${Iax.toExponential(3).padStart(13)} | ${cap.toFixed(1).padStart(13)} | ${motorImp.toFixed(4).padStart(9)} | ${limImp.toFixed(4).padStart(8)} | ${ratio.toFixed(2).padStart(8)}${flag}`,
    );
  }
}
