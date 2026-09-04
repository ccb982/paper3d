// ============================================================
// FaceBuild —— 表驱动的精修层几何构建（管线阶段 D 骨架 v1）
// ============================================================
// 输入 FaceTable + src，直接产出顶面与侧壁几何：
//   · 顶面：coarse 1m（平面 + weld 坡进顶 + bevel 弧带下弯）
//   · 侧壁：每边恒壁（表 depth = calc+保底）；顶沿采样贴顶面，
//           两端受左右邻壁属性影响由表 leftKind/rightKind 提供
// pit/crack 属后处理精细 pass（另行施加，不入本函数）。
// 待调项：① 侧壁底沿语义 ② 弧带法线/细分 ③ fine 细分
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { type FaceTable, WALL_EPS, WALL_MIN_DEPTH } from "./FaceTable";
import { type BlockSource, surfaceHeightCore } from "./Refinements";

const N = CHUNK_SIZE; // 60
const BPS = BLOCKS_PER_SIDE; // 15
const HALF = N / 2;
/** 弧带半径（与旧体系一致；精修层形态常量，后续收敛到 RefinementConstants） */
export const BEVEL_R = 0.3;

const DIRS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

export interface FaceGeometry {
  vertices: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  shade?: Float32Array;
  indices: Uint32Array;
  topTriCount: number;
}

// ------------------------------------------------------------
// 顶面高度（视觉面 + bevel 弧带下弯）
// ------------------------------------------------------------

/**
 * 指定视角块下的顶面高度（世界坐标，f64）：
 * base = 精修视觉面（该视角块的 weld 边插值/坡进顶）
 * 叠 bevel 弧带（该视角块的 bevel 棱带内下沉）。
 * ★ 视角块必须显式传入——块边界角点/墙顶线归属哪块就传哪块，
 *   不能用格点 floor 自推（否则取到邻块视角 → 地块边缘不平）。
 */
export function topYView(
  table: FaceTable,
  src: BlockSource,
  viewBx: number,
  viewBz: number,
  x: number,
  z: number,
): number {
  const base = surfaceHeightCore(src, viewBx, viewBz, x, z);
  const ccx = Math.floor(viewBx / BPS);
  const ccz = Math.floor(viewBz / BPS);
  const cell =
    ccx === table.cx && ccz === table.cz
      ? table.cells[(viewBz - ccz * BPS) * BPS + (viewBx - ccx * BPS)]
      : null;
  if (!cell) return base;
  let dMin = Infinity;
  for (let dir = 0; dir < 4; dir++) {
    if (cell.sides[dir as 0 | 1 | 2 | 3].kind !== "bevel") continue;
    let d: number;
    if (dir === 0) d = (viewBx + 1) * 4 - x;
    else if (dir === 1) d = x - viewBx * 4;
    else if (dir === 2) d = (viewBz + 1) * 4 - z;
    else d = z - viewBz * 4;
    if (d < dMin) dMin = d;
  }
  if (dMin >= BEVEL_R) return base;
  return base - (BEVEL_R - Math.sqrt(Math.max(0, 2 * BEVEL_R * dMin - dMin * dMin)));
}

/** 按点所属块视角的顶面高度（查询用；几何构建请用 topYView 显式视角） */
export function topYAt(
  table: FaceTable,
  src: BlockSource,
  x: number,
  z: number,
): number {
  return topYView(table, src, Math.floor(x / 4), Math.floor(z / 4), x, z);
}

// ------------------------------------------------------------
// 顶面网格（coarse 1m + bevel 带 fine 0.125m 拼弧；坑/裂已废弃）
// ------------------------------------------------------------
const FINE_D = 3; // 2^3 = 0.125m
const FINE_S = 1 << FINE_D;

