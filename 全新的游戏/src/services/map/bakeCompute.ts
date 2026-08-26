// ============================================================
// bakeCompute —— 双纹理烘焙纯计算核心（零 three 依赖，Worker 可用）
// ============================================================
// 从 ChunkAppearance 拆出的像素计算层（2026-08-26 Worker 化）：
//   - computeChunkMapsRGBA：albedo + lightmap 像素计算（纯函数，
//     输出可 transfer 的 RGBA 缓冲，主线程只做 canvas 组装）
//   - buildSnapshotFromChunks / makeSnapshotSource：主线程拷贝
//     chunk 原始数组 → Worker 内重构查询源（与 RasterMap 同公式，逐位一致）
//
// ★★ 采样统一（2026-08-26 定稿）：
//   烘焙只消费「视觉面」surfaceHeightAt（顶点值 = 整数格点周围
//   2×2 格取 max；面内 = 三角形插值 = PlaneGeometry 真实剖分，
//   Raycaster 实测逐位一致）——与网格位移、角色贴地、影子贴地完全同源。
//   双线性在斜坡过渡带（非平面格）偏差可达米级，禁止回退。
//   旧的块状 heightAt（4m 恒定）仅剩 Boss4D 单纹理旧路径使用。
//   由此修复：斜坡/台缘处烘焙阴影与可见地表的轻微错位。
//
// 快照协议（为什么拷原始数组而不是逐点查询）：
//   RasterMap.surfaceHeightAt 单次 ≈ 16 次 heightAt；一张快照若逐点
//   提取需 ~17 万次调用。改拷 3×3 chunk 的 heights/blockTypes 原始数组
//   （~150KB 内存拷贝），主线程亚毫秒，Worker 端 O(1) 重建同一语义。
//   未加载 chunk 高度记 0——与 RasterMap.heightAt 未加载回退一致。
// ============================================================

import {
  CHUNK_SIZE, BLOCK_SIZE, BLOCKS_PER_SIDE, hash2,
} from './ChunkGenerator';
import { vnoise } from './TerrainNoise';
import { hsl2rgb } from './TerrainPalette';
import { tileById, type TileDef } from './Tiles';
import { regionParamsAt, SEMANTIC_THEME_MIX } from './RegionTheme';
import { applyDecalStamps, type PlannedDecal } from './TileDecals';

// ============================================================
// 查询源接口（新路径唯一消费面——只有视觉面采样，无块状 heightAt）
// ============================================================
export interface BakeQuery {
  /** 世界种子（烘焙噪声用；同 seed 同地形 → 输出逐字节一致） */
  readonly worldSeed: number;
  /** 视觉面采样（与网格渲染/角色贴地同源，见文件头采样统一） */
  surfaceHeightAt(x: number, z: number): number;
  /** 地块定义（颜色/凹陷标志等外观属性） */
  tileDefAt(x: number, z: number): TileDef;
}

/** 外观分辨率（默认 256²；低端机降 128²） */
export const APPEARANCE_RES = 256;

// ---- AO 参数（环境尺度；压暗下限防死黑。旧路径共用）----
export const AO_RADIUS = 2.5;
export const AO_STRENGTH = 0.09;
export const AO_MIN = 0.55;
// ---- 光照图参数 ----
/** 光照图分辨率（阴影/AO 是低频信息，半分辨率足够） */
const LIGHT_RES = 128;

/** 烘焙太阳（美术定光源；hx/hz=指向太阳的水平单位向量，tan=射线爬升率）。
 *  ★ 主光必须在【相机后上方】（默认 yaw=0 → 相机在 +z 侧看 -z）：
 *    影子拖向 -z = 拖进玩家视野内的地面；面向相机的墙 = 朝阳亮墙。
 *    放反了会得到：地面无影（影子全被高台挡在背面）+ 迎面墙全黑。
 *  光位是构图决策不是物理决策。
 *  ★ 唯一权威来源：ChunkWalls 的墙明暗方向从此处 import（勿再手抄副本）。 */
export const BAKE_SUN = { hx: -0.342, hz: 0.940, tan: 1.0 };

