// ============================================================
// nav/LocalStep —— 短寻路（局部绕障；重写 S1；唯一段校验）
// ============================================================
// 用户口径（2026-09-25）：
//   · 两阶段：①先按**地形语义**找安全路线 → ②过**可行性校验**（同一套规则）
//   · **路径无需最短**（允许为安全绕远）；**目标点不许走偏**（终点必须精确，容差 ARRIVE）
//   · 无解 → **null**（上层停/换令/请求长寻路），不得原地打转、不得近似终点
//   · **上坡显式**：每段标 `climb`（来源 climbAt）；跨坡由寻路经上坡点（ClimbVia）+凭证执行
// 实现：有限窗口 Dijkstra（同一张表；8 向有向边；斜向禁上坡）；代价 = 步长 + 上坡 + 水 + 语义风险。
// 本文件同时提供 **唯一段校验 canSegment**（2m 采样；S3 起执行层也改用它）。
// ============================================================

/** 短寻路参数（集中调参） */
export const LOCAL = {
  /** 窗口半径（米；以起点为中心，够绕安全路即可；有限保证必终止） */
  R: 24,
  /** 输出段最大长度（米；执行层 lookahead 口径） */
  SEG_MAX: 10,
  /** 终点精度（米；硬门——不许以"附近安全点"冒充终点） */
  ARRIVE: 1.5,
  /** 上坡加价（每米净升） */
  K_UP: 0.6,
  /** 水加价（每格） */
  K_WATER: 0.35,
  /** 评分偏好权重（"不要求很安全"：只做偏好）；评分归一尺度（±SCORE_N → ±1） */
  K_SCORE: 0.5,
  SCORE_N: 8,
  /** 网格边长（米；与 PassTable 同格） */
  CELL: 4,
} as const;

/** 只读网格端口（生产 = PassTable；自检 = 合成图） */
export interface LocalGrid {
  /** 有向可走（dx,dz ∈ {-1,0,1}；斜向需两正交分量均可走） */
  canStep(x: number, z: number, dx: number, dz: number): boolean;
  /** 该向是否需**程序化爬坡** */
  climbAt(x: number, z: number, dx: number, dz: number): boolean;
  /** 该向净落差（米；正 = 升） */
  dropAt(x: number, z: number, dx: number, dz: number): number;
  /** 水域格（可走，加价） */
  waterAt(x: number, z: number): boolean;
  /** 高度（斜向禁上坡用；表外 NaN） */
  heightAt(x: number, z: number): number;
  /** ★ 统一评分（可选；正值 = 更有利、负值 = 更差；null/表外 = 中性）——
   *  由上层注入（地形语义 + 掩体表 + 事态×舰距加权，唯一实现 TerrainScoring.scoreAt） */
  scoreAt?(x: number, z: number): number | null;
  /** ★ 上坡点（可选；生产 = PassTable.climbRunAt）：可爬坡边 → 段中心上坡点（坡面前 1m） */
  climbRunAt?(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number; rise: number; lx: number; lz: number } | null;
}

export interface SegmentCheck {
  /** 可走（2m 采样通过） */
  ok: boolean;
  /** 该段是否需要程序化爬坡 */
  climb: boolean;
}

/** ★ 唯一段校验（2m 采样；与执行层同规则）：可走 + 爬坡标注。
 *  · 采样步进用 canStep（有向边；斜向需两轴均可走）
 *  · 斜向禁上坡（表只校四向边，斜线可能切折面/脊）
 *  · climb = 段内任一步 climbAt（执行层必须走程序化爬坡） */
export function canSegment(
  g: LocalGrid, ax: number, az: number, bx: number, bz: number,
): SegmentCheck {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 2));
  let px = ax, pz = az;
  let climb = false;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const dx = x - px, dz = z - pz;
    const sx = Math.abs(dx) < 0.4 ? 0 : (dx > 0 ? 1 : -1);
    const sz = Math.abs(dz) < 0.4 ? 0 : (dz > 0 ? 1 : -1);
    if (sx !== 0 || sz !== 0) {
      if (!g.canStep(px, pz, sx, sz)) return { ok: false, climb: false };
      if (!climb && g.climbAt(px, pz, sx, sz)) climb = true;
      if (sx !== 0 && sz !== 0) {
        const h0 = g.heightAt(px, pz);
        const h1 = g.heightAt(x, z);
        if (Number.isFinite(h0) && Number.isFinite(h1) && h1 > h0) return { ok: false, climb: false };
      }
    }
    px = x; pz = z;
  }
  return { ok: true, climb };
}

