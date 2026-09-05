// ============================================================
// FaceBuild —— 表驱动的精修层几何构建（阶段 D，定稿）
//   架构权威文档：《地形表驱动管线重构设计.md》（定稿 2026-09-05）
// ============================================================
// 输入 FaceTable + src，直接产出顶面与侧壁几何：
//   · 顶面：coarse 1m（平面 + weld 坡进顶 + bevel 弧带下弯），
//     fine 0.125m 只落在 bevel 弧带与 weld 坡脚/角脊非线性 cell
//     （topFineCells 统一判定：顶面与侧壁共用同一张细分图）
//   · 侧壁：每边恒壁（表 depth = calc+保底）；壁顶沿节点列 = 顶网格
//     边界折线同列（fine cell 段 0.125m / 其余 1m）→ 壁顶与顶面逐段
//     同端点闭合，weld 坡脚/弧带处不再各自近似开口（2026-09-05 修）
// pit/crack 属后处理精细 pass（另行施加，不入本函数）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { type FaceTable, WALL_EPS, WALL_MIN_DEPTH } from "./FaceTable";
import { type BlockSource, surfaceHeightCore, rampWidthOf } from "./Refinements";

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
// 顶面网格（coarse 1m + fine 0.125m 拼 bevel 弧 / weld 坡脚角脊；坑/裂已废弃）
// ------------------------------------------------------------
const FINE_D = 3; // 2^3 = 0.125m
const FINE_S = 1 << FINE_D;

/** weld 坡顶面非线性判据：cell 内网格边(1m 直线)与真实坡面的允许偏差（m） */
const WELD_FINE_EPS = 0.03;

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

/**
 * ★ weld 坡面非线性检测（坡脚棱/双坡角脊跨过 cell 内部时，1m 直线网格边会
 *   悬离真实坡面可达 ~1m → 该 cell 必须进 fine 细分）。
 * 判据：cell 内 4 边中点 + 中心的真实顶面高度，与按网格三角形（对角剖分
 * 01-10）线性预测值之差 > WELD_FINE_EPS → 非线性。
 * 只需测「本块视角」；而视角面只被本块自己的 weld 边 ± 坡带宽影响 → 候选
 * = cell 与本块 weld 棱距离 < 坡带宽的格（跨棱 0 起算）。
 */
function cellWeldCurvFine(
  table: FaceTable,
  src: BlockSource,
  lbx: number, // 块局部列 0..14
  lbz: number,
  lx: number,  // chunk 局部米格 0..N
  lz: number,
): boolean {
  const wx0 = table.cx * N + lx, wz0 = table.cz * N + lz;
  const bx = table.cx * BPS + lbx, bz = table.cz * BPS + lbz;
  // cell 近端距棱（东 x=(bx+1)*4、西 x=bx*4、南 z=(bz+1)*4、北 z=bz*4；
  // cell 覆盖 [0,1)，距棱 = 近端与棱的差，< 0 表示跨棱/在棱带内 → 0）
  const nearD = [
    Math.max(0, (bx + 1) * 4 - wx0 - 1),
    Math.max(0, wx0 - bx * 4),
    Math.max(0, (bz + 1) * 4 - wz0 - 1),
    Math.max(0, wz0 - bz * 4),
  ];
  let hit = false;
  for (let dir = 0; dir < 4; dir++) {
    const s = table.cells[lbz * BPS + lbx].sides[dir as 0 | 1 | 2 | 3];
    if (s.kind !== "weld") continue;
    // weld 棱伸入 cell：cell 任一部分落在坡带（近端 < 坡带宽）
    if (nearD[dir] < rampWidthOf(src, bx, bz, dir as 0 | 1 | 2 | 3)) hit = true;
  }
  if (!hit) return false;
  // 顶面 4 角 + 4 边中点 + 中心（网格剖分线性预测对照；视角 = 本块）
  const y00 = topYView(table, src, bx, bz, wx0, wz0);
  const y10 = topYView(table, src, bx, bz, wx0 + 1, wz0);
  const y11 = topYView(table, src, bx, bz, wx0 + 1, wz0 + 1);
  const y01 = topYView(table, src, bx, bz, wx0, wz0 + 1);
  const dev = (p: number, e: number) => Math.abs(p - e) > WELD_FINE_EPS;
  // 中心与 4 边中点各对照所属网格边（对角剖分 01-10，同 buildTopGeometry 绕序）
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 0.5), (y01 + y10) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0), (y00 + y10) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 1), (y01 + y11) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0, wz0 + 0.5), (y00 + y01) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 1, wz0 + 0.5), (y10 + y11) / 2)) return true;
  return false;
}

