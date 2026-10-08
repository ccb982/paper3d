/**
 * probe-idle.ts —— ★★ T1 静息测试（v2 的生死线）
 *
 * 判据：**关重力、零力矩、零控制器**，静置 N 秒后：
 *     Σ|Δθ| 应 < 1°（各轴相对初始姿态的位移绝对值之和）
 *     全关节 Σ|相对角速度| 应 → 0（收敛）
 *     torso.y 不应变化
 *
 * v1 的对照读数（同样条件，240 拍）：**Σ|Δθ| = 454°**，
 *   `knee_l/2` 自己弯到 −114°，`torso.y` 1.429→1.511 m（无重力下浮起来）。
 *
 * 为什么这条是生死线：**零输入下身体自己会动** ⇒ 之后任何"平衡/行走"的读数
 * 都建立在会自激的物理上，无法归因。v1 就死在这里。
 *
 * 用法：node tools/run.mjs probe-idle [frames] [grav=off|on]
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 720);          // 默认 3s @240Hz
const GRAV = ARGS[1] ?? 'off';                  // 默认关重力
const DRIVE = ARGS[2] ?? 'off';                 // 默认关驱动（测纯约束漂移）

const w = new World({ ...DEFAULT_WORLD_OPTIONS });
w.driveEnabled = DRIVE !== 'off';
if (GRAV === 'off') w.setGravityZero();
w.body.reset();

const nj = w.sk.joints.length;
const DEG = 180 / Math.PI;
const rr = new Float64Array(3);

console.log('════ T1 静息测试（v2）════');
console.log(`重力=${GRAV}  驱动=${DRIVE}  ${FRAMES} 拍 = ${(FRAMES * w.dt).toFixed(2)}s @${w.opt.physicsHz}Hz`);
console.log('');

// 记录初始姿态
const a0: number[] = [];
for (let i = 0; i < nj; i++) { w.body.jointRot(i, rr); for (let k = 0; k < 3; k++) a0[i * 3 + k] = rr[k]!; }
const y0 = w.sk.bodies.find((b) => /^spine\d+$/.test(b.key))?.cy ?? 0;

// ★ 关键：步进时**不施加任何力矩**（onStep 什么都不做）
w.advance(FRAMES);

// 结果
let sum = 0, sumW = 0;
const drift: { name: string; ax: number; v0: number; v1: number; d: number }[] = [];
for (let i = 0; i < nj; i++) {
  w.body.jointRot(i, rr);
  const rv = new Float64Array(3);
  w.body.jointRelVel(i, rv);
  sumW += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
  for (let k = 0; k < 3; k++) {
    const d = (rr[k]! - a0[i * 3 + k]!) * DEG;
    sum += Math.abs(d);
    if (Math.abs(d) > 0.5) drift.push({ name: w.sk.joints[i]!.name, ax: k, v0: a0[i * 3 + k]! * DEG, v1: rr[k]! * DEG, d });
  }
}
drift.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

const spineTop = w.sk.bodies.filter((b) => /^spine\d+$/.test(b.key)).pop();
const yi = w.body.indexByKey.get(spineTop!.key) ?? 0;
const y1 = w.body.bodies[yi]!.translation().y;

const com = new Float64Array(3);
w.body.com(com);

console.log(`Σ|Δθ|            = ${sum.toFixed(3)}°        (判据: < 1.0°)`);
console.log(`Σ|相对角速度|     = ${sumW.toFixed(6)} rad/s  (应 → 0)`);
console.log(`躯干 y           = ${y0.toFixed(4)} → ${y1.toFixed(4)} m   (Δ=${((y1 - y0) * 1000).toFixed(1)} mm)`);
console.log(`CoM              = (${com[0]!.toFixed(4)}, ${com[1]!.toFixed(4)}, ${com[2]!.toFixed(4)}) m`);
console.log('');

if (drift.length) {
  console.log('漂移轴（|Δθ| > 0.5°）：');
  console.log('joint/ax      |   初始(°)  →   末态(°)  |   Δθ(°)');
  for (const d of drift.slice(0, 20)) {
    console.log(`${(d.name + '/' + d.ax).padEnd(13)} | ${d.v0.toFixed(2).padStart(8)} → ${d.v1.toFixed(2).padStart(8)} | ${d.d.toFixed(2).padStart(7)}`);
  }
  console.log('');
}

// 执行器记账检查（本步无人写 ⇒ applied 应全 0）
let appliedNonZero = 0;
for (let i = 0; i < nj * 3; i++) if (Math.abs(w.body.executor.ledger[i]!.applied) > 1e-9) appliedNonZero++;
console.log(`执行器 applied 非零轴数 = ${appliedNonZero} / ${nj * 3}   (零力矩下应为 0)`);
console.log('');

const T1_PASS = sum < 1.0 && sumW < 1e-3;
console.log(`════ T1 判定：${T1_PASS ? '✔ 通过' : '✘ 失败'} ════`);
if (!T1_PASS) {
  console.log(`  v1 的对照读数：Σ|Δθ| = 454°，本实现 = ${sum.toFixed(1)}°`);
  console.log(`  ⇒ 若本实现也很大，漂移源**不在** v1 的那些开关里，要查装配层（body.ts）。`);
}
