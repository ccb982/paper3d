// ============================================================
// ChunkAppearance —— chunk 外观烘焙（契约 / 组装 / Boss4D 旧路径）
// ============================================================
// 双纹理方案（2026-08-25 定稿，主地图现行路径 = bakeChunkMaps）：
//   Pass A  albedo 图  ：纯材质色（底色/抖动/斑块/描边/拉丝/斑驳），
//                        不含任何明暗信息
//   Pass B  lightmap 图：R = 直射项（N·L wrap × 阴影可见度）
//                        G = AO          B/A 预留
//   运行时 TerrainMaterial 合成：
//     final = albedo × (环境色 × G + 太阳色 × R)
//   昼夜循环只动两个 uniform——阴影浓度/色调随时可调，无需重烘。
//
// ★ 2026-08-26 Worker 化重构：
//   - 像素计算核心全部迁往 bakeCompute.ts（纯函数、零 three 依赖、
//     可在 Worker 内运行）；本文件保留：烘焙契约、像素→纹理组装、
//     同步回退入口、Boss4D 单纹理旧路径（最终 Boss 战地图专用）。
//   - 异步管线见 TerrainBaker.ts（WorldMode 消费）。
//
// ★★ 采样统一（同日定稿）：双纹理管线只消费「视觉面」
//   surfaceHeightAt——与网格位移/角色贴地同源，修复斜坡台缘处
//   烘焙影与可见地表的错位。块状 heightAt 仅剩旧路径使用。
//
// 阴影算法（新路径，在 bakeCompute）：iq SDF 软阴影公式的地形变体
//   res=min(res,k·h/t)——接触遮挡物处锐利、随距离半影自然展宽。
//
// ─────────────────────────────────────────────────────────────
// 旧单纹理路径 bakeChunkAppearance（保留）：Boss4DArena（最终 Boss 战地图）
//   专用，主地图勿用。内嵌 AO 计算与双纹理路径共享 bakeCompute 的参数常量。
//
// 分界铁律（防重复计费）：
//   - 材质色 + 静态光（N·L/自遮挡影/AO）→ 全部在烘焙域完成
//   - 实时域只剩：昼夜色调/强度调制（uniform）+ 实体动态影子
//   ⚠️ 启用 canvas 烘焙后，顶点色/AO 必须停用——AO 只能存在一处
//
// 像素 ↔ 世界映射约定（两图同约定，lightmap 半分辨率）：
//   pixel(px,py) ↔ world( cx*60+(px+0.5)*step , cz*60+(py+0.5)*step )
//   配套顶点 UV = (lx/60, lz/60)，texture.flipY = false
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, hash2 } from './ChunkGenerator';
import { vnoise } from './TerrainNoise';
import { hsl2rgb } from './TerrainPalette';
import { tileById, type TileDef } from './Tiles';
import {
  AO_RADIUS, AO_STRENGTH, AO_MIN, APPEARANCE_RES,
  computeChunkMapsRGBA,
  type BakeQuery,
} from './bakeCompute';
import type { PlannedDecal } from './decor/TileDecalBase';
import { applyDecalStamps } from './decor/TileDecalBase';

// ============================================================
// 烘焙数据流契约（架构定稿）：
//
//   RasterMap（地图侧）          烘焙侧（bakeCompute/TerrainBaker）
//   持有高度场，暴露查询 ──────►  只认接口，自主计算阴影/光照，
//   TerrainBakeSource 能力        返回 albedo + lightmap 双纹理
//
// 烘焙器不 import RasterMap——依赖倒置：地图侧满足接口即被消费
// （TS 结构化类型，RasterMap 天然满足，无需显式 implements）。
// ============================================================

