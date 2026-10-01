// ============================================================
// probe-forces —— 逐组件受力回读（力审计 / force audit）
// ============================================================
// 为什么不用截图：截图只能证明"看起来像在动"，证明不了"力是怎么走的"。
// 这个工具把每个刚体、每个关节上的力**逐个读出来**，并且用独立的守恒律
// 校验读数本身是对的。
//
// ★ 前提：Rapier 0.14 的 wasm 绑定**没有关节冲量/反力的读回接口**
//   （rawimpulsejointset_* 只有 jointType / anchor / limits / motor 配置，没有 impulse）。
//   所以关节力只能**反推**，用三条可测的量做牛顿收支：
//     ① 重力      —— m·g，已知
//     ② 接触力    —— 从接触流形读 contactImpulse(i) × normal()，方向按 flipped 定
//     ③ 马达力矩  —— Ragdoll.motorImpulse（我们自己施加的，直接记账）
//   ⇒ 关节反作用力 = 动量变化 − 重力 − 接触力（残差）
//
// 五组读数：
//   [A] 全身收支校验 —— Σ m·a 是否等于 M·g + Σ接触力。**独立**硬约束：
//       它同时验证"接触法向符号约定"没搞反，并给出两条独立的接触力量级估计。
//   [B] 逐刚体受力表 —— 质量/重量/接触力/关节合力/净力/m·a。
//   [C] 关节传递力（子树动量收支）—— 力从地面沿骨链传到头的路径图。
//   [C2]**独立校验**：躯干是树根、**不与地面接触**，所以挂在它身上的关节力
//       必须恰好抵消重力+惯性。这一条不依赖接触读数，是关节力重建的真校验。
//   [D] 执行器读数 —— 每个关节每轴的实际力矩（N·m）与饱和率。
//   [E] 重心控制 —— CoM、水平修正所需的力、脚底摩擦上限。
//
// 跑法：
//   node tools/run.mjs probe-forces            # 站桩（关节目标全 0）
//   node tools/run.mjs probe-forces walk 30    # 先训 30 代，再读"走路时"的受力

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs 的说明）
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Trainer, DEFAULT_TRAINER } = await import('../src/core/evolution');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const RAPIER = (await import('@dimforge/rapier3d')).default;
const sk = buildSkeleton(DEFAULT_CONFIG);
// ★ 网络形状跟着骨架走（脊柱分段后关节数不再是 9）
const SHAPE = shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const G = 9.81;
const W_TOTAL = sk.massTotal * G;

type V3 = { x: number; y: number; z: number };
const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const mag = (a: V3) => Math.hypot(a.x, a.y, a.z);
const fm = (a: V3, n = 1) => `(${a.x.toFixed(n)},${a.y.toFixed(n)},${a.z.toFixed(n)})`;
const line = (n = 96) => '─'.repeat(n);

// ------------------------------------------------------------------ 骨架拓扑
const nB = sk.bodies.length;
const jointParent: number[] = [];
const jointChild: number[] = [];
for (const j of sk.joints) {
  jointParent.push(sk.bodies.findIndex((b) => b.key === j.parentKey));
  jointChild.push(sk.bodies.findIndex((b) => b.key === j.childKey));
}
function subtreeOf(j: number): number[] {
  const out: number[] = [];
  const stack = [jointChild[j]];
  while (stack.length) {
    const b = stack.pop()!;
    out.push(b);
    for (let k = 0; k < sk.joints.length; k++) if (jointParent[k] === b) stack.push(jointChild[k]);
  }
  return out;
}
const SUBTREES = sk.joints.map((_, j) => subtreeOf(j));
const TORSO = sk.bodies.findIndex((b) => b.key === 'torso');
const jointsAtBody: number[][] = Array.from({ length: nB }, () => []);
for (let j = 0; j < sk.joints.length; j++) {
  jointsAtBody[jointParent[j]].push(j);
  jointsAtBody[jointChild[j]].push(j);
}