export interface LocalStepOut {
  /** 下一拐点（路线首点；终点精确时即目标点） */
  next: { x: number; z: number };
  /** 进入 next 的段是否需要程序化爬坡 */
  climb: boolean;
}

// ---------- 模块级 scratch（免分配；单线程） ----------
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const hKey: number[] = [];
const hCost: number[] = [];
let popCost = 0;

function hPush(k: number, c: number): void {
  hKey.push(k); hCost.push(c);
  let i = hKey.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hCost[p] <= hCost[i]) break;
    const tk = hKey[p], tc = hCost[p];
    hKey[p] = hKey[i]; hCost[p] = hCost[i];
    hKey[i] = tk; hCost[i] = tc;
    i = p;
  }
}

function hPop(): number {
  const top = hKey[0];
  popCost = hCost[0];
  const lastK = hKey.pop() as number;
  const lastC = hCost.pop() as number;
  const n = hKey.length;
  if (n > 0) {
    hKey[0] = lastK; hCost[0] = lastC;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && hCost[l] < hCost[m]) m = l;
      if (r < n && hCost[r] < hCost[m]) m = r;
      if (m === i) break;
      const tk = hKey[m], tc = hCost[m];
      hKey[m] = hKey[i]; hCost[m] = hCost[i];
      hKey[i] = tk; hCost[i] = tc;
      i = m;
    }
  }
  return top;
}

const key = (cx: number, cz: number): number => cx * 100000 + cz;
const cxOf = (k: number): number => Math.round(k / 100000);
const czOf = (k: number): number => k - cxOf(k) * 100000;

/**
 * ★ 短寻路（唯一入口）：
 *  ① 直线段可走且 ≤SEG_MAX → 直接给精确目标（无需搜索）；
 *  ② 否则在有限窗口内 Dijkstra（安全偏好）→ 沿路线取"≤SEG_MAX 的最远可视点"为下一拐点；
 *  ③ 无解 → null。
 * 约束：终点必须是目标点本身（不许近似）；斜向禁上坡；climb 显式。
 */
