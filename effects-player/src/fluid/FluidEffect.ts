import * as THREE from 'three';
import { FluidSolver } from './FluidSolver';
import { buildFullConfig } from './config';
import { buildBaseHslData, buildResidualData } from '../core/ftx';
import { rasterizeBoundaryToObstacle, buildObstacleTextureFromBitmask } from './rasterize';
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
export class FluidEffect {
  readonly solver: FluidSolver;
  private resolution: { w: number; h: number };

  constructor(
    renderer: THREE.WebGLRenderer,
    physics: PhysicsConfig,
    frame: FrameTextureData,
    palette: PaletteColor[],
    entities: SerializedRegionEntity[],
  ) {
    // 解算器分辨率 = 帧纹理 bbox 尺寸（与残差 1:1，避免量化错位）
    const bbox = frame.bbox;
    this.resolution = { w: bbox.w, h: bbox.h };

    const cfg = buildFullConfig(physics, this.resolution);
    this.solver = new FluidSolver(renderer, cfg, this.resolution);

    // 1. 残差 → colorGrid（★ 流体直接作用在残差上）
    const residual = buildResidualData(frame);
    if (residual) {
      this.solver.loadResidual(residual.data, residual.width, residual.height);
    }

    // 2. 基础色 → MCSDA 合成（base 静态 + 残差被平流）
    const baseHsl = buildBaseHslData(frame, palette);
    if (baseHsl) {
      this.solver.setBaseHsl(baseHsl.data, baseHsl.width, baseHsl.height);
    } else {
      this.solver.clearBaseHsl();
    }

    // 3. 障碍物：优先 physics.obstacle 掩码，否则区域实体边界光栅化
    let obstacle: THREE.DataTexture | null = null;
    const mask = physics.obstacle;
    if (mask && mask.width > 0 && mask.height > 0 && mask.data) {
      obstacle = buildObstacleTextureFromBitmask(
        mask.width, mask.height, mask.data, bbox.w, bbox.h,
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

  /** ★ 调试：残差纹理（colorGrid）原始内容——验证残差存在于哪些像素（含基础色=0 区域） */
  getResidualTexture(): THREE.Texture | null {
    return this.solver.getColorTexture?.() ?? null;
  }

  dispose(): void {
    this.solver.dispose();
  }
}
