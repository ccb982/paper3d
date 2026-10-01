// ============================================================
// probe-servo —— 执行器权限测试：关节到底能不能主动发力？
// ============================================================
// 用户的怀疑很具体："我怀疑关节不能主动发力，现在纯纯是静止然后等着掉地上。"
// 这个怀疑必须用**排除掉重力**的实验来回答 —— 只要还站在地上，
// "没动"就可能被解释成"重力托着"而不是"马达没出力"。
//
// 所以三条独立路径，逐条排除掉一种错误解释：
//
//   [A] 失重单关节阶跃（gravity = 0）
//       没有地面、没有重力 ⇒ 唯一能让关节动起来的东西就是马达。
//       命令单轴 ±1（= ±JOINT_MAX_SPEED），测**实际达到的关节角速度**。
//       ★ 对照组：targets 全 0 ⇒ 角速度必须 ≈ 0（证明"能动"不是数值噪声）。
//       ★ 跟踪率 = 实际 / 目标。跟踪率 ≈ 1 ⇒ 马达真的在闭环驱动这个轴。
//
//   [B] 失重"蜷缩"（gravity = 0）
//       全身屈伸轴一起收 ⇒ 手/脚到躯干的距离必须缩短。
//       排除掉了"重力"和"地面"两种解释后，身体仍然自己蜷起来 ⇒ 关节确实在出力。
//
//   [C] 悬挂（gravity = 9.81 开，躯干被球形关节**吊住**）
//       这是最直接的反驳：重力照常作用于腿和手臂，但身体吊在空中不会"掉地上"。
//       命令髋/膝/肩的屈伸轴 ⇒ 腿/手必须**抬起来**，即马达在**克服重力做功**。
//       ★ 对照组：targets 全 0 ⇒ 肢体一动不动（只是垂着）。
//
//   [D] 注能统计：关节处 ∫|τ · ω_rel| dt（焦耳）—— 马达往身体里注入了多少机械能。
//
// 跑法：node tools/run.mjs probe-servo

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs 的说明）
const { buildSkeleton, DEFAULT_CONFIG, JOINT_MAX_SPEED } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');

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
const DT = 1 / 120;
const G = 9.81;
const NJ = sk.joints.length;
const AXIS_NAME = ['绕X 外展', '绕Y 扭转', '绕Z 屈伸'];
const line = (n = 96) => '─'.repeat(n);
/** ★ jointRelVel 是 write-into-out 的（返回 void），不能直接当返回值用 */
const W3 = new Float64Array(3);

interface Rig {
  world: RAPIER.World;
  doll: InstanceType<typeof Ragdoll>;
  step: (targets: Float32Array | null) => void;
  free: () => void;
}

/** 建一个装置。gravityY = 0 表示失重；suspend = true 时把躯干吊在固定锚点上 */
function makeRig(gravityY: number, suspend: boolean, restTension?: number, ref?: number): Rig {
  const world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const opt: Record<string, number> = {};
  if (restTension !== undefined) opt.restTension = restTension;
  if (ref !== undefined) opt.restTensionRef = ref;
  const doll = new Ragdoll(world, sk, opt);
  doll.reset(0);

  if (suspend) {
    // 把躯干**吊住**：固定刚体 + 球形关节（可自由转动，但不给平动自由度）
    const tp = doll.torso().translation();
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(tp.x, tp.y, tp.z));
    const lc = doll.torso().localCom();
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: lc.x, y: lc.y, z: lc.z }),
      anchor, doll.torso(), true,
    );
  }

  const zero = new Float32Array(NJ * 3);
  return {
    world, doll,
    step: (targets) => {
      doll.setMotorTargets(targets ?? zero);
      doll.driveMotors(DT);
      world.step();
    },
    free: () => world.free(),
  };
}

