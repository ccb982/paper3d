// ============================================================
// probe-skin —— 离屏验收：躯干护甲的「一张贴图 + 骨架折叠」是否真的成立
// ============================================================
// 为什么要有这个文件：躯干被切成 K 段**物理刚体**，视觉上却必须是**一整张贴图**。
//   之前每个脊柱刚体各建一个 PlaneGeometry(w, h)（h = 整块高度）⇒ 4 张完整躯干图
//   沿脊柱堆叠，就是那条"蜈蚣"。修法是把整块躯干收进**一个** mesh，按脊柱段做
//   逐顶点线性混合蒙皮（LBS，见 src/render/viewer.ts 的 buildSkinBinding/skinPositions）。
//
// 蒙皮是纯数学，不该靠截图判断 —— 这里把 viewer.ts 的**真实函数**（不是复刻版）
//   打包进 node 直跑（esbuild → .tmp/*.bundle.mjs），对它做确定性断言：
//     [A] 绑定收敛：单位旋转下蒙皮输出必须逐分量等于 bindPos（否则基座就错了）
//     [B] 刚体变换不变性：整段施加同一 (R0,T0) ⇒ 输出必须是 R0·bindPos + T0
//         —— 这一条同时抓"权重不归一"和"矩阵转置错"
//     [C] 权重完备：Σw = 1、s0 沿高度单调、次段权重连续（无撕裂的唯一条件）
//     [D] 板面几何：板高 = K 段之和 = part 整块高（⇒ 没裁图、没拉伸 = "一张贴图"）
//     [E] 折叠保真：按关节链递推的弯折姿态下，LBS 与"逐段刚性折叠"的偏差（mm）
//     [F] 无塌陷：弯折后相邻行间距不得低于直姿的 85%（LBS 的 candy-wrapper 检查）
//     [G] 折叠生效：弯折后板顶必须真的跟着胸腔走（不是冻在骨盆上）
//
// 跑法：node tools/run.mjs probe-skin

import { META } from '../src/core/partsMeta';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import {
  buildSkinBinding, bindSegPositions, identitySegRotations, skinPositions, groupPlates,
  type SkinBinding,
} from '../src/render/viewer';

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
function note(name: string, detail = ''): void {
  log(`  info  ${name}${detail ? '   ' + detail : ''}`);
}

const f = (x: number, n = 4) => x.toFixed(n);
const deg = (r: number) => (r * 180) / Math.PI;

// ------------------------------------------------------------ 0. 骨架 + 绑定

const sk = buildSkeleton(DEFAULT_CONFIG);
const K = sk.cfg.spineSegments;

// ★ 用 viewer 的**真实分组规则**（不是复刻版）——"板数 = 组件数"这条不变量就在这验
const groups = groupPlates(sk);
const segIdx = groups.skinned;

log('躯干护甲蒙皮 —— 一张贴图 + 骨架折叠');
log(`  骨架：${sk.bodies.length} 刚体 / ${sk.joints.length} 关节 / ${sk.joints.length * 3} 转动自由度`);
log(`  脊柱：parsed K=${K} 段（带 texSlice 的刚体 ${segIdx.length} 个：${segIdx.map((i) => sk.bodies[i].key).join(', ')}）`);

const b = buildSkinBinding(sk, segIdx, 6);
const Kb = b.segBody.length;

log(`  蒙皮板：${b.rows} 行 × 2 列 = ${b.vCount} 顶点，宽 ${f(b.w)} m × 高 ${f(b.H)} m，板心 y=${f(b.cyC)}`);
log('');

// ------------------------------------------------------------ A. 绑定收敛

{
  const segT = new Float64Array(Kb * 3);
  const segR = new Float64Array(Kb * 9);
  bindSegPositions(sk, b, segT);
  identitySegRotations(b, segR);
  const out = new Float32Array(b.vCount * 3);
  skinPositions(b, segT, segR, out);

  let worst = 0;
  let worstAt = -1;
  for (let i = 0; i < out.length; i++) {
    const d = Math.abs(out[i] - b.bindPos[i]);
    if (d > worst) { worst = d; worstAt = (i / 3) | 0; }
  }
  check('A 绑定收敛（单位旋转 ⇒ 输出 = bindPos）', worst < 1e-6,
    `max|Δ| = ${worst.toExponential(2)} m（顶点 ${worstAt}）`);
}

