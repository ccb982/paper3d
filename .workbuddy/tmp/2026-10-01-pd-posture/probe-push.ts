// ============================================================
// probe-push —— 「关节到底施加了多大力」的直接审计 + 权限标定
// ============================================================
// 用户的怀疑很具体：「现在的问题是关节完全不施加力吗」。
// ★★ 答案不是"是"也不是"不是"，而是**方向相反**：
//    关节**一直在出力，而且是"把每个关节的角速度刹到 0"的力**。见下面这条容易读错的分支。
//
// ★★ 关键更正（我第一版探针就在这儿栽了）：
//     `err = target − ω_rel;  if (err === 0) continue;`
//   直觉会以为"target = 0 ⇒ 不出力"。**错。** target = 0 的意思是
//   "让这个关节的角速度变成 0" ⇒ err = −ω_rel ⇒ τ = clamp(−ω_rel·τmax/ωmax, ±τmax)。
//   在真实负载下 ω_rel 永远不为 0（有重力、有接触、有限位）⇒ `continue` 几乎不触发
//   ⇒ **零输出 = 全力制动**，占空比可以打到 100%。
//   ⇒ "关节完全不施加力"是错的；真正的问题是：**这些力是"关节空间"的制动，
//      不是"重心空间"的平衡控制。** 把 36 个关节全刹住 = 让身体僵住；
//      而僵住的身体是个倒立摆 ẍ = ω²(x−p)——僵住**不改变 p（CoP）**，
//      所以它一点恢复能力都没有。
//
// 实验装置（两件事分开问，不要混）：
//   A 组 静息审计：不施加任何扰动，看**静息时**每个关节出了多少力、出在哪。
//   B 组 受扰审计：每刚体施加 m_i·Δv 的冲量 ⇒ **纯 CoM 平移激励、零角动量**
//                  （只考验"能不能把重心救回来"，不掺"被推转"这种额外变量）。
//                  6 种配置做 2D 扫描，把"权限不足"与"控制对象不对"两个假设分开：
//                    restTension k ∈ {0, 9, 36, 144}（唯一的"位置型"控制器）×
//                    torqueScale ∈ {1, 4}（权限倍率）
//   [X] 权限标定（解析）：把 CoP 顶到支撑域边缘需要多少 τ，与 τmax 比。
//   [Y] 反事实（解析）：同样冲量下，**理想 DCM 控制器**能不能救回来 —— 证明"可救但没人救"。
//
// 跑法：node tools/run.mjs probe-push

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);

// ★ rapier 相关模块必须先导入完，再注入真实 wasm（见 tools/_bundle.mjs）
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Ragdoll } = await import('../src/core/ragdoll');

{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-push] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const RAPIER = (await import('@dimforge/rapier3d')).default;
const sk = buildSkeleton(DEFAULT_CONFIG);
const DT = 1 / 120;
const G = 9.81;
const M = sk.massTotal;
const NW = M * G;

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
const f = (x: number, n = 3) => x.toFixed(n);
const pc = (x: number, n = 1) => `${(x * 100).toFixed(n)}%`;

// ------------------------------------------------------------ 支撑域（与 probe-stability 同口径）

const allCol: { key: string; bottom: number; hx: number; hz: number }[] = [];
for (const b of sk.bodies) {
  for (const c of b.colliders) {
    const halfY = c.shape === 'cuboid' ? c.hy : c.halfHeight + c.radius;
    allCol.push({
      key: b.key, bottom: b.cy + c.offsetY - halfY,
      hx: c.shape === 'cuboid' ? c.hx : c.radius,
      hz: c.shape === 'cuboid' ? c.hz : c.radius,
    });
  }
}
const g0 = Math.min(...allCol.map((c) => c.bottom));
const touching = allCol.filter((c) => c.bottom <= g0 + 0.02);
const P_X = Math.max(...touching.map((c) => c.hx));
const P_Z = Math.max(...touching.map((c) => c.hz));
/**
 * ★★ 侧向**被动**可达半宽 —— 由 [Z] 段填充（两脚等载荷时净 CoP 只能动"一只脚的宽度"）。
 * 这是判断"静息能不能站住"的**正确阈值**：凸包 P_Z = 0.266 m 是**主动**可达域，
 * 拿它当阈值会以为侧向很宽裕，从而把"静息侧翻"误判成别的原因。
 */
let P_Z_PASSIVE = P_Z;
const ZC = 0.9659;
const OMEGA = Math.sqrt(G / ZC);
const V_CATCH = OMEGA * P_X;