/** 投影门槛：遮挡物须高出接收面 ≥ 此值才投影
 *  （道路自身抖动 ±0.3m 不投影；高台落差 ≥1.5m 必投影）。
 *  ★ ChunkWalls.MIN_WALL_DROP 与此同源 import。 */
export const CAST_MIN_DEPTH = 0.5;
/** 射线射程（米）：高台柱体最厚 ~4m + 斜向余量 */
const CAST_RANGE = 16;
// ---- 软阴影（标准实现：iq SDF 软阴影公式的地形变体）----
//   res = min(res, k·h / t)   h=射线净空, t=行进距离
//   几何含义：净空角宽度 → 接触遮挡物处锐利，随距离半影自然展宽。
const SHADOW_K = 10;          // 半影硬度（越大越锐；太阳真实角直径≈1000+）
const CAST_MIN_STEP = 0.75;   // 自适应步长下限（近遮挡处精细采样）
const CAST_MAX_STEP = 2.5;    // 步长上限（<4m 块对角，防整列跳过）
const CAST_MAX_ITERS = 24;    // 迭代上限
/** 全影时直射项的保留比例（模拟天空散射；越小影子越深。0=物理纯黑，观感死板） */
const SHADOW_FLOOR = 0.12;
/** 全影区 AO 松绑比例：1=影内完全取消 AO（最亮），0=AO 全额叠加（贴墙死黑） */
const SHADOW_ZONE_AO_RELIEF = 0.65;
/** N·L wrap（0=朗伯硬边；轻微软化明暗交界——现只用于顶面常数推导） */
const NL_WRAP = 0.15;
/** 光照图双边模糊（不过高度断崖——影子不得爬上台顶，踩过的坑） */
const LIGHT_BLUR_R = 1;
const LIGHT_BLUR_PASSES = 1;

// （vnoise 已迁 TerrainNoise 共享——RegionTheme/ChunkGenerator 同源消费）

// ============================================================
// albedo 像素计算（原 bakeAlbedoCanvas 循环原样迁移）
// ============================================================

/** 双纹理烘焙像素产物（RGBA，可直接 ImageData） */
export interface ChunkPixels {
  /** 材质色图（纯颜色，无明暗；sRGB） */
  albedo: Uint8ClampedArray;
  /** 光照图（R=直射项 N·L×阴影可见度 / G=AO / B 预留；线性空间数据） */
  light: Uint8ClampedArray;
}

export function computeChunkMapsRGBA(
  q: BakeQuery, cx: number, cz: number,
  extras?: { propVolumes?: Float32Array; decals?: PlannedDecal[] },
): ChunkPixels {
  return {
    albedo: computeAlbedoRGBA(q, cx, cz, extras?.decals),
    light: computeLightRGBA(q, cx, cz, extras?.propVolumes),
  };
}

