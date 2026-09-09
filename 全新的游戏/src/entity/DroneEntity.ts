// ============================================================
// DroneEntity —— 可露希尔的无人机（召唤物实体）
// ============================================================
// 复用 EntityBase 动画/渲染/影子管线：
//   - 特效包三帧实为三图层（主体/左翅膀/右翅膀，共享同一画布）
//     → DroneCompositeSource CPU 合成进一张纹理，FTXQuad 立牌同时显示全部图层
//   - 无物理刚体：悬浮体，位置由 WorldMode 每帧钉在玩家上方（hover 目标）
// ============================================================

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { Asset } from '../vendor/player';
import type { FtxAsset } from '../vendor/player/FtxAsset';
import { DroneCompositeSource } from '../services/fx/DroneCompositeSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { RasterMap } from '../services/map/RasterMap';

export interface DroneOptions extends Omit<EntityBaseOptions, 'kind'> {
  /** 贴片放大（默认 1.2） */
  scale?: number;
}

export class DroneEntity extends EntityBase {
  /** 悬浮目标（世界坐标；WorldMode 每帧设为玩家上方偏移） */
  readonly hoverTarget = { x: 0, y: 0, z: 0 };
  /** 悬浮相位（正弦摆动用） */
  private phase = 0;
  /** 三图层合成源（本实体专有，dispose 时释放纹理） */
  private composite: DroneCompositeSource;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: Asset | FtxAsset,
    opts: DroneOptions,
  ) {
    // ★ 三图层合成源作为动画资产源：合成后整机一张帧，无帧序/动画
    const composite = new DroneCompositeSource(asset);
    super(em, {
      kind: 'decoration',
      x: opts.x, y: opts.y, z: opts.z,
      asset: composite,
      animInitial: opts.animInitial,
    });
    this.composite = composite;
    this.camp = 'neutral';
    this.billboard = true;
    this.attachToScene(scene);

    // 全画布 bbox 映射（合成纹理 = 整张共享画布 → 原点 0）
    const r = this.renderer as FTXQuad | null;
    if (r && this.composite) {
      const { width, height } = this.composite;
      r.setFrameMapping(
        { width, height },
        { x: 0, y: 0, w: width, h: height },
      );
    }
    // 按画布宽高比设贴片尺寸（宽 = baseSize；不压扁）
    this.applyRenderScale(opts.scale ?? 1.2);
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    // 渲染源 = 合成后的完整无人机（anim.source 已是 DroneCompositeSource）
    return new FTXQuad(scene, this.anim!.source);
  }

  /** ★ 按纹理宽高比设贴片尺寸（不压扁；宽 = baseSize） */
  private applyRenderScale(baseSize: number): void {
    const r = this.renderer as FTXQuad | null;
    if (r && 'setScaleKeepAspect' in r) {
      (r as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(baseSize);
    }
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
    this.composite.dispose();
  }
}