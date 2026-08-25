// ============================================================
// Boss4DAppearance —— 【已封存废案】四维空间 Boss 战专用烘焙器
// ============================================================
// ★ 来源：2026-08-25 主地图光影迭代失败的完整存档（双尺度AO+静态日照投影
//   全套保留）。失败特征意外契合最终 Boss 战主题，原样封存：
//   纯几何台阶感 + 透视拉伸错乱 + 贴面穿插——正是四维空间想要的破碎观感。
// ★ 启用方式：Boss 模式调用 bakeBoss4DAppearance() 替代标准外观纹理，
//   配合 Boss4DArena.buildBoss4DChunk() 的侧壁网格使用。主地图勿用。
//
// 烘焙内容（逐像素）：
//   类型底色 × hash2 噪声明暗 × 双尺度 AO（接触 + 环境）
//   × 静态日照投影（地形自遮挡，高度场光线步进；★ 固定太阳不随昼夜）
//
// 分界铁律（防重复计费）：
//   - 颜色类 → 全部在这里烘焙
//   - 几何明暗(N·L) → 实时（预计算法线，标准材质自动算）
//     ⚠️ 本文件不做坡向明暗——那会与实时 N·L 双重计费
//   - 地形自投影 → 在这里烘焙（实时阴影图里地形故意不 castShadow，
//     性能决策；静态遮挡属于颜色类，一次烘完）
//   - 实体投影阴影 → 实时（剪影影子系统，唯一动态分量）
//   ⚠️ 启用本 canvas 后，顶点色/AO 必须停用——AO 只能存在一处
//
// 像素 ↔ 世界映射约定：
//   pixel(px,py) ↔ world( cx*60+(px+0.5)*step , cz*60+(py+0.5)*step )
//   配套顶点 UV = (lx/60, lz/60)，texture.flipY = false
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, hash2 } from './ChunkGenerator';
import { hsl2rgb } from './TerrainPalette';
import { tileById } from './Tiles';
import type { RasterMap } from './RasterMap';

/** 外观分辨率（默认 256²；低端机降 128²） */
export const APPEARANCE_RES = 256;

/** AO 参数：双尺度——接触暗部（缝隙/贴边）+ 环境凹陷（旧单尺度）；下限防死黑 */
const AO_RADIUS = 2.5;
const AO_STRENGTH = 0.09;
const AO_MIN = 0.55;
const CONTACT_RADIUS = 0.85;    // ★ 新增：紧贴接触 AO（第二尺度）
const CONTACT_STRENGTH = 0.17;

/** ★ 静态日照投影参数（用户决策：地图光影不随昼夜变化 → 固定太阳观感）
 *  方向承旧 LIGHT_TUNING.sunOffset 的水平方位；仰角刻意低于正午——拖得出影子。
 *  ★ 阴影场在半分辨率预计算 + 盒式模糊柔化（防硬边阴影成片糊死），主循环双线性采样 */
const SHADOW_SUN_HX = 0.851;    // 太阳水平单位向量（指向太阳）
const SHADOW_SUN_HZ = 0.524;
const SHADOW_SUN_TAN = Math.tan((40 * Math.PI) / 180); // 射线爬升率（仰角 40°）
const SHADOW_MAX_DIST = 9;      // 米；更远的高墙不再投影（伪半影外限）
const SHADOW_STEPS = 12;        // 光线步进次数（几何步长覆盖 MAX_DIST）
const SHADOW_STRENGTH = 0.30;   // 最大压暗幅度（★ 与 AO 连乘，勿调回 0.4+——会黑成一团）
/** ★ 最小落差门槛（用户决策：普通高差台阶不投影，只有深坑/峡谷底才有影子。
 *  本地图形是绝对平整的 4m 台阶，物理正确的邻台投影在卡通风里=脏块；
 *  遮挡物须高出接收平面 ≥ 此值才算数 → 台顶/浅台阶永远干净） */
const SHADOW_MIN_DEPTH = 2.2;
const SHADOW_DIV = 2;           // 阴影场分辨率降档（256→128 格）
const SHADOW_BLUR_R = 1;        // 盒式模糊半径（格）
const SHADOW_BLUR_PASSES = 2;   // 模糊遍数
const SHADOW_EDGE_TOL = 0.6;    // ★ 双边模糊：高度差≤此值 = 同一平面，模糊自由跨过
const SHADOW_EDGE_FALL = 1.4;   // ★ 超出容差后权重线性衰减到 0（影子不得翻越断崖）

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
 * @returns 已配置好 colorSpace/filter 的 CanvasTexture（随 chunk 销毁时 dispose）
 */