/** Pass A —— 材质色图（256²）：底色/抖动/斑块/描边/拉丝/大尺度斑驳 */
function computeAlbedoRGBA(
  q: BakeQuery, cx: number, cz: number,
  decals?: PlannedDecal[],
): Uint8ClampedArray {
  const S = APPEARANCE_RES;
  const out = new Uint8ClampedArray(S * S * 4);

  const seed = q.worldSeed;
  const step = CHUNK_SIZE / S;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const lx = (px + 0.5) * step;
      const lz = (py + 0.5) * step;
      const wx = originX + lx;
      const wz = originZ + lz;

      // 类型判定 + 坑/水侧壁上段修正（surfaceHeightAt=网格真实渲染高度才可靠）
      let td = q.tileDefAt(wx, wz);
      if (td.isDepression && q.surfaceHeightAt(wx, wz) > 0) {
        td = tileById(0); // 0 线以上的侧壁暴露面 → 平地材质
      }

      // 基准色 → ★ 区域主题调制 → 逐地块 HSL 抖动 → RGB
      //   色相平移 + 饱和/明度系数随世界位置缓变（治地图单调的 A 药）；
      //   水/坑等语义色只吃部分强度——警示红与深蓝是玩法可读性
      const rp = regionParamsAt(seed, wx, wz);
      const thM = td.isDepression ? SEMANTIC_THEME_MIX : 1;
      const baseH = (((td.visual.baseHsl.h + rp.hueShift * thM) % 1) + 1) % 1;
      const baseS = Math.min(1, td.visual.baseHsl.s * (1 + (rp.satMul - 1) * thM));
      const baseL = Math.min(1, td.visual.baseHsl.l * (1 + (rp.lightMul - 1) * thM));

      const tx = Math.floor(wx / 4);
      const tz = Math.floor(wz / 4);
      let [r, g, b] = hsl2rgb(
        baseH + (hash2(tx, tz, seed + 101) - 0.5) * 2 * td.visual.jitter.h,
        baseS * (1 + (hash2(tx, tz, seed + 202) - 0.5) * 2 * td.visual.jitter.s),
        baseL * (1 + (hash2(tx, tz, seed + 303) - 0.5) * 2 * td.visual.jitter.l),
      );

      // 色阶化斑块（3 档离散亮度 → 手绘色块拼接感）
      if (td.visual.patches !== false) {
        const pn = vnoise(wx * 0.22, wz * 0.22, seed + 88);
        const t = pn * 3;
        const k = Math.min(2, Math.floor(t));
        let f = t - k;
        f = f < 0.6 ? 0 : (f - 0.6) / 0.4;
        f = f * f * (3 - 2 * f);
        const level = (k + f) / 2;
        const amp = 0.04 * (td.visual.patchHalf ? 0.5 : 1);
        const p = 1 - amp + 2 * amp * level;
        r *= p; g *= p; b *= p;
      }

      // 地块内描边（贴边 0.3m 压暗圈）
      if (td.visual.borderLine) {
        const bxm = ((lx % 4) + 4) % 4;
        const bzm = ((lz % 4) + 4) % 4;
        const dEdge = Math.min(bxm, 4 - bxm, bzm, 4 - bzm);
        if (dEdge < 0.3) {
          const t = 1 - dEdge / 0.3;
          const k = 1 - 0.13 * t;
          r *= k; g *= k; b *= k;
        }
      }

      // 平台方向性拉丝
      if (td.visual.streaks) {
        const st = (vnoise(wx * 0.7, wz * 0.12, seed + 66) - 0.5) * 0.08;
        r *= 1 + st; g *= 1 + st; b *= 1 + st;
      }

      // 大尺度斑驳（±6%，材质色的一部分，随 albedo 进合成）
      const n = vnoise(wx * 0.045, wz * 0.045, seed + 7);
      const shade = 0.94 + 0.12 * n;

      const i = (py * S + px) * 4;
      out[i]     = Math.min(255, r * shade);
      out[i + 1] = Math.min(255, g * shade);
      out[i + 2] = Math.min(255, b * shade);
      out[i + 3] = 255;
    }
  }

  // ---- ★ 贴图印章：预渲染前贴图已全部放置 → 印进 albedo（纯 CPU 直写） ----
  if (decals && decals.length > 0) {
    applyDecalStamps(out, S, cx * CHUNK_SIZE, cz * CHUNK_SIZE, decals, q.worldSeed);
  }
  return out;
}

/** Pass B —— 光照图（128²）：R=N·L wrap × 阴影可见度，G=AO。
 *  ★ 全部查询走视觉面 surfaceHeightAt（采样统一，见文件头）
 *  ★ 装饰物阴影：propVolumes 在双边模糊前印入——装饰物高度参与
 *    预渲染结构（放置顺序：装饰物全部放置完 → 触发预渲染 → 本函数消费） */
