/**
 * probe-anchor-err —— ★ 关节锚点自洽性检验（漂移的最终嫌疑）
 *
 * 已排除：限位冲量 / 阻尼 / 弓马达 / 自由关节系统。
 * 剩余唯一能量源：**Rapier 关节约束求解器**。
 * 零重力下的"自己动"只能来自**约束的位置误差被求解器当能量注入**。
 *
 * 检验：构建后（`begin()` 后、任何 advance 之前）读每个关节的
 *   父体锚点世界坐标 vs 子体锚点世界坐标 —— 两者**必须重合**（差 < 1e-6 m）。
 * 若不重合，求解器第一步就会把它们"拉合"，产生速度 ⇒ 自激。
 *
 * 另需检查：`restRad` 是否与骨架实际静姿态一致（jointRot() 在 t=0 应为 ~0）。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const nj = sk.joints.length;
const rr = new Float64Array(3);

console.log('════ ① t=0（未步进）关节读数与锚点自洽性 ════');
console.log('');

const sim: any = new Sim(sk, shapeForJoints(nj), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
sim.begin(new Float32Array(sim.paramCount));
const d: any = sim.doll;
sim.world.gravity = { x: 0, y: 0, z: 0 };

// jointRot 在 t=0 应 ≈ 0（restRad 已扣除）——非 0 说明 restRad 与实际姿态不符
console.log('jointName    | t=0 关节角(°) [x,y,z]      | restRad(°)');
let badRest = 0;
for (let i = 0; i < nj; i++) {
  d.jointRot(i, rr);
  const deg = [rr[0] * 180 / Math.PI, rr[1] * 180 / Math.PI, rr[2] * 180 / Math.PI];
  const rest = sk.joints[i].restRad.map((v: number) => v * 180 / Math.PI);
  const isBad = deg.some((v: number) => Math.abs(v) > 1.0);
  if (isBad) badRest++;
  console.log(
    `${sk.joints[i].name.padEnd(12)} | ${deg.map((v: number) => v.toFixed(2).padStart(7)).join(' ')} | ${rest.map((v: number) => v.toFixed(2).padStart(6)).join(' ')}${isBad ? '   ← t=0 非零!' : ''}`,
  );
}
console.log(`\n⇒ t=0 关节角非零的轴数：${badRest} / ${nj}（应为 0：restRad 已扣，零位 = 素材姿势）`);

// ── 锚点自洽性：父体锚点世界点 vs 子体锚点世界点
console.log('');
console.log('════ ② 锚点自洽性（父世界点 vs 子世界点，差应 < 1e-6 m）════');
console.log('');
console.log('jointName    |    Δx(mm)    Δy(mm)    Δz(mm)   | |Δ|(mm) | 判定');
let worst = 0, worstName = '';
for (let i = 0; i < nj; i++) {
  const j = sk.joints[i];
  const pi = d.jointBodies[i * 2], ci = d.jointBodies[i * 2 + 1];
  const bp = d.bodies[pi], bc = d.bodies[ci];
  // 手动算：世界点 = T_body * parentLocal
  // ★ toWorld 只做**旋转**（ragdoll.ts:1475），必须自己加平移（同 hipPoint:4237）
  const wp = new Float64Array(3), wc = new Float64Array(3);
  {
    const tp = bp.translation(), tc = bc.translation();
    d.toWorld(bp, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], wp);
    wp[0] += tp.x; wp[1] += tp.y; wp[2] += tp.z;
    d.toWorld(bc, j.childLocal[0], j.childLocal[1], j.childLocal[2], wc);
    wc[0] += tc.x; wc[1] += tc.y; wc[2] += tc.z;
  }
  const dx = (wp[0] - wc[0]) * 1000, dy = (wp[1] - wc[1]) * 1000, dz = (wp[2] - wc[2]) * 1000;
  const mag = Math.hypot(dx, dy, dz);
  if (mag > worst) { worst = mag; worstName = j.name; }
  console.log(
    `${j.name.padEnd(12)} | ${dx.toFixed(3).padStart(9)} ${dy.toFixed(3).padStart(9)} ${dz.toFixed(3).padStart(9)} | ${mag.toFixed(3).padStart(7)} | ${mag > 1 ? '✘ 不重合!' : '✔'}`,
  );
}
console.log(`\n⇒ 最大锚点偏差：${worst.toFixed(3)} mm（${worstName}）`);

// ── 刚体质量/惯量健全性
console.log('');
console.log('════ ③ 刚体健全性（质量为 0 或惯量为 0 ⇒ 求解器必炸）════');
console.log('');
console.log('bodyName           | mass(kg) | 主惯量 (Ix,Iy,Iz)');
let badBody = 0;
for (let i = 0; i < d.bodies.length; i++) {
  const b = d.bodies[i];
  const m = b.mass();
  const I = b.principalInertia();
  const bad = !(m > 1e-6) || !(I.x > 1e-12) || !(I.y > 1e-12) || !(I.z > 1e-12);
  if (bad) badBody++;
  const nm = d.bodyKeys?.[i] ?? `#${i}`;
  console.log(`${String(nm).padEnd(18)} | ${m.toFixed(4).padStart(8)} | ${I.x.toExponential(2)} ${I.y.toExponential(2)} ${I.z.toExponential(2)}${bad ? '   ← 病态!' : ''}`);
}
console.log(`\n⇒ 病态刚体：${badBody} / ${d.bodies.length}`);