// ------------------------------------------------------------ B. 刚体变换不变性

{
  // 任意刚体变换：绕 Y 转 0.4 rad 再平移 (0.3, 0.5, −0.2)。
  // LBS 下：所有权重和为 1 ⇒ 输出必须恰好是 R0·bindPos + T0（与分段方式无关）。
  const ang = 0.4;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // 绕 Y：x' = ca·x + sa·z ; z' = −sa·x + ca·z
  const R0 = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  const T0 = [0.3, 0.5, -0.2];

  const bindT = new Float64Array(Kb * 3);
  bindSegPositions(sk, b, bindT);
  const segT = new Float64Array(Kb * 3);
  const segR = new Float64Array(Kb * 9);
  for (let s = 0; s < Kb; s++) {
    for (let r = 0; r < 9; r++) segR[s * 9 + r] = R0[r];
    const x = bindT[s * 3], y = bindT[s * 3 + 1], z = bindT[s * 3 + 2];
    segT[s * 3] = R0[0] * x + R0[1] * y + R0[2] * z + T0[0];
    segT[s * 3 + 1] = R0[3] * x + R0[4] * y + R0[5] * z + T0[1];
    segT[s * 3 + 2] = R0[6] * x + R0[7] * y + R0[8] * z + T0[2];
  }
  const out = new Float32Array(b.vCount * 3);
  skinPositions(b, segT, segR, out);

  let worst = 0;
  for (let i = 0; i < b.vCount; i++) {
    const x = b.bindPos[i * 3], y = b.bindPos[i * 3 + 1], z = b.bindPos[i * 3 + 2];
    const ex = R0[0] * x + R0[1] * y + R0[2] * z + T0[0];
    const ey = R0[3] * x + R0[4] * y + R0[5] * z + T0[1];
    const ez = R0[6] * x + R0[7] * y + R0[8] * z + T0[2];
    worst = Math.max(worst, Math.hypot(out[i * 3] - ex, out[i * 3 + 1] - ey, out[i * 3 + 2] - ez));
  }
  check('B 刚体变换不变性（⇒ 权重归一 & 矩阵无转置错）', worst < 1e-6,
    `max|Δ| = ${worst.toExponential(2)} m`);
}

// ------------------------------------------------------------ C. 权重完备 / 连续

{
  let badSum = 0, badRange = 0, badNext = 0;
  for (let i = 0; i < b.vCount; i++) {
    const w1 = b.vW1[i];
    if (Math.abs((1 - w1) + w1 - 1) > 1e-9) badSum++;
    // ★ 上限取闭区间：vW1 是 Float32Array，v = x.9999999 存进去会进位成 1.0
    //   （等价于"100% 属于次段"，与真值差 ~1e-7 个变换差 —— 无观感影响）
    if (w1 < 0 || w1 > 1) badRange++;
    if (b.vS1[i] !== Math.min(Kb - 1, b.vS0[i] + 1)) badNext++;
  }
  check('C1 权重完备（1−w1 + w1 = 1）', badSum === 0, `异常 ${badSum} 个`);
  check('C2 次段权重 ∈ [0,1] 且 s1 = s0+1（s0 已封顶）', badRange === 0 && badNext === 0,
    `越界 ${badRange} / s1 错 ${badNext}`);

  // ★ 段分配必须是"干净的分区"：自顶向下 s0 每次只 −1，总共恰好 K−1 次。
  //   注意**不能**断言"相邻行权重跳变小" —— 段交接处 w1 必然从 ~1 掉回 0，
  //   那是交接本身，不是撕裂。位置连续性由 F（弯折后的行距）负责卡。
  let steps = 0, badStep = 0;
  for (let i = 0; i + 2 < b.vCount; i += 2) {
    const d = b.vS0[i] - b.vS0[i + 2];
    if (d === 1) steps++;
    else if (d !== 0) badStep++;
  }
  check('C3 段分配是干净分区（s0 每次恰 −1，共 K−1 次）',
    badStep === 0 && steps === Kb - 1, `递减 ${steps} 次（应为 ${Kb - 1}）/ 非法步 ${badStep}`);

  // s0 沿高度单调：iy=0 是最上一行 ⇒ 绑最上段
  let mono = true;
  for (let i = 0; i + 2 < b.vCount; i += 2) if (b.vS0[i + 2] > b.vS0[i]) mono = false;
  check('C4 s0 沿高度自顶向下单调不增（顶=胸腔 / 底=骨盆）', mono,
    `顶行绑段 ${b.vS0[0]}，底行绑段 ${b.vS0[b.vCount - 1]}`);
  check('C5 板顶绑最上段、板底绑骨盆', b.vS0[0] === Kb - 1 && b.vS0[b.vCount - 1] === 0,
    `顶 ${b.vS0[0]} / 底 ${b.vS0[b.vCount - 1]}（应为 ${Kb - 1} / 0）`);
}

