// ============================================================
// RefinementPostProcess —— 精修层后处理（★ 已弃用 2026-09-05）
// ============================================================
// 原先：坑洞/裂缝/旧 bevel 圆角的高度移位（ppHeight）+ 局部细分顶面
// 现状：渲染层已表驱动（无坑裂、FaceBuild 自带 bevel 弧带）→ 本层关停，
//       POST_PROCESS_ENABLED=false → ppHeight≡0 → 查询/烘焙均退化为纯
//       精修层视觉面（cornerCell 三角插值）。保留给 __PP_TABLE_BUILD=false
//       回退路径与旧管线 A/B 对照（退役拆分见重构设计 §12）。
// ★ 坑洞/裂隙已于 2026-09-05 彻底移除（渲染无坑裂；用户将基于表驱动重写）。
// ============================================================

import { tileById } from "./Tiles";
import type { BlockSource } from "./Refinements";
import { cornerCell, finalRuling } from "./Refinements";
import {
  POST_PROCESS_ENABLED,
  BEVEL_R,
  BEVEL_EPS,
  BEVEL_TILES,
  PP_FINE_SUBDIV_DEPTH,
  PP_FINE_BAND,
} from "./RefinementPostProcessConfig";

// ------------------------------------------------------------
// 判定：某点所属块的 genRole（供圆滑筛选）
// ------------------------------------------------------------
function roleAt(src: BlockSource, bx: number, bz: number): string | undefined {
  const b = src.blockAt(bx, bz);
  return b ? tileById(b.id).genRole : undefined;
}

// ------------------------------------------------------------
// ppHeight —— 连续高分率移位函数（bevel 圆角的唯一入口）
// 返回该点应叠加的高度增量（负 = 压低）。未命中 → 0。
// 总开关关闭 → 恒 0（空后处理 ≡ 原世界）。
// ------------------------------------------------------------
export function ppHeight(
  x: number,
  z: number,
  seed: number,
  src: BlockSource,
): number {
  if (!POST_PROCESS_ENABLED) return 0;
  const bx = Math.floor(x / 4);
  const bz = Math.floor(z / 4);
  const role = roleAt(src, bx, bz);
  if (role === undefined) return 0;

  // 边缘圆弧过渡：块顶面外缘内，按到棱线距离压低 → 圆滑楼缘
  return bevelOffset(x, z, seed, src, bx, bz, role);
}

// ---- 圆角（风化：只圆滑高台↔不插值地面的外露硬边）----
// 只在高台(platform)块顶面、且该边对面是「不插值地面（genRole=ground 且
// 该边 finalRuling=cliff）」时生效；高台↔高台/水/坑、插值(weld)边一律棱角分明。
// 距棱水平距离 d∈[0,BEVEL_R]：顶面顶点从平台高沿 1/4 圆弧下弯。
// 台面主体(d≥R)高度不变、棱线水平位置不变；只磨掉棱的直角。
function bevelOffset(
  x: number,
  z: number,
  seed: number,
  src: BlockSource,
  bx: number,
  bz: number,
  role: string | undefined,
): number {
  if (!role || !BEVEL_TILES.has(role)) return 0;
  if (!src.blockAt(bx, bz)) return 0;
  const hi = src.blockAt(bx, bz)?.h ?? 0;

  // 块内相对坐标
  const fx = x - bx * 4;
  const fz = z - bz * 4;
  // 四方向：dir(0..3) + 方向块 + 沿边法向距离
  // dirs: 0=+x,1=-x,2=+z,3=-z（与 finalRuling 一致）
  const edges: { d: number; dir: number; hb: number }[] = [
    { d: 4 - fx, dir: 0, hb: 0 },
    { d: fx, dir: 1, hb: 0 },
    { d: 4 - fz, dir: 2, hb: 0 },
    { d: fz, dir: 3, hb: 0 },
  ];
  const dxs = [1, -1, 0, 0];
  const dzs = [0, 0, 1, -1];
  // 只圆滑「对面=不插值地面(ground,cliff)」的边
  let best = Infinity;
  for (const e of edges) {
    const nb = src.blockAt(bx + dxs[e.dir], bz + dzs[e.dir]);
    if (!nb) continue;
    const nbRole = tileById(nb.id).genRole;
    const nbH = nb.h;
    // 对面必须是 ground、且是硬边界（cliff 非 weld 插值）、且本台高于它
    if (nbRole !== "ground") continue;
    if (finalRuling(src, bx, bz, e.dir as 0 | 1 | 2 | 3) !== "cliff") continue;
    if (nbH >= hi - BEVEL_EPS) continue;
    if (e.d < best) best = e.d;
  }
  if (!isFinite(best) || best > BEVEL_R) return 0;
  const d = best;
  // ★ 外凸圆弧（用户侧视图《我要的倒角》）：高台顶面保持水平 Y、墙壁保持竖直，
  //  只在尖角处用一个凸向外（向下·外侧鼓出）的 1/4 圆弧连接——圆心在高台内侧
  //  (x_edge−R, Y−R)，弧从墙顶切点(Y−R)平滑向外鼓到台面切点(Y)。
  //  公式 y = Y − R + sqrt(2Rd − d²)，d 为距棱距离：
  //  d=0(墙顶/棱) → y=Y−R；d=R(台面切点) → y=Y。台面主体(d>R)完全不变。 */
  const drop = BEVEL_R - Math.sqrt(2 * BEVEL_R * d - d * d);
  return -drop;
}