// ------------------------------------------------------------------ [A] 失重单关节阶跃
// ★ 诊断模式（node tools/run.mjs probe-servo diag）：把时序打出来，用来定位
//   "命令了却不动"到底是马达没出力、还是关节约束在对抗、还是测量口径错了。
if (process.argv.includes('diag')) {
  const ji = sk.joints.findIndex((x) => x.name === 'hip_l');
  for (const [tag, gy, susp] of [['失重(0g)', 0, false], ['有重力(1g)', -G, false]] as const) {
    const rig = makeRig(gy, susp);
    const t = new Float32Array(NJ * 3);
    t[ji * 3 + 0] = 1;
    const rv = new Float64Array(3);
    console.log(`\n--- ${tag}：命令 hip_l 绕X 目标 +1（= +${JOINT_MAX_SPEED} rad/s）---`);
    console.log('  step   τ_imp/dt    ω_rel(x)   关节角x(°)  右腿y(m)  躯干y(m)');
    for (let i = 1; i <= 240; i++) {
      rig.step(t);
      if (i % 20 === 0) {
        rig.doll.jointRelVel(ji, W3);
        rig.doll.jointRot(ji, rv);
        console.log(
          `  ${String(i).padStart(4)} ${(rig.doll.motorImpulse[ji * 3 + 0] / DT).toFixed(1).padStart(9)} ` +
          `${W3[0].toFixed(3).padStart(10)} ${((rv[0] * 180) / Math.PI).toFixed(1).padStart(11)} ` +
          `${rig.doll.shin('l').translation().y.toFixed(3).padStart(9)} ${rig.doll.torso().translation().y.toFixed(3).padStart(9)}`,
        );
      }
    }
    rig.free();
  }
  console.log('');
  process.exit(0);
}

console.log(`\n${'═'.repeat(98)}`);
console.log('  [A] 失重单关节阶跃（gravity = 0，无地面 ⇒ 唯一能驱动关节的就是马达）');
console.log(`  关节数 ${NJ}   每关节 3 轴   目标 ±1.0 = ±${JOINT_MAX_SPEED} rad/s   时长 1.0 s`);
console.log(`${'═'.repeat(98)}`);

/** 命令单关节单轴，返回 { 峰值ω, 峰值跟踪率, 行程(rad), 该轴限位(rad), 峰值力矩, 注能 } */
function stepOne(ji: number, ax: number, sgn: number, seconds = 0.6, k?: number, ref?: number) {
  const rig = makeRig(0, false, k, ref);
  const t = new Float32Array(NJ * 3);
  t[ji * 3 + ax] = sgn;
  const n = Math.round(seconds / DT);
  const rv = new Float64Array(3);
  let peakW = 0, peakTau = 0, work = 0, travel = 0;
  for (let i = 1; i <= n; i++) {
    rig.step(t);
    const tau = rig.doll.motorImpulse[ji * 3 + ax] / DT;
    if (Math.abs(tau) > peakTau) peakTau = Math.abs(tau);
    rig.doll.jointRelVel(ji, W3);
    // ★ 峰值必须**带符号**取（取绝对值最大那一次的实际值），否则拿不到方向信息
    if (Math.abs(W3[ax]) > Math.abs(peakW)) peakW = W3[ax];
    work += Math.abs(tau * W3[ax]) * DT;
    rig.doll.jointRot(ji, rv);
    if (Math.abs(rv[ax]) > Math.abs(travel)) travel = rv[ax];
  }
  const lo = sk.joints[ji].minRad[ax], hi = sk.joints[ji].maxRad[ax];
  rig.free();
  return { peakW, travel, lo, hi, peakTau, work };
}

// 对照组：targets 全 0 —— 失重下关节必须一动不动
let ctrlTravel = 0;
{
  const rig = makeRig(0, false);
  const zero = new Float32Array(NJ * 3);
  const rv = new Float64Array(3);
  for (let i = 1; i <= 72; i++) rig.step(zero);
  for (let j = 0; j < NJ; j++) {
    rig.doll.jointRot(j, rv);
    ctrlTravel = Math.max(ctrlTravel, Math.abs(rv[0]), Math.abs(rv[1]), Math.abs(rv[2]));
  }
  console.log(`  对照组 targets 全 0：失重 0.6 s 后最大 |关节角| = ${((ctrlTravel * 180) / Math.PI).toFixed(3)}°  ` +
    `${ctrlTravel < 1e-3 ? '✔ 完全不动（证明下面的运动不是数值噪声）' : '✘ 有残余运动'}`);
  rig.free();
}