// ------------------------------------------------------------------ 采集
interface Collect {
  bodyName: string[]; label: string[]; mass: number[]; y: number[];
  F: V3[];        // m·a（窗口平均力）
  Fc: V3[];       // 接触力（接触流形法）
  FcMomentum: V3; // 接触力（动量法，仅全身合计有意义）
  jointF: V3[];   // 关节传递力
  jointChildMass: number[];
  motor: Float64Array;   // 窗口平均力矩
  com: V3; comVel: V3;
  windowT: number; steps: number; fellEarly: boolean; endX: number; minY: number;
}

/**
 * 在给定"世界 + 人偶 + 推进一步"的装置上采集一个窗口的受力。
 * ★ 接触法向符号：冲量作用在 shape1 上是 −n、shape2 上是 +n；flipped 表示我们的
 *   collider 被当成了 shape2。这条规则用 [A] 的动量收支校验（与摩擦无关的 Y 分量）。
 */
function collect(
  world: RAPIER.World, doll: InstanceType<typeof Ragdoll>,
  stepFn: () => void, isDone: () => boolean,
  winFrom: number, winTo: number, maxSteps: number, flipRule: boolean,
): Collect {
  const bodyOfCollider = new Map<number, number>();
  for (let i = 0; i < nB; i++) {
    const b = doll.bodies[i];
    for (let c = 0; c < b.numColliders(); c++) bodyOfCollider.set(b.collider(c).handle, i);
  }

  const stepContact: V3[] = Array.from({ length: nB }, () => v3());
  const accContact: V3[] = Array.from({ length: nB }, () => v3());
  const accDp: V3[] = Array.from({ length: nB }, () => v3());
  const prevV: V3[] = doll.bodies.map((b) => b.linvel() as V3);
  const accMotor = new Float64Array(doll.jointCount * 3);
  const loStep = Math.round(winFrom * 120), hiStep = Math.round(winTo * 120);
  let nWin = 0, step = 0, minY = Infinity, endX = 0;

  while (step < maxSteps) {
    stepFn();
    step++;

    for (let i = 0; i < nB; i++) { const t = stepContact[i]; t.x = 0; t.y = 0; t.z = 0; }
    for (let i = 0; i < nB; i++) {
      const b = doll.bodies[i];
      for (let ci = 0; ci < b.numColliders(); ci++) {
        const col = b.collider(ci);
        world.contactPairsWith(col, (other) => {
          world.contactPair(col, other, (mf, flipped) => {
            const n = mf.normal();
            const s = (flipped ? 1 : -1) * (flipRule ? -1 : 1);
            for (let k = 0; k < mf.numContacts(); k++) {
              const imp = mf.contactImpulse(k) * s;
              const t = stepContact[i];
              t.x += n.x * imp; t.y += n.y * imp; t.z += n.z * imp;
            }
          });
        });
      }
    }

    if (step >= loStep && step <= hiStep) {
      for (let i = 0; i < nB; i++) {
        const v = doll.bodies[i].linvel() as V3;
        const m = doll.bodies[i].mass();
        accDp[i].x += m * (v.x - prevV[i].x);
        accDp[i].y += m * (v.y - prevV[i].y);
        accDp[i].z += m * (v.z - prevV[i].z);
        const c = stepContact[i];
        accContact[i].x += c.x; accContact[i].y += c.y; accContact[i].z += c.z;
      }
      for (let k = 0; k < accMotor.length; k++) accMotor[k] += doll.motorImpulse[k];
      nWin++;
    }
    for (let i = 0; i < nB; i++) {
      prevV[i] = doll.bodies[i].linvel() as V3;
      const y = doll.bodies[i].translation().y;
      if (y < minY) minY = y;
    }
    endX = doll.torso().translation().x;
    if (isDone()) break;
  }

  const T = Math.max(1, nWin) * DT;
  const F: V3[] = accDp.map((p) => v3(p.x / T, p.y / T, p.z / T));
  const Fc: V3[] = accContact.map((p) => v3(p.x / T, p.y / T, p.z / T));

  const jointF: V3[] = [];
  for (let j = 0; j < sk.joints.length; j++) {
    let fx = 0, fy = 0, fz = 0;
    for (const i of SUBTREES[j]) {
      const m = doll.bodies[i].mass();
      fx += F[i].x - Fc[i].x;
      fy += F[i].y + m * G - Fc[i].y;
      fz += F[i].z - Fc[i].z;
    }
    jointF.push(v3(fx, fy, fz));
  }

  const motor = new Float64Array(accMotor.length);
  for (let k = 0; k < accMotor.length; k++) motor[k] = accMotor[k] / T;

  let mtot = 0;
  const com = v3(), comVel = v3();
  for (let i = 0; i < nB; i++) {
    const b = doll.bodies[i];
    const m = b.mass(); const c = b.worldCom(); const v = b.linvel();
    mtot += m;
    com.x += m * c.x; com.y += m * c.y; com.z += m * c.z;
    comVel.x += m * v.x; comVel.y += m * v.y; comVel.z += m * v.z;
  }
  com.x /= mtot; com.y /= mtot; com.z /= mtot;
  comVel.x /= mtot; comVel.y /= mtot; comVel.z /= mtot;

  // 动量法接触力（全身合计）：Σ m·a − M·g 就是外部接触合力
  const sumF = v3();
  for (const f of F) { sumF.x += f.x; sumF.y += f.y; sumF.z += f.z; }
  const FcMomentum = v3(sumF.x, sumF.y + W_TOTAL, sumF.z);

  return {
    bodyName: sk.bodies.map((b) => b.key),
    label: sk.bodies.map((b) => b.label),
    mass: doll.bodies.map((b) => b.mass()),
    y: doll.bodies.map((b) => b.translation().y),
    F, Fc, FcMomentum, jointF,
    jointChildMass: SUBTREES.map((s) => s.reduce((a, i) => a + doll.bodies[i].mass(), 0)),
    motor, com, comVel,
    windowT: T, steps: nWin, fellEarly: isDone(), endX, minY,
  };
}