// ------------------------------------------------------------
// ppDetailLevel —— 该点是否需要局部细分（fine=需要、多顶点）
// 棱带内 = fine，否则 coarse。（坑/裂已移除 2026-09-05，仅剩 bevel）
// ------------------------------------------------------------
export function ppDetailLevel(
  x: number,
  z: number,
  seed: number,
  src: BlockSource,
): boolean {
  if (!POST_PROCESS_ENABLED) return false;
  const bx = Math.floor(x / 4);
  const bz = Math.floor(z / 4);
  const role = roleAt(src, bx, bz);
  // 落在圆滑棱带内（bevelOffset 非零）-> fine（倒角圆弧需细分才可见）
  return bevelOffset(x, z, seed, src, bx, bz, role) < -1e-9;
}

// ------------------------------------------------------------
// 渲染版局部细分顶面（设计稿 §5 ppRenderTop）
// ------------------------------------------------------------
// 在「需精细」的 1m 格及其 1 格邻域内做 1/2 递归细分（至
// PP_FINE_SUBDIV_DEPTH），细分顶点高度用 ppSurfaceHeight（=cornerCell+ppHeight）。
// ★ 8-邻域扩张保证水密：fine 格向外扩张 1 格，使 fine/coarse 边界两侧同深度
//   → 无 t-junction、无裂缝。
// ★ 倒角窄圆弧在细分网格上可见；平台顶面名义高度（cornerCell 硬边界）与棱
//   水平范围不变（bevel 只在带内压低、带外 0）。
// 纯函数、零 three、确定性（深度固定 → 主/Worker 同构可重放）。
// 返回与 buildChunkFinal 同形的 { vertices, normals, uvs, indices }。
// ------------------------------------------------------------
export interface PostTop {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * 渲染版局部细分顶面（设计稿 §5 ppRenderTop）。
 * 在坑/裂带影响区内做 1/2 递归细分，细分顶点高度用 ppSurfaceHeight
 * （=cornerCell + ppHeight，含圆滑/坑/裂），倒角窄圆弧因此在细分网格上可见，
 * 而平台顶面名义高度（cornerCell 硬边界）与棱水平范围不变。
 *
 * ★ 水密（无 t-junction）：采用「按列/按行细分」的张量积网格——
 *   每列的 x 细分深度 C(lx)、每行的 z 细分深度 R(lz) 分别由该列/行的 fine 格
 *   决定，格深度 D=max(R(lz),C(lx))。共享竖边两侧同列同深度、共享横边两侧
 *   同行同深度 → 全网格无裂缝。纯函数、零 three、确定性。
 */
export function buildPostRenderTop(
  src: BlockSource,
  cx: number,
  cz: number,
  seed: number,
  N: number,
): PostTop {
  const fine = new Uint8Array(N * N);
  let anyFine = false;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const x = cx * N + lx + 0.5;
      const z = cz * N + lz + 0.5;
      if (ppDetailLevel(x, z, seed, src)) {
        fine[lz * N + lx] = 1;
        anyFine = true;
      }
    }
  }
  if (!anyFine) {
    return EMPTY_POST_TOP;
  }

  // 按列 / 按行所需细分深度（含 1 格垂直扩张，保证倒角带内外都能细分到）
  const colD = new Uint8Array(N);
  const rowD = new Uint8Array(N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (fine[lz * N + lx]) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c = lx + dx,
              r = lz + dz;
            if (c >= 0 && c < N && colD[c] < PP_FINE_SUBDIV_DEPTH)
              colD[c] = PP_FINE_SUBDIV_DEPTH;
            if (r >= 0 && r < N && rowD[r] < PP_FINE_SUBDIV_DEPTH)
              rowD[r] = PP_FINE_SUBDIV_DEPTH;
          }
        }
      }
    }
  }

  // 张量积网格：收集 x 采样线与 z 采样线（世界坐标，升序）
  const wx0 = cx * N;
  const wz0 = cz * N;
  const xs: number[] = []; // 世界 x 采样坐标（每 1m 格 + 列内细分）
  for (let lx = 0; lx < N; lx++) {
    const s = 1 << colD[lx];
    for (let k = 0; k < s; k++) xs.push(wx0 + lx + k / s);
  }
  xs.push(wx0 + N); // 收尾右边界
  const zs: number[] = [];
  for (let lz = 0; lz < N; lz++) {
    const s = 1 << rowD[lz];
    for (let k = 0; k < s; k++) zs.push(wz0 + lz + k / s);
  }
  zs.push(wz0 + N); // 收尾下边界

  const nX = xs.length;
  const nZ = zs.length;
  const verts = new Float32Array(nX * nZ * 3);
  const uvs = new Float32Array(nX * nZ * 2);
  const height = new Float32Array(nX * nZ);

  // 顶点高度 = ppSurfaceHeight（后处理最终面）
  for (let iz = 0; iz < nZ; iz++) {
    for (let ix = 0; ix < nX; ix++) {
      const v = (iz * nX + ix) * 3;
      const h = ppSurfaceHeight(xs[ix], zs[iz], seed, src);
      height[iz * nX + ix] = h;
      verts[v] = xs[ix] - wx0 - N / 2; // 局部坐标（中心原点）
      verts[v + 1] = h;
      verts[v + 2] = zs[iz] - wz0 - N / 2;
      uvs[(iz * nX + ix) * 2] = (xs[ix] - wx0) / N;
      uvs[(iz * nX + ix) * 2 + 1] = (zs[iz] - wz0) / N;
    }
  }

  // 法线：用有限差分（简化，刻面光照；后续可平滑）
  const normals = new Float32Array(nX * nZ * 3);
  for (let iz = 0; iz < nZ; iz++) {
    for (let ix = 0; ix < nX; ix++) {
      const x0 = xs[Math.max(0, ix - 1)];
      const x1 = xs[Math.min(nX - 1, ix + 1)];
      const z0 = zs[Math.max(0, iz - 1)];
      const z1 = zs[Math.min(nZ - 1, iz + 1)];
      const hxm = height[iz * nX + Math.max(0, ix - 1)];
      const hxp = height[iz * nX + Math.min(nX - 1, ix + 1)];
      const hzm = height[Math.max(0, iz - 1) * nX + ix];
      const hzp = height[Math.min(nZ - 1, iz + 1) * nX + ix];
      const dx = (x1 - x0) || 1;
      const dz = (z1 - z0) || 1;
      let nx = -(hxp - hxm) / dx;
      let ny = 1;
      let nz = -(hzp - hzm) / dz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[(iz * nX + ix) * 3] = nx / len;
      normals[(iz * nX + ix) * 3 + 1] = ny / len;
      normals[(iz * nX + ix) * 3 + 2] = nz / len;
    }
  }

  // 索引：每个采样矩形（ix,ix+1)×(iz,iz+1) 两三角，对角线 (左,下)-(右,上)
  const indices = new Uint32Array((nX - 1) * (nZ - 1) * 6);
  let ip = 0;
  for (let iz = 0; iz < nZ - 1; iz++) {
    for (let ix = 0; ix < nX - 1; ix++) {
      const a = iz * nX + ix;
      const b = iz * nX + ix + 1;
      const c = (iz + 1) * nX + ix + 1;
      const d = (iz + 1) * nX + ix;
      indices[ip] = a;
      indices[ip + 1] = d;
      indices[ip + 2] = b;
      indices[ip + 3] = d;
      indices[ip + 4] = c;
      indices[ip + 5] = b;
      ip += 6;
    }
  }

  return { vertices: verts, normals, uvs, indices };
}

