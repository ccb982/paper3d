import * as THREE from 'three';
import { FluidSolver } from './FluidSolver';
import { buildFullConfig } from './config';
import { buildBaseHslData, buildResidualData } from '../core/ftx';
import { rasterizeBoundaryToObstacle, buildObstacleTextureFromBitmask } from './rasterize';
import { buildRegionWallMask, packToBits } from './regionWallMask';
import type { FrameTextureData, PaletteColor, SerializedRegionEntity, PhysicsConfig } from '../core/types';

// ============================================================
// FluidEffect —— 单帧流体模拟运行时（播放器）
// ============================================================
//
// 职责：
//   1. 由素材包 physics 配置 + FTX 帧数据构建 FluidSolver：
//      - buildBaseHslData → setBaseHsl（MCSDA 基础色）
//      - buildResidualData → loadResidual（量化残差，被平流）
//      - 区域实体边界 → 障碍物纹理（限制流体在区域内）
//   2. 每帧 step(dt) + composite()，渲染层读取 getCompositeTexture()
//      喂给网格的 uColorTex，复用模板裁剪 + VAT 位移 + textureOffset/Scale/Rotation。
//
// 坐标系约定（与主编辑器一致）：
//   - 残差/基础纹理 flipY=false，row 0 = world 顶部
//   - 注入源位置 = bbox 局部归一化 (0~1)，Y 向下为正
/**
 * ★★ 死亡特效的流体场总像素上限（2026-11-13 强压缩）。
 * 实测：33 个死亡实例按帧 bbox 原尺寸分配 = **237.5 MB**。
 * 显存 ≈ 54 B/px（6 张双缓冲网格 30 + composite 4 + base 16 + residual 4）
 * ⇒ 限到 128×128 = 16384 px ⇒ 单实例 ≈ 0.9MB，33 个 ≈ 28MB（约 1/8）。
 * ★ 死亡消散是"黑雾"，上限 128 边糊一点完全看不出来。
 *
 * ⚠ **只给死亡特效用**：构造函数的 `maxPixels` **默认 Infinity（不压缩）** ——
 *   抽卡背景 / 受击染料 / 祖宗 / 图标都是显式决定要不要压，默认行为与压缩前完全一致。
 */
export const DEATH_FLUID_MAX_PIXELS = 181 * 181;

/** HSL(0~1 浮点) → RGBA8：死亡特效是黑白灰，8 位完全够（见 `setBaseHslQuantized`）。 */
function quantizeHslToU8(src: Float32Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
  }
  return out;
}

export class FluidEffect {
  readonly solver: FluidSolver;
  private resolution: { w: number; h: number };
  /** base 是否走 RGBA8（仅压缩实例；见 `setBaseHslQuantized`） */
  private readonly quantizedBase: boolean;

  constructor(
    renderer: THREE.WebGLRenderer,
    physics: PhysicsConfig,
    frame: FrameTextureData,
    private readonly palette: PaletteColor[],
    entities: SerializedRegionEntity[],
    /** ★ 流体场总像素上限。**默认 Infinity = 不压缩**（保持所有既有调用点的行为）；
     *  只有死亡特效显式传 `DEATH_FLUID_MAX_PIXELS`。 */
    maxPixels = Infinity,
  ) {
    // 解算器分辨率 = 帧纹理 bbox 尺寸（与残差 1:1，避免量化错位）
    // ★★ 2026-11-13：加**总像素上限**（保持宽高比）—— 33 个死亡实例按原尺寸 = 237MB，
    //   限到 16K px 后 ≈ 28MB。base/residual 同步降采样，否则它们仍按原尺寸占显存。
    const bbox = frame.bbox;
    const area = Math.max(1, bbox.w * bbox.h);
    const compressed = area > maxPixels;
    const scale = compressed ? Math.sqrt(maxPixels / area) : 1;
    // ★ base 量化只在"真的压过"的实例上开（抽卡背景/染料保持 Float32，避免 banding）
    this.quantizedBase = compressed;
    this.resolution = {
      w: Math.max(8, Math.round(bbox.w * scale)),
      h: Math.max(8, Math.round(bbox.h * scale)),
    };
    const { w: rw, h: rh } = this.resolution;

    const cfg = buildFullConfig(physics, this.resolution);
    this.solver = new FluidSolver(renderer, cfg, this.resolution);

    // 1+2. 残差 → colorGrid、基础色 → MCSDA（都按 resolution 降采样后上传）
    this.loadFrameInto(frame);

    // 3. 障碍物：优先 physics.obstacle 掩码 → regionWalls 自主生成 → 区域实体边界光栅化
    let obstacle: THREE.DataTexture | null = null;
    const mask = physics.obstacle;
    if (mask && mask.width > 0 && mask.height > 0 && mask.data) {
      obstacle = buildObstacleTextureFromBitmask(
        mask.width, mask.height, mask.data, bbox.w, bbox.h,
      );
    }
    // ★ 色块交界自动加墙：无导出位图时，按帧调色板 ID 在大色块边界生成墙
    //   （算法 = 编辑器 editor/regionWallMask.ts 的游戏端移植；流体被物理隔离
    //    在各色块内，数值扩散无法跨墙搬运颜色）
    if (!obstacle && physics.regionWalls && frame.regionIdTex) {
      const r = buildRegionWallMask(
        frame.regionIdTex, bbox.w, bbox.h,
        { minAreaRatio: physics.regionWallsMinAreaRatio ?? 0.004 },
      );
      // 位打包 → Base64（与 physics.obstacle 导出格式一致；平台已用 atob 同族 API）
      const bits = packToBits(r.mask);
      let bin = '';
      for (let i = 0; i < bits.length; i++) bin += String.fromCharCode(bits[i]);
      obstacle = buildObstacleTextureFromBitmask(
        r.width, r.height, btoa(bin), bbox.w, bbox.h,
      );
    }
    if (!obstacle) {
      // 取第一个有效实体（多实体时取第一个区域限制流体）
      for (const ent of entities) {
        if (ent.boundary.length > 0 && ent.boundary[0].length >= 3) {
          obstacle = rasterizeBoundaryToObstacle(
            ent.boundary, bbox.w, bbox.h,
          );
          break;
        }
      }
    }
    this.solver.setObstacleTexture(obstacle);

    // 4. Level Set 启用时重置 φ 场（反映真实浓度分布）
    if (cfg.levelSetConfig?.enabled) {
      this.solver.resetLevelSet();
    }

    // 5. 首帧合成，立即产出可显示纹理
    this.solver.composite();
  }

