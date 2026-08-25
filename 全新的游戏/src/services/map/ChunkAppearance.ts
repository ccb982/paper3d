// ============================================================
// ChunkAppearance —— chunk 外观纹理烘焙器（静态预渲染，统一入口）
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
// 阴影算法（行业标准：高度场射线步进，GameDev.net 2002 正典）：
//   沿固定烘焙太阳方向逐米步进，「遮挡物高出接收平面 ≥ 落差门槛」
//   才投影；软边 = 遮挡越厚影越实（smoothstep 半影）。参数按标准
//   地图的块状结构重推（4m 等高柱体），不继承 Boss4D 废案数值。
//   ⚠️ terrain.heightAt 在 4m 块内恒定 → 步进采样自动按柱体取值，
//      无需专门 DDA。
//
// ─────────────────────────────────────────────────────────────
// 旧单纹理路径 bakeChunkAppearance（保留）：Boss4DArena 废案专用，
//   主地图勿用。其内嵌的 AO 计算与双纹理路径共享同一套参数常量。
//
// 分界铁律（防重复计费）：
//   - 材质色 + 静态光（N·L/自遮挡影/AO）→ 全部在这里烘焙
//   - 实时域只剩：昼夜色调/强度调制（uniform）+ 实体动态影子
//   ⚠️ 启用本 canvas 后，顶点色/AO 必须停用——AO 只能存在一处
//
// 像素 ↔ 世界映射约定（两图同约定，lightmap 半分辨率）：
//   pixel(px,py) ↔ world( cx*60+(px+0.5)*step , cz*60+(py+0.5)*step )
//   配套顶点 UV = (lx/60, lz/60)，texture.flipY = false
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, hash2 } from './ChunkGenerator';
import { hsl2rgb } from './TerrainPalette';
import { tileById, type TileDef } from './Tiles';

// ============================================================
// 烘焙数据流契约（架构定稿）：
//
//   RasterMap（地图侧）          ChunkAppearance（烘焙侧）
//   持有高度场，暴露查询 ──────►  只认 TerrainBakeSource 接口，
//   TerrainBakeSource 能力        自主计算阴影/光照，
//                                 返回 albedo + lightmap 双纹理
//
// 烘焙器不 import RasterMap——依赖倒置：地图侧满足接口即被消费
// （TS 结构化类型，RasterMap 天然满足，无需显式 implements）。
// 未来接入手绘地图/Boss4D 变体/Worker 内快照，只需实现同一接口。
// ============================================================

/** ★ 烘焙域消费的地形查询契约（最小能力集；RasterMap 天然满足） */
export interface TerrainBakeSource {
  /** 世界种子（烘焙噪声用；同 seed 同地形 → 输出逐字节一致） */
  readonly worldSeed: number;
  /** 世界高度（格值） */
  heightAt(x: number, z: number): number;
  /** 视觉面一致采样（顶点值双线性插值，与网格渲染完全一致） */
  surfaceHeightAt(x: number, z: number): number;
  /** 地块定义（颜色/凹陷标志等外观属性） */
  tileDefAt(x: number, z: number): TileDef;
}

/** 外观分辨率（默认 256²；低端机降 128²） */
export const APPEARANCE_RES = 256;

/** 烘焙可选档位（★ 主地图默认全关；组合见 BOSS4D_BAKE） */
export interface ChunkBakeOptions {
  /** ★ 第二尺度接触 AO（半径0.85m 缝隙/贴边暗部）——Boss4D 废案开启 */
  contactAO?: boolean;
  /** ★ 静态日照投影（地形自遮挡：半分辨率光线步进+双边模糊柔化；
   *  固定太阳不随昼夜；最小落差门槛 2.2m——普通台阶不投影）——Boss4D 废案开启 */
  sunShadow?: boolean;
}

/** ★ Boss 四维废案的烘焙配置（与 Boss4DArena 网格配套使用） */
export const BOSS4D_BAKE: Required<ChunkBakeOptions> = { contactAO: true, sunShadow: true };

/** AO 参数（环境尺度；压暗下限 0.55 防死黑） */
const AO_RADIUS = 2.5;
const AO_STRENGTH = 0.09;
const AO_MIN = 0.55;

/** 接触 AO 参数（contactAO 档；紧贴尺度） */
const CONTACT_RADIUS = 0.85;
const CONTACT_STRENGTH = 0.17;

/** 静态日照投影参数（sunShadow 档；固定太阳观感，方向承旧 sunOffset） */
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