/** cell(lx,lz)（视角=所属块）是否落在 bevel 弧带影响区（需 fine） */
function cellBevelFine(table: FaceTable, src: BlockSource, lx: number, lz: number): boolean {
  const ox = table.cx * N, oz = table.cz * N;
  const vbx = table.cx * BPS + Math.floor(lx / 4);
  const vbz = table.cz * BPS + Math.floor(lz / 4);
  const ccx = Math.floor(vbx / BPS), ccz = Math.floor(vbz / BPS);
  if (ccx !== table.cx || ccz !== table.cz) return false;
  const cell = table.cells[(vbz - ccz * BPS) * BPS + (vbx - ccx * BPS)];
  for (let dir = 0; dir < 4; dir++) {
    if (cell.sides[dir as 0 | 1 | 2 | 3].kind !== "bevel") continue;
    // 该 bevel 棱到 cell 的最小距离（垂直方向）
    const wx0 = ox + lx, wz0 = oz + lz;
    let d: number;
    if (dir === 0) d = (vbx + 1) * 4 - wx0 - 1; // 东棱：cell 东边界到棱=0 → 带内
    else if (dir === 1) d = wx0 - vbx * 4;
    else if (dir === 2) d = (vbz + 1) * 4 - wz0 - 1;
    else d = wz0 - vbz * 4;
    // cell 覆盖 [0,1)，棱到 cell 近端/远端距离：带相交判 cell 距棱 < R
    const near = Math.max(0, d); // 简化：cell 起点距棱
    const far = near + 1;
    void far;
    if (near < BEVEL_R && near > -1) return true;
  }
  return false;
}

export function buildTopGeometry(table: FaceTable, src: BlockSource): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  let vi = 0;

  // ① fine 标记（bevel 带 cell）+ 外扩 1 格保水密（coarse/fine 无 T 结）
  const fineE = new Uint8Array(N * N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (cellBevelFine(table, src, lx, lz)) fineE[lz * N + lx] = 1;
    }
  }
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!fineE[lz * N + lx]) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx2 = lx + dx, nz2 = lz + dz;
          if (nx2 >= 0 && nz2 >= 0 && nx2 < N && nz2 < N) fineE[nz2 * N + nx2] = 1;
        }
      }
    }
  }

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx, wz0 = oz + lz;
      const vbx = table.cx * BPS + Math.floor(lx / 4);
      const vbz = table.cz * BPS + Math.floor(lz / 4);
      const x0 = lx - HALF, z0 = lz - HALF;
      const base = vi;
      if (!fineE[lz * N + lx]) {
        // coarse：4 角
        const h00 = topYView(table, src, vbx, vbz, wx0, wz0);
        const h10 = topYView(table, src, vbx, vbz, wx0 + 1, wz0);
        const h11 = topYView(table, src, vbx, vbz, wx0 + 1, wz0 + 1);
        const h01 = topYView(table, src, vbx, vbz, wx0, wz0 + 1);
        pos.push(x0, h00, z0, x0 + 1, h10, z0, x0 + 1, h11, z0 + 1, x0, h01, z0 + 1);
        for (let c = 0; c < 4; c++) nor.push(0, 1, 0);
        uv.push(lx / N, lz / N, (lx + 1) / N, lz / N, (lx + 1) / N, (lz + 1) / N, lx / N, (lz + 1) / N);
        idx.push(vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1);
        vi += 4;
      } else {
        // fine：0.125m 网格，顶点 y = topYView，法线用中差
        const G = FINE_S + 1; // 9
        const yt = new Float64Array(G * G);
        for (let gy = 0; gy < G; gy++) {
          for (let gx = 0; gx < G; gx++) {
            const wx = wx0 + gx / FINE_S;
            const wz = wz0 + gy / FINE_S;
            yt[gy * G + gx] = topYView(table, src, vbx, vbz, wx, wz);
            const lxx = wx - ox - HALF;
            const lzz = wz - oz - HALF;
            pos.push(lxx, yt[gy * G + gx], lzz);
            uv.push((wx - ox) / N, (wz - oz) / N);
          }
        }
        // 顶点先占位法线，后差分
        for (let c = 0; c < G * G; c++) nor.push(0, 0, 0);
        const step = 1 / FINE_S;
        for (let gy = 0; gy < G; gy++) {
          for (let gx = 0; gx < G; gx++) {
            const yC = yt[gy * G + gx];
            const yL = gx > 0 ? yt[gy * G + gx - 1] : yC;
            const yR = gx < G - 1 ? yt[gy * G + gx + 1] : yC;
            const yD = gy > 0 ? yt[(gy - 1) * G + gx] : yC;
            const yU = gy < G - 1 ? yt[(gy + 1) * G + gx] : yC;
            const nx2 = -(yR - yL);
            const nz2 = -(yU - yD);
            const ny = 2 * step;
            const il = 1 / Math.hypot(nx2, ny, nz2);
            const io = (base + gy * G + gx) * 3;
            nor[io] = nx2 * il;
            nor[io + 1] = ny * il;
            nor[io + 2] = nz2 * il;
          }
        }
        for (let jz = 0; jz < FINE_S; jz++) {
          for (let jx = 0; jx < FINE_S; jx++) {
            const v00 = base + jz * G + jx;
            const v10 = v00 + 1;
            const v01 = v00 + G;
            const v11 = v01 + 1;
            idx.push(v00, v01, v10, v01, v11, v10);
          }
        }
        vi += G * G;
      }
    }
  }
  return {
    vertices: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
    topTriCount: idx.length / 3,
  };
}

