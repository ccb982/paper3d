// ============================================================
// LandingTerrain —— 舰船落地周边地形获取 + 战术分析（《敌人管线设计.md》§1.1）
// ============================================================
// 地形获取（v2，2026-09-20）：在落地周边（默认 80m）建 4m 采样网格：
//   · pass  = 可通行（坑/水/过低/陡升 → 不可通行；**下落放行**）
//   · stand = 可布防（pass 且 2m 内无大落差 —— 不在崖边摆工事）
//   · reach = 从落点洪泛可达（不可达的点不参与战术布置）
//   · width = 通行宽度（多源 BFS 距离变换：到最近不可通行格的距离）
// 战术分析：
//   · 来向：16 方向射线（pass ∧ reach 比例 × 爬升惩罚）——四邻采样，无方向偏置
//   · 高地：可达 + 12m 窗局部最高 + 突出 ≥2m（去重，取前 8）
//   · 隘口：宽度 ≤8m 且来向轴前后变宽的收缩段（聚类去重，取前 6）
//   · 掩体位：三环 × 来向 ±60°；**优先贴真实遮挡**（前方 4m 内不可通行/更高），
//     没有遮挡的环位跳过（不硬凑）
//   · 战壕线：三环弧线，仅 stand ∧ reach（遇阻自然断开）
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';

/** ★ 有利位置（落地扫描一次算好；远程驻守 / 工程兵优先施工共用） */
export interface DefensePost {
  x: number;
  z: number;
  /** high = 制高点；cover = 掩体后 */
  kind: 'high' | 'cover';
  /** 综合评分（越高越好；远程选位/施工排序用） */
  score: number;
}

/** ★ 防守布置（地形检测输出；阶段机 S0~S6 消费） */
export interface DefensePlan {
  cx: number;
  cz: number;
  /** 主要来向（单位向量；玩家最可能从这来） */
  approachX: number;
  approachZ: number;
  /** ★ 有利位置清单（落地扫描产出；远程兵/工程兵共用） */
  posts: DefensePost[];
  /** 高地（视野优势点；远程/观察） */
  highGround: { x: number; z: number; h: number }[];
  /** 掩体位（三环：0 外 / 1 中 / 2 内；工程兵按环序建造） */
  coverSlots: { x: number; z: number; ring: 0 | 1 | 2 }[];
  /** 隘口（盾兵守点；宽度收缩段） */
  chokepoints: { x: number; z: number }[];
  /** 战壕线（每环一条弧；每 4m 一个战壕块中心，3 块 ≈ 12m 宽工事） */
  trenchLines: { x: number; z: number }[][];
}

const STEP = 4;
/** 宽度上限（格；> 此值视为开阔） */
const WIDTH_CAP = 8;
/** 陡升阈值（米；2m 内上升超过此值 → 不可通行） */
const CLIMB_MAX = 1.2;
/** 布防落差阈值（米；2m 内下降超过此值 → 崖边，不布防） */
const DROP_MAX = 1.2;

/** ★ 地形扫描体（内部；网格 4m，原点为 (cx-radius, cz-radius)） */
interface Scan {
  n: number;
  radius: number;
  cx: number;
  cz: number;
  h: Float32Array;
  pass: Uint8Array;
  stand: Uint8Array;
  reach: Uint8Array;
  width: Uint8Array;
}