// ------------------------------------------------------------ 关节分组（分项统计才有意义）

type Group = '髋' | '膝' | '脊' | '颈' | '肩' | '肘';
const GROUPS: Group[] = ['髋', '膝', '脊', '颈', '肩', '肘'];
const groupOf: Group[] = sk.joints.map((j) => {
  const n = j.name;
  if (n.startsWith('hip')) return '髋';
  if (n.startsWith('knee')) return '膝';
  if (n.startsWith('spine')) return '脊';
  if (n.startsWith('neck')) return '颈';
  if (n.startsWith('shoulder')) return '肩';
  return '肘';
});
const nAx = sk.joints.length * 3;

log('关节出力审计 —— 静息 / 受扰 / 权限标定');
log(`  体重 ${NW.toFixed(0)} N   关节 ${sk.joints.length} 个 / ${nAx} 个可驱动轴`);
log(`  p_max(前后) = ${f(P_X)} m    ω = ${f(OMEGA, 3)} rad/s    v_catch = ${f(V_CATCH)} m/s`);
log('');

// ------------------------------------------------------------ 装置

function comOf(doll: InstanceType<typeof Ragdoll>) {
  let mt = 0, x = 0, y = 0, z = 0;
  for (const b of doll.bodies) {
    const m = b.mass(); const c = b.worldCom();
    mt += m; x += m * c.x; y += m * c.y; z += m * c.z;
  }
  return { x: x / mt, y: y / mt, z: z / mt };
}
function comVx(doll: InstanceType<typeof Ragdoll>) {
  let mt = 0, x = 0;
  for (const b of doll.bodies) { const m = b.mass(); mt += m; x += m * b.linvel().x; }
  return x / mt;
}

interface Res {
  label: string; quiet: boolean;
  ySettle: number; yEnd: number;
  markX: number[];
  peakComX: number; peakXi: number;
  /** ★ 侧向 DCM 峰值。静息侧翻倒在这里，只跟踪 X 的探针会完全看不到。 */
  peakXiZ: number;
  zeroAxes: number;
  meanOcc: number;
  peakOcc: Record<Group, number>;
  capCount: Record<Group, number>;
  fallT: number | null;
}

function run(label: string, rest: number, scale: number, quiet: boolean, dv: number): Res {
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, { restTension: rest, torqueScale: scale });
  doll.reset(0);
  const zero = new Float32Array(doll.jointCount * 3);
  const step = () => { doll.setMotorTargets(zero); doll.driveMotors(DT); world.step(); };

  for (let i = 0; i < 120; i++) step();            // 静置 1.0 s 让接触稳定
  const ySettle = doll.torso().translation().y;
  const com0 = comOf(doll);

  if (!quiet) {
    // ★ 每刚体施加 m_i·Δv ⇒ 纯 CoM 平移激励、零角动量增量
    for (const b of doll.bodies) b.applyImpulse({ x: b.mass() * dv, y: 0, z: 0 }, true);
  }

  const marks = [0.25, 0.5, 1.0, 2.0];
  const markX: number[] = [];
  let mi = 0;
  let peakComX = 0, peakXi = 0, peakXiZ = 0, zeroAxes = 0, occSum = 0, occN = 0;
  const peakOcc = {} as Record<Group, number>;
  const capCount = {} as Record<Group, number>;
  for (const g of GROUPS) { peakOcc[g] = 0; capCount[g] = 0; }
  let fallT: number | null = null;
  const total = Math.round(2.5 / DT);

  for (let s = 0; s < total; s++) {
    step();
    const t = (s + 1) * DT;
    const c = comOf(doll), v = comVx(doll);
    const dx = c.x - com0.x;
    const dz = c.z - com0.z;
    peakComX = Math.max(peakComX, Math.abs(dx));
    peakXi = Math.max(peakXi, Math.abs(dx + v / OMEGA));
    peakXiZ = Math.max(peakXiZ, Math.abs(dz + comVz(doll) / OMEGA));

    let zc = 0;
    for (let i = 0; i < doll.jointCount; i++) {
      const g = groupOf[i];
      for (let k = 0; k < 3; k++) {
        const imp = doll.motorImpulse[i * 3 + k];
        if (imp === 0) { zc++; continue; }
        const occ = Math.abs(imp) / DT / (sk.joints[i].maxTorque[k] * scale);
        occSum += occ; occN++;
        if (occ > peakOcc[g]) peakOcc[g] = occ;
        if (occ >= 0.999) capCount[g]++;
      }
    }
    zeroAxes += zc;
    if (fallT === null && (doll.torso().translation().y < 0.8 || Math.abs(dx) > 0.45)) fallT = t;
    while (mi < marks.length && t >= marks[mi] - 1e-9) { markX.push(dx); mi++; }
  }
  while (markX.length < marks.length) markX.push(comOf(doll).x - com0.x);

  return {
    label, quiet, ySettle, yEnd: doll.torso().translation().y,
    markX, peakComX, peakXi, peakXiZ,
    zeroAxes: zeroAxes / (total * nAx), meanOcc: occN ? occSum / occN : 0,
    peakOcc, capCount, fallT,
  };
}

