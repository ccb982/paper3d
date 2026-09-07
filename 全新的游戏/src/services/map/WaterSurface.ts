// ============================================================
// WaterSurface —— 水体管线：静止基面几何（共享纯函数，Worker/主线程同源）
// ============================================================
// 语义（《水体管线架构.md》§2.1/§3.1；2026-09-07 挖掘联动）：
//   · 水位默认世界 y=0（用户定调）。地形成形后读一次 FaceTable：
//       水 mask = cell.topTileId === TILE_WATER.id
//       水深   = 0 − 地形顶高（cell.h，负）
//       坑水交界 = 水 cell 邻 pit → 沿共享边下落水帘（唇沿=本池水位，帘底=挖后坑床）
//   · ★ 挖掘联动（patch 传入时）：子弹命中后顶面被 patch 下挖，块 h 不变 → 本层
//     【连通池水位求解】保证水面处处不悬空：
//       ◆ 池粒度 = 4m 块（已验证稳定；浅滩 1m 干/湿存在"水位回落↔复淹"的
//         不一致，块级中心床判定避开该坑）。
//       ◆ ★ 边界接触采样 = 高密度（用户要求「向外采样 + 向下采样」，点距 <10cm）：
//         - 唇沿（平面→坡面交界）：对邻块整面做 5cm 步长 80×80 点阵（逐块缓存）
//           的「挖后地面最低点」→ 水面闭嘴到交界最低处，<10cm 尺度凹点不悬空；
//         - 幕帘底（平面→坑床）：复用该坑块 5cm 点阵，取「段 1m 切线 × 贴边
//           1m 进深带」最低点 → 帘脚真接地，深挖不浮；
//         - 平面深（向下的柱深）：逐 1m cell 3×3 采样挖后床面 → 水越挖越厚。
//       语义核心（用户拍板）：「如果水和坡面交界处降低了，那么水面就降低」
//       —— 整池水面整体下降到各邻交界唇的最低值；干出的块不铺平面/幕帘，
//         大坑可按 4m 连通性拆成多个小池。
//     no-patch 路径 = 全块默认水位 0 基线（回归锁定同公式）。
//   · 几何随地形 chunk 一体装配，渲染期由 WaterMaterial 做 LOD/动画。
//   · 顶点为 chunk 局部坐标（与顶面同约定 lx − HALF，原点=chunk 中心）。
// 本文件不 import three —— Worker 依赖最小（与 PatchCompute 同哲学）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { TILE_PIT, TILE_WATER } from "./Tiles";
import type { FaceTable } from "./FaceTable";
import {
  baseHeightOf,
  surfaceHeightCore,
  type BlockSource,
} from "./Refinements";
import type { PatchOverlay } from "./FaceBuild";

const BPS = BLOCKS_PER_SIDE; // 15
const N = CHUNK_SIZE;        // 60
const HALF = CHUNK_SIZE / 2; // 30（几何局部坐标中心化，与 FaceBuild 同约定）
/** 水深钳制上限（着色器归一用；m） */
export const WATER_MAX_DEEP = 6;
/** 水帘贴墙内收（m，避坑侧壁 z-fight）；水面沿坑边外延同值，盖过幕布唇沿防交缝 */
const FALL_INSET = 0.1;
/** 水帘最小落差（m；过浅不生成） */
const FALL_MIN = 0.2;
/** 平面剔除容差：水块地形顶高于 0+ε 视为干地，不铺水面 */
const PLANE_Y_EPS = 0.05;
/** 边界向下采样间距（m；硬要求 <10cm → 取 5cm；4m 块 = 80×80 点阵，逐块缓存一次） */
const LIP_STRIDE = 0.05;
/** 平面向下柱深采样：1m cell 内 3×3 点阵（{0.25,0.5,0.75} 偏移） */
const CELL_BED_OFFSETS = [0.25, 0.5, 0.75];
/** 幕帘脚向坑内进深的贴边带（m，0.05 步长采样到该深度；水沿挖坡下行即止于此） */
const CURTAIN_REACH = 1.0;
/** 幕帘 / 唇沿 向下采样网格尺寸（= 4m / 0.05m） */
const BED_GRID = Math.round(4 / LIP_STRIDE);

/** 水顶点方向常量 */
const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;
/** 各向期望外法线（WaterSurface 产出；顶点序反推用） */
const DIR_NORMALS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface WaterSurfaceRaw {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 逐顶点：平面 = 水深（0..WATER_MAX_DEEP）；水帘 = -1 / 斜边 = -3 哨兵 */
  deep: Float32Array;
  /** 逐顶点旋转参数(angularSpeed, phase)：标准水全 0；boss4D 水幕 = 4D 自转/漂浮 */
  spin: Float32Array;
  indices: Uint32Array;
  /** 诊断：平面 quad 数 + 水帘 quad 数 */
  quads: number;
}