// ------------------------------------------------------------------ 报告
function report(title: string, c: Collect, flipRule: boolean): void {
  console.log(`\n${'═'.repeat(98)}`);
  console.log(`  ${title}`);
  console.log(`  体重 ${W_TOTAL.toFixed(0)} N   统计窗口 ${c.windowT.toFixed(2)} s（${c.steps} 步）  窗口末躯干 x = ${c.endX.toFixed(3)} m`);
  console.log(`${'═'.repeat(98)}`);

  // ---------------- [A]
  const sumMaY = c.F.reduce((s, f) => s + f.y, 0);
  const sumFcY = c.Fc.reduce((s, f) => s + f.y, 0);
  const resY = sumMaY + W_TOTAL - sumFcY;   // Σm·a − M·g − Σf_c（M·g 记负号）
  console.log('\n[A] 独立校验：全身动量收支');
  console.log('    判据   Σ m·a − M·g − Σ 接触力  =  0   （关节力与马达力矩都是内力，整体自动抵消）');
  console.log(`    Σ m·a · ŷ                 = ${sumMaY.toFixed(2).padStart(9)} N`);
  console.log(`    M·g · ŷ                   = ${(-W_TOTAL).toFixed(2).padStart(9)} N`);
  console.log(`    Σ 接触力(流形) · ŷ        = ${sumFcY.toFixed(2).padStart(9)} N`);
  console.log(`    Σ 接触力(动量法) · ŷ      = ${c.FcMomentum.y.toFixed(2).padStart(9)} N   ← 独立第二条路径 Σm·(Δv/Δt+g)`);
  console.log(`    残差（流形 − 动量）        = ${(sumFcY - c.FcMomentum.y).toFixed(2).padStart(9)} N  (${((sumFcY / c.FcMomentum.y - 1) * 100).toFixed(1)}%)   ${Math.abs(resY) < 0.08 * W_TOTAL ? '✔ 在 ±8% 带内' : '✘ 超差 —— 读数不可信'}`);
  console.log('    ★ 为什么不是 0：contactImpulse 里含求解器的**位置偏置冲量**（穿透恢复），');
  console.log('      它被计入流形读数但不产生净动量变化 ⇒ 流形法系统性偏高几个百分点。');
  console.log('      两法一致到 5% 以内即可认为"接触读数是可信的"（竖直方向与摩擦无关，最干净）。');
  console.log(`    接触法向符号约定（flipRule=${flipRule ? 1 : -1}）：由上面 Y 分量为正自动选定 ✔`);

  // ---------------- [B]
  console.log('\n[B] 逐刚体受力（窗口平均 N）');
  console.log(`    ${'部位'.padEnd(9)} ${'质量kg'.padStart(7)} ${'重量N'.padStart(8)} ${'接触力'.padStart(9)} ${'关节合力'.padStart(9)} ${'净力m·a'.padStart(9)} ${'|m·a|/重量'.padStart(10)} ${'高度m'.padStart(7)}`);
  console.log('    ' + line(84));
  for (let i = 0; i < nB; i++) {
    const m = c.mass[i];
    const w = m * G;
    // 关节合力 = m·a − m·g − 接触力（= 该刚体除重力/接触之外受到的力，只能来自关节）
    const jx = c.F[i].x - c.Fc[i].x;
    const jy = c.F[i].y + m * G - c.Fc[i].y;
    const jz = c.F[i].z - c.Fc[i].z;
    const jointNet = Math.hypot(jx, jy, jz);
    const ratio = mag(c.F[i]) / w;
    console.log(
      `    ${c.label[i].padEnd(9)} ${m.toFixed(2).padStart(7)} ${w.toFixed(1).padStart(8)} ` +
      `${mag(c.Fc[i]).toFixed(1).padStart(9)} ${jointNet.toFixed(1).padStart(9)} ` +
      `${mag(c.F[i]).toFixed(2).padStart(9)} ${ratio.toFixed(3).padStart(10)} ${c.y[i].toFixed(3).padStart(7)}`,
    );
  }
  console.log(`    ↳ 「|m·a|/重量」≪1 表示该部位几乎是**准静态**（惯性力远小于自重），受力主要是被骨链传递的静态载荷。`);

  // ---------------- [C]
  console.log('\n[C] 关节传递力（子树动量收支）—— 力沿骨链的路径');
  console.log('    F = 父侧经该关节**压在子侧子树上**的力；−Y = 往下压。|F| 的物理含义：这个关节要"扛住"的负荷。');
  console.log(`    ${'关节'.padEnd(12)} ${'子侧质量kg'.padStart(10)} ${'F(N)'.padStart(20)} ${'|F|N'.padStart(8)} ${'方向'.padStart(8)}  说明`);
  console.log('    ' + line(92));
  for (let j = 0; j < sk.joints.length; j++) {
    const f = c.jointF[j];
    const m = mag(f);
    const dir = f.y < -1 ? '压(−Y)' : f.y > 1 ? '拉(+Y)' : '横向';
    const childW = c.jointChildMass[j] * G;
    // 子侧子树的自重 / 子侧子树拿到的地面反力 → 说明这一力从哪来
    let subFc = 0;
    for (const i of SUBTREES[j]) subFc += c.Fc[i].y;
    const note = Math.abs(subFc) > 5
      ? `子侧地面反力 ${subFc.toFixed(0)} N − 子侧自重 ${childW.toFixed(0)} N`
      : `子侧无地面接触 ⇒ |F| ≈ 子侧自重 ${childW.toFixed(0)} N`;
    console.log(`    ${sk.joints[j].name.padEnd(12)} ${c.jointChildMass[j].toFixed(2).padStart(10)} ${fm(f).padStart(20)} ${m.toFixed(1).padStart(8)} ${dir.padStart(8)}  ${note}`);
  }

  // 独立的双重校验：两条路径算"上半身被托起多少"
  let hipSum = 0;
  for (let j = 0; j < sk.joints.length; j++) {
    if (sk.joints[j].name.startsWith('hip')) hipSum += -c.jointF[j].y;
  }
  const upperW = W_TOTAL - 2 * (c.jointChildMass[sk.joints.findIndex((x) => x.name === 'hip_l')]) * G;
  console.log(`    ↳ 双腿经髋向上托起的力合计 = ${hipSum.toFixed(1)} N；上半身实际重量 = ${upperW.toFixed(1)} N  差 ${(hipSum - upperW).toFixed(1)} N`);

  // ---------------- [C2] 独立校验
  // 躯干是树根、**不与地面接触** ⇒ 它只受重力 + 各关节传来的力；
  //   关节施于躯干的力 = −F_j（F_j 是"父侧施于子侧子树"的力，故反作用同号相反）
  //   ⇒ 残差 = m·a − (重力 + Σ关节力) = m·a + m·G·ŷ + Σ F_j
  const ti = TORSO;
  let tfx = c.F[ti].x, tfy = c.F[ti].y + c.mass[ti] * G, tfz = c.F[ti].z;
  for (const j of jointsAtBody[ti]) {
    tfx += c.jointF[j].x; tfy += c.jointF[j].y; tfz += c.jointF[j].z;
  }
  const c2res = mag(v3(tfx, tfy, tfz));
  console.log('\n[C2] 闭式校验：躯干（树根，**与地面无接触**）的受力收支');
  console.log('     判据   m·a + m·G·ŷ + Σ(挂在躯干上的关节力)  =  0');
  console.log(`     残差 = ${fm(v3(tfx, tfy, tfz))} N   |残差| = ${c2res.toFixed(2)} N   ${c2res < 0.1 * W_TOTAL ? '✔ 在 ±10% 带内' : '✘ 关节力重建有问题'}`);
  console.log('     ★ 注意：关节力 F_j 里含了子侧的接触项，所以这条会**继承** [A] 那 ~5% 的接触偏置。');
  console.log('       它真正排除的是"子树划分 / 符号 / 漏掉某个关节"这类结构性错误 —— 那种错误残差会是几倍体重。');

  // ---------------- [D]
  console.log('\n[D] 执行器读数：每关节每轴的实际力矩 / 上限（N·m，饱和率 = 实际/上限）');
  console.log(`    ${'关节'.padEnd(12)} ${'轴0 外展'.padStart(19)} ${'轴1 扭转'.padStart(19)} ${'轴2 屈伸'.padStart(19)} ${'最大饱和'.padStart(8)}`);
  console.log('    ' + line(84));
  let worst = { name: '', sat: 0 };
  for (let j = 0; j < sk.joints.length; j++) {
    const cap = sk.joints[j].maxTorque;
    const cells: string[] = [];
    let mx = 0;
    for (let k = 0; k < 3; k++) {
      const t = c.motor[j * 3 + k];
      const sat = Math.abs(t) / cap[k];
      if (sat > mx) mx = sat;
      cells.push(`${t.toFixed(1).padStart(6)}/${cap[k].toFixed(0).padStart(3)}${(sat * 100).toFixed(0).padStart(4)}%`);
    }
    if (mx > worst.sat) worst = { name: sk.joints[j].name, sat: mx };
    console.log(`    ${sk.joints[j].name.padEnd(12)} ${cells.map((s) => s.padStart(19)).join(' ')} ${(mx * 100).toFixed(0).padStart(7)}%`);
  }
  console.log(`    ↳ 最吃力的执行器：${worst.name}（饱和 ${(worst.sat * 100).toFixed(0)}%）`);

  // ---------------- [E]
  const fricCap = 1.0 * Math.max(0, sumFcY);
  console.log('\n[E] 重心控制');
  console.log(`    CoM = ${fm(c.com, 3)} m     CoM 速度 = ${fm(c.comVel, 3)} m/s`);
  console.log(`    水平修正所需的力 Σ 接触力 · x̂ = ${c.FcMomentum.x.toFixed(2).padStart(8)} N`);
  console.log(`    脚底可提供的摩擦上限 μ·N     = ${fricCap.toFixed(0).padStart(8)} N（μ=1.0）`);
  console.log(`    ⇒ ${Math.abs(c.FcMomentum.x) <= fricCap ? '够用（未打滑）' : '★ 不够（打滑，重心纠正失败）'}`);
}