function buildScan(raster: RasterMap, cx: number, cz: number, radius: number): Scan {
  const n = Math.floor((radius * 2) / STEP) + 1;
  const h = new Float32Array(n * n);
  const pass = new Uint8Array(n * n);
  const stand = new Uint8Array(n * n);
  const x0 = cx - radius;
  const z0 = cz - radius;
  const at = (ix: number, iz: number): number => iz * n + ix;
  const sampleH = (x: number, z: number): number => raster.surfaceHeightAt(x, z);

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = x0 + ix * STEP;
      const z = z0 + iz * STEP;
      const i = at(ix, iz);
      const hh = sampleH(x, z);
      h[i] = hh;
      const role = raster.tileDefAt(x, z).genRole;
      // pass = 基本地形（坑/水/过低 → 不可通行）；**墙由遍历时的边上检查处理**
      //（方向无关的"上升检测"会把所有崖底也判死 → 洪泛出不了高台）
      if (role === 'pit' || role === 'liquid' || hh < -1.2) { pass[i] = 0; stand[i] = 0; continue; }
      pass[i] = 1;
      // stand = 可布防（崖边/贴墙不摆工事）
      let cliff = false, wall = false;
      const probe = (dx: number, dz: number): void => {
        const d = sampleH(x + dx * 2, z + dz * 2) - hh;
        if (d > CLIMB_MAX) wall = true;
        else if (d < -DROP_MAX) cliff = true;
      };
      probe(1, 0); probe(-1, 0); probe(0, 1); probe(0, -1);
      stand[i] = cliff || wall ? 0 : 1;
    }
  }

  // ---- 可达性（从中心洪泛；**严格**：相邻格高差 ≤ CLIMB_MAX，上下都算）----
  //   ★ 部署锚点必须"能去也能回"：早期只挡爬升、下落放行 → 锚点会落到崖下，
  //     部队生成在低层台地后**爬不回舰船/玩家**（实测：远程/施工队卡在崖边不动）
  const reach = new Uint8Array(n * n);
  const cix = Math.round((cx - x0) / STEP);
  const ciz = Math.round((cz - z0) / STEP);
  const start = at(cix, ciz);
  if (pass[start]) {
    const stack = [start];
    reach[start] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const ix = c % n;
      const iz = (c - ix) / n;
      const hc = h[c];
      const tryStep = (nx: number, nz: number): void => {
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) return;
        const nb = nz * n + nx;
        if (!pass[nb] || reach[nb]) return;
        if (Math.abs(h[nb] - hc) > CLIMB_MAX) return;   // 崖/墙：不可达
        reach[nb] = 1;
        stack.push(nb);
      };
      tryStep(ix - 1, iz); tryStep(ix + 1, iz);
      tryStep(ix, iz - 1); tryStep(ix, iz + 1);
    }
  }

  // ---- 通行宽度（多源 BFS：到最近不可通行/不可布防格；单位 = 格） ----
  const width = new Uint8Array(n * n);
  const queue: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (pass[i] && stand[i]) width[i] = WIDTH_CAP;
    else { width[i] = 0; queue.push(i); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const w = width[c] + 1;
    if (w > WIDTH_CAP) continue;
    const ix = c % n;
    const iz = (c - ix) / n;
    if (ix > 0 && width[c - 1] > w) { width[c - 1] = w; queue.push(c - 1); }
    if (ix < n - 1 && width[c + 1] > w) { width[c + 1] = w; queue.push(c + 1); }
    if (iz > 0 && width[c - n] > w) { width[c - n] = w; queue.push(c - n); }
    if (iz < n - 1 && width[c + n] > w) { width[c + n] = w; queue.push(c + n); }
  }
  return { n, radius, cx, cz, h, pass, stand, reach, width };
}

/** ★ 舰船落地周边地形检测 + 战术分析（v2）
 *  @param preferX,preferZ 战术轴偏好（★ 玩家位置）：给了就以此为主来向（仍需落点可站）
 *         —— 玩家从哪边来，防线/工事/高地就朝哪边摆；缺省 = 扫描出的最可走方向。 */
