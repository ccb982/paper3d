// ============================================================
// PostProcess —— 独立后处理层（最小化补丁，不改精修层任何文件）
// ============================================================
// 设计铁律（《精修层后处理设计.md》v5）：
//   1. 只读复用精修层函数（buildChunkFinal / buildChunkWallBuffers /
//      cornerCell / finalRuling / tileById）——精修层代码零改动；
//   2. 接入 = ChunkManager 三处路由（顶面/侧壁/贴地查询），唯一改动点；
//   3. POST_PROCESS_ENABLED=false 时逐字节退化为精修层原输出（A/B 等价）；
//   4. 渲染网格 = 物理缓冲 = 贴地查询 同源（同一份后处理高度函数）。
//
// 效果（确定性、种子可重放、纯函数零 three 装配耦合）：
//   · 圆角 bevel：仅「高台(platform) → 不插值地面(ground+cliff)」外露硬边，
//     外凸 1/4 圆弧（风化圆滑），不改台面名义高度，棱处细分多段拼弧；
//     高台↔高台/水/坑、插值(weld)边一律棱角分明不圆滑；
//   · 坑洞 pit：块中心圆坑；邻高台/插值块整块禁挖（不破坏敏感接缝）；
//   · 裂缝 crack：块锚定折线浅沟；邻高台/插值块整块禁挖；按 5×5 邻域
//     扫锚块 → 跨块裂缝连续。
// ============================================================

import * as THREE from "three";
import { CHUNK_SIZE, hash2 } from "./ChunkGenerator";
import {
  buildChunkFinal,
  buildChunkWallBuffers,
  cornerCell,
  finalRuling,
  type BlockSource,
  type ChunkWallBuffers,
} from "./Refinements";
import { buildChunkTopSurface, type ChunkSurfaceBuild } from "./ChunkSurface";
import { buildChunkSideWalls, type ChunkWallsBuild } from "./ChunkWalls";
import type { RasterMap } from "./RasterMap";
import { tileById } from "./Tiles";
import { groupByKey, type GroupPalette } from "./TileGroups";
import {
  WallMaterial,
  type TileRenderConfig,
} from "./TerrainMaterial";

// ------------------------------------------------------------
// 配置常量
// ------------------------------------------------------------

/** 后处理总开关：false = 本层全部透传精修层原输出（逐字节 A/B 等价） */
export const POST_PROCESS_ENABLED = true;

/** 圆角半径（米）：外露硬边向台面内的风化带宽 */
const BEVEL_R = 0.3;
/** 圆角判定容差：邻块比本块低超过此值才算「下落到地面的外露边」 */
const BEVEL_EPS = 0.05;
/** 只圆滑这些生成角色的块（高台侧；地面/水/坑底不圆滑） */
const BEVEL_TILES = new Set(["platform"]);
/** 坑/裂细分数：fine 格每边 2^D 段（D=3 → 0.125m，多段拼弧） */
const PP_FINE_SUBDIV_DEPTH = 3;
/** 坑洞命中率（含内圈连续） */
const PIT_HIT = 0.06;

const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

/** DIRS 副本（与精修层一致）：块边两端角点偏移 + 法线（0=+x 1=−x 2=+z 3=−z） */
const WALL_DIRS = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
] as const;

/**
 * 块 (bx,bz) 的 dir 边是否为圆角外露边：platform → ground + cliff + 邻块更低。
 */
function isBevelEdge(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
): boolean {
  const cur = src.blockAt(bx, bz);
  if (!cur || tileById(cur.id).genRole !== "platform") return false;
  const wd = WALL_DIRS[dir];
  const nb = src.blockAt(bx + wd.dx, bz + wd.dz);
  if (!nb) return false;
  if (tileById(nb.id).genRole !== "ground") return false;
  if (finalRuling(src, bx, bz, dir) !== "cliff") return false;
  // ★ 侧向邻边（左右）有插值坡（weld）→ 撤销该弧边（坡方角突出、背面镂空）
  const lr = finalRuling(src, bx, bz, (dir ^ 2) as 0 | 1 | 2 | 3);
  const rr = finalRuling(src, bx, bz, (dir ^ 3) as 0 | 1 | 2 | 3);
  if (lr === "weld" || rr === "weld") return false;
  return nb.h < cur.h - BEVEL_EPS;
}