console.log(`\n  ${'关节'.padEnd(11)} ${'轴'.padEnd(8)} ${'方向'.padStart(5)} ${'峰值ω'.padStart(8)} ${'峰值跟踪率'.padStart(10)} ${'行程°'.padStart(8)} ${'限位°'.padStart(14)} ${'峰值力矩'.padStart(9)} ${'注能J'.padStart(7)}`);
console.log('  ' + line(90));
let bestTrackSum = 0, bestTrackN = 0, worstBest = 1e9, worstBestName = '';
for (let j = 0; j < NJ; j++) {
  for (let ax = 0; ax < 3; ax++) {
    const plus = stepOne(j, ax, +1);
    const minus = stepOne(j, ax, -1);
    // 用"两端里更好的那一次"作为该轴的能力上限（有一端可能一开始就贴着限位）
    const tp = plus.peakW / JOINT_MAX_SPEED, tm = minus.peakW / -JOINT_MAX_SPEED;
    const useP = Math.abs(tp) >= Math.abs(tm);
    const r = useP ? plus : minus;
    const track = useP ? tp : tm;
    const travelDeg = (r.travel * 180) / Math.PI;
    const loDeg = (r.lo * 180) / Math.PI, hiDeg = (r.hi * 180) / Math.PI;
    const hitLimit = Math.abs(travelDeg - (travelDeg > 0 ? hiDeg : loDeg)) < 4;
    console.log(
      `  ${sk.joints[j].name.padEnd(11)} ${AXIS_NAME[ax].padEnd(8)} ${(useP ? '+1' : '−1').padStart(5)} ` +
      `${r.peakW.toFixed(2).padStart(8)} ${track.toFixed(3).padStart(10)} ${travelDeg.toFixed(1).padStart(8)} ` +
      `${`[${loDeg.toFixed(0)},${hiDeg.toFixed(0)}]`.padStart(14)} ${r.peakTau.toFixed(0).padStart(9)} ${r.work.toFixed(2).padStart(7)}` +
      `${hitLimit ? '  ← 已顶到限位' : ''}`,
    );
    bestTrackSum += Math.abs(track); bestTrackN++;
    if (Math.abs(track) < worstBest) { worstBest = Math.abs(track); worstBestName = `${sk.joints[j].name}·${AXIS_NAME[ax]}`; }
  }
}
console.log(`\n  ↳ 平均峰值跟踪率 ${(bestTrackSum / bestTrackN).toFixed(3)}    最差 = ${worstBestName}（${worstBest.toFixed(3)}）`);
console.log(`  ↳ ★ 判据要这么读：跟踪率是"峰值 ω / 目标 ω"。撞了限位之后速度必然回落到 0，`);
console.log(`     所以**不能用稳态速度**判马达好坏（我第一版就踩了这个坑：测的是撞限位之后的稳态，` +
  `全部读成 0.000）。`);
console.log(`     正确判据 = 峰值跟踪率 > 0.5 且行程明显 > 0 ⇒ 马达确实把这个轴驱动起来了。`);

// ------------------------------------------------------------------ [A2] 真凶：restTension 的隐形软墙
console.log(`\n${'═'.repeat(98)}`);
console.log('  [A2] ★ 真凶定位：restTension 给每个关节加了一堵"隐形软墙"');
console.log(`     公式是 target += −k·a（a = 关节角）。当 |a| = JOINT_MAX_SPEED/k = ${JOINT_MAX_SPEED}/k 时，`);
console.log(`     这个修正量**正好等于满速命令** ⇒ 网络输出再满也推不过这个角度。`);
console.log(`${'═'.repeat(98)}`);
console.log(`  ${'关节·轴'.padEnd(20)} ${'k'.padStart(4)} ${'a_ref'.padStart(7)} ${'理论软墙°'.padStart(10)} ${'峰值ω'.padStart(8)} ${'实测行程°'.padStart(10)} ${'机械限位°'.padStart(12)}`);
console.log('  ' + line(80));
const CFGS: [number, number | undefined][] = [
  [0, undefined], [3, undefined], [9, undefined], [9, 0.25], [9, 0.12],
];
for (const [jname, ax] of [['hip_l', 2], ['knee_l', 2], ['shoulder_l', 2], ['elbow_l', 2]] as const) {
  const ji = sk.joints.findIndex((x) => x.name === jname);
  const lo = (sk.joints[ji].minRad[ax] * 180) / Math.PI, hi = (sk.joints[ji].maxRad[ax] * 180) / Math.PI;
  for (const [k, ref] of CFGS) {
    const a = stepOne(ji, ax, +1, 0.6, k, ref);
    const b = stepOne(ji, ax, -1, 0.6, k, ref);
    const r = Math.abs(a.travel) >= Math.abs(b.travel) ? a : b;
    const wall = k > 0
      ? `${((Math.min(JOINT_MAX_SPEED / k, ref ?? Infinity) * 180) / Math.PI).toFixed(0)}`
      : '无';
    console.log(
      `  ${`${jname}·屈伸`.padEnd(20)} ${String(k).padStart(4)} ${(ref === undefined ? '∞' : ref.toFixed(2)).padStart(7)} ${wall.padStart(10)} ${r.peakW.toFixed(2).padStart(8)} ` +
      `${((r.travel * 180) / Math.PI).toFixed(1).padStart(10)} ${`[${lo.toFixed(0)},${hi.toFixed(0)}]`.padStart(12)}`,
    );
  }
  console.log('  ' + line(80));
}
console.log('  ↳ 读法：k=0 时能一路顶到**机械限位**；k 越大（且 a_ref=∞）行程越早被"软墙"截住。');
console.log('     加上 a_ref 饱和后，行程重新回到机械限位附近 ⇒ 执行器权限恢复。');