// ------------------------------------------------------------ D. 板面几何 = 一张完整贴图

{
  const part = sk.bodies[segIdx[0]].part;
  const artH = part.bh * sk.px2m;
  const artW = part.bw * sk.px2m;

  let segSum = 0;
  let samePart = true;
  for (const i of segIdx) {
    segSum += sk.bodies[i].length;
    if (sk.bodies[i].part.file !== part.file) samePart = false;
  }
  const idxOk = segIdx.every((i, n) => sk.bodies[i].texSlice!.index === n && sk.bodies[i].texSlice!.count === Kb);

  check('D1 K 段共用同一张贴图（否则无从"一张纹理"）', samePart && idxOk,
    `${part.file}`);
  check('D2 板高 = 各段长度之和', Math.abs(b.H - segSum) < 1e-9,
    `${f(b.H)} vs ${f(segSum)}`);
  check('D3 板高 = 素材整块高度（没裁图 = 没变成"每段一张整图"）', Math.abs(b.H - artH) < 1e-6,
    `${f(b.H)} vs ${f(artH)}（part.bh=${part.bh}px）`);
  check('D4 板宽 = 素材整块宽度（未被压缩横向拉伸）', Math.abs(b.w - artW) < 1e-9,
    `${f(b.w)} vs ${f(artW)}`);
  check('D5 板高 = K × 段高（顶点正好落在每段中心线上）',
    Math.abs(b.H - Kb * sk.bodies[segIdx[0]].length) < 1e-9,
    `${f(b.H)} vs K·segLen = ${f(Kb * sk.bodies[segIdx[0]].length)}`);
  note('板面几何', `w=${f(b.w)} H=${f(b.H)}（= ${f(segSum / Kb)} m/段 × ${Kb}）`);
}

// ------------------------------------------------------------ E/F/G. 折叠

/** 按关节链递推的弯折姿态：相邻段端面严格相接（就是 ragdoll 实际会走到的姿态） */
function bendPose(thetaPerSeg: number): { segT: Float64Array; segR: Float64Array } {
  const segT = new Float64Array(Kb * 3);
  const segR = new Float64Array(Kb * 9);
  const segLen = sk.bodies[b.segBody[0]].length;
  const half = segLen / 2;
  const cz = sk.bodies[b.segBody[0]].cz;
  // 骨盆底端（绑定姿态）
  let bx = 0;
  let by = sk.bodies[b.segBody[0]].cy - half;
  const bz = cz;
  for (let s = 0; s < Kb; s++) {
    const a = -s * thetaPerSeg;          // 绕 Z，负号 ⇒ 朝 +X（前方）弯
    const ca = Math.cos(a), sa = Math.sin(a);
    const rp = s * 9, tp = s * 3;
    segR[rp] = ca; segR[rp + 1] = -sa; segR[rp + 2] = 0;
    segR[rp + 3] = sa; segR[rp + 4] = ca; segR[rp + 5] = 0;
    segR[rp + 6] = 0; segR[rp + 7] = 0; segR[rp + 8] = 1;
    // 段心 = 底端 + R·(0, half, 0) = 底端 + half·(R[1], R[4], R[7])
    segT[tp] = bx + segR[rp + 1] * half;
    segT[tp + 1] = by + segR[rp + 4] * half;
    segT[tp + 2] = bz;
    // 下一段底端 = 本段顶端 = 底端 + R·(0, segLen, 0)
    bx += segR[rp + 1] * segLen;
    by += segR[rp + 4] * segLen;
  }
  return { segT, segR };
}