/**
 * 弧边 (bx,bz,dir) 的指定端点是否与另一条弧边转角相接：
 * A 端(end=0)/B 端(end=1) 沿边方向的邻居块，其同向边也是弧边 → 转角交界。
 * 转角处两面墙天然闭合（用户确认无洞），无需绘制/生成弧形补面。
 */
function isCornerWithBevel(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
  end: 0 | 1,
): boolean {
  // 沿边邻居块方向（由 WALL_DIRS 端点角偏移推出）
  let tx = 0, tz = 0;
  if (dir === 0) { tx = 0; tz = end === 0 ? -1 : 1; }
  else if (dir === 1) { tx = 0; tz = end === 0 ? 1 : -1; }
  else if (dir === 2) { tx = end === 0 ? 1 : -1; tz = 0; }
  else { tx = end === 0 ? -1 : 1; tz = 0; }
  return isBevelEdge(src, bx + tx, bz + tz, dir);
}

/**
 * ★ 调试绘制（绿色线框）：弧边侧壁的目标形状。
 * 每条弧边画：外墙矩形轮廓（底线/两根竖线/墙顶弧底线）
 *           + 顶部弧形补面轮廓（两端剖面弧线 + 内缘竖线 + 内缘底线）。
 * 竖直面、法线朝外——从外面看的形状，类似用户手绘 json（竖直侧壁+顶部弧过渡）。
 * 仅调试用，不进渲染/物理正式管线。
 */
