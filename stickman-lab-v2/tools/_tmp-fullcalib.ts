/** _tmp-fullcalib: 一次性标定 全部自由度 → 膝/髋/踝 位置响应（物理级）
 *  输出紧凑表：每个 dof 对 (膝x,膝z,髋x,髋z,踝x,踝z) 的 cm/deg
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup } from '../src/core/servo/squat';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
squatCourtSetup(w, ctl, 2.0);
const body = w.body;

const P = (nm: string, ax: number): { x: number; z: number } => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return { x: NaN, z: NaN };
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, z: a[2]! };
};

const rotSub = (nm: string, ax: number, deg: number): void => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return;
  const d = body.dofs[i]!;
  const pivot = { x: d.anchorWorld[0]!, y: d.anchorWorld[1]!, z: d.anchorWorld[2]! };
  const axv = { x: d.axisWorld[0]!, y: d.axisWorld[1]!, z: d.axisWorld[2]! };
  const ang = (deg * Math.PI) / 180;
  const c = Math.cos(ang), s = Math.sin(ang);
  const rot = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
    const dot = v.x * axv.x + v.y * axv.y + v.z * axv.z;
    const cr = { x: axv.y * v.z - axv.z * v.y, y: axv.z * v.x - axv.x * v.z, z: axv.x * v.y - axv.y * v.x };
    return {
      x: v.x * c + cr.x * s + axv.x * dot * (1 - c),
      y: v.y * c + cr.y * s + axv.y * dot * (1 - c),
      z: v.z * c + cr.z * s + axv.z * dot * (1 - c),
    };
  };
  const chainBodies = body.subtree[d.joint] ?? [];
  for (const bi of chainBodies) {
    const rb = body.bodies[bi]!;
    const t = rb.translation();
    const p = rot({ x: t.x - pivot.x, y: t.y - pivot.y, z: t.z - pivot.z });
    rb.setTranslation({ x: pivot.x + p.x, y: pivot.y + p.y, z: pivot.z + p.z }, true);
  }
  const set = new Set(chainBodies);
  for (const d2 of body.dofs) {
    if (!set.has(d2.b1) && !set.has(d2.b2)) continue;
    const ap = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
    const p = rot({ x: ap.x - pivot.x, y: ap.y - pivot.y, z: ap.z - pivot.z });
    d2.anchorWorld[0] = pivot.x + p.x; d2.anchorWorld[1] = pivot.y + p.y; d2.anchorWorld[2] = pivot.z + p.z;
    const av = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
    const q = rot(av);
    d2.axisWorld[0] = q.x; d2.axisWorld[1] = q.y; d2.axisWorld[2] = q.z;
  }
};

console.log('════ 全自由度响应标定（cm/deg，物理扰动）════');
console.log('dof        |  膝x     膝z    |  髋x     髋z    |  踝x     踝z    | axisWorld');
for (const [nm, ax] of [
  ['hip_l', 0], ['hip_l', 1], ['hip_l', 2],
  ['knee_l', 0], ['knee_l', 1], ['knee_l', 2],
  ['foot_l', 0], ['foot_l', 1], ['foot_l', 2],
] as const) {
  const i = body.dofByName(nm, ax);
  if (i < 0) continue;
  const d = body.dofs[i]!;
  if (d.preRing) { console.log(`${nm}/${ax}  [preRing 锁死]`); continue; }
  const b0 = { k: P('knee_l', 2), h: P('hip_l', 2), a: P('foot_l', 2) };
  rotSub(nm, ax, 1);
  const b1 = { k: P('knee_l', 2), h: P('hip_l', 2), a: P('foot_l', 2) };
  rotSub(nm, ax, -1);
  const f = (p0: number, p1: number): string => ((p1 - p0) * 100).toFixed(3).padStart(7);
  const aw = d.axisWorld;
  console.log(
    `${(nm + '/' + ax).padEnd(10)} | ${f(b0.k.x, b1.k.x)} ${f(b0.k.z, b1.k.z)} |` +
    ` ${f(b0.h.x, b1.h.x)} ${f(b0.h.z, b1.h.z)} | ${f(b0.a.x, b1.a.x)} ${f(b0.a.z, b1.a.z)} |` +
    ` [${aw[0]!.toFixed(3)},${aw[1]!.toFixed(3)},${aw[2]!.toFixed(3)}]`,
  );
}

console.log('\n════ 当前额状几何 ════');
const kl = P('knee_l', 2), hl = P('hip_l', 2), al = P('foot_l', 2);
const shinLen = Math.hypot(kl.x - al.x, 0, kl.z - al.z);
const thighLen = Math.hypot(hl.x - kl.x, 0, hl.z - kl.z);
console.log(`  踝z=${(al.z * 100).toFixed(2)} 膝z=${(kl.z * 100).toFixed(2)} 髋z=${(hl.z * 100).toFixed(2)}`);
console.log(`  膝z−踝z = ${((kl.z - al.z) * 100).toFixed(2)}cm  → 小腿额向偏角 = ${(Math.asin((kl.z - al.z) / 37.5) * 57.3).toFixed(2)}°`);
console.log(`  髋z−膝z = ${((hl.z - kl.z) * 100).toFixed(2)}cm  → 大腿额向偏角 = ${(Math.asin((hl.z - kl.z) / 42.2) * 57.3).toFixed(2)}°`);
console.log(`  (膝x−踝x)=${((kl.x - al.x) * 100).toFixed(1)}cm (髋x−膝x)=${((hl.x - kl.x) * 100).toFixed(1)}cm`);

console.log('\n════ 达到「膝z=踝z 且 髋z=膝z」需要的自由度组合（线性求解）════');
// 用标定值（cm/deg）建 2×N 系统
const resp: Record<string, number[][]> = {};
for (const [nm, ax] of [
  ['hip_l', 0], ['hip_l', 1], ['hip_l', 2],
  ['knee_l', 0], ['knee_l', 1], ['knee_l', 2],
  ['foot_l', 0], ['foot_l', 1], ['foot_l', 2],
] as const) {
  const i = body.dofByName(nm, ax);
  if (i < 0) continue;
  const d = body.dofs[i]!;
  if (d.preRing) continue;
  const b0 = { k: P('knee_l', 2), h: P('hip_l', 2), a: P('foot_l', 2) };
  rotSub(nm, ax, 1);
  const b1 = { k: P('knee_l', 2), h: P('hip_l', 2), a: P('foot_l', 2) };
  rotSub(nm, ax, -1);
  resp[`${nm}/${ax}`] = [
    [(b1.k.x - b0.k.x) * 100, (b1.k.z - b0.k.z) * 100],
    [(b1.h.x - b0.h.x) * 100, (b1.h.z - b0.h.z) * 100],
    [(b1.a.x - b0.a.x) * 100, (b1.a.z - b0.a.z) * 100],
  ];
}
const keys = Object.keys(resp);
console.log(`  约束1: Δ(膝z−踝z)=0   约束2: Δ(髋z−膝z)=0`);
console.log(`  自由度: ${keys.join(', ')}`);
// 约束矩阵 2×N
const M: number[][] = [
  keys.map((k) => resp[k]![0]![1]! - resp[k]![2]![1]!),   // ∂(膝z−踝z)
  keys.map((k) => resp[k]![1]![1]! - resp[k]![0]![1]!),   // ∂(髋z−膝z)
];
const r = [-(kl.z - al.z) * 100, -(hl.z - kl.z) * 100];
console.log(`  矩阵行1(∂(膝z−踝z)): ${M[0]!.map((v) => v.toFixed(4)).join(', ')}`);
console.log(`  矩阵行2(∂(髋z−膝z)): ${M[1]!.map((v) => v.toFixed(4)).join(', ')}`);
console.log(`  rhs: ${r.map((v) => v.toFixed(2)).join(', ')} cm`);
// 最小范数解
const N = keys.length;
const A: number[][] = []; const b: number[] = [];
for (let i = 0; i < N; i++) {
  A.push(new Array<number>(N).fill(0));
  let rhs = 0;
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let k = 0; k < 2; k++) s += M[k]![i]! * M[k]![j]!;
    A[i]![j] = s;
  }
  for (let k = 0; k < 2; k++) rhs += M[k]![i]! * r[k]!;
  A[i]![i] = A[i]![i]! + 1e-8;
  b.push(rhs);
}
// 高斯
for (let col = 0; col < N; col++) {
  let piv = col;
  for (let rr = col + 1; rr < N; rr++) if (Math.abs(A[rr]![col]!) > Math.abs(A[piv]![col]!)) piv = rr;
  if (Math.abs(A[piv]![col]!) < 1e-14) continue;
  [A[piv], A[col]] = [A[col], A[piv]];
  [b[piv], b[col]] = [b[col], b[piv]];
  const dd = A[col]![col]!;
  for (let j = col; j < N; j++) A[col]![j] = A[col]![j]! / dd;
  b[col] = b[col]! / dd;
  for (let rr = 0; rr < N; rr++) {
    if (rr === col) continue;
    const f = A[rr]![col]!;
    if (f === 0) continue;
    for (let j = col; j < N; j++) A[rr]![j] = A[rr]![j]! - f * A[col]![j]!;
    b[rr] = b[rr]! - f * b[col]!;
  }
}
console.log('  解 (deg):');
keys.forEach((k, i) => { if (Math.abs(b[i]!) > 1e-4) console.log(`    ${k} = ${b[i]!.toFixed(2)}°`); });