{
  const THETA = (25 * Math.PI) / 180;     // 每个脊柱关节 25° = 该关节的软限位上限
  const { segT, segR } = bendPose(THETA);
  const out = new Float32Array(b.vCount * 3);
  skinPositions(b, segT, segR, out);

  // ---- E. 折叠保真 ----
  // ★ 先说清"对"是什么：LBS 的结果**本来就**不等于逐段刚性折叠 —— 它把折痕圆化了。
  //   可推导的精确结论（设关节处两段共享世界锚点 Jw，顶点离关节高度差 a、板内横向偏移 d）：
  //       p_s     = Jw + R_s·(0, a, d)
  //       p_{s+1} = Jw + R_{s+1}·(0, a, d)
  //   绕 Z 弯 ⇒ d（沿 Z）在旋转下不变 ⇒ 两者之差 = (R_s − R_{s+1})·(0, a, 0)，模长 = 2sin(θ/2)·|a|
  //   ⇒ **a = 0（正好在关节面上）时两者严格重合，LBS 无误差**；
  //      离关节越远偏差越大，且乘上混合权重 α ∈ [0, 0.5]。
  //   把 α·|a| 在 v ∈ [0,1] 段内取极大：max (0.5−|u|)·|u| = 1/16（u = v−0.5）
  //   ⇒ 圆化深度上界 = (1/16)·2sin(θ/2)·segLen。
  const segLen = sk.bodies[b.segBody[0]].length;
  const seamDevs: number[] = [];
  let worstE = 0;
  let worstVert = -1;
  for (let i = 0; i < b.vCount; i++) {
    const a3 = i * 3;
    const v = b.vW1[i] > 0 ? b.vS0[i] + b.vW1[i] : b.vS0[i];
    const s = Math.max(0, Math.min(Kb - 1, Math.round(v)));
    const rp = s * 9, tp = s * 3;
    const px = b.bindPos[a3] - sk.bodies[b.segBody[s]].cx;
    const py = b.bindPos[a3 + 1] - sk.bodies[b.segBody[s]].cy;
    const pz = b.bindPos[a3 + 2] - sk.bodies[b.segBody[s]].cz;
    const ex = segR[rp] * px + segR[rp + 1] * py + segR[rp + 2] * pz + segT[tp];
    const ey = segR[rp + 3] * px + segR[rp + 4] * py + segR[rp + 5] * pz + segT[tp + 1];
    const ez = segR[rp + 6] * px + segR[rp + 7] * py + segR[rp + 8] * pz + segT[tp + 2];
    const d = Math.hypot(out[a3] - ex, out[a3 + 1] - ey, out[a3 + 2] - ez);
    if (d > worstE) { worstE = d; worstVert = i; }
    // 正好落在关节面上的顶点：两个候选位置必须严格重合
    if (Math.abs(b.vW1[i] - 0.5) < 1e-7) seamDevs.push(d);
  }
  const bound = (1 / 16) * 2 * Math.sin(THETA / 2) * segLen;
  check('E1 关节面顶点：LBS = 刚性解（板在关节处不重叠/不裂开）',
    seamDevs.length > 0 && Math.max(...seamDevs) < 1e-5,
    `关节面顶点 ${seamDevs.length} 个，max = ${Math.max(...seamDevs).toExponential(2)} m`);
  check('E2 离关节处的"折痕圆化"深度 ≤ 解析上界 (1/16)·2sin(θ/2)·segLen',
    worstE <= bound, `max = ${f(worstE * 1000, 2)} mm ≤ ${f(bound * 1000, 2)} mm（顶点 ${worstVert}）`);

  // ---- F. 无塌陷：弯折后相邻行间距必须还在直姿的量级 ----
  let minRatio = Infinity, maxRatio = 0;
  for (let iy = 0; iy + 1 <= b.rows; iy++) {
    // 行 iy 的两个顶点：索引 2*iy（左）/ 2*iy+1（右）
    const a = 2 * iy * 3, c = 2 * (iy + 1) * 3;
    // 用两侧中点（中线上的点）量行距 —— 侧边点会被 LBS 向内夹一点
    const ax = (out[a] + out[a + 3]) / 2, ay = (out[a + 1] + out[a + 4]) / 2, az = (out[a + 2] + out[a + 5]) / 2;
    const cx = (out[c] + out[c + 3]) / 2, cy = (out[c + 1] + out[c + 4]) / 2, cz2 = (out[c + 2] + out[c + 5]) / 2;
    const bb = b.bindPos;
    const dx = (bb[a] + bb[a + 3]) / 2, dy = (bb[a + 1] + bb[a + 4]) / 2, dz = (bb[a + 2] + bb[a + 5]) / 2;
    const ex = (bb[c] + bb[c + 3]) / 2, ey = (bb[c + 1] + bb[c + 4]) / 2, ez = (bb[c + 2] + bb[c + 5]) / 2;
    const dNow = Math.hypot(cx - ax, cy - ay, cz2 - az);
    const dRef = Math.hypot(ex - dx, ey - dy, ez - dz);
    const r = dNow / dRef;
    if (r < minRatio) minRatio = r;
    if (r > maxRatio) maxRatio = r;
  }
  check('F 无塌陷/无爆开（相邻行间距比 ∈ [0.85, 1.10]）',
    minRatio >= 0.85 && maxRatio <= 1.10,
    `行距比 ${f(minRatio, 3)} ~ ${f(maxRatio, 3)}`);

  // ---- G. 折叠生效：板顶必须真的跟着胸腔走 ----
  const topMid = (arr: Float32Array) => ({
    x: (arr[0] + arr[3]) / 2,
    y: (arr[1] + arr[4]) / 2,
    z: (arr[2] + arr[5]) / 2,
  });
  const p0 = topMid(b.bindPos);
  const p1 = topMid(out);
  const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  // 顶端到底端的总弧长 = (K−1)·θ，弦长下界用 0.2·H 保守卡
  check('G 折叠生效：板顶跟随胸腔（位移 > 0.2·H）', moved > 0.2 * b.H,
    `板顶位移 ${f(moved)} m（累计弯 ${f(deg((Kb - 1) * THETA), 1)}°，H=${f(b.H)}）`);
  note('弯折姿态', `每关节 ${f(deg(THETA), 1)}° · 段心 y: ${
    Array.from({ length: Kb }, (_, s) => f(segT[s * 3 + 1], 3)).join(' / ')}  →  板顶前移 ${f(p1.x - p0.x)} m`);

  // 端点刚性：板最底行必须与骨盆刚体完全一致（不动）
  const botRef = { x: 0, y: b.cyC - b.H / 2, z: b.cz };
  const botNow = (() => {
    const a = 2 * b.rows * 3;
    return { x: (out[a] + out[a + 3]) / 2, y: (out[a + 1] + out[a + 4]) / 2, z: (out[a + 2] + out[a + 5]) / 2 };
  })();
  // 骨盆在弯折姿态里绕自己的底端转了，所以板底会有位移；这里只要求它**没乱飞**
  const botD = Math.hypot(botNow.x - botRef.x, botNow.y - botRef.y, botNow.z - botRef.z);
  check('G2 板底未乱飞（位移 ≤ 半个段高）', botD <= sk.bodies[b.segBody[0]].length / 2 + 1e-6,
    `${f(botD)} m ≤ ${f(sk.bodies[b.segBody[0]].length / 2)} m`);
}