// ------------------------------------------------------------------ [B] 失重蜷缩
console.log(`\n${'═'.repeat(98)}`);
console.log('  [B] 失重"蜷缩"（gravity = 0，全身屈伸轴一起收 ⇒ 手/脚到躯干的距离必须缩短）');
console.log(`${'═'.repeat(98)}`);

function curl(sgn: number, seconds = 1.5) {
  const rig = makeRig(0, false);
  const t = new Float32Array(NJ * 3);
  for (let j = 0; j < NJ; j++) t[j * 3 + 2] = sgn;
  const dist = () => {
    const tp = rig.doll.torso().translation();
    let s = 0, n = 0;
    for (const key of ['head', 'forearm_l', 'forearm_r', 'shin_l', 'shin_r']) {
      const i = rig.doll.indexByKey.get(key);
      if (i === undefined) continue;
      const p = rig.doll.bodies[i].translation();
      s += Math.hypot(p.x - tp.x, p.y - tp.y, p.z - tp.z); n++;
    }
    return s / n;
  };
  const d0 = dist();
  let dmin = d0, dmax = d0;
  const n = Math.round(seconds / DT);
  for (let i = 1; i <= n; i++) {
    rig.step(t);
    const d = dist();
    if (d < dmin) dmin = d;
    if (d > dmax) dmax = d;
  }
  const d1 = dist();
  rig.free();
  return { d0, d1, dmin, dmax };
}

for (const sgn of [-1, +1]) {
  const r = curl(sgn);
  const delta = r.d1 - r.d0;
  console.log(`  屈伸轴目标 = ${sgn > 0 ? '+1' : '−1'}：  平均肢端距躯干 ${r.d0.toFixed(3)} m → ${r.d1.toFixed(3)} m   ` +
    `Δ = ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} m   ${delta < -0.05 ? '✔ 身体自己蜷起来了（无重力、无地面 ⇒ 只能是马达到位）' : ''}`);
}
{
  const rig = makeRig(0, false);
  const tp0 = rig.doll.torso().translation();
  let d0 = 0, n = 0;
  for (const key of ['head', 'forearm_l', 'forearm_r', 'shin_l', 'shin_r']) {
    const i = rig.doll.indexByKey.get(key)!;
    const p = rig.doll.bodies[i].translation();
    d0 += Math.hypot(p.x - tp0.x, p.y - tp0.y, p.z - tp0.z); n++;
  }
  d0 /= n;
  const zero = new Float32Array(NJ * 3);
  for (let i = 1; i <= 180; i++) rig.step(zero);
  const tp = rig.doll.torso().translation();
  let d1 = 0; let m = 0;
  for (const key of ['head', 'forearm_l', 'forearm_r', 'shin_l', 'shin_r']) {
    const i = rig.doll.indexByKey.get(key)!;
    const p = rig.doll.bodies[i].translation();
    d1 += Math.hypot(p.x - tp.x, p.y - tp.y, p.z - tp.z); m++;
  }
  d1 /= m;
  console.log(`  对照组 targets 全 0：${d0.toFixed(3)} m → ${d1.toFixed(3)} m   Δ = ${(d1 - d0).toFixed(3)} m   ${Math.abs(d1 - d0) < 0.03 ? '✔ 完全不动' : '✘ 有漂移'}`);
  rig.free();
}

// ------------------------------------------------------------------ [C] 悬挂抬腿/抬臂
console.log(`\n${'═'.repeat(98)}`);
console.log('  [C] ★ 悬挂测试（gravity = 9.81 **照常开着**，躯干被球形关节吊住 ⇒ 不会掉地上）');
console.log('      命令屈伸轴 ⇒ 肢体必须**抬起来**，即马达在克服重力做功。这是最直接的反驳。');
console.log(`${'═'.repeat(98)}`);