function table(rs: Res[], showFall: boolean): void {
  log(`  ${'配置'.padEnd(22)} ${'胸腔y 静置→末'.padStart(15)} ${'零出力轴'.padStart(9)} ${'均占用'.padStart(8)} `
    + `${GROUPS.map((g) => g.padStart(7)).join('')} ${'ξx峰'.padStart(7)} ${'ξz峰'.padStart(7)} ${'越界'.padStart(6)} ${showFall ? '摔倒@'.padStart(8) : ''}`);
  log('  ' + '─'.repeat(showFall ? 128 : 120));
  for (const r of rs) {
    log(`  ${r.label.padEnd(22)} ${`${f(r.ySettle, 3)}→${f(r.yEnd, 3)}`.padStart(15)} ${pc(r.zeroAxes).padStart(9)} ${pc(r.meanOcc, 2).padStart(8)} `
      + GROUPS.map((g) => pc(r.peakOcc[g], 0).padStart(7)).join(' ')
      + ` ${f(r.peakXi).padStart(7)} ${f(r.peakXiZ).padStart(7)} `
      + `${(r.peakXi > P_X || r.peakXiZ > P_Z_PASSIVE ? '★越界' : ' 域内').padStart(6)} `
      + (showFall ? `${(r.fallT === null ? '未摔' : f(r.fallT, 2) + 's').padStart(8)}` : ''));
  }
}

// ------------------------------------------------------------ diag：静息时间序列

// ★ 为什么要有这一段：A 组看到"胸腔 y 静置 1.379 → 末 0.196"，即**不加任何扰动它自己就倒**。
//   这个结论太重，必须先拿时间序列确认"是缓慢变形导致重心越界"还是"真的在翻"，
//   不能靠一个末态数字下结论。
if (process.argv.includes('diag')) {
  const rest = Number(process.argv[process.argv.indexOf('diag') + 1] ?? 9) || 9;
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, { restTension: rest });
  doll.reset(0);
  const zero = new Float32Array(doll.jointCount * 3);

  log(`══════ diag：静息时间序列（restTension = ${rest}，全程零命令、零扰动）══════`);
  log(`  ${'t(s)'.padStart(6)} ${'胸腔y'.padStart(7)} ${'胸腔倾角°'.padStart(10)} ${'CoM x'.padStart(8)} ${'CoM z'.padStart(8)} `
    + `${'CoM vx'.padStart(8)} ${'ξx'.padStart(8)} ${'ξz'.padStart(8)} ${'膝峰值'.padStart(7)} ${'髋峰值'.padStart(7)} ${'接触合力N'.padStart(10)}`);
  log('  ' + '─'.repeat(96));
  let s = 0;
  for (let mark = 0; mark <= Math.round(3.5 / DT); mark++) {
    while (s < mark) {
      doll.setMotorTargets(zero); doll.driveMotors(DT); world.step(); s++;
    }
    if (mark % Math.round(0.25 / DT) !== 0) continue;
    const c = comOf(doll), v = comVx(doll);
    const tq = doll.torso().rotation();
    let kPeak = 0, hPeak = 0, contactY = 0;
    for (let i = 0; i < doll.jointCount; i++) {
      const g = groupOf[i];
      for (let k = 0; k < 3; k++) {
        const occ = Math.abs(doll.motorImpulse[i * 3 + k]) / DT / sk.joints[i].maxTorque[k];
        if (g === '膝' && occ > kPeak) kPeak = occ;
        if (g === '髋' && occ > hPeak) hPeak = occ;
      }
    }
    for (const b of doll.bodies) {
      for (let ci = 0; ci < b.numColliders(); ci++) {
        const col = b.collider(ci);
        world.contactPairsWith(col, (other) => {
          world.contactPair(col, other, (mf, flipped) => {
            const n = mf.normal();
            const sgn = flipped ? 1 : -1;
            for (let k = 0; k < mf.numContacts(); k++) contactY += n.y * mf.contactImpulse(k) * sgn / DT;
          });
        });
      }
    }
    log(`  ${f(mark * DT, 2).padStart(6)} ${f(doll.torso().translation().y).padStart(7)} `
      + `${f((doll.tiltOf(doll.torso()) * 180) / Math.PI, 1).padStart(10)} `
      + `${f(c.x).padStart(8)} ${f(c.z).padStart(8)} ${f(v).padStart(8)} `
      + `${f(c.x + v / OMEGA).padStart(8)} ${f(c.z + comVz(doll) / OMEGA).padStart(8)} `
      + `${pc(kPeak, 0).padStart(7)} ${pc(hPeak, 0).padStart(7)} ${f(contactY, 0).padStart(10)}`);
    void tq;
  }
  log('');
  log(`  体重 = ${f(NW, 0)} N（接触合力列应与它相当；明显偏小 = 正在下落）`);
  log('');
  process.exit(0);
}
function comVz(doll: InstanceType<typeof Ragdoll>) {
  let mt = 0, z = 0;
  for (const b of doll.bodies) { const m = b.mass(); mt += m; z += m * b.linvel().z; }
  return z / mt;
}