/** 无 fine 区时的空返回（调用方据此退回精修层原顶面） */
const EMPTY_POST_TOP: PostTop = {
  vertices: new Float32Array(0),
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint32Array(0),
};


// ------------------------------------------------------------
// ppSurfaceHeight —— 唯一自洽采样：精修层最终视觉面 + ppHeight
// 渲染网格顶点 / 物理粗顶点 / 烘焙重放 都走它 → 三者同源、确定性。
// 语义与 sampleSurface（Refinements.ts:418）完全同构：
//   查询点所在米格的 4 角按块归属取「后处理最终高」，再三角形插值；
//   对角线 (x+1,z+1)... 与网格相同，fx+fz≤1 取 T1。
// 关闭 → 每角 ppm = 0 → 退回 sampleSurface 原状（空后处理 ≡ 原世界）。
// ------------------------------------------------------------
export function ppSurfaceHeight(
  x: number,
  z: number,
  seed: number,
  src: BlockSource,
): number {
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  const fx = x - gx;
  const fz = z - gz;
  const bcx = Math.floor(gx / 4);
  const bcz = Math.floor(gz / 4);
  // 四角基值 = cornerCell（精修层硬边界视觉面；块归属只用基底格 bcx,bcz，
  // 朴 sampleSurface 同式）——不含后处理效果。
  const h00 = cornerCell(src, bcx, bcz, gx, gz);
  const h10 = cornerCell(src, bcx, bcz, gx + 1, gz);
  const h01 = cornerCell(src, bcx, bcz, gx, gz + 1);
  const h11 = cornerCell(src, bcx, bcz, gx + 1, gz + 1);
  let base: number;
  if (fx + fz <= 1) {
    base = h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  } else {
    base = h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
  }
  // ★ 效果偏移（bevel 圆弧 / 坑 / 裂）在【查询点处】求值并叠加：
  //   倒角带厚 BEVEL_R(<1m) 时无法由 1m 角格表示，只能按查询点自身的位置判定
  //   是否落在高棱带内（ppHeight 内部按 floor(x/4) 归块判棱）。
  //   渲染网格 / 物理粗顶 / 烘焙 都调本函数 → 三者同源、棱外高度不变。
  return base + ppHeight(x, z, seed, src);
}