/**
 * ★ 顶面 fine 细分图（N×N，1 = 该 1m cell 用 0.125m 子网格）：
 *   bevel 弧带 cell ∪ weld 非线性 cell（坡脚/角脊），外扩 1 格保水密
 *   （coarse/fine 之间不出现共享边 = 无 T 结）。
 *   顶面与侧壁共用同一张图 → 壁顶沿按同一节点列采样，闭合一致。
 */
const fineCache = new WeakMap<FaceTable, Uint8Array>();

export function topFineCells(table: FaceTable, src: BlockSource): Uint8Array {
  const cached = fineCache.get(table);
  if (cached) return cached;
  const weldFine = new Uint8Array(N * N);
  const bevelFine = new Uint8Array(N * N);
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      // 该块是否有 weld 边（无则其视角面恒平面，跳过曲率检测）
      let weld = false;
      for (let dir = 0; dir < 4; dir++) {
        if (table.cells[lbz * BPS + lbx].sides[dir as 0 | 1 | 2 | 3].kind === "weld") { weld = true; break; }
      }
      const b0x = lbx * 4, b0z = lbz * 4;
      for (let jz = 0; jz < 4; jz++) {
        for (let jx = 0; jx < 4; jx++) {
          const lx = b0x + jx, lz = b0z + jz;
          // ★ bevel：弧带圆角边界可能在 cell 边 → 外扩 1 格保水密（历史方案）
          if (cellBevelFine(table, src, lx, lz)) { bevelFine[lz * N + lx] = 1; continue; }
          // ★ weld：坡脚/角脊（含双坡交汇）跨过 cell 内部/边界 → 非线性 cell
          if (weld && cellWeldCurvFine(table, src, lbx, lbz, lx, lz)) { weldFine[lz * N + lx] = 1; }
        }
      }
    }
  }
  // bevel 外扩 1 格（coarse/fine 边界隔一格，无 T 结）——必须写独立数组，
  // 否则原地扩散会级联传染整片区域
  const bevelOut = new Uint8Array(N * N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!bevelFine[lz * N + lx]) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx2 = lx + dx, nz2 = lz + dz;
          if (nx2 >= 0 && nz2 >= 0 && nx2 < N && nz2 < N) bevelOut[nz2 * N + nx2] = 1;
        }
      }
    }
  }
  // ★ 逐边扩张（代替整格外扩）：fine/coarse 共享边若在 fine 节点处偏离
  //   直线 > SLIT_EPS → 该 coarse cell 并入 fine（角脊弯曲贴近共享边端点的
  //   漏判区正是细缝源）。迭代至稳定；块边界/chunk 边界的边由墙封，跳过。
  //   并入 cell 的新边可能又弯曲 → 下一轮再查；弯曲集群有限，轮数小。
  const wFine = weldOut(table, src, weldFine);
  const out = new Uint8Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = wFine[i] | bevelOut[i];
  fineCache.set(table, out);
  return out;
}

/** 混合边偏离直线阈值（m）：低于此的折线/弦差不可见 */
const SLIT_EPS = 0.004;