// ------------------------------------------------------------ [Z] 被动可达 vs 主动可达的 CoP

log('══════ [Z] CoP 可达域：被动（双脚等载荷）vs 主动（可差动卸载）══════');
log('  ★ 上一轮（probe-stability）只报了凸包 ⇒ 会高估平衡权限。凸包要求"能把一只脚的载荷降到 0"，');
log('    那**必须靠主动控制**（差动分配地面反力）。没有任何控制器时，两脚各承一半，');
log('    净 CoP 被夹在**两脚脚印中心的中点**附近 —— 这才是"静息时真正可用的支撑面"。');
{
  // 按脚（body key）合并足迹
  const byFoot = new Map<string, { z0: number; z1: number; x0: number; x1: number }>();
  for (const b of sk.bodies) {
    for (const c of b.colliders) {
      const halfY = c.shape === 'cuboid' ? c.hy : c.halfHeight + c.radius;
      if (b.cy + c.offsetY - halfY > g0 + 0.02) continue;
      const hx = c.shape === 'cuboid' ? c.hx : c.radius;
      const hz = c.shape === 'cuboid' ? c.hz : c.radius;
      const cur = byFoot.get(b.key);
      if (!cur) byFoot.set(b.key, { z0: b.cz - hz, z1: b.cz + hz, x0: b.cx - hx, x1: b.cx + hx });
      else {
        cur.z0 = Math.min(cur.z0, b.cz - hz); cur.z1 = Math.max(cur.z1, b.cz + hz);
        cur.x0 = Math.min(cur.x0, b.cx - hx); cur.x1 = Math.max(cur.x1, b.cx + hx);
      }
    }
  }
  const feetArr = [...byFoot.entries()].sort((a, b) => a[1].z0 - b[1].z0);
  for (const [k, r] of feetArr) log(`      脚 ${k}：X[${f(r.x0)}, ${f(r.x1)}]  Z[${f(r.z0)}, ${f(r.z1)}]`);
  // 净 CoP：Z 向 -> 差动才可达；X 向 -> 两脚同向，等载荷也是整个足迹
  const zPassive = [
    (feetArr[0][1].z0 + feetArr[1][1].z0) / 2,
    (feetArr[0][1].z1 + feetArr[1][1].z1) / 2,
  ];
  const zActive = [feetArr[0][1].z0, feetArr[1][1].z1];
  const xPassive = [
    (feetArr[0][1].x0 + feetArr[1][1].x0) / 2,
    (feetArr[0][1].x1 + feetArr[1][1].x1) / 2,
  ];
  const xActive = [Math.min(feetArr[0][1].x0, feetArr[1][1].x0), Math.max(feetArr[0][1].x1, feetArr[1][1].x1)];
  const half = (r: number[]) => (r[1] - r[0]) / 2;
  const ctr = (r: number[]) => (r[1] + r[0]) / 2;
  P_Z_PASSIVE = half(zPassive);   // ← 对外暴露：后面判断"静息站不站得住"要用它
  log('');
  log(`  ${'方向'.padEnd(8)} ${'被动(等载荷)'.padStart(18)} ${'半宽'.padStart(8)} ${'主动(可差动)'.padStart(18)} ${'半宽'.padStart(8)} ${'被动占比'.padStart(9)}`);
  log(`  ${'侧向 Z'.padEnd(8)} ${`[${f(zPassive[0])}, ${f(zPassive[1])}]`.padStart(18)} ${f(half(zPassive)).padStart(8)} `
    + `${`[${f(zActive[0])}, ${f(zActive[1])}]`.padStart(18)} ${f(half(zActive)).padStart(8)} ${pc(half(zPassive) / half(zActive), 0).padStart(9)}`);
  log(`  ${'前后 X'.padEnd(8)} ${`[${f(xPassive[0])}, ${f(xPassive[1])}]`.padStart(18)} ${f(half(xPassive)).padStart(8)} `
    + `${`[${f(xActive[0])}, ${f(xActive[1])}]`.padStart(18)} ${f(half(xActive)).padStart(8)} ${pc(half(xPassive) / half(xActive), 0).padStart(9)}`);
  log('');
  log(`  侧向被动中心 z = ${f(ctr(zPassive))}（≠ 0！两脚脚印不对称：${f(feetArr[0][1].z1)} vs ${f(feetArr[1][1].z1)}）`);
  const comZ0 = 0.0055;
  log(`  静息 CoM z = ${f(comZ0)}（probe-stability）⇒ 距被动力学 CoP 区间的余量：`);
  log(`      负向 ${f(comZ0 - zPassive[0])} m    正向 ${f(zPassive[1] - comZ0)} m`);
  check('Z1 侧向"被动可达 CoP"远小于凸包 ⇒ 静息站姿的侧向余量只有 ~6~7 cm',
    half(zPassive) < half(zActive) * 0.35,
    `被动半宽 ${f(half(zPassive))} m vs 凸包 ${f(half(zActive))} m（被动只占 ${pc(half(zPassive) / half(zActive), 0)}）`);
  check('Z2 前后方向无此损失（两脚同向，等载荷也能覆盖整个足迹）',
    half(xPassive) > half(xActive) * 0.95,
    `被动 ${f(half(xPassive))} m ≈ 凸包 ${f(half(xActive))} m`);
  log('');
  log('  ⇒ **侧向才是真正的短板**：被动只有 ±' + f(half(zPassive)) + ' m，而 probe-push 的实测正是在');
  log('     ξz 越过这个数之后（t≈1.0→1.25 s）立刻翻倒。前后方向反而有 ±' + f(half(xPassive)) + ' m 的被动余量。');
}
log('');