/** 世界 4m 块坐标 key（整数合成，非负；池解粒度 = 4m 块） */
function blockKey(bx: number, bz: number): number {
  return (bx + 4096) * 8192 + (bz + 4096);
}
function blockX(k: number): number {
  return Math.floor(k / 8192) - 4096;
}
function blockZ(k: number): number {
  return (k % 8192) - 4096;
}

/**
 * 给定 chunk 表 → 静止基面几何字节（局部坐标；无水位/起伏，起伏由 shader 做）。
 * @param table  该 chunk 的 FaceTable（Pass1 已定型：topTileId/h）
 * @param src    邻域源（跨 chunk 边判 pit 邻接用）
 * @param patch  可选：子弹命中补丁覆盖层。传入时做「连通池水位求解」+ 高密度
 *               边界接触采样（唇对外+向下、幕帘底对坑内+向下）；缺省 = 基线。
 */
export function buildWaterSurface(
  table: FaceTable,
  src: BlockSource,
  patch?: PatchOverlay,
): WaterSurfaceRaw {
  const { cx, cz } = table;
  const verts: number[] = [];
  const nors: number[] = [];
  const uvs: number[] = [];
  const deps: number[] = [];
  const idx: number[] = [];
  let quads = 0;
  const CH = CHUNK_SIZE;

  // ============ 0) 池水位求解（块级；无 patch = 全块基线 0 = 0−h） ============
  // occ: 世界 4m 水块 → { level(平面高), deep(水深，clamp 0..MAX) }
  const occ = new Map<number, { level: number; deep: number }>();
  const digTop = (bx: number, bz: number, x: number, z: number): number =>
    surfaceHeightCore(src, bx, bz, x, z) - (patch ? patch.depthOf(x, z) : 0);
  /** 块中心床面（挖后；干湿判定 + 池 deep 基准） */
  const bedOf = (bx: number, bz: number): number =>
    digTop(bx, bz, bx * 4 + 2, bz * 4 + 2);
  /** 1m cell 的向下床底面最低点（挖后；{0.25,0.5,0.75} 3×3 采样 → 柱深/干湿用） */
  const cellBedMin = (wx: number, wz: number): number => {
    let m = Infinity;
    for (const a of CELL_BED_OFFSETS) {
      for (const b of CELL_BED_OFFSETS) {
        const h = digTop(Math.floor(wx / 4), Math.floor(wz / 4), wx + a, wz + b);
        if (h < m) m = h;
      }
    }
    return m;
  };
  /** 按块缓存的 5cm 挖后床面点阵（80×80；patch 期"边界向下采样"的唯一数据源，
   *  每块只算一次，多次 settle 迭代 / 多条幕帘段共用） */
  const bedGrids = new Map<number, Float32Array>();
  const bedGridAt = (bx: number, bz: number): Float32Array => {
    const key = blockKey(bx, bz);
    let g = bedGrids.get(key);
    if (!g) {
      g = new Float32Array(BED_GRID * BED_GRID);
      for (let i = 0; i < BED_GRID; i++) {
        for (let j = 0; j < BED_GRID; j++) {
          g[i * BED_GRID + j] = digTop(bx, bz, bx * 4 + (i + 0.5) * LIP_STRIDE, bz * 4 + (j + 0.5) * LIP_STRIDE);
        }
      }
      bedGrids.set(key, g);
    }
    return g;
  };
  const bedMins = new Map<number, number>();
  const blockBedMin = (bx: number, bz: number): number => {
    const key = blockKey(bx, bz);
    let m = bedMins.get(key);
    if (m === undefined) {
      const g = bedGridAt(bx, bz);
      let mm = Infinity;
      for (let k = 0; k < BED_GRID * BED_GRID; k++) {
        const h = g[k];
        if (h < mm) mm = h;
      }
      bedMins.set(key, mm);
      m = mm;
    }
    return m;
  };

  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const depth = 0 - cell.h;
      if (depth < -PLANE_Y_EPS) continue; // 干地防穿面
      const key = blockKey(cx * BPS + lbx, cz * BPS + lbz);
      if (!occ.has(key))
        occ.set(key, { level: 0, deep: Math.min(Math.max(depth, 0), WATER_MAX_DEEP) });
    }
  }

  if (occ.size > 0 && patch) {
    // ---- ★ 唇高 = 邻(非水/非pit)块整面「挖后地面最低点」（对外+向下，5cm 点阵逐块缓存） ----
    const lipOf = (bx: number, bz: number, dir: number): number => {
      const NX = bx + DIR4[dir].dx, NZ = bz + DIR4[dir].dz;
      const nb = src.blockAt(NX, NZ);
      if (!nb) return Infinity;                 // 邻缺数据 → 不约束（防整池误泄）
      if (nb.id === TILE_PIT.id) return Infinity; // 坑 = 幕帘承接，不约束平面
      if (nb.id === TILE_WATER.id) return Infinity; // 水-水连通由池 BFS 承接（防把邻池床当唇）
      // 整面 5cm 点阵最低点 = 交界闭唇点：任何 <10cm 尺度的凹点水面都不悬空
      return blockBedMin(NX, NZ);
    };
    // 递归安定：把块集拆成连通子池，逐池求 L=min(0,各块唇min)，干块(床≥L)摘除再拆
    const settle = (keys: Set<number>): void => {
      for (;;) {
        let L = 0;
        for (const k of keys) {
          const bx = blockX(k), bz = blockZ(k);
          for (let dir = 0; dir < 4; dir++) {
            const lip = lipOf(bx, bz, dir);
            if (lip < L) L = lip;
          }
        }
        const dried: number[] = [];
        for (const k of keys) {
          if (bedOf(blockX(k), blockZ(k)) >= L - 1e-3) dried.push(k);
        }
        if (dried.length === 0) {
          for (const k of keys) {
            const o = occ.get(k)!;
            o.level = L;
            o.deep = Math.min(Math.max(L - bedOf(blockX(k), blockZ(k)), 0), WATER_MAX_DEEP);
          }
          return;
        }
        const live = new Set<number>(keys);
        for (const k of dried) {
          live.delete(k);
          occ.delete(k); // 干块摘除：不铺平面/幕帘 → 暴露为干地
        }
        if (live.size === 0) return;
        const visited = new Set<number>();
        for (const seed of live) {
          if (visited.has(seed)) continue;
          const sub = new Set<number>();
          const stack = [seed];
          visited.add(seed);
          while (stack.length > 0) {
            const k = stack.pop()!;
            sub.add(k);
            const bx = blockX(k), bz = blockZ(k);
            for (let dir = 0; dir < 4; dir++) {
              const nk = blockKey(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
              if (live.has(nk) && !visited.has(nk)) {
                visited.add(nk);
                stack.push(nk);
              }
            }
          }
          settle(sub); // 大池按 4m 连通性拆小池 → 各自安定
        }
        return;
      }
    };
    settle(new Set(occ.keys()));
  }

  // ============ ① 水面平面：单一索引网格（四角顶点跨格共用；透明 AA 无缝） ============
  //    no-patch：顶点 y=0，deep=max(邻块)。patch：y=池水位，key 含水位（跨池不混点）。
  const filled = new Uint8Array((N + 1) * (N + 1));
  const cX = new Map<number, number>();
  const cZ = new Map<number, number>();
  const PIT_INC = FALL_INSET;
  for (let lz = 0; lz < N; lz++) {
    const lbz = lz >> 2;
    for (let lx = 0; lx < N; lx++) {
      const cell = table.cells[lbz * BPS + (lx >> 2)];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const lbx = lx >> 2;
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const o = occ.get(blockKey(bx, bz));
      if (!o) continue; // 干块（patch 拆池）→ 不铺平面
      filled[lz * (N + 1) + lx] = 1;
      const isPit = (dx: number, dz: number): boolean => {
        const b = src.blockAt(bx + dx, bz + dz);
        return !!b && b.id === TILE_PIT.id;
      };
      const pushDisp = (k: number, dx: number, dz: number) => {
        const ox = cX.get(k) ?? 0, oz = cZ.get(k) ?? 0;
        if (dx !== 0) cX.set(k, ox !== 0 && Math.sign(ox) === Math.sign(dx) ? ox : ox + dx);
        if (dz !== 0) cZ.set(k, oz !== 0 && Math.sign(oz) === Math.sign(dz) ? oz : oz + dz);
      };
      const pitDisp = (x: number, z: number, dx: number, dz: number) =>
        pushDisp(x * 128 + z, dx, dz);
      // ★ 坑邻边外延 FALL_INSET：水面顶到幕帘顶，避免"水纹理与幕墙间隔"
      if (isPit(1, 0)) { pitDisp(lx + 1, lz, PIT_INC, 0); pitDisp(lx + 1, lz + 1, PIT_INC, 0); }
      if (isPit(-1, 0)) { pitDisp(lx, lz, -PIT_INC, 0); pitDisp(lx, lz + 1, -PIT_INC, 0); }
      if (isPit(0, 1)) { pitDisp(lx, lz + 1, 0, PIT_INC); pitDisp(lx + 1, lz + 1, 0, PIT_INC); }
      if (isPit(0, -1)) { pitDisp(lx, lz, 0, -PIT_INC); pitDisp(lx + 1, lz, 0, -PIT_INC); }
    }
  }
  const cornerOf = new Map<number, number>();
  const cornerKey = (x: number, z: number, level: number): number =>
    patch ? x * 262144 + z * 64 + Math.round((level + 4) * 512) : x * 128 + z;
  const vertexAt = (x: number, z: number, level: number): number => {
    const k = cornerKey(x, z, level);
    let vi = cornerOf.get(k);
    if (vi === undefined) {
      vi = verts.length / 3;
      cornerOf.set(k, vi);
      verts.push(x - HALF + (cX.get(x * 128 + z) ?? 0), level, z - HALF + (cZ.get(x * 128 + z) ?? 0));
      nors.push(0, 1, 0);
      uvs.push(x / N, z / N);
      // 角深（向下的柱深，1m cell 级 3×3 采样聚合；无 patch = 块级 occ deep 基线）
      let dmax = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const ccx = x + dx, ccz = z + dz;
        if (ccx < 0 || ccz < 0 || ccx >= N || ccz >= N) continue;
        const wx = cx * CH + ccx, wz = cz * CH + ccz;
        const o = occ.get(blockKey(cx * BPS + (ccx >> 2), cz * BPS + (ccz >> 2)));
        if (!o || Math.abs(o.level - level) >= 1e-4) continue;
        const d = patch
          ? Math.min(Math.max(level - cellBedMin(wx, wz), 0), WATER_MAX_DEEP)
          : o.deep;
        if (d > dmax) dmax = d;
      }
      deps.push(dmax);
    }
    return vi;
  };
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!filled[lz * (N + 1) + lx]) continue;
      const o = occ.get(blockKey(cx * BPS + (lx >> 2), cz * BPS + (lz >> 2)))!;
      const level = o.level;
      const a = vertexAt(lx, lz, level), b = vertexAt(lx + 1, lz, level),
        c = vertexAt(lx + 1, lz + 1, level), d = vertexAt(lx, lz + 1, level);
      idx.push(a, d, b, b, d, c); // +Y 外法线（a→d→b / b→d→c）
      quads++;
    }
  }

  // ============ ② 坑水交界 —— 下落水帘（4m 整边一条；patch 时帘脚 5cm 采样接挖后坑床） ============
  for (let lbz = 0; lbz < BPS; lbz++) {
    const z0 = lbz * 4 - HALF;              // 块局部 z 起点
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const o = occ.get(blockKey(bx, bz));
      if (!o) continue; // 干块 → 无幕帘
      const x0 = lbx * 4 - HALF;            // 块局部 x 起点
      for (let dir = 0; dir < 4; dir++) {
        const dx = DIR4[dir].dx, dz = DIR4[dir].dz;
        const n = src.blockAt(bx + dx, bz + dz);
        if (!n || n.id !== TILE_PIT.id) continue;
        const want = DIR_NORMALS[dir];
        const lipY = o.level; // 唇沿 = 本池水位（patch 已下沉）
        // ★ 挖后坑床（向外+向下，5cm 点阵缓存复用）：整条 4m 边切线 × 贴边 1m 进深带 → 最低点接地
        let botY = baseHeightOf(n);
        if (patch) {
          const g = bedGridAt(bx + dx, bz + dz);
          const reachRows = Math.round(CURTAIN_REACH / LIP_STRIDE); // 20
          // 进深行：+x/+z 从坑口向坑内 0→reach；-x/-z 从坑口(块内 4m 边)向坑内 4→(4-reach)
          const rFrom = dx === -1 || dz === -1 ? BED_GRID - reachRows : 0;
          for (let r = rFrom; r < rFrom + reachRows; r++) {
            for (let c = 0; c < BED_GRID; c++) { // 整条 4m 边全部切线列
              const k = dir === 0 || dir === 1 ? r * BED_GRID + c : c * BED_GRID + r;
              const h = g[k];
              if (h < botY) botY = h;
            }
          }
        }
        const fallLen = lipY - botY;
        if (fallLen < FALL_MIN) continue; // 落差过浅不生成（连斜边也不出）

        // 壁轴与切线（整条 4m 边）
        const axisX = dir === 0 || dir === 1;
        const fixed = axisX
          ? (dir === 0 ? x0 + 4 + FALL_INSET : x0 - FALL_INSET)
          : (dir === 2 ? z0 + 4 + FALL_INSET : z0 - FALL_INSET);
        const rev = dir === 1 || dir === 3;
        const pt = (t: number, y: number): [number, number, number] => {
          const u = rev ? 1 - t : t;
          return axisX ? [fixed, y, z0 + u * 4] : [x0 + u * 4, y, fixed];
        };
        const a = pt(0, botY), b = pt(0, lipY), c = pt(1, lipY), d = pt(1, botY);
        // 校验/修正绕序：外法线 = cross(b−a, c−a)；不符则翻面
        const ax0 = a[0], az0 = a[2];
        const dx1 = b[0] - ax0, dy1 = b[1] - a[1], dz1 = b[2] - az0;
        const dx2 = c[0] - ax0, dy2 = c[1] - a[1], dz2 = c[2] - az0;
        const nx = dy1 * dz2 - dz1 * dy2;
        const ny = dz1 * dx2 - dx1 * dz2;
        const nz = dx1 * dy2 - dy1 * dx2;
        const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
        const pts = flip ? [a, d, c, b] : [a, b, c, d];
        const vi = verts.length / 3;
        for (let k = 0; k < 4; k++) {
          const [px, py, pz] = pts[k];
          verts.push(px, py, pz);
          nors.push(want[0], want[1], want[2]);
          // uv：x = 沿帘切线 0..1（整条边归一）；y = 落差 0(唇)..1(坑底)
          const tU = axisX ? (pz - z0) / 4 : (px - x0) / 4;
          uvs.push(tU, (lipY - py) / fallLen);
          deps.push(-1);
        }
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        quads++;
        // ★ 保护性斜边（仅 patch 时；罩住 90° 交界深缝，唇沿向水侧倒 45°；整条边一条）
        if (patch) {
          const ROOF = 0.14;
          const ROOF_DROP = 0.2; // 斜边下探：稳定覆盖水面波动全程（波幅约 ±0.09）
          const wnx = -dx, wnz = -dz; // 水侧法向 = 坑反方向
          const tA = pt(0, lipY), tB = pt(1, lipY); // 唇沿两角（y=lipY）
          const r0: [number, number, number] = [tA[0] + wnx * ROOF, lipY - ROOF_DROP, tA[2] + wnz * ROOF];
          const r1: [number, number, number] = [tB[0] + wnx * ROOF, lipY - ROOF_DROP, tB[2] + wnz * ROOF];
          // 法向：低 N.y（<0.5 → fragment 走幕布分支，唇沿水色）；略偏水侧
          const rn: [number, number, number] = [wnx * 0.7, 0.3, wnz * 0.7];
          const rp0: [number, number, number] = tA;
          const rp1: [number, number, number] = r0;
          const rp2: [number, number, number] = r1;
          const rp3: [number, number, number] = tB;
          const rax = rp0[0], raz = rp0[2];
          const rv1 = [rp1[0] - rax, rp1[1] - rp0[1], rp1[2] - raz];
          const rv2 = [rp2[0] - rax, rp2[1] - rp0[1], rp2[2] - raz];
          const rnx = rv1[1] * rv2[2] - rv1[2] * rv2[1];
          const rny = rv1[2] * rv2[0] - rv1[0] * rv2[2];
          const rnz = rv1[0] * rv2[1] - rv1[1] * rv2[0];
          const roofPts = [rp0, rp1, rp2, rp3];
          if (rnx * rn[0] + rny * rn[1] + rnz * rn[2] < 0) roofPts.reverse();
          const rvi = verts.length / 3;
          for (let k = 0; k < 4; k++) {
            const [px, py, pz] = roofPts[k];
            verts.push(px, py, pz);
            nors.push(rn[0], rn[1], rn[2]);
            uvs.push(0.5, 0.0); // uv.y=0 → 唇沿水色
            deps.push(-3);      // 斜边哨兵：fragment 用极浅 alpha 遮缝
          }
          idx.push(rvi, rvi + 1, rvi + 2, rvi, rvi + 2, rvi + 3);
          quads++;
        }
      }
    }
  }

  return {
    vertices: Float32Array.from(verts),
    normals: Float32Array.from(nors),
    uvs: Float32Array.from(uvs),
    deep: Float32Array.from(deps),
    spin: new Float32Array((verts.length / 3) * 2), // 标准水静止 → 旋速/相位全 0
    indices: Uint32Array.from(idx),
    quads,
  };
}