// ============================================================
// WaterSurface —— 水体管线：静止基面几何（共享纯函数，Worker/主线程同源）
// ============================================================
// 语义（《水体管线架构.md》§2.1/§3.1；2026-09-07 挖掘联动）：
//   · 水位默认世界 y=0（用户定调）。地形成形后读一次 FaceTable：
//       水 mask = cell.topTileId === TILE_WATER.id
//       水深   = 0 − 地形顶高（cell.h，负）
//       坑水交界 = 水 cell 邻 pit → 沿共享边下落水帘（唇沿=本池水位，帘底=坑床 dug 后）
//   · ★ 挖掘联动（patch 传入时）：子弹命中后顶面被 patch 下挖，块 h 不变 → 本层
//     在【含 patch】时做「连通池水位求解」，保证水面处处不悬空：
//       1) 每池水位 = min(0, 四周非水非坑邻的挖后地面唇高) —— 水面歇在最低唇，不悬空；
//       2) 某水块床面（挖后）高于本池水位 → 变干暴露 → 不铺平面/幕帘 → 大坑拆成小坑；
//       3) 幕帘底延伸到挖后的新坑/新床底，lip 跟本池水位下降。
//     no-patch 路径逐字节不变（回归基线锁定）。
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
/** 挖后水位求解：唇高采样距共享边的探入量（m，落在邻块地面在边界后 0.5/1m 的挖深带） */
const LIP_INSET = [0.5, 1.0] as const;

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

/** 世界块坐标 key（整数合成，非负） */
function blockKey(bx: number, bz: number): number {
  // bx/bz 可负 → 平移保正：世界块坐标上限 *64（取 64 格 → 足够大且不溢出 int 数组 key）
  return (bx + 512) * 1024 + (bz + 512);
}
function keyBx(k: number): number {
  return Math.floor(k / 1024) - 512;
}
function keyBz(k: number): number {
  return (k % 1024) - 512;
}

/** 共享边两端点（世界米格坐标；block(bx,bz) 视角 dir 方向的边） */
function edgeEndpoints(bx: number, bz: number, dir: number): [number, number][] {
  const x0 = bx * 4, z0 = bz * 4;
  if (dir === 0) return [[x0 + 4, z0], [x0 + 4, z0 + 4]];
  if (dir === 1) return [[x0, z0], [x0, z0 + 4]];
  if (dir === 2) return [[x0, z0 + 4], [x0 + 4, z0 + 4]];
  return [[x0, z0], [x0 + 4, z0]];
}