export function buildBevelWallDebug(
  raster: RasterMap,
  cx: number,
  cz: number,
): THREE.LineSegments | null {
  const N = CHUNK_SIZE;
  const HALF = N / 2;
  const src = raster.chunkSource(cx, cz);
  const BPS = N / 4;
  const all: number[] = [];
  const col: number[] = [];
  // 方向着色：dir0(+x)=红 dir1(−x)=绿 dir2(+z)=蓝 dir3(−z)=黄
  const colorOf = [new THREE.Color(0xff3333), new THREE.Color(0x33ff33), new THREE.Color(0x3366ff), new THREE.Color(0xffff33)];
  let count = 0;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      for (let dir = 0; dir < 4; dir++) {
        const d = dir as 0 | 1 | 2 | 3;
        if (!isBevelEdge(src, bx, bz, d)) continue;
        count++;
        const cur = src.blockAt(bx, bz)!;
        const nb = src.blockAt(bx + WALL_DIRS[dir].dx, bz + WALL_DIRS[dir].dz)!;
        // 边线两端（世界米格）
        const Ax = bx * 4 + WALL_DIRS[dir].ax * 4;
        const Az = bz * 4 + WALL_DIRS[dir].az * 4;
        const Bx = bx * 4 + WALL_DIRS[dir].bx * 4;
        const Bz = bz * 4 + WALL_DIRS[dir].bz * 4;
        const yTop = cur.h;
        const yBot = Math.min(cur.h, nb.h) - 0.5;
        // 记号：沿边竖直矩形 + 一条对角线（按方向着色）
        const quad = [
          [Ax, yBot, Az], [Bx, yBot, Bz],
          [Bx, yTop, Bz], [Ax, yTop, Az],
        ];
        const c = colorOf[dir];
        const push = (p: number[], q: number[]) => {
          all.push(p[0] - HALF, p[1], p[2] - HALF, q[0] - HALF, q[1], q[2] - HALF);
          for (let k = 0; k < 2; k++) col.push(c.r, c.g, c.b);
        };
        for (let i = 0; i < 4; i++) push(quad[i], quad[(i + 1) % 4]);
        push(quad[0], quad[2]);

        // ---- 弧边左右侧壁线框（白色，自身非弧边才画）----
        // 墙顶轮廓逐端读数据：接弧边的端压到弧底并沿弧回升，另一端同样检查
        const drawSideWall = (sd: 0 | 1 | 2 | 3) => {
          if (isBevelEdge(src, bx, bz, sd)) return; // 自身是弧边（转角）→ 不画
          const wsd = WALL_DIRS[sd];
          const sb = src.blockAt(bx + wsd.dx, bz + wsd.dz);
          if (!sb) return;
          const eAx = bx * 4 + wsd.ax * 4, eAz = bz * 4 + wsd.az * 4;
          const eBx = bx * 4 + wsd.bx * 4, eBz = bz * 4 + wsd.bz * 4;
          // 靠弧边的端点：与 dir 边共线的坐标偏移
          const nearIsA = dir === 0 ? wsd.ax === 1
            : dir === 1 ? wsd.ax === 0
            : dir === 2 ? wsd.az === 1 : wsd.az === 0;
          const nearX = nearIsA ? eAx : eBx;
          const nearZ = nearIsA ? eAz : eBz;
          const farX = nearIsA ? eBx : eAx;
          const farZ = nearIsA ? eBz : eAz;
          const len = Math.hypot(farX - nearX, farZ - nearZ);
          const ux = (farX - nearX) / len, uz = (farZ - nearZ) / len;
          const yH = cur.h;
          const yTop = cur.h - BEVEL_R;
          const sBot = Math.min(cur.h, sb.h) - 0.5;
          // ★ far 端真实读数据：沿边方向邻居块的同向边是否弧边
          const tx = Math.round(ux), tz = Math.round(uz);
          const farBevel = isBevelEdge(src, bx + tx, bz + tz, sd);
          const white = new THREE.Color(0xffffff);
          const pushW = (p: number[], q: number[]) => {
            all.push(p[0] - HALF, p[1], p[2] - HALF, q[0] - HALF, q[1], q[2] - HALF);
            for (let k = 0; k < 2; k++) col.push(white.r, white.g, white.b);
          };
          const arcY = (d: number) =>
            yH - BEVEL_R + Math.sqrt(Math.max(0, 2 * BEVEL_R * d - d * d));
          const at = (d: number, y: number): number[] =>
            [nearX + ux * d, y, nearZ + uz * d];
          // 底边
          pushW([nearX, sBot, nearZ], [farX, sBot, farZ]);
          // near 端竖直边：底 → 弧底（near 端接弧边 dir，必压弧）
          pushW([nearX, sBot, nearZ], at(0, yTop));
          // near 弧线：弧底 → 台面
          let prev = at(0, yTop);
          const K2 = 6;
          for (let k = 1; k <= K2; k++) {
            const dM = (k / K2) * BEVEL_R;
            const q = at(dM, arcY(dM));
            pushW(prev, q);
            prev = q;
          }
          // 中段水平顶线：near 弧结束 → far 弧开始（或直接到远端）
          const farStart = farBevel ? len - BEVEL_R : len;
          if (farStart > BEVEL_R) {
            pushW(at(BEVEL_R, yH), at(farStart, yH));
          }
          // far 弧线：台面 → 弧底（far 端接弧边时）
          if (farBevel) {
            let prev2 = at(farStart, yH);
            for (let k = 1; k <= K2; k++) {
              const d = farStart + (k / K2) * BEVEL_R;
              const q = at(d, arcY(len - d));
              pushW(prev2, q);
              prev2 = q;
            }
            // far 端竖直边顶 = 弧底
            pushW(at(len, yTop), [farX, sBot, farZ]);
          } else {
            // far 端竖直边：台面 → 底
            pushW(at(len, yH), [farX, sBot, farZ]);
          }
        };
        // 左右侧边 = 与弧边垂直的两条边（dir^2 / dir^3，四个方向均成立）
        drawSideWall((dir ^ 2) as 0 | 1 | 2 | 3);
        drawSideWall((dir ^ 3) as 0 | 1 | 2 | 3);
      }
    }
  }
  console.log(`[弧边记号] chunk(${cx},${cz}) 检测到 ${count} 条弧边`);
  if (all.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------

/** 平滑轮廓：t∈[0,1]，1→0，两端导数平（坑/裂剖面用） */
function smoothProfile(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return 0.5 + 0.5 * Math.cos(Math.PI * s);
}

function roleAt(src: BlockSource, bx: number, bz: number): string | undefined {
  const b = src.blockAt(bx, bz);
  return b ? tileById(b.id).genRole : undefined;
}

/** 坑/裂禁挖带：任一方向邻高台(platform)或该边是插值(weld)交界 → 整块禁挖 */
function nearInterpOrPlatform(
  src: BlockSource,
  bx: number,
  bz: number,
): boolean {
  for (let dir = 0; dir < 4; dir++) {
    const nb = src.blockAt(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
    if (!nb) continue;
    if (tileById(nb.id).genRole === "platform") return true;
    if (finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3) === "weld") return true;
  }
  return false;
}

// ------------------------------------------------------------
// 效果偏移（三类效果的唯一入口；负 = 压低，未命中 = 0）
// ------------------------------------------------------------

/** 圆角偏移（块视角）：view 块是高台且某边外露下落 → 带内外凸圆弧压低 */
function bevelOffset(
  src: BlockSource,
  bx: number,
  bz: number,
  x: number,
  z: number,
): number {
  const cur = src.blockAt(bx, bz);
  if (!cur || !BEVEL_TILES.has(tileById(cur.id).genRole ?? "")) return 0;
  // 收集外露硬边（邻块=地面 + 裁决=cliff + 邻块更低）及其带内距离
  let dMin = Infinity;
  for (let dir = 0; dir < 4; dir++) {
    const d4 = DIR4[dir];
    const nb = src.blockAt(bx + d4.dx, bz + d4.dz);
    if (!nb) continue;
    if (tileById(nb.id).genRole !== "ground") continue;
    if (finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3) !== "cliff") continue;
    if (nb.h >= cur.h - BEVEL_EPS) continue;
    // ★ 侧向邻边（左右）有插值坡（weld）→ 撤销该弧边：
    //   侧壁补弧后，weld 坡的方形顶角会从弧形缺口突出且背面镂空
    const lr = finalRuling(src, bx, bz, (dir ^ 2) as 0 | 1 | 2 | 3);
    const rr = finalRuling(src, bx, bz, (dir ^ 3) as 0 | 1 | 2 | 3);
    if (lr === "weld" || rr === "weld") continue;
    // 该边向块内推进的距离（棱 d=0 → 带外 R 处 0）
    let d: number;
    if (dir === 0) d = (bx + 1) * 4 - x;
    else if (dir === 1) d = x - bx * 4;
    else if (dir === 2) d = (bz + 1) * 4 - z;
    else d = z - bz * 4;
    if (d < 0) d = 0;
    if (d < dMin) dMin = d;
  }
  if (dMin === Infinity || dMin >= BEVEL_R) return 0;
  // 外凸 1/4 圆弧：棱处 −R，带缘 0（y = Y − R + √(2Rd − d²) 的增量形式）
  return -(BEVEL_R - Math.sqrt(Math.max(0, 2 * BEVEL_R * dMin - dMin * dMin)));
}

