// ============================================================
// DroneEntity —— 可露希尔的无人机（召唤物实体）
// ============================================================
// 复用 EntityBase 动画/渲染/影子管线：
//   - 特效包三帧实为三图层（主体/左翅膀/右翅膀，共享同一画布）
//     → DroneCompositeRender 复合渲染：
//       主体 = FTXQuad 静态贴片；
//       双翼 = 播放器区域实体 VAT 管线（整翼矩形重建 + 恒等 uv）→ 离屏 RT → billboard quad，
//             用本实体 AnimationVAT 连续时钟（FrameAnimatorBase.localTime）驱动
//   - 无物理刚体：悬浮体，位置由 WorldMode 每帧钉在玩家侧上方（hover 目标）
// ============================================================

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { Asset } from '../vendor/player';
import type { FtxAsset } from '../vendor/player/FtxAsset';
import { DroneCompositeRender } from '../services/render/DroneCompositeRender';
import { RasterMap } from '../services/map/RasterMap';

export interface DroneOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 贴片放大（默认 1.2） */
  scale?: number;
}

export class DroneEntity extends EntityBase {
  /** 悬浮目标（世界坐标；WorldMode 每帧设为玩家侧上方偏移） */
  readonly hoverTarget = { x: 0, y: 0, z: 0 };
  /** 悬浮相位（正弦摆动用） */
  private phase = 0;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset | FtxAsset,
    opts: DroneOptions,
  ) {
    super(em, {
      kind: 'decoration',
      x: opts.x, y: opts.y, z: opts.z,
      asset,
      animInitial: opts.animInitial,
    });
    this.camp = 'neutral';
    this.billboard = true;
    // ★ 无人机豁免视锥裁剪 + 距离 LOD：LOD≥2 会冻结动画时间轴（FrameAnimatorBase.update），
    //   双翼 VAT 连续时钟（localTime）随之停摆 → 必须全程满档
    this.lodExempt = true;
    this.attachToScene(scene);

    // 按画布宽高比设贴片尺寸（宽 = baseSize；不压扁）
    const r = this.renderer as DroneCompositeRender | null;
    if (r) r.setScaleKeepAspect(opts.scale ?? 1.2);
  }

  protected createRenderer(scene: THREE.Scene): DroneCompositeRender {
    return new DroneCompositeRender(scene, this.anim!.source as Asset | FtxAsset, this.anim);
  }

  /** ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享上下文 */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    const r = this.renderer as DroneCompositeRender | null;
    if (r) r.setRenderer(renderer);
  }

  /** ★ 贴片数学上不带碰撞/影子：只保留基类漂浮逻辑 */
  protected override onUpdate(dt: number): void {
    void dt;
  }

  /** ★ 每帧由 WorldMode 调用：把位置钉到 hoverTarget 附近（带上下漂浮正弦） */
  flyTo(dt: number): void {
    this.phase += dt * 2.2;
    const t = this.hoverTarget;
    const p = this.entity.position;
    // 逼近目标（平滑追踪，避免瞬移）
    p.x += (t.x - p.x) * Math.min(1, dt * 6);
    p.z += (t.z - p.z) * Math.min(1, dt * 6);
    // 离地高度：目标 y 基础上加轻微正弦漂浮
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const baseY = Math.max(t.y, gy + 1.2);
    p.y += (baseY + Math.sin(this.phase) * 0.18 - p.y) * Math.min(1, dt * 6);
  }

  /** 影子：无人机悬浮高，关闭贴地剪影 */
  protected override get shadowShape(): { w: number; h?: number; alpha?: number } | null {
    return null;
  }

  override dispose(): void {
    super.dispose();
  }
}