export function bakeBoss4DAppearance(
  raster: RasterMap,
  cx: number,
  cz: number,
): THREE.CanvasTexture {
  const S = APPEARANCE_RES;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const seed = raster.worldSeed;
  const step = CHUNK_SIZE / S;               // 米/像素
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // ==================== Pass A：静态日照投影场（半分辨率 + 柔化） ====================
  // 纯高度场计算（与 tile 类型无关）；凹陷是否接收在主循环判定
  const SR = Math.max(1, Math.round(S / SHADOW_DIV));
  const sStep = CHUNK_SIZE / SR;
  const field = new Float32Array(SR * SR);
  const hfield = new Float32Array(SR * SR); // 格点高度（双边模糊的权重依据）
  {
    const d0 = (SHADOW_MAX_DIST / SHADOW_STEPS) * 0.5;
    const grow = Math.pow(SHADOW_MAX_DIST / d0, 1 / SHADOW_STEPS); // 几何扩步系数
    for (let sy = 0; sy < SR; sy++) {
      for (let sx = 0; sx < SR; sx++) {
        const wx = originX + (sx + 0.5) * sStep;
        const wz = originZ + (sy + 0.5) * sStep;
        const h = raster.heightAt(wx, wz);
        hfield[sy * SR + sx] = h;
        // 双探针快速预检：沿射线中/远段都无"足够深"的遮挡 → 跳过步进
        // （迷宫墙厚 ≥4m，两探针间隔 ~3.5m 挡不住穿隙漏检）
        const p1 = SHADOW_MAX_DIST * 0.35, p2 = SHADOW_MAX_DIST * 0.75;
        const blocked =
          raster.heightAt(wx + SHADOW_SUN_HX * p1, wz + SHADOW_SUN_HZ * p1) - h >= Math.max(SHADOW_SUN_TAN * p1, SHADOW_MIN_DEPTH) ||
          raster.heightAt(wx + SHADOW_SUN_HX * p2, wz + SHADOW_SUN_HZ * p2) - h >= Math.max(SHADOW_SUN_TAN * p2, SHADOW_MIN_DEPTH);
        if (!blocked) continue;
        let sh = 0, d = d0;
        for (let k = 0; k < SHADOW_STEPS && sh < 0.92; k++) {
          const th = raster.heightAt(wx + SHADOW_SUN_HX * d, wz + SHADOW_SUN_HZ * d);
          const rayY = h + SHADOW_SUN_TAN * d;
          // ★ 最小落差门槛：遮挡物须高出接收平面 ≥SHADOW_MIN_DEPTH
          //   （挡射线且足够"深"——普通 ±1~2 级台阶差直接无视，台顶不投影）
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
    // ---- ★ 双边盒式模糊 ×N（可分离）：亮度柔化但【不过高度断崖】----
    //     普通模糊会让低地的浓影渗过高台边缘、爬上台顶（已踩坑）；
    //     高度差 >TOL 的邻居权重线性衰减到 0 → 半影只在同一平面上展开
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
      let td = raster.tileDefAt(wx, wz);
      if (td.isDepression && raster.surfaceHeightAt(wx, wz) > 0) {
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

      // ---- 双尺度 AO + 静态日照投影 ----
      // ★ 凹陷地块（修正后仍是水/坑的部分 = 0 线以下的底面）：
      //   表面按 ≤0 的平面均匀着色，不参与邻域 AO 与投影接收——否则邻接
      //   高台的高度差会烘进纹理，让水面/坑底出现明暗不均。深度感由几何侧壁承担。
      let ao = 1;
      if (!td.isDepression) {
        const h = raster.heightAt(wx, wz);

        // ① 接触 AO（紧贴尺度：缝隙/贴边暗部）
        let cOcc = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = raster.heightAt(wx + Math.cos(ang) * CONTACT_RADIUS, wz + Math.sin(ang) * CONTACT_RADIUS) - h;
          if (dh > 0) cOcc += Math.min(dh, 1.2);
        }
        const contactAO = 1 - (cOcc / 8) * CONTACT_STRENGTH;

        // ② 环境 AO（旧单尺度：凹陷/谷地压暗）
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = raster.heightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
          if (dh > 0) occ += Math.min(dh, 2.5);
        }
        // ★ 显式下限在"接触×环境"合并后生效——防止多层连乘击穿亮度
        ao = Math.max(AO_MIN, contactAO * (1 - (occ / 8) * AO_STRENGTH));

        // ③ 静态日照投影：采样 Pass A 柔化后的半分辨率阴影场（双线性；
        //    固定太阳见文件头铁律）。★ 只与 AO 相乘一次，强度已调低防黑团
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
