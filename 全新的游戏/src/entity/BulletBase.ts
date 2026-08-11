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
  /** 发射方向（世界 x/z 平面） */
  dirX: number;
  dirZ: number;
  /** 初速（世界单位/秒） */
  speed: number;
  /** 阵营（碰撞过滤） */
  camp: 'player' | 'ally' | 'enemy';
  /** 存活时间（秒），超时自动销毁 */
  lifetime?: number;
  /** 半径 */
  radius?: number;
}

export class BulletBase extends EntityBase {
  readonly camp: string;
  private lifetime: number;
  private fired = false;

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
        },
      },
      asset,
    });
    this.camp = opts.camp;
    this.lifetime = opts.lifetime ?? 2;
    this.physicsMode = 'read'; // 物理飞行 → 位置读回
    this.attachToScene(scene);

    // 发射（初速）
    const rb = this.entity.rigidBody;
    if (rb) {
      const dx = opts.dirX, dz = opts.dirZ;
      const len = Math.hypot(dx, dz) || 1;
      em.physics?.setLinearVelocity(rb.handle, (dx / len) * opts.speed, 0, (dz / len) * opts.speed);
    }
    this.fired = true;
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
