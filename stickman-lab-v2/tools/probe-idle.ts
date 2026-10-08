/**
 * probe-idle.ts —— T1 静息测试（生死线）
 *
 * 零重力 / 零驱动 / 零命令：Σ|Δθ| 必须接近 0。
 * v1 的读数是 454°（原生球铰在非零锚点下注入能量）；
 * 新执行层每个自由度都是引擎 revolute ⇒ 目标是 < 1°。
 *
 * 用法：node tools/run.mjs probe-idle [frames]
 */
import './_boot';
import { World } from '../src/core/world';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 720);

const w = new World();
w.driveEnabled = false;
w.setGravityZero();
w.reset();

const a0 = w.body.dofs.map((d) => d.angle);
const s0 = w.executor.checkInvariants();

w.advance(FRAMES);

let sum = 0, sumW = 0, worst = '', worstD = 0;
w.body.dofs.forEach((d, i) => {
  const dd = Math.abs(d.angle - a0[i]!) * 180 / Math.PI;
  sum += dd;
  sumW += Math.abs(d.vel);
  if (dd > worstD) { worstD = dd; worst = `${d.name}/${d.axis}`; }
});
const bad = w.executor.checkInvariants();

console.log('════ T1 静息（零重力 / 零驱动）════');
console.log(`扫描启动违例：${s0.length === 0 ? '无' : s0.join('; ')}`);
console.log(`${FRAMES} 拍（${(FRAMES * w.dt).toFixed(2)}s）后：`);
console.log(`  Σ|Δθ| = ${sum.toFixed(4)}°   Σ|ω| = ${sumW.toFixed(6)} rad/s`);
console.log(`  最差 ${worst || '—'} ${worstD.toFixed(4)}°`);
console.log(`  执行器不变量：${bad.length === 0 ? '通过' : bad.join('; ')}`);
console.log(`  自由度总数 = ${w.body.dofs.length}（逻辑关节 ${w.sk.joints.length}）`);