// ------------------------------------------------------------
// 侧壁（每边恒壁：顶沿采样贴顶面，深度 = 表 calc+保底）
// ------------------------------------------------------------

export function buildWallGeometry(table: FaceTable, src: BlockSource): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const shd: number[] = [];
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  const SEG = 8; // 每 4m 边 8 段（0.5m）
  let vi = 0;

  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      const bx = table.cx * BPS + lbx;
      const bz = table.cz * BPS + lbz;
      // 该块局部 tile 中心 uv（默认侧壁材质 = 本块 tile）
      const uU = (lbx + 0.5) / 15;
      const uV = (lbz + 0.5) / 15;
      for (let dir = 0; dir < 4; dir++) {
        const side = cell.sides[dir as 0 | 1 | 2 | 3];
        const nbx = bx + DIRS[dir].dx;
        const nbz = bz + DIRS[dir].dz;
        // ★ 每块每边无条件强制绘制侧壁（含保底埋深）——不过滤高侧/等高；
        //   顶面视角 bug 已修，埋底壁不再制造坑洼（2026-09-04）
        const x0 = bx * 4, z0 = bz * 4;
        let ax: number, az: number, bx2: number, bz2: number;
        if (dir === 0) { ax = x0 + 4; az = z0; bx2 = x0 + 4; bz2 = z0 + 4; }
        else if (dir === 1) { ax = x0; az = z0; bx2 = x0; bz2 = z0 + 4; }
        else if (dir === 2) { ax = x0; az = z0 + 4; bx2 = x0 + 4; bz2 = z0 + 4; }
        else { ax = x0; az = z0; bx2 = x0 + 4; bz2 = z0; }
        const nrm = DIRS[dir];
        let prevTop: number | null = null;
        let prevNb = 0;
        let prevLx = 0, prevLz = 0;
        for (let s = 0; s <= SEG; s++) {
          const t = s / SEG;
          const gx = ax + (bx2 - ax) * t;
          const gz = az + (bz2 - az) * t;
          // 墙顶沿采样：视角 = 本墙所属块（bx,bz），勿按格点 floor 推
          const top = topYView(table, src, bx, bz, gx, gz);
          // 低侧视觉顶（本段邻视角 max，用于贴低侧基准 + 埋保底）
          const nbTop = Math.max(
            surfaceHeightCore(src, nbx, nbz, gx, gz),
            surfaceHeightCore(src, nbx, nbz, gx + (bx2 - ax) / SEG, gz + (bz2 - az) / SEG),
          );
          const lx = gx - ox - HALF;
          const lz = gz - oz - HALF;
          if (prevTop !== null) {
            // 底 = 低侧基准 − EPS − 保底（埋地下）；clip 不高于本段顶
            const botA = Math.min(prevTop, prevNb - WALL_EPS - WALL_MIN_DEPTH);
            const botB = Math.min(top, nbTop - WALL_EPS - WALL_MIN_DEPTH);
            pos.push(prevLx, prevTop, prevLz, lx, top, lz, lx, botB, lz, prevLx, botA, prevLz);
            for (let c = 0; c < 4; c++) {
              nor.push(nrm.dx, 0, nrm.dz);
              uv.push(uU, uV);
              col.push(0.6, 0.6, 0.6); // 顶点色占位（shader 调）
              shd.push(1);
            }
            // ★ 绕序朝外（正面可见）：dir1/-x 与 dir2/+z 的墙法线因采样方向
            //   朝内，翻转索引；dir0/dir3 保持（2026-09-04 修正）
            if (dir === 1 || dir === 2) {
              idx.push(vi, vi + 3, vi + 2, vi, vi + 2, vi + 1);
            } else {
              idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
            }
            vi += 4;
          }
          prevTop = top;
          prevNb = nbTop;
          prevLx = lx;
          prevLz = lz;
        }
      }
    }
  }
  return {
    vertices: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    shade: new Float32Array(shd),
    indices: new Uint32Array(idx),
    topTriCount: 0,
  };
}