  /** ★ 流体场**实际分配**的像素数（已含 `maxPixels` 压缩后的 resolution） */
  get fluidPixels(): number {
    return this.resolution.w * this.resolution.h;
  }

  /** ★ 估算显存占用（B/px 口径：6 张双缓冲网格 30 + composite 4 + residual 4
   *  + base：量化 4 / 未量化 16）。与 `[DeathFx]` 日志一致，改网格结构时同步。 */
  get estimatedBytes(): number {
    const perPx = 30 + 4 + 4 + (this.quantizedBase ? 4 : 16);
    return this.fluidPixels * perPx;
  }

  /** ★ 载入一帧的残差 + 基础色（**直接按 `resolution` 生成**）。
   *  ★★ 2026-11-14：不再"先生成原尺寸大数组、再最近邻降采样" —— 那会在加载瞬间
   *    多分配一份原尺寸内存（33 个实例叠起来很可观）。现在解码循环直接按目标尺寸采样，
   *    峰值内存 = 目标尺寸一份。 */
  private loadFrameInto(frame: FrameTextureData): void {
    const { w: rw, h: rh } = this.resolution;

    const residual = buildResidualData(frame, rw, rh);
    if (residual) {
      this.solver.loadResidual(residual.data, residual.width, residual.height);
    }

    const baseHsl = buildBaseHslData(frame, this.palette, rw, rh);
    if (baseHsl) {
      // ★ 压缩实例：base 用 RGBA8（16 → 4 B/px）—— 死亡特效是黑白灰，8 位绰绰有余
      if (this.quantizedBase) {
        this.solver.setBaseHslQuantized(quantizeHslToU8(baseHsl.data), rw, rh);
      } else {
        this.solver.setBaseHsl(baseHsl.data, rw, rh);
      }
    } else {
      this.solver.clearBaseHsl();
    }
  }

  /** ★ 复用换帧（死亡特效池，用户定 2026-09-30）：载入新帧残差/基础色 → 清运动场/爆炸 → 重建 φ */
  resetFrame(frame: FrameTextureData): void {
    this.loadFrameInto(frame);
    this.solver.reset();
    this.solver.resetLevelSet();
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.solver.step(dt);
    this.solver.composite();
  }

  /**
   * 手动注入：在纹理 UV 坐标（0~1，Y 向下）处注入流体。
   * 以第一个启用源为模板（颜色/浓度/速度），位置替换为注入点。
   */
  injectAt(uv: { x: number; y: number }): void {
    const src = this.solver.config.continuousSources.find(s => s.enabled)
      ?? this.solver.config.continuousSources[0];
    this.solver.queueInjection({
      enabled: true,
      position: {
        x: Math.min(1, Math.max(0, uv.x)),
        y: Math.min(1, Math.max(0, uv.y)),
      },
      radius: 0.08,
      velocity: src?.velocity ?? { x: 0, y: 300 },
      ...(src?.color ? { color: src.color } : {}),
      ...(src?.density !== undefined ? { density: src.density } : {}),
      rate: 1.0,
    });
  }

  getCompositeTexture(): THREE.Texture | null {
    return this.solver.getCompositeTexture();
  }

  dispose(): void {
    this.solver.dispose();
  }
}