/** 坑洞偏移：块中心圆坑（坑半径 ≤1.5 < 半块 2m，恒在Own块内） */
function pitOffset(
  src: BlockSource,
  seed: number,
  bx: number,
  bz: number,
  x: number,
  z: number,
): number {
  const b = src.blockAt(bx, bz);
  const role = b ? tileById(b.id).genRole : undefined;
  if (!role || role === "liquid" || role === "pit") return 0;
  if (nearInterpOrPlatform(src, bx, bz)) return 0;
  if (hash2(bx, bz, seed) > PIT_HIT) return 0;
  const R = 0.75 + hash2(bx * 3 + 7, bz * 3 + 11, seed) * 0.75;
  const D = 0.25 + hash2(bx * 5 + 1, bz * 5 + 3, seed) * 0.25;
  const r = Math.hypot(x - (bx * 4 + 2), z - (bz * 4 + 2));
  if (r > R) return 0;
  return -D * smoothProfile(r / R);
}

/** 裂缝锚参数（每块一条确定性折线；与旧版同哈希族） */
interface CrackLine {
  ox: number;
  oz: number;
  ca: number;
  sa: number;
  half: number;
  w: number;
  d: number;
}

function crackLineOf(
  src: BlockSource,
  seed: number,
  bx: number,
  bz: number,
): CrackLine | null {
  const b = src.blockAt(bx, bz);
  const role = b ? tileById(b.id).genRole : undefined;
  if (!role || role === "liquid" || role === "pit") return null;
  if (nearInterpOrPlatform(src, bx, bz)) return null;
  const ang = hash2(bx * 11 + 3, bz * 7 + 5, seed) * Math.PI * 2;
  const len = 3 + hash2(bx * 13 + 9, bz * 17 + 1, seed) * 5;
  const w = 0.15 + hash2(bx * 19 + 2, bz * 23 + 8, seed) * 0.25;
  const d = 0.15 + hash2(bx * 29 + 4, bz * 31 + 6, seed) * 0.15;
  const perp = ang + Math.PI / 2;
  const off = (hash2(bx * 37 + 5, bz * 41 + 2, seed) - 0.5) * len * 0.4;
  // 锚点可达 6.6m → 5×5 邻域（±2 块）覆盖全部影响
  return {
    ox: bx * 4 + 2 + Math.cos(ang) * 1.5 + Math.cos(perp) * off,
    oz: bz * 4 + 2 + Math.sin(ang) * 1.5 + Math.sin(perp) * off,
    ca: Math.cos(ang),
    sa: Math.sin(ang),
    half: len / 2,
    w,
    d,
  };
}