/** weld fine 集 → 逐边扩张至无弯曲混合边 */
function weldOut(
  table: FaceTable,
  src: BlockSource,
  seed: Uint8Array,
): Uint8Array {
  const f = seed.slice();
  const N2 = N;
  const at = (lx: number, lz: number) =>
    lx >= 0 && lz >= 0 && lx < N2 && lz < N2 && f[lz * N2 + lx] === 1;
  // 视角块 = 共享边两侧 cell 的公共块（仅块内边才有公共块）
  const sameViewEdgeFine = (lx: number, lz: number, dir: number): boolean => {
    // dir 0/1 = 东/西邻（竖边），2/3 = 南/北邻（横边）
    if (dir === 0) return (lx + 1) % 4 !== 0 && at(lx + 1, lz);
    if (dir === 1) return lx % 4 !== 0 && at(lx - 1, lz);
    if (dir === 2) return (lz + 1) % 4 !== 0 && at(lx, lz + 1);
    return lz % 4 !== 0 && at(lx, lz - 1);
  };
  const edgeDeviation = (lx: number, lz: number, dir: number): number => {
    // 本 cell(coarse) 视角；共享边两 cell 同块 → 同视角
    const vbx = table.cx * BPS + Math.floor(lx / 4);
    const vbz = table.cz * BPS + Math.floor(lz / 4);
    const wx0 = table.cx * N2 + lx, wz0 = table.cz * N2 + lz;
    let ax: number, az: number, bx2: number, bz2: number;
    if (dir === 0) { ax = wx0 + 1; az = wz0; bx2 = wx0 + 1; bz2 = wz0 + 1; }
    else if (dir === 1) { ax = wx0; az = wz0; bx2 = wx0; bz2 = wz0 + 1; }
    else if (dir === 2) { ax = wx0; az = wz0 + 1; bx2 = wx0 + 1; bz2 = wz0 + 1; }
    else { ax = wx0; az = wz0; bx2 = wx0 + 1; bz2 = wz0; }
    const yA = topYView(table, src, vbx, vbz, ax, az);
    const yB = topYView(table, src, vbx, vbz, bx2, bz2);
    let worst = 0;
    for (let k = 1; k < FINE_S; k++) {
      const t = k / FINE_S;
      const yE = topYView(table, src, vbx, vbz,
        ax + (bx2 - ax) * t, az + (bz2 - az) * t);
      worst = Math.max(worst, Math.abs(yE - (yA + (yB - yA) * t)));
    }
    return worst;
  };
  for (let iter = 0; iter < 16; iter++) {
    let changed = false;
    for (let lz = 0; lz < N2; lz++) {
      for (let lx = 0; lx < N2; lx++) {
        if (at(lx, lz)) continue;
        for (let dir = 0; dir < 4; dir++) {
          if (!sameViewEdgeFine(lx, lz, dir)) continue;
          if (edgeDeviation(lx, lz, dir) > SLIT_EPS) {
            f[lz * N2 + lx] = 1;
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
  return f;
}

/**
 * ★ 侧壁沿边节点列取用的本块侧 fine 标记：dir 边沿 4 个 1m span，
 * 每个 span 对应一块本块侧 1m cell（该 cell 的边界段 = 顶网格边界折线段）。
 * dir0(+x)/dir1(-x) 沿 z → 本块侧 cell 列固定（lbx*4+3 / lbx*4），行随 span；
 * dir2(+z)/dir3(-z) 沿 x → 行固定（lbz*4+3 / lbz*4），列随 span。
 */
function dirEdgeCells(dir: number, lbx: number, lbz: number, fineE: Uint8Array): Uint8Array {
  const out = new Uint8Array(4);
  if (dir === 0 || dir === 1) {
    const lx = lbx * 4 + (dir === 0 ? 3 : 0);
    for (let j = 0; j < 4; j++) out[j] = fineE[(lbz * 4 + j) * N + lx];
  } else {
    const lz = lbz * 4 + (dir === 2 ? 3 : 0);
    for (let j = 0; j < 4; j++) out[j] = fineE[lz * N + lbx * 4 + j];
  }
  return out;
}

export function buildTopGeometry(
  table: FaceTable,
  src: BlockSource,
  deformAt?: (x: number, z: number) => number,
): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  const def = (wx: number, wz: number): number => (deformAt ? deformAt(wx, wz) : 0);
  let vi = 0;

  // ① fine 标记（bevel 带 + weld 坡脚/角脊 cell；已外扩 1 格保水密）
  const fineE = topFineCells(table, src);

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx, wz0 = oz + lz;
      const vbx = table.cx * BPS + Math.floor(lx / 4);
      const vbz = table.cz * BPS + Math.floor(lz / 4);
      const x0 = lx - HALF, z0 = lz - HALF;
      const base = vi;
      if (!fineE[lz * N + lx]) {
        // coarse：4 角
        const h00 = topYView(table, src, vbx, vbz, wx0, wz0) + def(wx0, wz0);
        const h10 = topYView(table, src, vbx, vbz, wx0 + 1, wz0) + def(wx0 + 1, wz0);
        const h11 = topYView(table, src, vbx, vbz, wx0 + 1, wz0 + 1) + def(wx0 + 1, wz0 + 1);
        const h01 = topYView(table, src, vbx, vbz, wx0, wz0 + 1) + def(wx0, wz0 + 1);
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
            yt[gy * G + gx] = topYView(table, src, vbx, vbz, wx, wz) + def(wx, wz);
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

export function buildWallGeometry(
  table: FaceTable,
  src: BlockSource,
  deformAt?: (x: number, z: number) => number,
): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const shd: number[] = [];
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  const def = (wx: number, wz: number): number => (deformAt ? deformAt(wx, wz) : 0);
  const fineE = topFineCells(table, src);
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
        const nbx = bx + DIRS[dir].dx;
        const nbz = bz + DIRS[dir].dz;
        // ★ 沿边节点列：按本块侧 4 个 1m cell 的 fine 标记定 0.125m/1m 步长。
        //   顶网格边界折线在 fine cell 上是 0.125m 折线、coarse cell 上是
        //   1m 直线 —— 壁顶沿取同一节点列 → 每段与顶网格边界段同端点，
        //   weld 坡脚/弧带处不再各自近似（否则壁顶低于网格边 = 开口）。
        const rowCells = dirEdgeCells(dir, lbx, lbz, fineE);
        const nodes: number[] = [];
        for (let span = 0; span < 4; span++) {
          const sub = rowCells[span] ? FINE_S : 1;
          for (let k = 0; k < sub; k++) nodes.push(span + k / sub);
        }
        nodes.push(4);
        const x0 = bx * 4, z0 = bz * 4;
        let ax: number, az: number, bx2: number, bz2: number;
        if (dir === 0) { ax = x0 + 4; az = z0; bx2 = x0 + 4; bz2 = z0 + 4; }
        else if (dir === 1) { ax = x0; az = z0; bx2 = x0; bz2 = z0 + 4; }
        else if (dir === 2) { ax = x0; az = z0 + 4; bx2 = x0 + 4; bz2 = z0 + 4; }
        else { ax = x0; az = z0; bx2 = x0 + 4; bz2 = z0; }
        const nrm = DIRS[dir];
        // 低侧基底（旧裙墙语义 lowBase = min(邻视觉顶, 两侧 hBase)）
        const nbH0 = src.blockAt(nbx, nbz)?.h ?? 0;
        const nbBase0 = src.blockAt(nbx, nbz)?.hBase ?? nbH0;
        const m = nodes.length;
        const topV = new Array<number>(m);
        const lowV = new Array<number>(m);
        const lxV = new Array<number>(m);
        const lzV = new Array<number>(m);
        for (let i = 0; i < m; i++) {
          const s = nodes[i];
          const gx = ax + (bx2 - ax) * (s / 4);
          const gz = az + (bz2 - az) * (s / 4);
          // 墙顶沿采样：视角 = 本墙所属块（bx,bz）——weld 边在坡顶棱 crest
          const top = topYView(table, src, bx, bz, gx, gz) + def(gx, gz);
          // 邻视角（节点 + 下一节点 max，供本段底沿用）
          const nx2 = i < m - 1 ? nodes[i + 1] : s;
          const nbTop = Math.max(
            surfaceHeightCore(src, nbx, nbz, gx, gz),
            surfaceHeightCore(src, nbx, nbz,
              ax + (bx2 - ax) * (nx2 / 4), az + (bz2 - az) * (nx2 / 4)),
          );
          topV[i] = top;
          lowV[i] = Math.min(nbTop, cell.hBase, nbBase0);
          lxV[i] = gx - ox - HALF;
          lzV[i] = gz - oz - HALF;
        }
        for (let i = 0; i < m - 1; i++) {
          // ★ 底 = 低侧基底 − EPS − 保底（埋入地下防破面）；
          //   weld 边全高：顶在坡顶棱 crest，底到低侧基底 → 坡面侧壁完整贴坡
          const botA = Math.min(topV[i], lowV[i] - WALL_EPS - WALL_MIN_DEPTH);
          const botB = Math.min(topV[i + 1], lowV[i + 1] - WALL_EPS - WALL_MIN_DEPTH);
          pos.push(lxV[i], topV[i], lzV[i], lxV[i + 1], topV[i + 1], lzV[i + 1],
            lxV[i + 1], botB, lzV[i + 1], lxV[i], botA, lzV[i]);
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