// ------------------------------------------------------------ A 组：静息审计

log('══════ A 组：静息审计（不施加任何冲量，2.5 s）══════');
const qA = run('rest=0     τ×1', 0, 1, true, 0);
const qB = run('rest=9     τ×1（当前）', 9, 1, true, 0);
const qC = run('rest=36    τ×1', 36, 1, true, 0);
table([qA, qB, qC], false);
log('');
log('  ★ 列的含义：');
log('    「零出力轴」= 单步内 motorImpulse 恰为 0 的轴占比。接近 0% ⇒ **每个轴每步都在出力**。');
log('    「均占用」  = |τ|/τmax 的步×轴均值 —— 静息时的持续出力水平。');
log('    分组峰值    = 哪一类关节在扛。平衡只关心**髋/膝**；肘打满说明"制动"在全关节无差别发生。');
log('');
check('A1 静息时关节**一直在出力**（零输出 = 制动，不是松手）',
  qB.zeroAxes < 0.02, `当前配置：零出力轴仅 ${pc(qB.zeroAxes, 2)}`);
check('A2 "零目标 = 不出力"是错的：rest=0 同样在制动',
  qA.zeroAxes < 0.02, `rest=0：零出力轴 ${pc(qA.zeroAxes, 2)}，均占用 ${pc(qA.meanOcc, 2)}`);
check('A3 静息出力里"非平衡关节"（肘/肩）比髋/膝更吃紧 ⇒ 是关节制动而非平衡控制',
  Math.max(qB.peakOcc['肘'], qB.peakOcc['肩']) >= Math.max(qB.peakOcc['髋'], qB.peakOcc['膝']),
  `肘 ${pc(qB.peakOcc['肘'])} 肩 ${pc(qB.peakOcc['肩'])} vs 髋 ${pc(qB.peakOcc['髋'])} 膝 ${pc(qB.peakOcc['膝'])}`);