/** 裂缝偏移：扫 5×5 邻域锚块（跨块裂缝连续） */
function crackOffset(
  src: BlockSource,
  seed: number,
  bx: number,
  bz: number,
  x: number,
  z: number,
  cache: Map<number, CrackLine | null>,
): number {
  let out = 0;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const abx = bx + dx,
        abz = bz + dz;
      const key = abx * 8192 + abz;
      let ln = cache.get(key);
      if (ln === undefined) {
        ln = crackLineOf(src, seed, abx, abz);
        cache.set(key, ln);
      }
      if (!ln) continue;
      const rx = x - ln.ox,
        rz = z - ln.oz;
      const along = rx * ln.ca + rz * ln.sa;
      if (along < -ln.half - ln.w || along > ln.half + ln.w) continue;
      const perp = Math.abs(-rx * ln.sa + rz * ln.ca);
      if (perp > ln.w) continue;
      const o = -ln.d * smoothProfile(perp / ln.w);
      if (o < out) out = o;
    }
  }
  return out;
}

/**
 * ★ 后处理总偏移（块视角）：bevel(view) + pit + crack。
 * view = 承载该点视觉面的块（cell 视角，与精修层 cornerCell 同语义）——
 * 圆角只作用于高台视角的点（低侧地面视角不受影响 → 棱底不挖沟）。
 */
function ppOffset(
  src: BlockSource,
  seed: number,
  viewBx: number,
  viewBz: number,
  x: number,
  z: number,
  cache: Map<number, CrackLine | null>,
): number {
  let off = bevelOffset(src, viewBx, viewBz, x, z);
  const bx = Math.floor(x / 4);
  const bz = Math.floor(z / 4);
  off += pitOffset(src, seed, bx, bz, x, z);
  off += crackOffset(src, seed, bx, bz, x, z, cache);
  return off;
}

/** 后处理面高度（网格同式）：cornerCell(view) + ppOffset */
function yAt(
  src: BlockSource,
  seed: number,
  viewBx: number,
  viewBz: number,
  x: number,
  z: number,
  cache: Map<number, CrackLine | null>,
): number {
  return cornerCell(src, viewBx, viewBz, x, z) + ppOffset(src, seed, viewBx, viewBz, x, z, cache);
}

// ------------------------------------------------------------
// 贴地查询（渲染 = 查询同源；与精修层 sampleSurface 同三角剖分）
// ------------------------------------------------------------

/**
 * ★ 后处理贴地采样：米格 4 角按【块归属】取后处理高后三角形插值——
 * 与后处理顶面网格 coarse 部分逐位一致（fine 细分格内为亚米近似，
 * 物理碰撞走 trimesh 不受影响；装饰/标签用）。
 * POST_PROCESS_ENABLED=false 时透传 raster.surfaceHeightAt。
 */
export function postSurfaceHeightAt(raster: RasterMap, x: number, z: number): number {
  const base = () => raster.surfaceHeightAt(x, z);
  if (!POST_PROCESS_ENABLED) return base();
  const ccx = Math.floor(x / CHUNK_SIZE);
  const ccz = Math.floor(z / CHUNK_SIZE);
  const src = raster.chunkSource(ccx, ccz);
  const seed = raster.worldSeed;
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  const fx = x - gx;
  const fz = z - gz;
  const bcx = Math.floor(gx / 4);
  const bcz = Math.floor(gz / 4);
  const cache = new Map<number, CrackLine | null>();
  const h00 = yAt(src, seed, bcx, bcz, gx, gz, cache);
  const h10 = yAt(src, seed, bcx, bcz, gx + 1, gz, cache);
  const h01 = yAt(src, seed, bcx, bcz, gx, gz + 1, cache);
  const h11 = yAt(src, seed, bcx, bcz, gx + 1, gz + 1, cache);
  if (fx + fz <= 1) {
    return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  }
  return h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
}