function computeLightRGBA(
  q: BakeQuery, cx: number, cz: number,
  propVolumes?: Float32Array,
): Uint8ClampedArray {
  const S = LIGHT_RES;
  const out = new Uint8ClampedArray(S * S * 4);

  const step = CHUNK_SIZE / S;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // 顶面直射常数：顶面全平（块状地图），N·L 恒定——不用逐像素法线，
  // 消除断崖边缘 ±1m 的法线光晕伪影
  const ly = BAKE_SUN.tan / Math.hypot(1, BAKE_SUN.tan);
  const TOP_DIRECT = (ly + NL_WRAP) / (1 + NL_WRAP);

  // ---- Pass B1：原始场（视觉面高度/直射/AO；侧壁带单独着色由 ChunkWalls 承担）----
  const surf = new Float32Array(S * S);       // 视觉面高度（模糊权重按它断崖衰减）
  const directF = new Float32Array(S * S);
  const aoF = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const wx = originX + (px + 0.5) * step;
      const wz = originZ + (py + 0.5) * step;
      const h = q.surfaceHeightAt(wx, wz);
      surf[py * S + px] = h;

      // 顶面：常数直射 × 投影可见度（留底防死黑）。
      // ★ 软阴影 = iq 标准公式的地形变体：res = min(res, k·h/t)，
      //   h 为射线对视觉面的净空——接触遮挡物处锐利、随距离半影展宽。
      //   台阶豁免：落差 <CAST_MIN_DEPTH 的地形不产生遮挡（只影响步长）。
      let vis = 1;
      let t = (CAST_MIN_DEPTH / BAKE_SUN.tan) + 0.05;  // 起步越过自身台阶豁免区
      for (let it = 0; it < CAST_MAX_ITERS && t <= CAST_RANGE; it++) {
        const th = q.surfaceHeightAt(wx + BAKE_SUN.hx * t, wz + BAKE_SUN.hz * t);
        const diff = h + BAKE_SUN.tan * t - th;        // 净空（>0 未命中）
        const drop = th - h;
        if (diff <= 0 && drop >= CAST_MIN_DEPTH) { vis = 0; break; }
        if (drop >= CAST_MIN_DEPTH) {
          const s = SHADOW_K * diff / t;
          if (s < vis) vis = s;
          if (vis < 0.01) break;                       // 已足够黑，提前收敛
        }
        // 自适应步长：净空越大步子越大（clamp 防停滞/跳块）
        t += Math.min(CAST_MAX_STEP, Math.max(CAST_MIN_STEP, diff));
      }
      const direct = TOP_DIRECT * (SHADOW_FLOOR + (1 - SHADOW_FLOOR) * vis);

      // AO（凹陷地块均匀跳过——深度感由几何侧壁承担）
      let ao = 1;
      const td = q.tileDefAt(wx, wz);
      if (!(td.isDepression && q.surfaceHeightAt(wx, wz) <= 0)) {
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = q.surfaceHeightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
          if (dh > 0) occ += Math.min(dh, 2.5);
        }
        ao = Math.max(AO_MIN, 1 - (occ / 8) * AO_STRENGTH);
      }

      // ★ 防重复计费：直射遮挡（vis 低）多发生在同一批遮挡物脚下，
      //   AO 若全额叠加会三重压暗（直射umbra+天光遮挡+半影），贴墙
      //   一圈黑到失真。全影区按比例松绑 AO——AO 主要作用于受光区。
      const aoEff = ao + (1 - ao) * (1 - vis) * SHADOW_ZONE_AO_RELIEF;

      directF[py * S + px] = direct;
      aoF[py * S + px] = aoEff;
    }
  }

  // ---- Pass B1.5：装饰物阴影（预渲染结构含装饰物高度；模糊前印入）----
  if (propVolumes && propVolumes.length > 0) {
    stampPropShadows(directF, aoF, S, step, originX, originZ, propVolumes);
  }

  // ---- Pass B2：高度加权双边模糊 ×N（柔化但不过断崖；乒乓缓冲）----
  {
    const tmpD = new Float32Array(S * S), tmpA = new Float32Array(S * S);
    for (let pass = 0; pass < LIGHT_BLUR_PASSES; pass++) {
      blurAxis(directF, aoF, surf, tmpD, tmpA, S, true);   // 水平轴
      blurAxis(tmpD, tmpA, surf, directF, aoF, S, false);  // 垂直轴（读tmp写回原场，安全）
    }
  }

  // ---- Pass B3：写 RGBA ----
  for (let i = 0; i < S * S; i++) {
    out[i * 4]     = Math.round(Math.min(1, directF[i]) * 255);
    out[i * 4 + 1] = Math.round(Math.min(1, aoF[i]) * 255);
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 单轴双边盒式模糊（权重按视觉面高度差衰减——影子不跨断崖；读src写out，禁止别名） */
function blurAxis(
  srcD: Float32Array, srcA: Float32Array, h: Float32Array,
  outD: Float32Array, outA: Float32Array, S: number, horizontal: boolean,
): void {
  const TOL = 0.6, FALL = 1.4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hc = h[y * S + x];
      let sd = 0, sa = 0, wsum = 0;
      for (let k = -LIGHT_BLUR_R; k <= LIGHT_BLUR_R; k++) {
        const xx = horizontal ? Math.min(S - 1, Math.max(0, x + k)) : x;
        const yy = horizontal ? y : Math.min(S - 1, Math.max(0, y + k));
        const j = yy * S + xx;
        const dh = Math.abs(h[j] - hc);
        const w = dh <= TOL ? 1 : Math.max(0, 1 - (dh - TOL) / FALL);
        sd += srcD[j] * w; sa += srcA[j] * w; wsum += w;
      }
      const o = y * S + x;
      if (wsum > 0) { outD[o] = sd / wsum; outA[o] = sa / wsum; }
      else { outD[o] = srcD[o]; outA[o] = srcA[o]; }
    }
  }
}

