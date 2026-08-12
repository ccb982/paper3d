// ============================================================
// BulletBase —— 子弹基类（EntityBase 子类）
// ============================================================
// 物理：dynamic 球体 + 初速（直线/追踪），read 模式（物理驱动位置）
// 生命周期：命中/超时/超距 → 销毁（回池由 EntityManager 池化做，后续）
// 阵营：创建时锁定（碰撞过滤在 PhysicsWorld 层）

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';

export interface BulletOptions extends Omit<EntityBaseOptions, 'physics' | 'kind'> {
  /** 发射方向（3D 单位向量；含竖直分量 dirY = 准星俯仰） */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** 初速（世界单位/秒） */
  speed: number;
  /** 阵营（碰撞过滤：同阵营不伤） */
  camp: 'player' | 'ally' | 'enemy';
  /** 存活时间（秒），超时自动销毁 */
  lifetime?: number;
  /** 半径 */
  radius?: number;
}

export class BulletBase extends EntityBase {
  /** ★ 子弹碰撞体积（实例基类属性：球体） */
  readonly collisionVolume: { shape: import('../services/physics/PhysicsWorld').ColliderShape; offsetY: number } = {
    shape: { type: 'ball', radius: 0.08 },
    offsetY: 0,
  };
  private lifetime: number;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: FrameAssetSource,
    opts: BulletOptions,
  ) {
    super(em, {
      kind: 'bullet',
      x: opts.x, y: opts.y, z: opts.z,
      physics: {
        type: 'dynamic',
        options: {
          shape: { type: 'ball', radius: opts.radius ?? 0.08 },
          canSleep: false,
          gravityScale: 0, // ★ 无重力：直线弹道
        },
      },
      asset,
    });
    this.camp = opts.camp;
    this.lifetime = opts.lifetime ?? 2;
    this.physicsMode = 'read'; // 物理飞行 → 位置读回
    this.attachToScene(scene);

    // 贴片配置：中心锚点（贴片中心 = 物理球心）+ 小尺寸 + 纹理映射
    const pair = asset.getFramePair(0);
    if (pair && this.renderer) {
      (this.renderer as FTXQuad).setAnchorBottom(false);
      (this.renderer as FTXQuad).setFrameMapping(
        { width: pair.base.image.width, height: pair.base.image.height },
        { x: 0, y: 0, w: pair.base.image.width, h: pair.base.image.height },
      );
      this.renderer.setScale(0.12, 0.12);
    }

    // 发射（初速，3D 方向：含竖直分量）
    const rb = this.entity.rigidBody;
    if (rb) {
      const len = Math.hypot(opts.dirX, opts.dirY, opts.dirZ) || 1;
      em.physics?.setLinearVelocity(
        rb.handle,
        (opts.dirX / len) * opts.speed,
        (opts.dirY / len) * opts.speed,
        (opts.dirZ / len) * opts.speed,
      );
    }
  }

  /** ★ 命中处理（实体管线碰撞分发）：同阵营忽略 → 命中销毁（含静态世界）
   *   ⚠ 伤害结算后续接（当前只验证飞行与碰撞） */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!started) return;
    if (other && other.camp === this.camp) return; // 同阵营不伤（friend 不伤 friend）
    console.log(`[bullet] 命中 ${other ? other.constructor.name : '静态世界'}，销毁`);
    this.dispose();
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }

  protected override onUpdate(dt: number): void {
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.dispose(); // 超时销毁（回池后续）
    }
  }
}