/**
 * 给定 chunk 表 → 静止基面几何字节（局部坐标；无水位/起伏，起伏由 shader 做）。
 * @param table  该 chunk 的 FaceTable（Pass1 已定型：topTileId/h）
 * @param src    邻域源（跨 chunk 边判 pit 邻接用）
 * @param patch  可选：子弹命中补丁覆盖层。传入时对含 water 的命中区做「连通池水位
 *               求解」（水面下沉不悬空 / 高床拆池 / 幕帘接地）；缺省 = 静态基线。
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

  // ============ 0) 水位求解（仅含 patch 时；no-patch → 每块 level=0/deep=0−h 基线） ============
  // occ: world block → { level(平面高), deep(水深，clamp 0..MAX) }
  const occ = new Map<number, { level: number; deep: number }>();
  const digTop = (bx: number, bz: number, x: number, z: number): number =>
    surfaceHeightCore(src, bx, bz, x, z) - (patch ? patch.depthOf(x, z) : 0);
  const center = (bx: number, bz: number) => [bx * 4 + 2, bz * 4 + 2] as const;

  // 收口：本 chunk 内所有合法水块（基线帧塞默认 occ）
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const depth = 0 - cell.h;
      if (depth < -PLANE_Y_EPS) continue; // 干地防穿面
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const bk = blockKey(bx, bz);
      if (!occ.has(bk))
        occ.set(bk, {
          level: 0,
          deep: Math.min(Math.max(depth, 0), WATER_MAX_DEEP),
        });
    }
  }

  if (occ.size > 0 && patch) {
    // ---- 唇高：水块朝 dir 邻块(非pit)的挖后地面，取共享边后 0.5/1m 带 + 邻块中心的 min ----
    const lipOf = (bx: number, bz: number, dir: number): number => {
      const tx = bx + DIR4[dir].dx, tz = bz + DIR4[dir].dz;
      const nb = src.blockAt(tx, tz);
      if (!nb) return Infinity;      // 邻缺数据 → 不约束（防整池误泄）
      if (nb.id === TILE_PIT.id) return Infinity; // 坑 = 幕帘承接，不约束平面
      if (nb.id === TILE_WATER.id) return Infinity; // 水-水连通由池 BFS 承接，不把邻池床面当唇（防整池误泄）
      let m = Infinity;
      const check = (x: number, z: number) => {
        const v = digTop(tx, tz, x, z);
        if (v < m) m = v;
      };
      const [cex, cez] = center(tx, tz);
      check(cex, cez);
      for (const [ex, ez] of edgeEndpoints(bx, bz, dir)) {
        for (const s of LIP_INSET) check(ex + DIR4[dir].dx * s, ez + DIR4[dir].dz * s);
      }
      return m;
    };
    // 递归安定：把块集拆成连通子池，逐池求 L=min(0,各块唇min)，干块(床≥L)摘除再拆
    const settle = (keys: Set<number>): void => {
      for (;;) {
        let L = 0;
        for (const k of keys) {
          const bx = keyBx(k), bz = keyBz(k);
          for (let dir = 0; dir < 4; dir++) {
            const lip = lipOf(bx, bz, dir);
            if (lip < L) L = lip;
          }
        }
        const dried: number[] = [];
        for (const k of keys) {
          const bx = keyBx(k), bz = keyBz(k);
          const bed = digTop(bx, bz, bx * 4 + 2, bz * 4 + 2);
          if (bed >= L - 1e-3) dried.push(k); // 床高于水位 → 干暴露
        }
        if (dried.length === 0) {
          for (const k of keys) {
            const bx = keyBx(k), bz = keyBz(k);
            const bed = digTop(bx, bz, bx * 4 + 2, bz * 4 + 2);
            const o = occ.get(k)!;
            o.level = L;
            o.deep = Math.min(Math.max(L - bed, 0), WATER_MAX_DEEP);
          }
          return;
        }
        // 摘除干块后按 4 邻连通性重新分池 → 各自安定（大坑拆小坑）
        const live = new Set<number>(keys);
        for (const k of dried) {
          live.delete(k);
          occ.delete(k); // 干块彻底摘除：不铺平面/幕帘 → 暴露为干地
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
            const bx = keyBx(k), bz = keyBz(k);
            for (let dir = 0; dir < 4; dir++) {
              const nk = blockKey(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
              if (live.has(nk) && !visited.has(nk)) {
                visited.add(nk);
                stack.push(nk);
              }
            }
          }
          settle(sub);
        }
        return;
      }
    };
    settle(new Set(occ.keys()));
  }

  // 常量（避每次循环重建）
  // ---- ① 水面平面：单一索引网格（四角顶点跨格共用；杜绝逐 quad 独立顶点 → 透明 AA 缝） ----
  //    no-patch：顶点 y=waterLevel(0)，deep=cD(max)。patch：y=池水位，key 含水位（池间不混点）。
  const filled = new Uint8Array((N + 1) * (N + 1));
  const cX = new Map<number, number>();
  const cZ = new Map<number, number>();
  const PIT_INC = FALL_INSET;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const lbx = lx >> 2;      // 4m 块内局部列
      const lbz = lz >> 2;
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
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
      // 角深：取触及该角、同池水位的水块 deep 的 max
      let dmax = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const ccx = Math.floor((x + dx) / 4), ccz = Math.floor((z + dz) / 4);
        if (x + dx < 0 || z + dz < 0 || x + dx > N || z + dz > N) continue;
        const o = occ.get(blockKey(cx * BPS + ccx, cz * BPS + ccz));
        if (o && Math.abs(o.level - level) < 1e-4 && o.deep > dmax) dmax = o.deep;
      }
      deps.push(dmax);
    }
    return vi;
  };
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!filled[lz * (N + 1) + lx]) continue;
      const lbx = lx >> 2, lbz = lz >> 2;
      const o = occ.get(blockKey(cx * BPS + lbx, cz * BPS + lbz))!;
      const level = o.level;
      const a = vertexAt(lx, lz, level), b = vertexAt(lx + 1, lz, level),
        c = vertexAt(lx + 1, lz + 1, level), d = vertexAt(lx, lz + 1, level);
      idx.push(a, d, b, b, d, c); // +Y 外法线（a→d→b / b→d→c）
      quads++;
    }
  }

  // ---- ② 坑水交界 —— 下落水帘（水块沿 pit 邻边，池水位 → 挖后坑床） ----
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      const o = occ.get(blockKey(bx, bz));
      if (!o) continue; // 干块 → 无幕帘
      const x0 = lbx * 4 - HALF, x1 = lbx * 4 + 4 - HALF;
      const z0 = lbz * 4 - HALF, z1 = lbz * 4 + 4 - HALF;
      for (let dir = 0; dir < 4; dir++) {
        const dx = DIR4[dir].dx, dz = DIR4[dir].dz;
        const n = src.blockAt(bx + dx, bz + dz);
        if (!n || n.id !== TILE_PIT.id) continue;
        const lipY = o.level;     // 唇沿 = 本池水位（patch 可能已下沉）
        let botY = baseHeightOf(n); // 帘底基线 = 坑块面板底
        if (patch) {
          for (const [ex, ez] of edgeEndpoints(bx, bz, dir)) {
            botY = Math.min(botY, digTop(bx + dx, bz + dz, ex, ez)); // 挖后坑床
          }
        }
        const fallLen = lipY - botY;
        if (fallLen < FALL_MIN) continue; // 落差过浅不生成
        // 四角（顶点序 [a bottom-start, b top-start, c top-end, d bottom-end]；统一 [x, 高度, z]）
        let pts: [number, number, number][];
        if (dir === 0)   pts = [[x1 + FALL_INSET, botY, z0], [x1 + FALL_INSET, lipY, z0], [x1 + FALL_INSET, lipY, z1], [x1 + FALL_INSET, botY, z1]];
        else if (dir === 1) pts = [[x0 - FALL_INSET, botY, z1], [x0 - FALL_INSET, lipY, z1], [x0 - FALL_INSET, lipY, z0], [x0 - FALL_INSET, botY, z0]];
        else if (dir === 2) pts = [[x1, botY, z1 + FALL_INSET], [x1, lipY, z1 + FALL_INSET], [x0, lipY, z1 + FALL_INSET], [x0, botY, z1 + FALL_INSET]];
        else                pts = [[x0, botY, z0 - FALL_INSET], [x0, lipY, z0 - FALL_INSET], [x1, lipY, z0 - FALL_INSET], [x1, botY, z0 - FALL_INSET]];
        const want = DIR_NORMALS[dir];
        // 校验/修正绕序：外法线 = cross(b−a, c−a)；不符则翻面
        const ax = pts[0][0], az = pts[0][2];
        const dx1 = pts[1][0] - ax, dy1 = pts[1][1] - pts[0][1], dz1 = pts[1][2] - az;
        const dx2 = pts[2][0] - ax, dy2 = pts[2][1] - pts[0][1], dz2 = pts[2][2] - az;
        const nx = dy1 * dz2 - dz1 * dy2;
        const ny = dz1 * dx2 - dx1 * dz2;
        const nz = dx1 * dy2 - dy1 * dx2;
        const flip =
          (nx * want[0] + ny * want[1] + nz * want[2]) < 0;
        if (flip) pts = [pts[0], pts[3], pts[2], pts[1]]; // 翻转绕序（a,d,c,b）
        const vi = verts.length / 3;
        for (let k = 0; k < 4; k++) {
          const [px, py, pz] = pts[k];
          verts.push(px, py, pz);
          nors.push(want[0], want[1], want[2]);
          // uv：x = 沿帘切线 0..1；y = 落差 0(唇)..1(坑底)
          const u = dir === 0 || dir === 1 ? (pz - z0) / 4 : (px - x0) / 4;
          uvs.push(u, (lipY - py) / fallLen);
          deps.push(-1);
        }
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        quads++;
        // ★ 保护性斜边：幕布唇沿顶向水面侧倒 45° 斜坡，覆盖 90° 交界深缝
        //   唇沿两角(b,c 在 y=lipY) 向外(水侧)下压 edgeH，构成坡面
        const ROOF = 0.14;
        const ROOF_DROP = 0.2; // 斜边下探：稳定覆盖水面波动全程（波幅约 ±0.09）
        const wx = -DIR4[dir].dx, wz = -DIR4[dir].dz; // 水侧法向 = 坑反方向
        const lipA: [number, number, number][] = [pts[1], pts[2]]; // 唇沿两角（y=lipY）
        const r0: [number, number, number] = [lipA[0][0] + wx * ROOF, lipA[0][1] - ROOF_DROP, lipA[0][2] + wz * ROOF];
        const r1: [number, number, number] = [lipA[1][0] + wx * ROOF, lipA[1][1] - ROOF_DROP, lipA[1][2] + wz * ROOF];
        // 法向：低 N.y（<0.5 → fragment 走幕布分支，唇沿水色）；略偏水侧
        const rn: [number, number, number] = [wx * 0.7, 0.3, wz * 0.7];
        const rp0: [number, number, number] = [lipA[0][0], lipA[0][1], lipA[0][2]];
        const rp1: [number, number, number] = r0;
        const rp2: [number, number, number] = r1;
        const rp3: [number, number, number] = [lipA[1][0], lipA[1][1], lipA[1][2]];
        // 绕序校验：cross(b−a, c−a) · 期望法向 > 0
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