/** 平滑值噪声（双线性 + smoothstep），用于大尺度明暗斑驳（幅度刻意克制，保方块感） */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash2(a, b, seed);
  const top = h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx;
  const bot = h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/**
 * 烘焙一张 chunk 外观纹理。
 * @param raster 地图查询层（terrainTypeAt / heightAt / worldSeed）
 * @param cx,cz  chunk 坐标
 * @param opts   可选档位（缺省 = 主地图原始观感）
 * @returns 已配置好 colorSpace/filter 的 CanvasTexture（随 chunk 销毁时 dispose）
 */
export function bakeChunkAppearance(
  terrain: TerrainBakeSource,
  cx: number,
  cz: number,
  opts: ChunkBakeOptions = {},
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
      //   必须用 surfaceHeightAt（顶点值双线性插值 = 网格真实渲染高度）判定。
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
      //   ① 色阶化斑块：中频噪声量化成 3 档离散亮度（对称 ±2.5%）→ 手绘色块拼接感
      //   ② 地块内描边：贴边 ~0.3m 压暗一圈 → "精制面板"质感（方舟地图签名）
      //   ③ 平台方向性拉丝：各向异性噪声沿 X 拉伸 → 拉丝金属
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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = false;                        // ★ 与显式 UV 约定配套（见文件头）
  tex.colorSpace = THREE.SRGBColorSpace;    // 真实显示色（区别于 FTX 的线性 HSL 数据）
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ============================================================
// 双纹理烘焙（主地图现行路径，见文件头方案说明）
// ============================================================

/** 光照图分辨率（阴影/AO 是低频信息，半分辨率足够） */
const LIGHT_RES = 128;

/** 烘焙太阳（美术定光源；hx/hz=指向太阳的水平单位向量，tan=射线爬升率）。
 *  仰角 45°、光来自西南——集中此处调参。 */
const BAKE_SUN = { hx: -0.7071, hz: -0.7071, tan: 1.0 };

/** 投影门槛：遮挡物须高出接收面 ≥ 此值才投影
 *  （道路自身抖动 ±0.3m 不投影；高台落差 ≥1.5m 必投影） */
const CAST_MIN_DEPTH = 0.5;
/** 射线射程（米）：高台柱体最厚 ~4m + 斜向余量 */
const CAST_RANGE = 16;
const CAST_STEP = 1.25;
/** 半影：遮挡超出射线的厚度在此范围内从 0 渐变到全影（米） */
const CAST_PENUMBRA = 1.1;
/** 全影时直射项的保留比例（模拟天空散射；越小影子越深。0=物理纯黑，观感死板） */
const SHADOW_FLOOR = 0.12;
/** N·L wrap（0=朗伯硬边；轻微软化明暗交界——现只用于顶面常数推导） */
const NL_WRAP = 0.15;
/** 光照图双边模糊（不过高度断崖——影子不得爬上台顶，踩过的坑） */
const LIGHT_BLUR_R = 1;
const LIGHT_BLUR_PASSES = 1;

/** 双纹理烘焙产物 */
export interface ChunkMaps {
  /** 材质色图（纯颜色，无明暗；sRGB） */
  albedo: THREE.CanvasTexture;
  /** 光照图（R=直射项 N·L×阴影可见度 / G=AO / B 预留；线性空间数据） */
  lightmap: THREE.CanvasTexture;
}

/**
 * 烘焙一个 chunk 的双纹理外观（主地图入口）。
 * 同 (seed, cx, cz) 输出确定一致；两张纹理随 chunk 销毁时 dispose。
 */
export function bakeChunkMaps(terrain: TerrainBakeSource, cx: number, cz: number): ChunkMaps {
  return {
    albedo: bakeAlbedoCanvas(terrain, cx, cz),
    lightmap: bakeLightCanvas(terrain, cx, cz),
  };
}

/** Pass A —— 材质色图（256²）：底色/抖动/斑块/描边/拉丝/大尺度斑驳 */
function bakeAlbedoCanvas(terrain: TerrainBakeSource, cx: number, cz: number): THREE.CanvasTexture {
  const S = APPEARANCE_RES;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const seed = terrain.worldSeed;
  const step = CHUNK_SIZE / S;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const lx = (px + 0.5) * step;
      const lz = (py + 0.5) * step;
      const wx = originX + lx;
      const wz = originZ + lz;

      // 类型判定 + 坑/水侧壁上段修正（语义与旧路径一致，见旧循环注释）
      let td = terrain.tileDefAt(wx, wz);
      if (td.isDepression && terrain.surfaceHeightAt(wx, wz) > 0) {
        td = tileById(0);
      }

      // 基准色 → 逐地块 HSL 抖动 → RGB
      const tx = Math.floor(wx / 4);
      const tz = Math.floor(wz / 4);
      let [r, g, b] = hsl2rgb(
        td.visual.baseHsl.h + (hash2(tx, tz, seed + 101) - 0.5) * 2 * td.visual.jitter.h,
        td.visual.baseHsl.s * (1 + (hash2(tx, tz, seed + 202) - 0.5) * 2 * td.visual.jitter.s),
        td.visual.baseHsl.l * (1 + (hash2(tx, tz, seed + 303) - 0.5) * 2 * td.visual.jitter.l),
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
      img.data[i]     = Math.min(255, r * shade);
      img.data[i + 1] = Math.min(255, g * shade);
      img.data[i + 2] = Math.min(255, b * shade);
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Pass B —— 光照图（128²）：R=N·L wrap × 阴影可见度，G=AO */
function bakeLightCanvas(terrain: TerrainBakeSource, cx: number, cz: number): THREE.CanvasTexture {
  const S = LIGHT_RES;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const step = CHUNK_SIZE / S;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // 顶面直射常数：顶面全平（块状地图），N·L 恒定——不用逐像素法线，
  // 消除断崖边缘 ±1m 的法线光晕伪影
  const ly = BAKE_SUN.tan / Math.hypot(1, BAKE_SUN.tan);
  const TOP_DIRECT = (ly + NL_WRAP) / (1 + NL_WRAP);

  // ---- Pass B1：原始场（高度/直射/AO；侧壁带单独着色）----
  const heights = new Float32Array(S * S);
  const directF = new Float32Array(S * S);
  const aoF = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const wx = originX + (px + 0.5) * step;
      const wz = originZ + (py + 0.5) * step;
      const h = terrain.heightAt(wx, wz);
      heights[py * S + px] = h;

      const hL = terrain.heightAt(wx - 1, wz);
      const hR = terrain.heightAt(wx + 1, wz);
      const hD = terrain.heightAt(wx, wz - 1);
      const hU = terrain.heightAt(wx, wz + 1);
      // （hL/hR/hD/hU 供模糊权重参考；直射项按平顶常数处理——
      //   侧壁形体感由 ChunkWalls 独立几何承担，不再污染地面贴图）

      // 顶面：常数直射 × 投影可见度（留底防死黑）
      let sh = 0;
      for (let d = CAST_STEP; d <= CAST_RANGE && sh < 1; d += CAST_STEP) {
        const th = terrain.heightAt(wx + BAKE_SUN.hx * d, wz + BAKE_SUN.hz * d);
        if (th - h < CAST_MIN_DEPTH) continue;          // 台阶不投影
        const over = th - (h + BAKE_SUN.tan * d);       // 遮挡超出射线的厚度
        if (over <= 0) continue;
        const s = over / CAST_PENUMBRA;                 // 半影渐变
        if (s > sh) sh = s > 1 ? 1 : s;
      }
      const direct = TOP_DIRECT * (SHADOW_FLOOR + (1 - SHADOW_FLOOR) * (1 - sh));

      // AO（凹陷地块均匀跳过——深度感由几何侧壁承担）
      let ao = 1;
      const td = terrain.tileDefAt(wx, wz);
      if (!(td.isDepression && terrain.surfaceHeightAt(wx, wz) <= 0)) {
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = terrain.heightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
          if (dh > 0) occ += Math.min(dh, 2.5);
        }
        ao = Math.max(AO_MIN, 1 - (occ / 8) * AO_STRENGTH);
      }

      directF[py * S + px] = direct;
      aoF[py * S + px] = ao;
    }
  }

  // ---- Pass B2：高度加权双边模糊 ×N（柔化但不过断崖；乒乓缓冲）----
  {
    const tmpD = new Float32Array(S * S), tmpA = new Float32Array(S * S);
    for (let pass = 0; pass < LIGHT_BLUR_PASSES; pass++) {
      blurAxis(directF, aoF, heights, tmpD, tmpA, S, true);   // 水平轴
      blurAxis(tmpD, tmpA, heights, directF, aoF, S, false);  // 垂直轴（读tmp写回原场，安全）
    }
  }

  // ---- Pass B3：写 canvas ----
  for (let i = 0; i < S * S; i++) {
    img.data[i * 4]     = Math.round(Math.min(1, directF[i]) * 255);
    img.data[i * 4 + 1] = Math.round(Math.min(1, aoF[i]) * 255);
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = false;                       // 与 albedo 同 UV 约定
  // colorSpace 保持默认（线性数据乘数，不做 sRGB 解码）
  tex.generateMipmaps = false;             // 低频光照不需要 mip
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---- 光照图内部工具 ----

/** 单轴双边盒式模糊（权重按高度差衰减——影子不跨断崖；读src写out，禁止别名） */
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