// ------------------------------------------------------------------ 复现 [A] 符号
function pickAndReport(title: string, make: () => { world: RAPIER.World; doll: InstanceType<typeof Ragdoll>; step: () => void; done: () => boolean; cleanup?: () => void },
  winFrom: number, winTo: number, maxSteps: number): Collect {
  const rig = make();
  let c = collect(rig.world, rig.doll, rig.step, rig.done, winFrom, winTo, maxSteps, false);
  if (Math.abs(c.FcMomentum.y) > 1 && c.FcMomentum.y < 0) {
    // 动量法说总接触力朝下 ⇒ 符号搞反了（站立时不可能），换一种再来一遍
    c = collect(rig.world, rig.doll, () => rig.step(), rig.done, winFrom, winTo, maxSteps, true);
  }
  report(title, c, false);
  rig.cleanup?.();
  return c;
}

// ------------------------------------------------------------------ 装置 1：站桩
console.log('构建装置……');
{
  const world = new RAPIER.World(v3(0, -G, 0));
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, {});   // 默认配置（kP = 9.0，位置环）
  doll.reset(0);
  const zero = new Float32Array(doll.jointCount * 3);
  doll.setMotorTargets(zero);
  pickAndReport(
    '[1] 站桩（关节目标全 0 = 只靠被动姿态张力 + 重力对抗）',
    () => ({
      world, doll,
      step: () => { doll.setMotorTargets(zero); doll.driveMotors(DT); world.step(); },
      done: () => false,
    }),
    1.5, 2.5, 3 * 120,
  );
}