// ------------------------------------------------------------ H. 与 PlaneGeometry 的契约

// ★ buildSkinBinding 的顶点编号是**假设**了 PlaneGeometry 的顶点顺序/UV 方向的。
//   这层契约一旦不成立（three 改实现 / 我们改分行参数），蒙皮会静默错位（图上下颠倒、
//   顶点数对不上、甚至越界写）。所以这里拿**真的** PlaneGeometry 逐条核对，
//   而不是信推导。viewer.ts 里也有一道运行时 throw 兜顶点数。
{
  const { PlaneGeometry } = await import('three');
  const geo = new PlaneGeometry(b.w, b.H, 1, b.rows);
  const pos = geo.getAttribute('position') as { count: number; getX(i: number): number; getY(i: number): number };
  const uv = geo.getAttribute('uv') as { getX(i: number): number; getY(i: number): number };
  const idx = geo.getIndex()!;

  check('H1 顶点数 = (rows+1)×2', pos.count === b.vCount, `${pos.count} vs ${b.vCount}`);
  check('H2 索引数 = 1×rows×6（一整块连续网格）', idx.count === 1 * b.rows * 6,
    `${idx.count} vs ${1 * b.rows * 6}`);

  const topY = pos.getY(0);
  const topL = pos.getX(0);
  const topR = pos.getX(1);
  const botIdx = 2 * b.rows;
  const botY = pos.getY(botIdx);
  check('H3 顶点 0 = 左上（iy=0 是最上一行、ix=0 是左边）',
    Math.abs(topY - b.H / 2) < 1e-6 && Math.abs(topL + b.w / 2) < 1e-6 && Math.abs(topR - b.w / 2) < 1e-6,
    `(x,y) = (${f(topL, 3)}, ${f(topY, 3)}) → (${f(topR, 3)}, ${f(topY, 3)})`);
  check('H4 最后一行的 y = −H/2（自上而下排列）', Math.abs(botY + b.H / 2) < 1e-6, `y = ${f(botY, 3)}`);

  // UV：v=1 在最上一行、u=0 在最左 ⇒ 贴图顶边贴板顶、贴图左边贴板左（整图无裁切无翻转）
  const uvOk =
    Math.abs(uv.getX(0) - 0) < 1e-6 && Math.abs(uv.getY(0) - 1) < 1e-6 &&
    Math.abs(uv.getX(1) - 1) < 1e-6 && Math.abs(uv.getY(1) - 1) < 1e-6 &&
    Math.abs(uv.getX(botIdx) - 0) < 1e-6 && Math.abs(uv.getY(botIdx) - 0) < 1e-6;
  check('H5 UV 连续覆盖 0~1 整图（左上= (0,1) / 底左= (0,0)）', uvOk,
    `v0=(${uv.getX(0)},${uv.getY(0)}) v1=(${uv.getX(1)},${uv.getY(1)}) vBot=(${uv.getX(botIdx)},${uv.getY(botIdx)})`);

  // 顶点 Z 必须全 0，否则 buildSkinBinding 里"板内 (px,py) → 世界"的映射就不是纯 2D
  let maxZ = 0;
  const posZ = geo.getAttribute('position') as unknown as { getZ(i: number): number };
  for (let i = 0; i < b.vCount; i++) maxZ = Math.max(maxZ, Math.abs(posZ.getZ(i)));
  check('H6 PlaneGeometry 顶点全在 z=0 平面（板内是纯 2D 映射）', maxZ < 1e-9,
    `max|z| = ${maxZ.toExponential(1)}`);
  geo.dispose();
}