check('A4 ★ 没有位置反馈 ⇒ rest=0 时身体在 1 s 内就**蠕变塌陷**',
  qA.ySettle < qB.ySettle - 0.3,
  `静置 1 s 后胸腔高度：rest=0 → ${f(qA.ySettle)} m（bind 1.429），rest=9 → ${f(qB.ySettle)} m`);
check('A5 ★★ 即便 rest=9，**不加任何扰动它自己也会倒**（静息不是稳定平衡）',
  qB.fallT !== null || qB.peakXiZ > P_Z_PASSIVE,
  `rest=9 静息 2.5 s：侧向 ξz 峰值 ${f(qB.peakXiZ)} > 被动域 ${f(P_Z_PASSIVE)}`
  + `（前后 ξx 峰值 ${f(qB.peakXi)} > ${f(P_X)}）；胸腔 ${f(qB.ySettle)} → ${f(qB.yEnd)} m`);
log('');

// ------------------------------------------------------------ B 组：受扰审计

const DV = 0.2;
log(`══════ B 组：受扰（每刚体 m_i·Δv，纯 CoM 平移激励 Δv = ${DV} m/s 沿 +X）══════`);
log(`  理论可救上限 ω·p_max = ${f(V_CATCH)} m/s ⇒ 本次只用到 ${pc(DV / V_CATCH, 0)} 的额度，落在"可救"区间内`);
log('');
const CFG: [string, number, number][] = [
  ['rest=0    τ×1（纯制动）', 0, 1],
  ['rest=9    τ×1（当前）', 9, 1],
  ['rest=36   τ×1（增益×4）', 36, 1],
  ['rest=144  τ×1（增益×16）', 144, 1],
  ['rest=9    τ×4（权限×4）', 9, 4],
  ['rest=144  τ×4（双管齐下）', 144, 4],
];
const rsB = CFG.map(([l, r, s]) => run(l, r, s, false, DV));
table(rsB, true);
log('');
log('  ★ 位移列（t = 0.25/0.5/1/2 s，单位 m）：');
for (const r of rsB) {
  log(`    ${r.label.padEnd(22)} ${r.markX.map((x) => f(x).padStart(7)).join(' ')}   ξx 峰 ${f(r.peakXi)}   ξz 峰 ${f(r.peakXiZ)}`);
}
log('');
{
  // ★ 对比必须**单变量**：cur = rest=9 τ×1，big = rest=9 τ×4（只动权限）。
  //   上一版我写成 cur vs rsB[5]（rest=144 τ×4），restTension 和 torqueScale 一起变了，
  //   两个变量同时动 ⇒ 那个"逐位相同"的断言本身就不可满足。
  const cur = rsB[1], hi = rsB[3], big = rsB[4];
  check('B1 受扰后 6 组配置**全部**让 DCM 越界 ⇒ 谁都没在控制重心',
    rsB.every((r) => r.peakXi > P_X || r.peakXiZ > P_Z_PASSIVE),
    `ξx 峰 ${f(Math.min(...rsB.map((r) => r.peakXi)))} ~ ${f(Math.max(...rsB.map((r) => r.peakXi)))}（域 ${f(P_X)}）`
    + ` · ξz 峰 ${f(Math.min(...rsB.map((r) => r.peakXiZ)))} ~ ${f(Math.max(...rsB.map((r) => r.peakXiZ)))}（被动域 ${f(P_Z_PASSIVE)}）`);
  check('B2 冲量远低于可救上限、仍然救不回来 ⇒ 不是"幅度太大"',
    DV < V_CATCH * 0.7, `${DV} vs ${f(V_CATCH)} m/s`);
  check('B3 被动增益 ×16 救不回来、反而漂得更远 ⇒ 它只是"乱抖"，不是平衡',
    hi.peakXi > cur.peakXi,
    `rest=144 峰值 ξ = ${f(hi.peakXi)} vs rest=9 的 ${f(cur.peakXi)}`);
  // ★ B4 的正确证法不是"轨迹逐位相同"（那个前提是错的：`imp = clamp(τ·dt, ±α·|err|·Ieff)` 里
  //   `Ieff` 随 torqueScale 变，所以 ±α 那个自适应上限也跟着变，轨迹**一定**会微微不同）。
  //   真正要证的是"**多出来的权限没被用上**" —— 用三条互相独立的证据合起来证：
  //   ① 髋/膝一次上限都没碰到；② 同样的力，占用率等比缩到 ~1/4（说明力矩是同一个物理量，只是分母变大了）；
  //   ③ 轨迹/峰值 ξ/摔倒时刻几乎不动（τ×1 与 τ×4 差异在读数误差量级）。
  const occRatio = (g: Group) => cur.peakOcc[g] / Math.max(big.peakOcc[g], 1e-9);
  const trajDiff = Math.max(...big.markX.map((x, i) => Math.abs(x - cur.markX[i])));
  check('B4 权限 ×4：髋/膝不再触上限、占用率等比掉到 1/4、而轨迹几乎不动 ⇒ 权限不是瓶颈',
    big.capCount['髋'] === 0 && big.capCount['膝'] === 0
      && occRatio('髋') > 3 && occRatio('髋') < 5.5
      && occRatio('膝') > 3 && occRatio('膝') < 5.5
      && trajDiff < 0.02
      && Math.abs(big.peakXi - cur.peakXi) < 0.01,
    `触上限 ${big.capCount['髋']}/${big.capCount['膝']} 次；占用 髋 ${pc(cur.peakOcc['髋'])}→${pc(big.peakOcc['髋'])}（÷${f(occRatio('髋'), 1)}）`
    + ` 膝 ${pc(cur.peakOcc['膝'])}→${pc(big.peakOcc['膝'])}（÷${f(occRatio('膝'), 1)}）；`
    + `轨迹最大差 ${f(trajDiff, 4)} m，峰值 ξ ${f(cur.peakXi)}→${f(big.peakXi)}`);
  check('B5 髋/膝力矩占用远未打满 ⇒ 平衡权限有余量',
    Math.max(cur.peakOcc['髋'], cur.peakOcc['膝']) < 0.6,
    `当前峰值：髋 ${pc(cur.peakOcc['髋'])} 膝 ${pc(cur.peakOcc['膝'])}（打满的是肘 ${pc(cur.peakOcc['肘'])}）`);
}
log('');