export function localStep(
  g: LocalGrid, sx: number, sz: number, gx: number, gz: number,
): LocalStepOut | null {
  const d = Math.hypot(gx - sx, gz - sz);
  if (d <= LOCAL.ARRIVE) return null;   // 已到（无需段）
  // ★ 先找安全路线（用户定）：不做"直线可走就直走"的短路——直线只是 Dijkstra 的一个候选，
  //   语义风险会自然把路线推离危险格；只有明显风险才值得绕（"不要求很安全"）。
  // 窗口 Dijkstra（起点为中心；半径保证能绕）
  const cell = LOCAL.CELL;
  const RW = Math.max(LOCAL.R, d * 1.5 + 8);
  const sxi = Math.floor(sx / cell), szi = Math.floor(sz / cell);
  const gxi = Math.floor(gx / cell), gzi = Math.floor(gz / cell);
  const sk = key(sxi, szi), gk = key(gxi, gzi);
  const dist = new Map<number, number>();
  const parent = new Map<number, number>();
  hKey.length = 0; hCost.length = 0;
  const hOf = (k: number): number => {
    const dx = cxOf(k) - gxi, dz = czOf(k) - gzi;
    return Math.max(Math.abs(dx), Math.abs(dz)) + 0.4142 * Math.min(Math.abs(dx), Math.abs(dz));
  };
  dist.set(sk, 0);
  parent.set(sk, -1);
  hPush(sk, hOf(sk));
  let found = false;
  while (hKey.length > 0) {
    const cur = hPop();
    const curD = dist.get(cur);
    if (curD === undefined || popCost - hOf(cur) > curD + 1e-9) continue;   // 惰性删除
    if (cur === gk) { found = true; break; }
    const cx = cxOf(cur), cz = czOf(cur);
    const wx = cx * cell + cell / 2, wz = cz * cell + cell / 2;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      const wx2 = nx * cell + cell / 2, wz2 = nz * cell + cell / 2;
      // 窗口（有限 → 必终止）
      if (Math.hypot(wx2 - sx, wz2 - sz) > RW) continue;
      if (!g.canStep(wx, wz, dx, dz)) continue;
      if (dx !== 0 && dz !== 0) {
        const h0 = g.heightAt(wx, wz), h1 = g.heightAt(wx2, wz2);
        if (Number.isFinite(h0) && Number.isFinite(h1) && h1 > h0) continue;   // 斜向禁上坡
      }
      let c = (dx !== 0 && dz !== 0) ? 1.414 : 1;
      const drop = g.dropAt(wx, wz, dx, dz);
      if (drop > 0) c += drop * LOCAL.K_UP;
      if (g.waterAt(wx2, wz2)) c += LOCAL.K_WATER;
      // ★ 贪心消费统一评分（用户定 2026-09-26）：分数越高越便宜（地形+掩体+事态×舰距）
      const sc = g.scoreAt ? g.scoreAt(wx2, wz2) : null;
      if (sc !== null && sc > -1e8) c -= Math.max(-1, Math.min(1, sc / LOCAL.SCORE_N)) * LOCAL.K_SCORE;
      const nk = key(nx, nz);
      const nd = curD + c;
      const old = dist.get(nk);
      if (old === undefined || nd < old) {
        dist.set(nk, nd);
        parent.set(nk, cur);
        hPush(nk, nd + hOf(nk));
      }
    }
  }
  if (!found) return null;   // 无解 → null（上层停/换令/请求长寻路）
  // 回溯 → 世界点（格心）
  const cells: number[] = [];
  let c = gk;
  while (c >= 0) { cells.push(c); c = parent.get(c) as number; }
  cells.reverse();
  const pts: { x: number; z: number }[] = cells.map((k) => ({
    x: cxOf(k) * cell + cell / 2, z: czOf(k) * cell + cell / 2,
  }));
  pts[0] = { x: sx, z: sz };                       // 起点精确（避免先绕到格心）
  pts[pts.length - 1] = { x: gx, z: gz };          // 末点精确 = 目标（不许近似）
  // 沿路线取"≤SEG_MAX 的最远可视点"（从远到近找第一个可直连的）；
  // ★ 拉直不得把"高分路线"变成"低分直线"（负分总和不得超过原路线该段；评分=统一评分）
  const posRisk = (ax: number, az: number, bx: number, bz: number): number => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 2));
    let sum = 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const sc = g.scoreAt ? g.scoreAt(ax + (bx - ax) * t, az + (bz - az) * t) : null;
      if (sc !== null && sc > -1e8 && sc < 0) sum += -sc / LOCAL.SCORE_N;
    }
    return sum;
  };
  // 路线累计正风险（逐段采样，与 pts 对齐：cum[i] = 起点→pts[i]）
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { x: number; z: number };
    const b = pts[i] as { x: number; z: number };
    cum.push((cum[i - 1] as number) + posRisk(a.x, a.z, b.x, b.z));
  }
  if (pts.length === 1) {
    // 同格：直接给精确目标（爬坡显式）
    const p0 = pts[0] as { x: number; z: number };
    const seg = canSegment(g, sx, sz, p0.x, p0.z);
    return seg.ok ? { next: { x: p0.x, z: p0.z }, climb: seg.climb } : null;
  }
  let next: { x: number; z: number } | null = null;
  let climb = false;
  const MAXI = Math.min(pts.length - 1, 8);   // 扫描上限（10m/4m ≈ 3 格，留余量）
  for (let i = MAXI; i >= 1; i--) {
    const p = pts[i] as { x: number; z: number };
    if (Math.hypot(p.x - sx, p.z - sz) > LOCAL.SEG_MAX) continue;
    const seg = canSegment(g, sx, sz, p.x, p.z);
    if (!seg.ok) continue;
    if (posRisk(sx, sz, p.x, p.z) > (cum[i] as number) + 0.01) continue;   // 不得拉直成更险直线
    next = p; climb = seg.climb;
    break;
  }
  if (!next) {
    // ★ 拉直被安全门全部否决时：**退化为沿安全路线的第一段**（不是 null——路是安全的、可执行的）
    for (let i = 1; i <= MAXI; i++) {
      const p = pts[i] as { x: number; z: number };
      if (Math.hypot(p.x - sx, p.z - sz) < 0.1) continue;
      const seg = canSegment(g, sx, sz, p.x, p.z);
      if (seg.ok) { next = p; climb = seg.climb; break; }
    }
    if (!next) return null;   // 第一段也不可执行 → 宁可不发
  }
  return { next, climb };
}