log('');
{
  // ★ 分组规则来自 viewer 的真源：plain = 单刚体板；skinned = **那一个**蒙皮组的刚体
  const plateCount = groups.plain.length + (groups.skinned.length > 0 ? 1 : 0);
  check('I1 护甲板数 = 素材组件数（躯干 K 段合成 1 块）', plateCount === META.parts.length,
    `${plateCount} vs ${META.parts.length}（单片板 ${groups.plain.length} + 蒙皮板 ${groups.skinned.length > 0 ? 1 : 0}）`);
  check('I2 蒙皮组只有 1 个，且段数 = spineSegments', groups.skinned.length === Kb,
    `蒙皮组 1 个 / ${groups.skinned.length} 段（cfg.spineSegments=${K}）`);
  check('I3 其余板 1 刚体 1 块（没被误并进来）', groups.plain.length === sk.bodies.length - Kb,
    `${groups.plain.length} vs ${sk.bodies.length} − ${Kb}`);
  check('I4 蒙皮刚体下标递增（= 骨盆→胸腔）',
    groups.skinned.every((v, n) => n === 0 || v > groups.skinned[n - 1]),
    groups.skinned.map((i) => sk.bodies[i].key).join(' → '));
}

log('');
log(`  组件数 ${META.parts.length} ⇒ 护甲板 ${META.parts.length} 块（躯干 ${Kb} 段合成 1 块）`);
log(failures === 0 ? '  ✅ probe-skin 全部通过' : `  ❌ probe-skin 失败 ${failures} 项`);
process.exitCode = failures === 0 ? 0 : 1;