// ------------------------------------------------------------ [X] 权限标定（解析）

log('══════ [X] 权限标定：把 CoP 顶到支撑域边缘需要多少力矩？ ══════');
log('  本骨架**无踝关节**（脚与小腿同刚体）⇒ CoP 只能靠**膝关节力矩**顶（"膝即踝"）：Δp = τ / N_leg');
log('');
const NL_D = NW / 2, NL_S = NW;
const capFlex = sk.joints.find((j) => j.name === 'knee_l')!.maxTorque[2];
const capAbd = sk.joints.find((j) => j.name === 'knee_l')!.maxTorque[0];
log(`  单腿负荷：双腿支撑 ${f(NL_D, 0)} N   单腿支撑 ${f(NL_S, 0)} N`);
log(`  膝关节上限：屈伸 ${f(capFlex, 0)} N·m   外展 ${f(capAbd, 0)} N·m`);
log('');
log(`  ${'方向'.padEnd(10)} ${'脚印内半幅 Δp'.padStart(13)} ${'τ(双腿)'.padStart(10)} ${'占比'.padStart(7)} ${'τ(单腿)'.padStart(10)} ${'占比'.padStart(7)}  余量`);
for (const [name, dp, cap] of [['前后(屈伸)', P_X, capFlex], ['侧向(外展)', P_Z, capAbd]] as [string, number, number][]) {
  const td = NL_D * dp, ts = NL_S * dp;
  log(`  ${name.padEnd(10)} ${f(dp).padStart(13)} ${f(td, 1).padStart(10)} ${pc(td / cap, 0).padStart(7)} ${f(ts, 1).padStart(10)} ${pc(ts / cap, 0).padStart(7)}  ${f(cap / ts, 1)}×`);
}
check('X1 最坏情况（单腿全重）顶到前/后缘也只要 ≤60% 权限',
  (NL_S * P_X) / capFlex <= 0.6,
  `${f(NL_S * P_X, 1)} / ${f(capFlex, 0)} = ${pc((NL_S * P_X) / capFlex, 0)}`);
check('X2 侧向同理', (NL_S * P_Z) / capAbd <= 0.6,
  `${f(NL_S * P_Z, 1)} / ${f(capAbd, 0)} = ${pc((NL_S * P_Z) / capAbd, 0)}`);
log('');

// ------------------------------------------------------------ [Y] 反事实：理想 DCM 控制器