// ------------------------------------------------------------
// 顶面网格（coarse 1m + fine 2^D 细分，水密无 T 结）
// ------------------------------------------------------------

/**
 * ★ 后处理顶面：复用精修层 buildChunkFinal（只读）作为基底/快照，
 * 在其上按后处理高度重建渲染网格：
 *   · 效果带内 1m 格 → 2^D 细分（多段拼圆弧/坑/裂）；
 *   · fine 区向外扩张 1 格 → fine/coarse 边界两侧偏移均为 0（表面线性）
 *     → 无 T 结、无裂缝；
 *   · coarse 顶点 = 精修层 cornerCell + 偏移；偏移为 0 处与精修层逐位一致。
 */
export function buildPostChunkTopSurface(
  raster: RasterMap,
  cx: number,
  cz: number,
): ChunkSurfaceBuild {
  if (!POST_PROCESS_ENABLED) return buildChunkTopSurface(raster, cx, cz);

  const N = CHUNK_SIZE;
  const HALF = N / 2;
  const src = raster.chunkSource(cx, cz);
  const seed = raster.worldSeed;
  const ox = cx * N;
  const oz = cz * N;
  // 只读复用精修层定型快照（finalTerrain 透传；物理路由改用本层顶点）
  const finalTerrain = buildChunkFinal(src, cx, cz, N);

  const D = PP_FINE_SUBDIV_DEPTH;
  const S = 1 << D;
  const step = 1 / S;
  const cache = new Map<number, CrackLine | null>();

  // ---- ① fine 标记：效果带内 1m 格（9 点采样判定） ----
  const fine = new Uint8Array(N * N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx;
      const wz0 = oz + lz;
      const vb = cellViewBlock(cx, cz, lx, lz);
      let hit = false;
      for (let k = 0; k < 9 && !hit; k++) {
        const dx = (k % 3) * 0.5;
        const dz = Math.floor(k / 3) * 0.5;
        if (ppOffset(src, seed, vb.bx, vb.bz, wx0 + dx, wz0 + dz, cache) < -1e-9)
          hit = true;
      }
      if (hit) fine[lz * N + lx] = 1;
    }
  }
  // ---- ② fine 外扩 1 格（8 邻域）：边界两侧偏移=0 → 水密 ----
  const fineE = new Uint8Array(N * N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      let f = fine[lz * N + lx];
      if (!f) {
        outer: for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = lx + dx,
              nz = lz + dz;
            if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
            if (fine[nz * N + nx]) {
              f = 1;
              break outer;
            }
          }
        }
      }
      fineE[lz * N + lx] = f;
    }
  }

  // ---- ③ 发射网格 ----
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let vi = 0;

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx;
      const wz0 = oz + lz;
      const vb = cellViewBlock(cx, cz, lx, lz);
      if (!fineE[lz * N + lx]) {
        // ---- coarse：与精修层同布局（4 顶点 + 同对角剖分），y 加偏移 ----
        const xs = [wx0, wx0 + 1, wx0 + 1, wx0];
        const zs = [wz0, wz0, wz0 + 1, wz0 + 1];
        for (let k = 0; k < 4; k++) {
          pos.push(xs[k] - ox - HALF, yAt(src, seed, vb.bx, vb.bz, xs[k], zs[k], cache), zs[k] - oz - HALF);
          nor.push(0, 1, 0);
          uv.push((xs[k] - ox) / N, (zs[k] - oz) / N);
        }
        idx.push(vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1);
        vi += 4;
      } else {
        // ---- fine：2^D 细分，中差分法线（偏移光滑带内才有倾斜） ----
        const base = vi;
        const yOf = (x: number, z: number) =>
          yAt(src, seed, vb.bx, vb.bz, x, z, cache);
        for (let jz = 0; jz <= S; jz++) {
          for (let jx = 0; jx <= S; jx++) {
            const x = wx0 + jx * step;
            const z = wz0 + jz * step;
            const y = yOf(x, z);
            const yL = yOf(x - step, z);
            const yR = yOf(x + step, z);
            const yD = yOf(x, z - step);
            const yU = yOf(x, z + step);
            const nx = -(yR - yL);
            const nz = -(yU - yD);
            const ny = 2 * step;
            const il = 1 / Math.hypot(nx, ny, nz);
            pos.push(x - ox - HALF, y, z - oz - HALF);
            nor.push(nx * il, ny * il, nz * il);
            uv.push((x - ox) / N, (z - oz) / N);
          }
        }
        for (let jz = 0; jz < S; jz++) {
          for (let jx = 0; jx < S; jx++) {
            const v00 = base + jz * (S + 1) + jx;
            const v10 = v00 + 1;
            const v01 = v00 + S + 1;
            const v11 = v01 + 1;
            idx.push(v00, v01, v10, v01, v11, v10);
          }
        }
        vi += (S + 1) * (S + 1);
      }
    }
  }

  const vertices = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return { geometry, vertices, indices, finalTerrain };
}