// ============================================================
// 装饰物阴影印章（Pass B1.5）
// ============================================================
// 每个装饰物 = 一个简单遮挡体积（r 底半径 × h 高），沿 BAKE_SUN 方向
// 投影一段软影到地面：影子长度 ≈ h/tan（太阳仰角），随距离收窄变虚。
// 不是光线步进（不参与地形相互遮挡）——静态小物件的合理近似。
// 印入时机在双边模糊之前：模糊天然把印章柔化成半影。

function stampPropShadows(
  directF: Float32Array, aoF: Float32Array,
  S: number, step: number, originX: number, originZ: number,
  propVolumes: Float32Array,
): void {
  const P = propVolumes.length / 5;
  for (let i = 0; i < P; i++) {
    const x = propVolumes[i * 5];
    const z = propVolumes[i * 5 + 1];
    const y = propVolumes[i * 5 + 2];
    const r = propVolumes[i * 5 + 3];
    const h = propVolumes[i * 5 + 4];
    if (h <= 0.01) continue;

    // 影子沿太阳水平方向延伸：长度 = 高度/仰角 + 底半径余量
    const len = h / BAKE_SUN.tan + r;
    // 投影到像素坐标
    const pcx = (x - originX) / step;
    const pcz = (z - originZ) / step;
    const pr = Math.ceil((len + r) / step) + 1;

    for (let j = Math.max(0, Math.floor(pcz) - pr); j <= Math.min(S - 1, Math.ceil(pcz) + pr); j++) {
      for (let i2 = Math.max(0, Math.floor(pcx) - pr); i2 <= Math.min(S - 1, Math.ceil(pcx) + pr); i2++) {
        const wx = originX + (i2 + 0.5) * step;
        const wz = originZ + (j + 0.5) * step;
        const dx = wx - x, dz = wz - z;
        const along = dx * BAKE_SUN.hx + dz * BAKE_SUN.hz;   // 影子轴向投影
        if (along <= 0 || along >= len) continue;
        const perp2 = dx * dx + dz * dz - along * along;
        // ★ 浮点防御：沿轴投影反解出的垂距平方可微负（-1e-3 级），
        //   sqrt(负数)=NaN → NaN 写进 Uint8ClampedArray 变 0 → 影尾出现黑块
        const perp = Math.sqrt(Math.max(0, perp2));
        // 影子宽度：底宽 1.7×r（128² 光照图 0.47m/px，物理宽度会被模糊抹平到
        //   不可见——美术向放宽），随距离收窄（透视）→ 头实尾尖
        const perpR = r * (1.7 - 0.9 * (along / len));
        if (perp > perpR) continue;
        const idx = j * S + i2;
        const falloff = (1 - along / len) * (1 - perp / perpR);
        // 压暗直射项（影子读作光的缺席；0.7 强于 0.55——保证小体积也可见）；基底微 AO
        directF[idx] = Math.min(directF[idx], 1 - falloff * 0.7);
        aoF[idx] = Math.max(0.35, aoF[idx] * (1 - falloff * 0.15));
      }
    }
  }
}

