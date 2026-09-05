/**
 * §14.11 包络场数值原型（离线，不碰游戏代码）：
 * 验证 u(p) = min over 4 卡氏射线 r, cell k≥0: N[j+k] + d_k(p)/W 的形态。
 *   - d_k：p 到"第 k 个 cell 的最近边"的轴距（k=0 → 0；+x = k−frac；−x = frac+(k−1)）
 *   - W：每层过渡宽度（m/层）；u 连续 ⇒ 顶面无内部台阶（水密）
 * 检查项：
 *   ① 十字坑(5格) 逐层加深 L=1..8：中心可达深度（饱和曲线）
 *   ② 单格孤立高层：最大深度（不能深于离地距离/W —— 无内墙几何的硬约束）
 *   ③ 层差跃变连续性：L|L+1 邻接剖面无跳变、无尖点、坡度单调
 *   ④ 对角不泄压：十字坑中心不被对角 0 格拉低（卡氏射线必须成立）
 *   ⑤ 剖面观感 vs 现行 smoothstep(1m) 坑形（W 档位对比）
 */
const N = 21;            // cell 矩阵宽（奇数，中心 10,10）
const FRAC = 0.125;      // 采样细分（与 fine 一致）

function makeMap(center: [number, number][], level: number): Uint8Array {
  const m = new Uint8Array(N * N);
  for (const [lx, lz] of center) m[lz * N + lx] = level;
  return m;
}

/** 4 射线包络场求值（轴距、卡氏方向、W 每层宽度） */
function uAt(map: Uint8Array, x: number, z: number, W: number): number {
  const lx = Math.floor(x), lz = Math.floor(z);
  if (lx < 0 || lz < 0 || lx >= N || lz >= N) return 0;
  const fx = x - lx, fz = z - lz;
  const own = map[lz * N + lx];
  if (own === 0) return 0;
  let best = own; // 自身 cell 常数地板（k=0 候选）
  // +x
  {
    let v = best;
    for (let k = 1; lx + k < N; k++) {
      const cand = map[lz * N + (lx + k)] + (k - fx) / W;
      if (cand < v) { v = cand; if (v <= 0) break; }
      if ((k - fx) / W >= v) break; // 后续单调增，剪枝
    }
    if (v < best) best = v;
  }
  // -x
  {
    let v = best;
    for (let k = 1; lx - k >= 0; k++) {
      const cand = map[lz * N + (lx - k)] + (fx + (k - 1)) / W;
      if (cand < v) { v = cand; if (v <= 0) break; }
      if ((fx + (k - 1)) / W >= v) break;
    }
    if (v < best) best = v;
  }
  // +z
  {
    let v = best;
    for (let k = 1; lz + k < N; k++) {
      const cand = map[(lz + k) * N + lx] + (k - fz) / W;
      if (cand < v) { v = cand; if (v <= 0) break; }
      if ((k - fz) / W >= v) break;
    }
    if (v < best) best = v;
  }
  // -z
  {
    let v = best;
    for (let k = 1; lz - k >= 0; k++) {
      const cand = map[(lz - k) * N + lx] + (fz + (k - 1)) / W;
      if (cand < v) { v = cand; if (v <= 0) break; }
      if ((fz + (k - 1)) / W >= v) break;
    }
    if (v < best) best = v;
  }
  return Math.max(0, best);
}

/** 沿 x 剖面（z 固定） */
function profile(map: Uint8Array, z: number, W: number): number[] {
  const out: number[] = [];
  for (let gx = 0; gx <= N; gx += FRAC) out.push(uAt(map, gx, z, W));
  return out;
}

const cross: [number, number][] = [
  [10, 10], [11, 10], [9, 10], [10, 9], [10, 11],
];
const single: [number, number][] = [[10, 10]];
const twoPlateau: [number, number][] = [];
for (let lx = 0; lx <= 8; lx++) for (let lz = 0; lz < N; lz++) twoPlateau.push([lx, lz]); // 左半 L1
for (let lx = 9; lx < N; lx++) for (let lz = 0; lz < N; lz++) twoPlateau.push([lx, lz]); // 右半 L2