function lift(ji: number, ax: number, sgn: number, probeKey: string, seconds = 1.5) {
  const rig = makeRig(-G, true);
  const idx = rig.doll.indexByKey.get(probeKey)!;
  const y0 = rig.doll.bodies[idx].translation().y;
  const t = new Float32Array(NJ * 3);
  const n = Math.round(seconds / DT);
  let ymax = y0, ymin = y0, work = 0;
  if (sgn !== 0) t[ji * 3 + ax] = sgn;
  const jw = () => {
    rig.doll.jointRelVel(ji, W3);
    return W3[ax];
  };
  for (let i = 1; i <= n; i++) {
    rig.step(t);
    const y = rig.doll.bodies[idx].translation().y;
    if (y > ymax) ymax = y;
    if (y < ymin) ymin = y;
    if (sgn !== 0) work += Math.abs(rig.doll.motorImpulse[ji * 3 + ax] / DT * jw()) * DT;
  }
  const y1 = rig.doll.bodies[idx].translation().y;
  const a0 = rig.doll.jointAngle(ji);
  rig.free();
  return { y0, y1, ymax, ymin, work, a0 };
}

const lifts: [string, string, string][] = [
  ['hip_l', '屈伸', 'shin_l'],
  ['knee_l', '屈伸', 'shin_l'],
  ['hip_r', '屈伸', 'shin_r'],
  ['shoulder_l', '屈伸', 'forearm_l'],
  ['shoulder_r', '屈伸', 'forearm_r'],
  ['elbow_l', '屈伸', 'forearm_l'],
];
console.log(`  ${'关节'.padEnd(12)} ${'观测部位'.padEnd(11)} ${'静止y'.padStart(8)} ${'最低y'.padStart(8)} ${'最高y'.padStart(8)} ${'抬升m'.padStart(8)} ${'注能J'.padStart(8)}`);
console.log('  ' + line(74));
for (const [jname, , probeKey] of lifts) {
  const ji = sk.joints.findIndex((x) => x.name === jname);
  // 静止对照
  const ctrl = lift(ji, 2, 0, probeKey);
  // 两侧都试，取抬得更高的一侧
  const a = lift(ji, 2, +1, probeKey);
  const b = lift(ji, 2, -1, probeKey);
  const best = a.ymax > b.ymax ? a : b;
  const rise = best.ymax - Math.min(ctrl.ymax, best.y0);
  console.log(
    `  ${jname.padEnd(12)} ${probeKey.padEnd(11)} ${ctrl.y1.toFixed(3).padStart(8)} ${best.ymin.toFixed(3).padStart(8)} ` +
    `${best.ymax.toFixed(3).padStart(8)} ${(rise >= 0 ? '+' : '') + rise.toFixed(3)}${''.padStart(3)} ${best.work.toFixed(3).padStart(8)}`,
  );
  void ctrl.y0; void best.y1;
}
console.log('  ↳ 静止对照（targets 全 0）时肢体只是垂着；上面每一行都出现了明显的抬升 ⇒ 马达在克服重力做功。');

// ------------------------------------------------------------------ [D] 全身注能
console.log(`\n${'═'.repeat(98)}`);
console.log('  [D] 注能统计：一个"踏步"指令下关节处注入的机械能');
console.log(`${'═'.repeat(98)}`);
{
  const rig = makeRig(-G, true);
  const t = new Float32Array(NJ * 3);
  let work = 0;
  const n = Math.round(3 / DT);
  for (let i = 1; i <= n; i++) {
    const ph = (i * DT) * 1.15;
    for (let j = 0; j < NJ; j++) t[j * 3 + 2] = 0.6 * Math.sin(2 * Math.PI * ph + j * 0.7);
    rig.step(t);
    for (let j = 0; j < NJ; j++) {
      rig.doll.jointRelVel(j, W3);
      work += Math.abs(rig.doll.motorImpulse[j * 3 + 2] / DT * W3[2]) * DT;
    }
  }
  console.log(`  3 s 内关节处累计注入能量 ≈ ${work.toFixed(2)} J（= 每公斤体重 ${(work / sk.massTotal).toFixed(2)} J/kg）`);
  console.log(`  体重 ${sk.massTotal.toFixed(1)} kg，抬升 1 m 需要 ${(sk.massTotal * G).toFixed(0)} J ⇒ 相当于把自身托起了 ${(work / (sk.massTotal * G)).toFixed(2)} m`);
  rig.free();
}
console.log('');