// ============================================================
// 快照协议：主线程拷 chunk 原始数组 ↔ Worker 重构查询源
// ============================================================

/** 快照覆盖半径：raymarch 16m + AO 2.5m + 插值角点余量 */
const SNAP_MARGIN = 22;

/** 烘焙快照（可 transfer；vHeights 为整数格点顶点值晶格） */
export interface BakeSnapshot {
  seed: number;
  cx: number; cz: number;
  /** 顶点晶格：世界 (vx0+gx, vz0+gz) 处 vertexHeightAt 值，vw×vw */
  vx0: number; vz0: number; vw: number;
  vHeights: Float32Array;
  /** 块类型：块对齐栅格 bw×bh，块 (bx0+bx, bz0+bz) */
  bx0: number; bz0: number; bw: number; bh: number;
  blockIds: Uint8Array;
  /** 装饰物遮挡体积（世界坐标；每 5 个 [x,z,y,r,h]；shadow='disc' 才有） */
  propVolumes: Float32Array;
  /** 贴图放置计划（预渲染时印进 albedo） */
  decals: PlannedDecal[];
}

/** 快照消费的最小 chunk 数据面（RasterMap.getChunkData 天然满足） */
export interface ChunkDataLite {
  heights: Float32Array;
  blockTypes: Uint8Array;
}

/**
 * 主线程提取快照：直接拷贝覆盖区内全部 chunk 的原始数组再本地重排
 * （亚毫秒级；未加载 chunk 高度记 0，与 RasterMap.heightAt 回退一致）。
 * 顶点值 = 整数格点周围 2×2 格 max——与 RasterMap.vertexHeightAt 同公式。
 */
export function buildSnapshotFromChunks(
  seed: number, cx: number, cz: number,
  getChunk: (cx: number, cz: number) => ChunkDataLite | undefined,
  extras?: { propVolumes?: Float32Array; decals?: PlannedDecal[] },
): BakeSnapshot {
  const originX = cx * CHUNK_SIZE, originZ = cz * CHUNK_SIZE;
  const vx0 = originX - SNAP_MARGIN, vz0 = originZ - SNAP_MARGIN;
  const vw = CHUNK_SIZE + SNAP_MARGIN * 2 + 1;

  // ---- 米格高度场（覆盖 [vx0, vx0+vw) 整数格；每米 1 格）----
  const mw = vw;
  const mx0 = vx0, mz0 = vz0;
  const meterH = new Float32Array(mw * mw);
  const cFirstX = Math.floor(mx0 / CHUNK_SIZE), cLastX = Math.floor((mx0 + mw - 1) / CHUNK_SIZE);
  const cFirstZ = Math.floor(mz0 / CHUNK_SIZE), cLastZ = Math.floor((mz0 + mw - 1) / CHUNK_SIZE);
  for (let ccz = cFirstZ; ccz <= cLastZ; ccz++) {
    for (let ccx = cFirstX; ccx <= cLastX; ccx++) {
      const data = getChunk(ccx, ccz);
      if (!data) continue; // 未加载 → 保持 0（与 heightAt 回退一致）
      const baseX = ccx * CHUNK_SIZE, baseZ = ccz * CHUNK_SIZE;
      const lx0 = Math.max(0, mx0 - baseX), lx1 = Math.min(CHUNK_SIZE - 1, mx0 + mw - 1 - baseX);
      const lz0 = Math.max(0, mz0 - baseZ), lz1 = Math.min(CHUNK_SIZE - 1, mz0 + mw - 1 - baseZ);
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          // 目标行列 = 世界格坐标 − 快照原点（世界格 = chunk 原点 + 局部索引）
          meterH[(baseZ + lz - mz0) * mw + (baseX + lx - mx0)] =
            data.heights[lz * CHUNK_SIZE + lx] ?? 0;
        }
      }
    }
  }

  // ---- 顶点晶格：max(2×2 米格)，与 RasterMap.vertexHeightAt 同公式 ----
  const vHeights = new Float32Array(vw * vw);
  for (let gz = 0; gz < vw; gz++) {
    for (let gx = 0; gx < vw; gx++) {
      const cxl = gx, czl = gz; // 米格索引（米格与顶点晶格同起点同分辨率）
      vHeights[gz * vw + gx] = Math.max(
        meterH[(czl - 1 < 0 ? 0 : czl - 1) * mw + (cxl - 1 < 0 ? 0 : cxl - 1)],
        meterH[(czl - 1 < 0 ? 0 : czl - 1) * mw + cxl],
        meterH[czl * mw + (cxl - 1 < 0 ? 0 : cxl - 1)],
        meterH[czl * mw + cxl],
      );
    }
  }

  // ---- 块类型（块对齐覆盖同区域；块中心采一点即块定义）----
  const bx0 = Math.floor(vx0 / BLOCK_SIZE), bz0 = Math.floor(vz0 / BLOCK_SIZE);
  const bw = Math.ceil((vx0 + vw - 1) / BLOCK_SIZE) - bx0 + 1;
  const bh = Math.ceil((vz0 + vw - 1) / BLOCK_SIZE) - bz0 + 1;
  const blockIds = new Uint8Array(bw * bh);
  for (let bz = 0; bz < bh; bz++) {
    for (let bx = 0; bx < bw; bx++) {
      const wx = (bx0 + bx) * BLOCK_SIZE + 2; // 块中心
      const wz = (bz0 + bz) * BLOCK_SIZE + 2;
      const data = getChunk(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE));
      let id = 0; // 未加载 → BLOCK_FLAT（与 tileDefAt 回退一致）
      if (data) {
        const lx = wx - Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE;
        const lz = wz - Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE;
        id = data.blockTypes[Math.floor(lz / BLOCK_SIZE) * BLOCKS_PER_SIDE + Math.floor(lx / BLOCK_SIZE)] ?? 0;
      }
      blockIds[bz * bw + bx] = id;
    }
  }

  return {
    seed, cx, cz, vx0, vz0, vw, vHeights, bx0, bz0, bw, bh, blockIds,
    propVolumes: extras?.propVolumes ?? new Float32Array(0),
    decals: extras?.decals ?? [],
  };
}