/** ★ 烘焙域消费的地形查询契约（最小能力集；RasterMap 天然满足） */
export interface TerrainBakeSource {
  /** 世界种子（烘焙噪声用；同 seed 同地形 → 输出逐字节一致） */
  readonly worldSeed: number;
  /** 世界高度（格值；仅旧路径消费） */
  heightAt(x: number, z: number): number;
  /** 视觉面一致采样（顶点值三角形插值 = PlaneGeometry 真实剖分，逐位一致） */
  surfaceHeightAt(x: number, z: number): number;
  /** 地块定义（颜色/凹陷标志等外观属性） */
  tileDefAt(x: number, z: number): TileDef;
}

// ---- 接触 AO 参数（contactAO 档；紧贴尺度。仅旧路径）----
const CONTACT_RADIUS = 0.85;
const CONTACT_STRENGTH = 0.17;

/** 静态日照投影参数（sunShadow 档；固定太阳观感，方向承旧 sunOffset。仅旧路径） */
const SHADOW_SUN_HX = 0.851;
const SHADOW_SUN_HZ = 0.524;
const SHADOW_SUN_TAN = Math.tan((40 * Math.PI) / 180); // 仰角 40° 射线爬升率
const SHADOW_MAX_DIST = 9;
const SHADOW_STEPS = 12;
const SHADOW_STRENGTH = 0.30;   // ★ 与 AO 连乘，勿调回 0.4+——背光处会黑成一团
const SHADOW_DIV = 2;           // 阴影场半分辨率
const SHADOW_BLUR_R = 1;        // 双边盒式模糊半径
const SHADOW_BLUR_PASSES = 2;
const SHADOW_EDGE_TOL = 0.6;    // 高度差≤此值模糊自由跨过
const SHADOW_EDGE_FALL = 1.4;   // 超出后权重线性归零（影子不得翻越断崖）
const SHADOW_MIN_DEPTH = 2.2;   // 最小落差门槛（普通台阶不投影）

/** 烘焙可选档位（★ 主地图默认全关；组合见 BOSS4D_BAKE） */
export interface ChunkBakeOptions {
  /** ★ 第二尺度接触 AO（半径0.85m 缝隙/贴边暗部）——Boss4D 开启 */
  contactAO?: boolean;
  /** ★ 静态日照投影（地形自遮挡：半分辨率光线步进+双边模糊柔化；
   *  固定太阳不随昼夜；最小落差门槛 2.2m——普通台阶不投影）——Boss4D 开启 */
  sunShadow?: boolean;
}

/** ★ Boss 四维空间（最终 Boss 战地图）的烘焙配置（与 Boss4DArena 网格配套使用） */
export const BOSS4D_BAKE: Required<ChunkBakeOptions> = { contactAO: true, sunShadow: true };

/**
 * 【旧路径】烘焙一张 chunk 单纹理外观（Boss4DArena 专用，主地图勿用）。
 * @param decals 装饰贴图计划（预渲染前放置完成 → 印进外观纹理；boss4D 同管线）
 * @returns 已配置好 colorSpace/filter 的 CanvasTexture（随 chunk 销毁时 dispose）
 */