export function analyzeLandingTerrain(
  raster: RasterMap, cx: number, cz: number, radius = 80,
  preferX?: number, preferZ?: number,
): DefensePlan {
  const scan = buildScan(raster, cx, cz, radius);
  const { n, pass, stand, reach, width, h } = scan;
  const x0 = cx - radius;
  const z0 = cz - radius;
  const okAt = (x: number, z: number): boolean => {
    const ix = Math.round((x - x0) / STEP);
    const iz = Math.round((z - z0) / STEP);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return false;
    const i = iz * n + ix;
    return reach[i] === 1 && pass[i] === 1;
  };
  const hAt = (x: number, z: number): number => {
    const ix = Math.max(0, Math.min(n - 1, Math.round((x - x0) / STEP)));
    const iz = Math.max(0, Math.min(n - 1, Math.round((z - z0) / STEP)));
    return h[iz * n + ix];
  };
  const h0 = hAt(cx, cz);

  // ---- ① 来向：16 方向射线（pass ∧ reach 比例 × 爬升惩罚） ----
  let bestScore = -Infinity, bestDirX = 1, bestDirZ = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let ok = 0, cnt = 0, rise = 0;
    for (let d = 12; d <= radius; d += STEP) {
      cnt++;
      const x = cx + dx * d, z = cz + dz * d;
      if (okAt(x, z)) ok++;
      rise += Math.max(0, hAt(x, z) - h0);
    }
    const score = ok / Math.max(1, cnt) - (rise / Math.max(1, cnt)) * 0.05;
    if (score > bestScore) { bestScore = score; bestDirX = dx; bestDirZ = dz; }
  }
  const baseA = preferX !== undefined && preferZ !== undefined
    ? Math.atan2(preferZ, preferX)
    : Math.atan2(bestDirZ, bestDirX);
  // ★ 战术轴：玩家在附近 → 朝向玩家（"玩家位置改变整体部署"）；否则用扫描结果
  const axisX = preferX !== undefined && preferZ !== undefined ? preferX : bestDirX;
  const axisZ = preferX !== undefined && preferZ !== undefined ? preferZ : bestDirZ;

  // ---- ② 高地：可达 + 12m 窗局部最高 + 突出 ≥2m（去重，取前 8） ----
  const highRaw: { x: number; z: number; h: number; prom: number }[] = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      if (!stand[i] || !reach[i]) continue;
      const x = x0 + ix * STEP, z = z0 + iz * STEP;
      let isMax = true, minH = Infinity;
      for (let oz = -2; oz <= 2; oz++) {
        for (let ox = -2; ox <= 2; ox++) {
          const jx = ix + ox, jz = iz + oz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const hh = h[jz * n + jx];
          if (hh > h[i] + 0.01) isMax = false;
          if (hh < minH) minH = hh;
        }
      }
      const prom = h[i] - minH;
      if (isMax && prom >= 2) highRaw.push({ x, z, h: h[i], prom });
    }
  }
  highRaw.sort((a, b) => b.prom - a.prom);
  const highGround: { x: number; z: number; h: number }[] = [];
  for (const g of highRaw) {
    if (highGround.length >= 8) break;
    let near = false;
    for (const k of highGround) {
      if ((k.x - g.x) ** 2 + (k.z - g.z) ** 2 < 12 * 12) { near = true; break; }
    }
    if (!near) highGround.push({ x: g.x, z: g.z, h: g.h });
  }

  // ---- ③ 隘口：宽度 ≤8m 且来向轴前后变宽的收缩段（聚类去重，取前 6） ----
  const chokeRaw: { x: number; z: number; w: number }[] = [];
  for (let iz = 1; iz < n - 1; iz++) {
    for (let ix = 1; ix < n - 1; ix++) {
      const i = iz * n + ix;
      if (!pass[i] || !reach[i]) continue;
      const w = width[i];
      if (w > 2) continue;                       // 宽度 > 8m 不算隘口
      const x = x0 + ix * STEP, z = z0 + iz * STEP;
      const d = Math.hypot(x - cx, z - cz);
      if (d < 12 || d > radius * 0.85) continue;
      // 沿来向轴前后 8m 更宽（收缩段）或前方即不可通行（口子）
      const ax = Math.round((x + axisX * 8 - x0) / STEP);
      const az = Math.round((z + axisZ * 8 - z0) / STEP);
      const bx = Math.round((x - axisX * 8 - x0) / STEP);
      const bz = Math.round((z - axisZ * 8 - z0) / STEP);
      const inRange = (qx: number, qz: number): boolean => qx >= 0 && qz >= 0 && qx < n && qz < n;
      let wider = 0;
      if (inRange(ax, az) && width[az * n + ax] >= w + 1) wider++;
      if (inRange(bx, bz) && width[bz * n + bx] >= w + 1) wider++;
      if (wider === 0) continue;
      chokeRaw.push({ x, z, w });
    }
  }
  chokeRaw.sort((a, b) => a.w - b.w);
  const chokepoints: { x: number; z: number }[] = [];
  for (const c of chokeRaw) {
    if (chokepoints.length >= 6) break;
    let near = false;
    for (const k of chokepoints) {
      if ((k.x - c.x) ** 2 + (k.z - c.z) ** 2 < 12 * 12) { near = true; break; }
    }
    if (!near) chokepoints.push({ x: c.x, z: c.z });
  }

  // ---- ④ 掩体位：三环 × 来向 ±60°（★ 保证每环都有位：有遮挡优先，没有也不跳过） ----
  //   ★ 2026-09-20：环半径放大到 40/60/80m（用户定调：开始造掩体距离拉到 80m）；
  //     早期"没遮挡就不硬凑"→ 开阔地形 0 掩体位 → 工程兵无活可干（用户实测）
  const rings = [40, 60, 80];
  const coverSlots: { x: number; z: number; ring: 0 | 1 | 2 }[] = [];
  for (let r = 0; r < rings.length; r++) {
    const cand: { x: number; z: number; covered: boolean }[] = [];
    for (let k = -4; k <= 4; k++) {
      const a = baseA + (k * 15 * Math.PI) / 180;
      const px = cx + Math.cos(a) * rings[r];
      const pz = cz + Math.sin(a) * rings[r];
      if (!okAt(px, pz)) continue;
      // 贴遮挡：朝来向（外）4m 处不可通行 或 高出 ≥1m（有更好，没有也可）
      const ox = Math.cos(a) * 4, oz = Math.sin(a) * 4;
      const oix = Math.round((px + ox - x0) / STEP);
      const oiz = Math.round((pz + oz - z0) / STEP);
      const inRange = oix >= 0 && oiz >= 0 && oix < n && oiz < n;
      const covered = inRange && (pass[oiz * n + oix] === 0 || h[oiz * n + oix] >= hAt(px, pz) + 1);
      cand.push({ x: px, z: pz, covered });
    }
    // 有遮挡的排前面；同环间距 ≥3m
    cand.sort((a, b) => Number(b.covered) - Number(a.covered));
    for (const c of cand) {
      let tooClose = false;
      for (const s of coverSlots) {
        if (s.ring !== r) continue;
        if ((s.x - c.x) ** 2 + (s.z - c.z) ** 2 < 9) { tooClose = true; break; }
      }
      if (tooClose) continue;
      coverSlots.push({ x: c.x, z: c.z, ring: r as 0 | 1 | 2 });
    }
  }

  // ---- ⑤ 战壕线：三环弧线（7.5° 步进 ≈ 每 4m 一块），仅 stand ∧ reach；
  //        若整条线不足 3 块（崖边/遮挡地形）→ 用 pass ∧ reach 兜底，保证有壕可挖 ----
  const trenchLines: { x: number; z: number }[][] = [];
  for (const r of rings) {
    const line: { x: number; z: number }[] = [];
    const fallback: { x: number; z: number }[] = [];
    for (let k = -8; k <= 8; k++) {
      const a = baseA + (k * 7.5 * Math.PI) / 180;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const ix = Math.round((x - x0) / STEP);
      const iz = Math.round((z - z0) / STEP);
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
      const i = iz * n + ix;
      if (pass[i] !== 1 || reach[i] !== 1) continue;
      if (stand[i] === 1) line.push({ x, z });
      else fallback.push({ x, z });
    }
    if (line.length < 3) line.push(...fallback.slice(0, 6));
    trenchLines.push(line);
  }

  // ---- ⑥ ★ 有利位置清单（一次扫描算好，供远程驻守 / 工程兵优先施工） ----
  //   掩体位：统一分（真实遮挡已在 ④ 保证；环位越接近"理想驻守带 55m"越高）
  //   高地：按突出度归一 + 基础分；两类合并排序、去重（≥10m）
  const posts: DefensePost[] = [];
  for (const c of coverSlots) {
    const r = rings[c.ring];
    posts.push({ x: c.x, z: c.z, kind: 'cover', score: 2 + (1 - Math.abs(r - 55) / 40) });
  }
  for (const g of highGround) {
    posts.push({ x: g.x, z: g.z, kind: 'high', score: 1 + Math.min(1, g.h / 12) * 0.5 });
  }
  posts.sort((a, b) => b.score - a.score);
  const picked: DefensePost[] = [];
  for (const p of posts) {
    if (picked.length >= 24) break;
    let near = false;
    for (const q of picked) {
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 10 * 10) { near = true; break; }
    }
    if (!near) picked.push(p);
  }

  return {
    cx, cz,
    approachX: axisX, approachZ: axisZ,
    posts: picked,
    highGround,
    coverSlots,
    chokepoints,
    trenchLines,
  };
}
