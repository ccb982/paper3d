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
/**
 * 坑/裂细化采样率（0..1）：只随机细化部分区块，其余显示为 coarse 大格
 * （bevel 圆角不受影响，仍全细化）。确定性：按块坐标哈希，同块内 16 格一致。
 */
const PP_REFINE_RATE = 0.55;

/** 坑/裂细化判定（确定性，按块坐标）；bevel 不参与、必细化 */
function refineChance(seed: number, bx: number, bz: number): boolean {
  return hash2(bx * 101 + 7, bz * 103 + 13, seed) < PP_REFINE_RATE;
}

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
  const rr = finalRuling(src, bx, bz, ((dir ^ 2) ^ 1) as 0 | 1 | 2 | 3);
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
        // 左右侧边 = 与弧边垂直的两条边（dir^2 / (dir^2)^1，恒成立）
        drawSideWall((dir ^ 2) as 0 | 1 | 2 | 3);
        drawSideWall(((dir ^ 2) ^ 1) as 0 | 1 | 2 | 3);
        // ---- ★ 侧面高台边调试标记（橙色）：弧边 dir 邻居高台朝本块的边 ----
        // 邻居高台朝向本块（弧面高台）的边，无条件生成延长墙
        {
          const owd = WALL_DIRS[dir];
          const onb = src.blockAt(bx + owd.dx, bz + owd.dz);
          if (onb && tileById(onb.id).genRole === "platform") {
            // 邻居块的 dir 边（朝向本块），坐标以邻居块为基准
            const nbx = bx + owd.dx, nbz = bz + owd.dz;
            const eAx = nbx * 4 + owd.ax * 4, eAz = nbz * 4 + owd.az * 4;
            const eBx = nbx * 4 + owd.bx * 4, eBz = nbz * 4 + owd.bz * 4;
            const yT = onb.h;
            const yB = Math.min(onb.h, cur.h) - 0.5;
            const orange = new THREE.Color(0xff8800);
            const pushO = (p: number[], q: number[]) => {
              all.push(p[0] - HALF, p[1], p[2] - HALF, q[0] - HALF, q[1], q[2] - HALF);
              for (let k = 0; k < 2; k++) col.push(orange.r, orange.g, orange.b);
            };
            const qA = [eAx, yB, eAz], qB = [eBx, yB, eBz], qC = [eBx, yT, eBz], qD = [eAx, yT, eAz];
            pushO(qA, qB); pushO(qB, qC); pushO(qC, qD); pushO(qD, qA);
            pushO(qA, qC);
          }
        }
        // ---- ★ 弧边侧壁的邻居边调试标记（紫色）：侧壁 sd 方向邻居高台上、
        //      朝向本块的边（邻居坐标 sd^1）延长生成的位置 ----
        for (const sd of [dir ^ 2, (dir ^ 2) ^ 1]) {
          const s = sd as 0 | 1 | 2 | 3;
          if (isBevelEdge(src, bx, bz, s)) continue; // 与生成一致：自身弧边跳过
          const pwd = WALL_DIRS[s];
          const pnb = src.blockAt(bx + pwd.dx, bz + pwd.dz);
          if (!pnb || tileById(pnb.id).genRole !== "platform") continue;
          // 邻居朝向本块的边 = 邻居坐标的 sd^1 方向（用 sd^1 的角点偏移！）
          const nbx = bx + pwd.dx, nbz = bz + pwd.dz;
          const nwd = WALL_DIRS[(s ^ 1) as 0 | 1 | 2 | 3];
          const pAx = nbx * 4 + nwd.ax * 4, pAz = nbz * 4 + nwd.az * 4;
          const pBx = nbx * 4 + nwd.bx * 4, pBz = nbz * 4 + nwd.bz * 4;
          const purple = new THREE.Color(0xff00ff);
          const pushP = (p: number[], q: number[]) => {
            all.push(p[0] - HALF, p[1], p[2] - HALF, q[0] - HALF, q[1], q[2] - HALF);
            for (let k = 0; k < 2; k++) col.push(purple.r, purple.g, purple.b);
          };
          const yT2 = pnb.h;
          const yB2 = Math.min(pnb.h, cur.h) - 0.5;
          const qA = [pAx, yB2, pAz], qB = [pBx, yB2, pBz], qC = [pBx, yT2, pBz], qD = [pAx, yT2, pAz];
          pushP(qA, qB); pushP(qB, qC); pushP(qC, qD); pushP(qD, qA);
        }
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
    const rr = finalRuling(src, bx, bz, ((dir ^ 2) ^ 1) as 0 | 1 | 2 | 3);
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