let failures = 0;
const ok = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) failures++;
};

console.log("== ① 十字坑逐层加深：中心可达深度（饱和曲线） ==");
for (const W of [0.25, 0.5, 1.0]) {
  const row: string[] = [];
  for (let L = 1; L <= 8; L++) {
    const m = makeMap(cross, L);
    const d = uAt(m, 10.5, 10.5, W);
    row.push(`${L}→${d.toFixed(2)}`);
  }
  console.log(`  W=${W}m/层  ` + row.join("  "));
}

console.log("== ② 单格孤立高层：最大深度（无内墙的硬约束） ==");
for (const W of [0.25, 0.5, 1.0]) {
  const row: string[] = [];
  for (let L = 1; L <= 6; L++) {
    const m = makeMap(single, L);
    const d = uAt(m, 10.5, 10.5, W);
    row.push(`${L}→${d.toFixed(2)}`);
  }
  console.log(`  W=${W}m/层  ` + row.join("  "));
}

console.log("== ③ 层差跃变 L1|L2 剖面（边界 x=9）连续性 ==");
{
  const m = new Uint8Array(N * N);
  for (let lx = 0; lx < N; lx++) for (let lz = 0; lz < N; lz++) m[lz * N + lx] = lx < 9 ? 1 : 2;
  // 剖面取 x ∈ [1,20]（避开矩阵边缘的测试假象：边缘外 = 0 由 seam 语义负责）
  const prof = profile(m, 10.5, 0.5);
  let maxStep = 0, prev = prof[Math.round(1 / FRAC)];
  for (let idx = Math.round(1 / FRAC) + 1; idx <= Math.round(20 / FRAC); idx++) {
    const v = prof[idx];
    maxStep = Math.max(maxStep, Math.abs(v - prev) / FRAC);
    prev = v;
  }
  // 边界在 x=9（cell8 层1 | cell9 层2）：过渡发生在 cell9 前 0.5m 内，斜率 ≤ 1/W=2
  ok(maxStep <= 2.001 + 1e-9, `③ 跃变处无跳变（内部最大斜率 ${maxStep.toFixed(2)} 层/m ≤ 1/W=2）`);
  const at = (x: number) => prof[Math.round(x / FRAC)];
  ok(at(8.5) <= 1.001 && at(9.0) <= 1.001 && at(9.25) > 1.2 && at(9.25) < 1.8
    && at(9.5) >= 1.99,
    `③ 过渡在右侧 cell 前 0.5m 内完成（x:8.5=${at(8.5).toFixed(2)} 9.0=${at(9.0).toFixed(2)} 9.25=${at(9.25).toFixed(2)} 9.5=${at(9.5).toFixed(2)}）`);
}

console.log("== ④ 对角不泄压：十字 W=0.5 中心须到满层 ==");
{
  const m3 = makeMap(cross, 3);
  const d = uAt(m3, 10.5, 10.5, 0.5);
  ok(d >= 2.99, `④ 十字 L3 中心 = ${d.toFixed(2)} ≥ 3（对角 0 格不拉低）`);
}

console.log("== ⑤ 剖面观感（x 中线；层 1） ==");
for (const W of [0.5, 1.0]) {
  const m = makeMap(cross, 1);
  const prof = profile(m, 10.5, W);
  const mid = prof.length >> 1;
  const left = prof.slice(0, mid + 1);
  const right = prof.slice(mid).reverse();
  const top = prof[mid];
  console.log(`  W=${W}: 中心 ${top.toFixed(2)}，距中心 1m 处 ${prof[mid + Math.round(1 / FRAC)].toFixed(2)}，2m ${prof[mid + Math.round(2 / FRAC)].toFixed(2)}`);
  void left; void right;
}

console.log(failures === 0 ? "\n=== PATCH STACK 原型全部通过 ===" : `\n=== 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);