log('══════ [Y] 反事实：同样冲量下，理想 DCM 控制器能不能救回来？ ══════');
log('  LIPM 积分 ẍ = ω²(x − p)，控制器取经典捕获点法 p = clamp(ξ, ±p_max)');
{
  let x = 0, v = DV;
  const dt = 1 / 960;
  let peakX = 0, peakXi = 0;
  for (let i = 0; i < Math.round(2.5 / dt); i++) {
    const xi = x + v / OMEGA;
    const p = Math.max(-P_X, Math.min(P_X, xi));
    const a = OMEGA * OMEGA * (x - p);
    v += a * dt; x += v * dt;
    peakX = Math.max(peakX, Math.abs(x));
    peakXi = Math.max(peakXi, Math.abs(x + v / OMEGA));
  }
  log(`      初始 ξ = Δv/ω = ${f(DV / OMEGA)} m  ≤ p_max = ${f(P_X)} m  ⇒ **捕获域内，理论可救**`);
  log(`      理想控制器：峰值 |x| = ${f(peakX)} m，峰值 ξ = ${f(peakXi)} m，2.5 s 末速 ${f(v)} m/s`);
  check('Y1 同一冲量在理想 DCM 控制器下可被完全救回（ξ 从未越界）',
    peakXi <= P_X + 1e-6 && Math.abs(v) < 0.01,
    `峰值 ξ = ${f(peakXi)} ≤ ${f(P_X)}，末速 ${f(v)} m/s`);
}
log('');

// ------------------------------------------------------------ 结论

log('══════ 结论 ══════');
log('  1. ✘「关节完全不施加力」—— 不成立，而且**方向相反**。targets = 0 的含义是"把关节角速度刹到 0"，');
log(`     所以静息时每个轴**每步都在出力**（零出力轴仅 ${pc(qB.zeroAxes, 2)}），打满的是**肘**这类非平衡关节。`);
log('  2. ✘「权限不够」—— 不成立。[X] 说最坏情况也只用 50~55%；实测把权限 ×4 后髋/膝再也没触过上限，');
log(`     占用率等比缩到 1/4，而 CoM 轨迹只差 ${f(Math.max(...rsB[4].markX.map((x, i) => Math.abs(x - rsB[1].markX[i]))), 4)} m、峰值 ξ 只差 ${f(Math.abs(rsB[4].peakXi - rsB[1].peakXi), 4)}（B4）`);
log('     ⇒ 那些权限**根本没被用上**：不是被人卡住，是没人去要。');
log('  3. ✘「控制器不够强」—— 不成立。把唯一的"位置型"控制器（restTension）增益 ×16，');
log('     DCM 漂得**更远**（B3）⇒ 它是在关节空间里乱抖，不是在重心空间里平衡。');
log('  4. ✔ 真正的缺口：**没有任何东西在控制重心（CoP / DCM）**。证据链：');
log('     · 观测 88 维里没有 CoM / CoM 速度 / CoP / DCM（probe-stability [F]）；');
log('     · 适应度惩罚的是胸腔倾角（占 12.4% 质量、中心离 CoM 0.46 m）；');
log('     · 唯一的"位置反馈"是 restTension 的关节角回中，与 CoM 无因果关系。');
log('  5. ✔ 而这件事**是做得到的**：[Y] 用同一冲量跑理想捕获点控制器，峰值 ξ 从未越界、末速归零。');
log('     ⇒ 缺的是"有人在用这些力"，不是"没有力"。');
log('  6. ⚠ ★★ 额外发现（可能比上面的问题更急）：**这个姿势静息就站不住**。');
log('     rest=9、零命令零扰动，ξz 在 t≈1.0→1.25 s 越过侧向"被动"CoP 半宽后立刻侧翻，');
log(`     胸腔从 ${f(qB.ySettle)} m 掉到 ${f(qB.yEnd)} m（A5）。机制见 [Z]：凸包 ±0.266 m 是**主动**可达域，`);
log('     要靠"差动卸载一只脚"才拿得到；没有任何控制器时净 CoP 被夹在两脚脚印中心的中点，');
log('     **被动侧向半宽只有 ±0.065 m（凸包的 24%）** ⇒ 静止平衡这一项当前**不成立**，');
log('     这不是调参问题，是"侧向余量本来就没有"。');
log(`  7. ⚠ 结构性问题：网络输出是**角速度目标** ⇒ 对静载荷只能靠"速度误差"换力矩 ⇒ 静止姿态必然**蠕变**`);
log(`     （A4：rest=0 时胸腔 ${f(qA.ySettle)}→${f(qA.yEnd)} m）。速度控制 + 静载荷天生不匹配；`);
log('     这也是 restTension 存在的唯一理由。');

log('');
log(failures === 0 ? '  ✅ probe-push 全部通过' : `  ❌ probe-push 失败 ${failures} 项`);
process.exitCode = failures === 0 ? 0 : 1;