export function bakeChunkAppearance(
  terrain: TerrainBakeSource,
  cx: number,
  cz: number,
  opts: ChunkBakeOptions = {},
  decals?: PlannedDecal[],
): THREE.CanvasTexture {
  const S = APPEARANCE_RES;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const seed = terrain.worldSeed;
  const step = CHUNK_SIZE / S;               // 米/像素
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  const useContact = opts.contactAO === true;
  const useShadow = opts.sunShadow === true;

  // ==================== Pass A：静态日照投影场（sunShadow 档）====================
  // 半分辨率预计算 + 高度加权双边模糊柔化；纯高度场计算（与 tile 类型无关）
  let SR = 0;
  let field: Float32Array | null = null;
  if (useShadow) {
    SR = Math.max(1, Math.round(S / SHADOW_DIV));
    const sStep = CHUNK_SIZE / SR;
    field = new Float32Array(SR * SR);
    const hfield = new Float32Array(SR * SR);
    const d0 = (SHADOW_MAX_DIST / SHADOW_STEPS) * 0.5;
    const grow = Math.pow(SHADOW_MAX_DIST / d0, 1 / SHADOW_STEPS);
    for (let sy = 0; sy < SR; sy++) {
      for (let sx = 0; sx < SR; sx++) {
        const wx = originX + (sx + 0.5) * sStep;
        const wz = originZ + (sy + 0.5) * sStep;
        const h = terrain.heightAt(wx, wz);
        hfield[sy * SR + sx] = h;
        // 双探针快速预检（须同时满足落差门槛）：平坦开阔区跳过步进
        const p1 = SHADOW_MAX_DIST * 0.35, p2 = SHADOW_MAX_DIST * 0.75;
        const gate1 = Math.max(SHADOW_SUN_TAN * p1, SHADOW_MIN_DEPTH);
        const gate2 = Math.max(SHADOW_SUN_TAN * p2, SHADOW_MIN_DEPTH);
        const blocked =
          terrain.heightAt(wx + SHADOW_SUN_HX * p1, wz + SHADOW_SUN_HZ * p1) - h >= gate1 ||
          terrain.heightAt(wx + SHADOW_SUN_HX * p2, wz + SHADOW_SUN_HZ * p2) - h >= gate2;
        if (!blocked) continue;
        let sh = 0, d = d0;
        for (let k = 0; k < SHADOW_STEPS && sh < 0.92; k++) {
          const th = terrain.heightAt(wx + SHADOW_SUN_HX * d, wz + SHADOW_SUN_HZ * d);
          const rayY = h + SHADOW_SUN_TAN * d;
          // ★ 落差门槛：遮挡物须高出接收平面 ≥SHADOW_MIN_DEPTH（普通台阶无视）
          if (th > rayY && th - h >= SHADOW_MIN_DEPTH) {
            const over = Math.min(1, (th - rayY) / 1.1);       // 遮挡越厚影越实
            const fall = 1 - d / SHADOW_MAX_DIST;              // 越远越淡
            sh = Math.max(sh, over * (0.35 + 0.65 * fall));
          }
          d *= grow;
        }
        field[sy * SR + sx] = sh;
      }
    }
    // ---- 双边盒式模糊 ×N：亮度柔化但【不过高度断崖】（影子不得爬上台顶——踩过坑）----
    const tmp = new Float32Array(field.length);
    for (let pass = 0; pass < SHADOW_BLUR_PASSES; pass++) {
      for (let y = 0; y < SR; y++) {
        for (let x = 0; x < SR; x++) {
          const hc = hfield[y * SR + x];
          let sum = 0, wsum = 0;
          for (let k = -SHADOW_BLUR_R; k <= SHADOW_BLUR_R; k++) {
            const xx = Math.min(SR - 1, Math.max(0, x + k));
            const dh = Math.abs(hfield[y * SR + xx] - hc);
            const w = dh <= SHADOW_EDGE_TOL ? 1 : Math.max(0, 1 - (dh - SHADOW_EDGE_TOL) / SHADOW_EDGE_FALL);
            sum += field[y * SR + xx] * w; wsum += w;
          }
          tmp[y * SR + x] = wsum > 0 ? sum / wsum : field[y * SR + x];
        }
      }
      for (let y = 0; y < SR; y++) {
        for (let x = 0; x < SR; x++) {
          const hc = hfield[y * SR + x];
          let sum = 0, wsum = 0;
          for (let k = -SHADOW_BLUR_R; k <= SHADOW_BLUR_R; k++) {
            const yy = Math.min(SR - 1, Math.max(0, y + k));
            const dh = Math.abs(hfield[yy * SR + x] - hc);
            const w = dh <= SHADOW_EDGE_TOL ? 1 : Math.max(0, 1 - (dh - SHADOW_EDGE_TOL) / SHADOW_EDGE_FALL);
            sum += tmp[yy * SR + x] * w; wsum += w;
          }
          field[y * SR + x] = wsum > 0 ? sum / wsum : field[y * SR + x];
        }
      }
    }
  }

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const lx = (px + 0.5) * step;
      const lz = (py + 0.5) * step;
      const wx = originX + lx;
      const wz = originZ + lz;

      // ---- 类型判定 + 高度修正 ----
      // ★ 坑/水的"侧壁上段"修正：
      //   必须用 surfaceHeightAt（顶点值三角形插值 = 网格真实渲染高度）判定。
      //   ⚠️ 两个坑：
      //   ① heightAt 是原始格子数据（坑块内恒为负），判 h>0 永不成立；
      //   ② vertexHeightAt 是 max 且只向负方向采样 —— 在悬崖【低侧】看不到
      //      高邻块，同样判不出。surfaceHeightAt 与网格渲染完全一致才可靠。
      //   插值高度 >0 且水平归属坑/水 tile = 位于 0 线以上的侧壁暴露面，
      //   改按平地材质处理（不得涂水色/警示色）。
      let td = terrain.tileDefAt(wx, wz);
      if (td.isDepression && terrain.surfaceHeightAt(wx, wz) > 0) {
        td = tileById(0); // 0 线以上的侧壁暴露面 → 平地材质
      }

      // ---- 基准色 → 逐地块 HSL 抖动 → RGB（幅度来自 Tiles 注册表）----
      const tx = Math.floor(wx / 4);
      const tz = Math.floor(wz / 4);
      let [r, g, b] = hsl2rgb(
        td.visual.baseHsl.h + (hash2(tx, tz, seed + 101) - 0.5) * 2 * td.visual.jitter.h,
        td.visual.baseHsl.s * (1 + (hash2(tx, tz, seed + 202) - 0.5) * 2 * td.visual.jitter.s),
        td.visual.baseHsl.l * (1 + (hash2(tx, tz, seed + 303) - 0.5) * 2 * td.visual.jitter.l),
      );

      // ---- 结构化细节层（替代白噪点——白噪=脏，结构=设计）----
      //   ⚠️ 已删除：像素白噪点 / R,B 冷暖偏移 / 中频连续斑块
      //     （各向同性无结构 = 脏；2026-08-23 TileDef 迁移时曾误带回，勿再恢复）

      // ① 色阶化斑块（3 档；带内平台 + 带缘 smoothstep 软过渡 → 自然不生硬）
      if (td.visual.patches !== false) {
        const pn = vnoise(wx * 0.22, wz * 0.22, seed + 88);   // 0~1
        const t = pn * 3;
        const k = Math.min(2, Math.floor(t));
        let f = t - k;
        f = f < 0.6 ? 0 : (f - 0.6) / 0.4;                    // 每带：60% 平台 + 40% 过渡
        f = f * f * (3 - 2 * f);                              // smoothstep 缓坡
        const level = (k + f) / 2;                            // 0 ~ 1（跨带连续）
        const amp = 0.04 * (td.visual.patchHalf ? 0.5 : 1);
        const p = 1 - amp + 2 * amp * level;                  // 对称 ±4%（pit 减半）
        r *= p; g *= p; b *= p;
      }

      // ---- 地块内描边（贴边 0.3m 压暗圈）----
      if (td.visual.borderLine) {
        const bxm = ((lx % 4) + 4) % 4;
        const bzm = ((lz % 4) + 4) % 4;
        const dEdge = Math.min(bxm, 4 - bxm, bzm, 4 - bzm);
        if (dEdge < 0.3) {
          const t = 1 - dEdge / 0.3; // 越贴边越暗
          const k = 1 - 0.13 * t;
          r *= k; g *= k; b *= k;
        }
      }

      // ---- 平台方向性拉丝（X 向拉伸噪声）----
      if (td.visual.streaks) {
        const st = (vnoise(wx * 0.7, wz * 0.12, seed + 66) - 0.5) * 0.08;
        r *= 1 + st; g *= 1 + st; b *= 1 + st;
      }

      // ---- 大尺度斑驳（幅度刻意克制 ±6%，不抢方块感）----
      const n = vnoise(wx * 0.045, wz * 0.045, seed + 7);
      const shade = 0.94 + 0.12 * n;

      // ---- 逐像素 AO（凹陷地块均匀着色跳过——深度感由几何侧壁承担）----
      let ao = 1;
      if (!td.isDepression) {
        const h = terrain.heightAt(wx, wz);

        // ① 接触 AO（contactAO 档：紧贴尺度缝隙/贴边暗部）
        let contactAO = 1;
        if (useContact) {
          let cOcc = 0;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            const dh = terrain.heightAt(wx + Math.cos(ang) * CONTACT_RADIUS, wz + Math.sin(ang) * CONTACT_RADIUS) - h;
            if (dh > 0) cOcc += Math.min(dh, 1.2);
          }
          contactAO = 1 - (cOcc / 8) * CONTACT_STRENGTH;
        }

        // ② 环境 AO（基础尺度：凹陷/谷地压暗）
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = terrain.heightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
          if (dh > 0) occ += Math.min(dh, 2.5);
        }
        // ★ 显式下限在合并后生效——防止多层连乘击穿亮度
        ao = Math.max(AO_MIN, contactAO * (1 - (occ / 8) * AO_STRENGTH));

        // ③ 静态日照投影（sunShadow 档）：采样 Pass A 柔化后的阴影场（双线性）
        if (field && SR > 0) {
          const fx = Math.max(0, Math.min(SR - 1e-3, (px + 0.5) / SHADOW_DIV - 0.5));
          const fy = Math.max(0, Math.min(SR - 1e-3, (py + 0.5) / SHADOW_DIV - 0.5));
          const x0 = fx | 0, y0 = fy | 0;
          const x1 = Math.min(x0 + 1, SR - 1), y1 = Math.min(y0 + 1, SR - 1);
          const tx = fx - x0, ty = fy - y0;
          const sh =
            field[y0 * SR + x0] * (1 - tx) * (1 - ty) +
            field[y0 * SR + x1] * tx * (1 - ty) +
            field[y1 * SR + x0] * (1 - tx) * ty +
            field[y1 * SR + x1] * tx * ty;
          ao *= 1 - SHADOW_STRENGTH * sh;
        }
      }

      const f = shade * ao;
      const i = (py * S + px) * 4;
      img.data[i]     = Math.min(255, r * f);
      img.data[i + 1] = Math.min(255, g * f);
      img.data[i + 2] = Math.min(255, b * f);
      img.data[i + 3] = 255;
    }
  }

  // ★ 装饰贴图印章：预渲染前贴图已全部放置 → 印进外观纹理（与双纹理路径同款）
  if (decals && decals.length > 0) {
    applyDecalStamps(img.data, S, originX, originZ, decals, seed);
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = false;                        // ★ 与显式 UV 约定配套（见文件头）
  tex.colorSpace = THREE.SRGBColorSpace;    // 真实显示色（区别于 FTX 的线性 HSL 数据）
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ============================================================
// 双纹理组装（主地图现行路径的主线程侧；像素计算在 bakeCompute）
// ============================================================

/** 双纹理烘焙产物 */
export interface ChunkMaps {
  /** 材质色图（纯颜色，无明暗；sRGB） */
  albedo: THREE.CanvasTexture;
  /** 光照图（R=直射项 N·L×阴影可见度 / G=AO / B 预留；线性空间数据） */
  lightmap: THREE.CanvasTexture;
}

/** 由像素缓冲组装纹理（Worker 结果与同步回退共用此尾部；主线程执行） */
export function assembleChunkMaps(albedoBuf: Uint8ClampedArray, lightBuf: Uint8ClampedArray): ChunkMaps {
  // ---- albedo：sRGB + mipmap + 各向异性（地面掠射角画质）----
  const aCvs = document.createElement('canvas');
  aCvs.width = aCvs.height = APPEARANCE_RES;
  aCvs.getContext('2d')!.putImageData(new ImageData(albedoBuf, APPEARANCE_RES, APPEARANCE_RES), 0, 0);
  const albedo = new THREE.CanvasTexture(aCvs);
  albedo.flipY = false;                        // ★ 与显式 UV 约定配套（见文件头）
  albedo.colorSpace = THREE.SRGBColorSpace;    // 真实显示色（区别于线性数据）
  albedo.anisotropy = 4;
  albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;

  // ---- lightmap：线性数据乘数，不做 sRGB 解码；低频光照不需要 mip ----
  const lRes = Math.sqrt(lightBuf.length / 4) | 0;
  const lCvs = document.createElement('canvas');
  lCvs.width = lCvs.height = lRes;
  lCvs.getContext('2d')!.putImageData(new ImageData(lightBuf, lRes, lRes), 0, 0);
  const lightmap = new THREE.CanvasTexture(lCvs);
  lightmap.flipY = false;                    // 与 albedo 同 UV 约定
  lightmap.generateMipmaps = false;
  lightmap.minFilter = THREE.LinearFilter;
  lightmap.magFilter = THREE.LinearFilter;
  lightmap.wrapS = lightmap.wrapT = THREE.ClampToEdgeWrapping;

  return { albedo, lightmap };
}

/**
 * 【同步回退】主线程直接烘一个 chunk 的双纹理外观。
 * 正常路径走 TerrainBaker（Worker）；本函数用于 Worker 不可用时的回退，
 * 与 Worker 输出逐位一致（同一计算核心）。
 */
export function bakeChunkMaps(
  terrain: TerrainBakeSource, cx: number, cz: number,
  extras?: { propVolumes?: Float32Array; decals?: PlannedDecal[] },
): ChunkMaps {
  const q: BakeQuery = {
    worldSeed: terrain.worldSeed,
    surfaceHeightAt: (x, z) => terrain.surfaceHeightAt(x, z),
    tileDefAt: (x, z) => terrain.tileDefAt(x, z),
  };
  const out = computeChunkMapsRGBA(q, cx, cz, extras);
  return assembleChunkMaps(out.albedo, out.light);
}

// ============================================================
// 烘焙缓存（2026-08-26）：纹理级复用，消除两类重烘浪费
// ============================================================
// 解决：① 风格切换往返全量重烘（架构已知债务）；② 玩家每跨一次
// chunk 边界最多 4 个邻居接缝重建的重烘（烘焙输出已与加载顺序无关
// ——快照前 ensureData 补齐数据环——故纹理可安全复用，接缝只需
// 重建几何）。
//
// 所有权约定：
//   - 入缓存后纹理归缓存所有；disposeChunkVisual 见材质 userData.cached
//     标记即跳过纹理释放（材质本身仍随 chunk 销毁）
//   - 模式退出 releaseBakeCache() 取出全部并销毁（不跨模式占显存）
//   - key 含 seed：换 seed 自然失配，无陈旧命中风险
const bakeCache = new Map<string, ChunkMaps>();
const mapsCacheKey = (seed: number, cx: number, cz: number) => `${seed}|${cx}|${cz}`;

/** 缓存命中则返回纹理组（调用方直接装配，跳过烘焙） */
export function getCachedChunkMaps(seed: number, cx: number, cz: number): ChunkMaps | undefined {
  return bakeCache.get(mapsCacheKey(seed, cx, cz));
}

/** 存入缓存（接管纹理所有权；此后 chunk 销毁不得 dispose 这两张纹理） */
export function cacheChunkMaps(seed: number, cx: number, cz: number, maps: ChunkMaps): void {
  const key = mapsCacheKey(seed, cx, cz);
  if (!bakeCache.has(key)) bakeCache.set(key, maps);
}

/** 模式退出：取出全部缓存并销毁纹理（唯一合法的缓存侧 dispose 点） */
export function releaseBakeCache(): void {
  for (const m of bakeCache.values()) {
    m.albedo.dispose();
    m.lightmap.dispose();
  }
  bakeCache.clear();
}