/** 1m cell 的块视角（与精修层 buildChunkFinal 同式：cell 所属块） */
function cellViewBlock(cx: number, cz: number, lx: number, lz: number) {
  const BPS = CHUNK_SIZE / 4;
  return { bx: cx * BPS + Math.floor(lx / 4), bz: cz * BPS + Math.floor(lz / 4) };
}

// ------------------------------------------------------------
// 侧壁（复用精修层墙缓冲，只调墙顶 y 跟随后处理面）
// ------------------------------------------------------------

/**
 * ★ 后处理侧壁：只读复用精修层 buildChunkWallBuffers 产出墙缓冲，
 * 然后把每面墙的【顶边 2 顶点】y 加上后处理偏移（发射块视角）——
 * 圆角棱处墙顶下降 R 与顶面圆弧底吻合（水密）；偏移 0 处逐位不变。
 * 墙顶点布局（Refinements）：每 quad 4 顶点 = 顶A/顶B/底B/底A，
 * uv 首列可反推发射块（bxC = round(u·15−0.5) + cx·15）。
 */
export function buildPostSideWalls(
  raster: RasterMap,
  cx: number,
  cz: number,
  albedo: THREE.Texture,
  lightmap: THREE.Texture,
  matCfg?: TileRenderConfig,
): ChunkWallsBuild {
  if (!POST_PROCESS_ENABLED)
    return buildChunkSideWalls(raster, cx, cz, albedo, lightmap, matCfg);

  const N = CHUNK_SIZE;
  const HALF = N / 2;
  const seed = raster.worldSeed;
  const src = raster.chunkSource(cx, cz);
  const gkey = raster.getChunkData(cx, cz)?.groupKey;
  const palette: GroupPalette | undefined = gkey
    ? groupByKey(gkey)?.palette
    : undefined;
  const BPS = N / 4;

  const buffers: ChunkWallBuffers = buildChunkWallBuffers(src, cx, cz, N, {
    seed,
    palette,
    heightAt: (x, z) => raster.heightAt(x, z),
    tileDefAt: (x, z) => raster.tileDefAt(x, z),
  });

  if (buffers.indices.length > 0) {
    const V = buffers.vertices;
    const quads = V.length / 12;
    const cache = new Map<number, CrackLine | null>();
    for (let q = 0; q < quads; q++) {
      const tblX = Math.round(buffers.uvs[q * 8] * 15 - 0.5);
      const tblZ = Math.round(buffers.uvs[q * 8 + 1] * 15 - 0.5);
      const bxC = tblX + cx * BPS;
      const bzC = tblZ + cz * BPS;
      for (let t = 0; t < 2; t++) {
        const vi = q * 4 + t;
        const lx = V[vi * 3];
        const lz = V[vi * 3 + 2];
        const wx = lx + cx * N + HALF;
        const wz = lz + cz * N + HALF;
        V[vi * 3 + 1] += ppOffset(src, seed, bxC, bzC, wx, wz, cache);
      }
    }
  }

  if (buffers.indices.length === 0) {
    return {
      mesh: null,
      buffers,
      vertices: buffers.vertices,
      indices: buffers.indices,
    };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(buffers.vertices, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geo.setAttribute("shade", new THREE.Float32BufferAttribute(buffers.shade, 1));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

  const mat = new WallMaterial(albedo, lightmap, matCfg);
  return {
    mesh: new THREE.Mesh(geo, mat),
    buffers,
    vertices: buffers.vertices,
    indices: buffers.indices,
  };
}