/**
 * 裂缝偏移：只查「本块 + 4 个直邻地块」的预计算裂缝（跨块连续）。
 * 裂缝锚点在本块中心，长度均值 ~5.5m（half~2.75 < 块距 4m），绝大多数只
 * 影响本块与其直邻；超长裂缝的末端二层影响被截断（极少数，视觉可忽略）。
 * 相比旧 5×5=25 锚块扫描，采样点热点评测 ~5 倍提速。
 */
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
  for (let k = 0; k < 5; k++) {
    const dx = k === 1 ? 1 : k === 2 ? -1 : 0;
    const dz = k === 3 ? 1 : k === 4 ? -1 : 0;
    const key = (bx + dx) * 8192 + (bz + dz);
    let ln = cache.get(key);
    if (ln === undefined) {
      ln = crackLineOf(src, seed, bx + dx, bz + dz);
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

  // ---- ① fine 标记：bevel 必细（弧边 0.125m 多段拼弧）；坑/裂随机细 ----
  // 同一 1m 格内逐点区分偏移来源：
  //   bevelHit = 任一点有圆角偏移（必须细分，否则弧边成锯齿）
  //   fxHit    = 任一点有坑/裂偏移（确定性随机决定是否细分，跳过的显示为
  //              coarse 大格；由 refineChance 用「块坐标」随机 → 同块 4×4 格一致）
  const fine = new Uint8Array(N * N);
  let statB = 0, statF = 0;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx;
      const wz0 = oz + lz;
      const vb = cellViewBlock(cx, cz, lx, lz);
      let bevelHit = false;
      let fxHit = false;
      for (let k = 0; k < 9 && !(bevelHit && fxHit); k++) {
        const dx = (k % 3) * 0.5;
        const dz = Math.floor(k / 3) * 0.5;
        const x = wx0 + dx;
        const z = wz0 + dz;
        if (bevelOffset(src, vb.bx, vb.bz, x, z) < -1e-9) {
          bevelHit = true;
        } else if (
          pitOffset(src, seed, vb.bx, vb.bz, x, z) +
            crackOffset(src, seed, vb.bx, vb.bz, x, z, cache) <
          -1e-9
        ) {
          fxHit = true;
        }
      }
      if (bevelHit) {
        fine[lz * N + lx] = 1;
        statB++;
      } else if (fxHit && refineChance(seed, vb.bx, vb.bz)) {
        fine[lz * N + lx] = 1;
        statF++;
      }
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
  if ((globalThis as { __PP_STAT?: boolean }).__PP_STAT) {
    let sf = 0;
    for (let l = 0; l < N * N; l++) if (fineE[l]) sf++;
    console.log(`[stat] bevelFine=${statB} fxFine=${statF} fineE=${sf}/${N * N}`);
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
        // 法线用离散格点差分（含 ±1 外圈 padding），每个采样点只算 1 次 yAt
        // （原逐点 5× 采 yAt → 提速；热点 crackOffset 由此成倍下降）
        const base = vi;
        const G = S + 3; // 含外圈 padding 1（11×11）
        const yt = new Float64Array(G * G);
        for (let gy = -1; gy <= S + 1; gy++) {
          for (let gx = -1; gx <= S + 1; gx++) {
            yt[(gy + 1) * G + (gx + 1)] = yAt(
              src, seed, vb.bx, vb.bz, wx0 + gx * step, wz0 + gy * step, cache,
            );
          }
        }
        for (let jz = 0; jz <= S; jz++) {
          for (let jx = 0; jx <= S; jx++) {
            const y = yt[(jz + 1) * G + (jx + 1)];
            const yL = yt[(jz + 1) * G + jx];
            const yR = yt[(jz + 1) * G + (jx + 2)];
            const yD = yt[jz * G + (jx + 1)];
            const yU = yt[(jz + 2) * G + (jx + 1)];
            const nx = -(yR - yL);
            const nz = -(yU - yD);
            const ny = 2 * step;
            const il = 1 / Math.hypot(nx, ny, nz);
            const x = wx0 + jx * step;
            const z = wz0 + jz * step;
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
/**
 * 由精修层墙 quad 反推其发射边方向（0..3）：
 * 顶 A/B 两顶点同一 block 边界线上 → x 边（dir 0/1）或 z 边（dir 2/3）。
 */
function quadEdgeDir(
  V: Float32Array,
  q: number,
  cx: number,
  cz: number,
  N: number,
  bxC: number,
  bzC: number,
): 0 | 1 | 2 | 3 {
  const HALF = N / 2;
  const tAx = V[q * 12] + cx * N + HALF;
  const tAz = V[q * 12 + 2] + cz * N + HALF;
  const tBx = V[q * 12 + 3] + cx * N + HALF;
  const tBz = V[q * 12 + 5] + cz * N + HALF;
  if (tAx === tBx && (tAx === (bxC + 1) * 4 || tAx === bxC * 4)) {
    return tAx === (bxC + 1) * 4 ? 0 : 1;
  }
  return tAz === (bzC + 1) * 4 ? 2 : 3;
}

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

  const cache = new Map<number, CrackLine | null>();

  // ---- ★ 收集待处理的弧边侧壁（白色调试位置）----
  // 弧边的左右邻边，自身非弧边（转角由弧边自身遍历覆盖）：
  //   有落差 → 重建全高细分侧壁（墙顶弧线）；无落差 → 只补弧带端面封片
  const rebuild = new Map<string, { bx: number; bz: number; sd: 0 | 1 | 2 | 3; drop: boolean }>();
  // 被剔除 quad 的材质（沿边参数 t → 属性），供新细分墙继承
  const matByEdge = new Map<string, { t: number; cr: number; cg: number; cb: number; shade: number; uvU: number; uvV: number }[]>();
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      for (let dir = 0; dir < 4; dir++) {
        if (!isBevelEdge(src, bx, bz, dir as 0 | 1 | 2 | 3)) continue;
        const cur = src.blockAt(bx, bz)!;
        for (const sd of [dir ^ 2, (dir ^ 2) ^ 1]) {
          const s = sd as 0 | 1 | 2 | 3;
          if (isBevelEdge(src, bx, bz, s)) continue; // 转角：不修（弧边遍历覆盖）
          const wsd = WALL_DIRS[s];
          const nb2 = src.blockAt(bx + wsd.dx, bz + wsd.dz);
          if (!nb2) continue;
          const drop = nb2.h < cur.h; // 有落差 → 全高墙；无落差 → 只封弧带端面
          rebuild.set(`${bx},${bz},${s}`, { bx, bz, sd: s, drop });
        }
      }
    }
  }

  // ---- ★ 侧面高台的边也生成墙：rebuild 中每条边（无论落差/封片）的邻居
  //      若是高台（platform），则「邻居高台朝向本块的边」（邻居坐标 sd^1）
  //      也延长生成——两高台背靠背同面，堵住弧带缺口看穿的悬空 ----
  const initial2 = [...rebuild.entries()];
  for (const [, e] of initial2) {
    const wd = WALL_DIRS[e.sd];
    const nbx = e.bx + wd.dx, nbz = e.bz + wd.dz;
    const nb = src.blockAt(nbx, nbz);
    if (!nb) continue;
    if (tileById(nb.id).genRole !== "platform") continue; // 只扩散到侧面高台
    const od = (e.sd ^ 1) as 0 | 1 | 2 | 3; // 邻居朝向本块的边
    const okey = `${nbx},${nbz},${od}`;
    if (!rebuild.has(okey)) {
      rebuild.set(okey, { bx: nbx, bz: nbz, sd: od, drop: true });
    }
  }
  // 弧边的对边（邻居坐标）：弧边 dir 的邻居高台，其朝本块边同样处理
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      for (let dir = 0; dir < 4; dir++) {
        if (!isBevelEdge(src, bx, bz, dir as 0 | 1 | 2 | 3)) continue;
        const od = (dir ^ 1) as 0 | 1 | 2 | 3;
        const owd = WALL_DIRS[od];
        const onb = src.blockAt(bx + owd.dx, bz + owd.dz);
        if (!onb) continue;
        if (tileById(onb.id).genRole !== "platform") continue;
        const okey = `${bx + owd.dx},${bz + owd.dz},${dir}`; // 邻居的 dir 边（朝向本块）
        if (!rebuild.has(okey)) {
          rebuild.set(okey, { bx: bx + owd.dx, bz: bz + owd.dz, sd: dir as 0 | 1 | 2 | 3, drop: true });
        }
      }
    }
  }

  if (buffers.indices.length > 0) {
    const V = buffers.vertices;
    const I = buffers.indices;
    const quads = V.length / 12;
    const skip = new Set<number>();
    // 被剔除 quad 的材质（沿边参数 t → 属性），供新细分墙继承
    for (let q = 0; q < quads; q++) {
      const tblX = Math.round(buffers.uvs[q * 8] * 15 - 0.5);
      const tblZ = Math.round(buffers.uvs[q * 8 + 1] * 15 - 0.5);
      const bxC = tblX + cx * BPS;
      const bzC = tblZ + cz * BPS;
      const dirQ = quadEdgeDir(V, q, cx, cz, N, bxC, bzC);
      const key = `${bxC},${bzC},${dirQ}`;
      const rb = rebuild.get(key);
      if (rb) {
        // 该 quad 属于重建边 → 剔除并记录材质（按沿边中点参数 t）
        skip.add(q);
        const wsd = WALL_DIRS[dirQ];
        // 顶 A 世界沿边坐标 → 参数 t（0..4m）
        const aAlong = dirQ < 2
          ? (V[q * 12 + 2] + cz * N + HALF) - (rb.bz * 4)
          : (V[q * 12] + cx * N + HALF) - (rb.bx * 4);
        const tMid = Math.max(0, Math.min(3.999, aAlong));
        const list = matByEdge.get(key) ?? [];
        list.push({
          t: tMid,
          cr: buffers.colors[q * 12], cg: buffers.colors[q * 12 + 1], cb: buffers.colors[q * 12 + 2],
          shade: buffers.shade[q * 4],
          uvU: buffers.uvs[q * 8], uvV: buffers.uvs[q * 8 + 1],
        });
        matByEdge.set(key, list);
        continue;
      }
      // 其余墙：墙顶加 ppOffset（原行为）
      for (let t = 0; t < 2; t++) {
        const vi = q * 4 + t;
        const lx = V[vi * 3];
        const lz = V[vi * 3 + 2];
        const wx = lx + cx * N + HALF;
        const wz = lz + cz * N + HALF;
        V[vi * 3 + 1] += ppOffset(src, seed, bxC, bzC, wx, wz, cache);
      }
    }
    // 重排索引剔除被替换 quad
    if (skip.size > 0) {
      const newIdx: number[] = [];
      for (let t = 0; t < I.length; t += 6) {
        const q = (I[t] / 4) | 0;
        if (!skip.has(q)) {
          newIdx.push(I[t], I[t + 1], I[t + 2], I[t + 3], I[t + 4], I[t + 5]);
        }
      }
      buffers.indices = new Uint32Array(newIdx);
    }
  }

  // ---- ★ 重建细分弧形顶侧壁（顶 y 逐点 yAt 与顶面同源，含两端弧线）----
  if (rebuild.size > 0) {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const shd: number[] = [];
    const uva: number[] = [];
    const idx: number[] = [];
    let vi = 0;

    for (const { bx, bz, sd, drop } of rebuild.values()) {
      const cur = src.blockAt(bx, bz)!;
      const wsd = WALL_DIRS[sd];
      const nb2 = src.blockAt(bx + wsd.dx, bz + wsd.dz)!;
      // 边线两端（世界米格，A→B 与精修层同序 → 绕序一致）
      const Ax = bx * 4 + wsd.ax * 4, Az = bz * 4 + wsd.az * 4;
      const Bx = bx * 4 + wsd.bx * 4, Bz = bz * 4 + wsd.bz * 4;
      const yH = cur.h;
      const ux = (Bx - Ax) / 4, uz = (Bz - Az) / 4; // 沿边单位向量
      const key = `${bx},${bz},${sd}`;
      const mats = matByEdge.get(key) ?? [];
      const matAt = (d: number) => {
        let best = mats[0];
        for (const m of mats) if (Math.abs(m.t - d) < Math.abs(best.t - d)) best = m;
        return best;
      };
      // 判定两端是否接弧边（A 端 t=0，B 端 t=4）
      const isArcAtPoint = (px: number, pz: number) => {
        for (const cd of [(sd ^ 2) as 0 | 1 | 2 | 3, ((sd ^ 2) ^ 1) as 0 | 1 | 2 | 3]) {
          if (!isBevelEdge(src, bx, bz, cd)) continue;
          const cwd = WALL_DIRS[cd];
          const cAx = bx * 4 + cwd.ax * 4, cAz = bz * 4 + cwd.az * 4;
          const cBx = bx * 4 + cwd.bx * 4, cBz = bz * 4 + cwd.bz * 4;
          if ((Math.abs(cAx - px) < 1e-6 && Math.abs(cAz - pz) < 1e-6)
            || (Math.abs(cBx - px) < 1e-6 && Math.abs(cBz - pz) < 1e-6)) return true;
        }
        return false;
      };
      const aArc = isArcAtPoint(Ax, Az);
      const bArc = isArcAtPoint(Bx, Bz);
      // 无落差：只补弧带端面封片（曲边三角，位于弧带端头的竖直平面）
      if (!drop) {
        // 找到本边与哪条弧边相邻（near 端）：左右两条垂直边各可能接一条弧边
        // 本封片位于 sd 边线，剖面沿「相邻弧边的内缩方向」
        // 相邻弧边 = 与 sd 垂直且共享 near/far 端的方向，逐端检测
        const ends: { px: number; pz: number; cornerBevelDir: 0 | 1 | 2 | 3 }[] = [];
        // near 端（A 或 B）与 far 端分别判定：端点 t=0 和 t=4
        for (const isNear of [true, false]) {
          const tx = isNear ? Math.round(-ux) : Math.round(ux); // 端点沿边外的块方向
          const tz = isNear ? Math.round(-uz) : Math.round(uz);
          // 端点处的垂直边 = 本块 dir 候选：与 sd 垂直且指向该端的两条
          const cds: (0 | 1 | 2 | 3)[] = [(sd ^ 2) as 0 | 1 | 2 | 3, ((sd ^ 2) ^ 1) as 0 | 1 | 2 | 3];
          for (const cd of cds) {
            const cwd = WALL_DIRS[cd];
            // cd 边必须贴着该端点：cd 边线两端角点之一 = 本边端点
            const cAx = bx * 4 + cwd.ax * 4, cAz = bz * 4 + cwd.az * 4;
            const cBx = bx * 4 + cwd.bx * 4, cBz = bz * 4 + cwd.bz * 4;
            const pX = isNear ? Ax : Bx, pZ = isNear ? Az : Bz;
            const touches = (Math.abs(cAx - pX) < 1e-6 && Math.abs(cAz - pZ) < 1e-6)
              || (Math.abs(cBx - pX) < 1e-6 && Math.abs(cBz - pZ) < 1e-6);
            if (!touches) continue;
            if (isBevelEdge(src, bx, bz, cd)) {
              ends.push({ px: pX, pz: pZ, cornerBevelDir: cd as 0 | 1 | 2 | 3 });
            }
          }
        }
        // 对每个接弧边的端点画曲边三角封片
        for (const end of ends) {
          const cwd = WALL_DIRS[end.cornerBevelDir];
          const inX = -cwd.dx, inZ = -cwd.dz; // 弧边内缩方向（进本块）
          // 法线沿 sd 边朝外
          const color = 0.5;
          // 顶点高度全部采样 yAt（顶面同源，角点混合/弧线完全贴合）
          const p0y = yAt(src, seed, bx, bz, end.px, end.pz, cache);
          const P0: number[] = [end.px, p0y, end.pz];
          let prev: number[] = [...P0];
          const K3 = 6;
          for (let k = 1; k <= K3; k++) {
            const dM = (k / K3) * BEVEL_R;
            const qx = end.px + inX * dM, qz = end.pz + inZ * dM;
            const qy = yAt(src, seed, bx, bz, qx, qz, cache);
            const q: number[] = [qx, qy, qz];
            // 绕序校验：三角形法线须与 sd 外法线一致，反了则交换后两点
            const e1x = prev[0] - P0[0], e1y = prev[1] - P0[1], e1z = prev[2] - P0[2];
            const e2x = q[0] - P0[0], e2y = q[1] - P0[1], e2z = q[2] - P0[2];
            const cnx = e1y * e2z - e1z * e2y;
            const cnz = e1x * e2y - e1y * e2x;
            const flip = cnx * wsd.dx + cnz * wsd.dz < 0;
            const A3 = P0, B3 = flip ? q : prev, C3 = flip ? prev : q;
            pos.push(
              A3[0] - cx * N - HALF, A3[1], A3[2] - cz * N - HALF,
              B3[0] - cx * N - HALF, B3[1], B3[2] - cz * N - HALF,
              C3[0] - cx * N - HALF, C3[1], C3[2] - cz * N - HALF,
            );
            for (let c = 0; c < 3; c++) {
              nor.push(wsd.dx, 0, wsd.dz);
              col.push(color, color, color);
              shd.push(0.5);
              uva.push(0.5, 0.5);
            }
            idx.push(vi, vi + 1, vi + 2);
            vi += 3;
            prev = q;
          }
        }
        continue;
      }
      const yBot = Math.min(cur.h, nb2.h) - 0.5;
      // 采样点按 A→B 距离 d（顶点顺序恒定 A→B → 绕序/材质不变）；
      // 弧区加密点放在接弧端一侧（aArc → A 端 0 侧；bArc → B 端 4 侧）
      const dsSet = new Set<number>([0]);
      for (let d = 0.5; d < 4; d += 0.5) dsSet.add(d); // 基础 0.5m 采样
      const arcPt = [0.125, 0.25, 0.375];
      if (aArc) for (const x of arcPt) dsSet.add(x);          // A 端弧区加密
      if (bArc) for (const x of arcPt) dsSet.add(4 - x);      // B 端弧区加密
      dsSet.add(4);
      const ds = [...dsSet].sort((a, b) => a - b);
      // 逐段生成竖直 quad：顶 y = yAt（顶面同源），底 y = yBot
      for (let i = 0; i < ds.length - 1; i++) {
        const d0 = ds[i], d1 = ds[i + 1];
        const ax = Ax + ux * d0, az = Az + uz * d0;
        const bx2 = Ax + ux * d1, bz2 = Az + uz * d1;
        const yA = yAt(src, seed, bx, bz, ax, az, cache);
        const yB = yAt(src, seed, bx, bz, bx2, bz2, cache);
        const m = matAt((d0 + d1) / 2) ?? { cr: 0.5, cg: 0.5, cb: 0.5, shade: 0.5, uvU: 0.5, uvV: 0.5 };
        pos.push(
          ax - cx * N - HALF, yA, az - cz * N - HALF,
          bx2 - cx * N - HALF, yB, bz2 - cz * N - HALF,
          bx2 - cx * N - HALF, yBot, bz2 - cz * N - HALF,
          ax - cx * N - HALF, yBot, az - cz * N - HALF,
        );
        for (let c = 0; c < 4; c++) {
          nor.push(wsd.dx, 0, wsd.dz);
          col.push(m.cr, m.cg, m.cb);
          shd.push(m.shade);
          uva.push(m.uvU, m.uvV);
        }
        idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
        vi += 4;
      }
    }

    // 合并新墙进 buffers
    if (vi > 0) {
      const nV = buffers.vertices.length / 3;
      const nI = buffers.indices.length;
      const mergedV = new Float32Array(buffers.vertices.length + pos.length);
      mergedV.set(buffers.vertices, 0);
      mergedV.set(pos, buffers.vertices.length);
      const mergedN = new Float32Array(buffers.normals.length + nor.length);
      mergedN.set(buffers.normals, 0);
      mergedN.set(nor, buffers.normals.length);
      const mergedU = new Float32Array(buffers.uvs.length + uva.length);
      mergedU.set(buffers.uvs, 0);
      mergedU.set(uva, buffers.uvs.length);
      const mergedC = new Float32Array(buffers.colors.length + col.length);
      mergedC.set(buffers.colors, 0);
      mergedC.set(col, buffers.colors.length);
      const mergedS = new Float32Array(buffers.shade.length + shd.length);
      mergedS.set(buffers.shade, 0);
      mergedS.set(shd, buffers.shade.length);
      const mergedI = new Uint32Array(nI + idx.length);
      mergedI.set(buffers.indices, 0);
      for (let i = 0; i < idx.length; i++) mergedI[nI + i] = idx[i] + nV;
      buffers.vertices = mergedV;
      buffers.normals = mergedN;
      buffers.uvs = mergedU;
      buffers.colors = mergedC;
      buffers.shade = mergedS;
      buffers.indices = mergedI;
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