/** Worker 端：快照 → BakeQuery（与 RasterMap 同公式的本地重构，零跨线程查询） */
export function makeSnapshotSource(s: BakeSnapshot): BakeQuery {
  return {
    worldSeed: s.seed,
    surfaceHeightAt(x: number, z: number): number {
      // ★ 三角形插值 = PlaneGeometry 真实剖分（对角线 (lx,lz+1)-(lx+1,lz)，
      //   分割条件 fx+fz≤1；Raycaster 实测逐位一致）。不能用双线性——
      //   非平面格（斜坡过渡带）偏差可达米级，烘焙影会脱离可见地表。
      let fx = x - s.vx0;
      let fz = z - s.vz0;
      if (fx < 0) fx = 0; else if (fx > s.vw - 1.001) fx = s.vw - 1.001;
      if (fz < 0) fz = 0; else if (fz > s.vw - 1.001) fz = s.vw - 1.001;
      const gx = Math.floor(fx), gz = Math.floor(fz);
      const tx = fx - gx, tz = fz - gz;
      const g1 = gx + 1, g1z = gz + 1;
      const h00 = s.vHeights[gz * s.vw + gx];
      const h10 = s.vHeights[gz * s.vw + g1];
      const h01 = s.vHeights[g1z * s.vw + gx];
      const h11 = s.vHeights[g1z * s.vw + g1];
      if (tx + tz <= 1) return h00 * (1 - tx - tz) + h01 * tz + h10 * tx;
      return h11 * (tx + tz - 1) + h01 * (1 - tx) + h10 * (1 - tz);
    },
    tileDefAt(x: number, z: number): TileDef {
      let bx = Math.floor(x / BLOCK_SIZE) - s.bx0;
      let bz = Math.floor(z / BLOCK_SIZE) - s.bz0;
      if (bx < 0) bx = 0; else if (bx > s.bw - 1) bx = s.bw - 1;
      if (bz < 0) bz = 0; else if (bz > s.bh - 1) bz = s.bh - 1;
      return tileById(s.blockIds[bz * s.bw + bx]);
    },
  };
}
