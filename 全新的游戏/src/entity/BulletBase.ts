// ============================================================
// BulletBase —— 子弹基类（EntityBase 子类，池化复用）
// ============================================================
// 物理：dynamic 球体 + 初速（直线/反弹），read 模式（物理驱动位置）
// ★ 池化：BulletManager 预创建 N 颗，activate 发射 / deactivate 回收
//   （失活 = 退出管线 + 藏到地图外 + 清速；不销毁重建，刚体/贴片常驻）
// 生命周期：超时 → 回收（回池）；穿透实体；地面/墙反弹

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
  /** 存活时间（秒），超时回池 */
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
  private lifetime = 0;
  /** ★ 激活状态（失活 = 在池中，不更新不渲染不碰撞处理） */
  private active = false;
  /** ★ 回收回调（BulletManager 注册：超时 → 回池） */
  recycle: (() => void) | null = null;

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
          gravityScale: 0,    // ★ 无重力：直线弹道
          ccd: true,          // ★ 连续碰撞检测：12m/s × 1/60步 ≈ 0.2m > 薄目标 → 防隧穿
          restitution: 0.8,   // ★ 反弹：打地面/墙弹起
        },
      },
      asset,
    });
    this.camp = opts.camp;
    this.physicsMode = 'read'; // 物理飞行 → 位置读回
    this.attachToScene(scene);

    // 贴片配置：中心锚点（贴片中心 = 物理球心）+ 尺寸 + 纹理映射
    const pair = asset.getFramePair(0);
    if (pair && this.renderer) {
      (this.renderer as FTXQuad).setAnchorBottom(false);
      (this.renderer as FTXQuad).setFrameMapping(
        { width: pair.base.image.width, height: pair.base.image.height },
        { x: 0, y: 0, w: pair.base.image.width, h: pair.base.image.height },
      );
      this.renderer.setScale(0.2, 0.2);
    }

    // ★ 初始即失活（入池状态）：退出管线 + 藏到地图外
    this.deactivate();
  }

  /** ★ 激活发射（池化复用：重入管线 + 设位置/速度/寿命） */
  activate(opts: BulletOptions): void {
    this.camp = opts.camp;
    this.lifetime = opts.lifetime ?? 2;
    this.entity.position.x = opts.x;
    this.entity.position.y = opts.y;
    this.entity.position.z = opts.z;
    this.active = true;
    this.visible = true;
    this.em.register(this);
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      this.em.physics?.setPosition(rb.handle, opts.x, opts.y, opts.z);
      const len = Math.hypot(opts.dirX, opts.dirY, opts.dirZ) || 1;
      this.em.physics?.setLinearVelocity(
        rb.handle,
        (opts.dirX / len) * opts.speed,
        (opts.dirY / len) * opts.speed,
        (opts.dirZ / len) * opts.speed,
      );
    }
  }

  /** ★ 失活回收（池化复用：退出管线 + 藏到地图外 + 清速；不销毁） */
  deactivate(): void {
    this.active = false;
    this.visible = false;
    this.em.unregister(this);
    this.entity.position.x = 0;
    this.entity.position.y = -50;
    this.entity.position.z = 0;
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      this.em.physics?.setLinearVelocity(rb.handle, 0, 0, 0);
      this.em.physics?.setPosition(rb.handle, 0, -50, 0);
    }
  }

  /** ★ 命中处理（实体管线碰撞分发）：
   *   - 同阵营 → 忽略
   *   - 命中实体 → 穿透继续飞（伤害结算后续接）
   *   - 命中地面/墙 → 反弹（restitution 0.8，不销毁）
   *   - 超时 → 回收（回池） */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!this.active) return;
    if (!started) return;
    if (other && other.camp === this.camp) return; // 同阵营不伤（friend 不伤 friend）
    console.log(other ? `[bullet] 命中 ${other.constructor.name}，穿透` : '[bullet] 命中 地面，反弹');
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }

  protected override onUpdate(dt: number): void {
    if (!this.active) return;
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.deactivate(); // 超时回池（复用，不销毁）
      this.recycle?.();
    }
  }
}