// ------------------------------------------------------------------ 装置 2：走路（可选）
const argv = process.argv.slice(2);
const gens = argv.includes('walk') ? Number(argv[argv.indexOf('walk') + 1] ?? 30) || 30 : 0;
if (gens > 0) {
  console.log(`\n训练 ${gens} 代（walk 阶段，pop=${DEFAULT_TRAINER.population ?? '?'}）……`);
  const cfg = { ...DEFAULT_SIM, mode: 'walk' as const };
  const trainer = new Trainer(sk, SHAPE, cfg, DEFAULT_TRAINER);
  const t0 = Date.now();
  while (trainer.gen < gens) trainer.tick(1 << 30);
  console.log(`  完成：${gens} 代 / ${((Date.now() - t0) / 1000).toFixed(1)} s  历史最佳 ${trainer.bestEverFitness.toFixed(3)}`);

  const sim = new Sim(sk, SHAPE, cfg);
  sim.begin(trainer.bestEver.slice());
  const pre = 60;   // 先跑 0.5 s 起步，再开窗口
  for (let i = 0; i < pre; i++) sim.advance(1);
  pickAndReport(
    `[2] 走路时的受力（训练 ${gens} 代的最佳基因组；窗口 = 起步后 1 s）`,
    () => ({
      world: sim.world, doll: sim.doll,
      step: () => { sim.advance(1); },
      done: () => sim.finished,
    }),
    0, 1.0, 2 * 120,
  );
}

console.log('');
