// ============================================================
// BulletEntity —— 纯子弹实体（物理/碰撞/寿命，零渲染）
// ============================================================
// 实体信息完全独立：位置（物理 read）/速度/寿命/阵营/伤害。
// 不持有纹理、不持有渲染器、不参与 3D 场景绘制——
// 绘制由 BulletRenderer 从"位置+速度"快照完成（架构解耦）。

import { EntityBase } from '../../entity/EntityBase';
import type { EntityManager } from '../../entity/EntityManager';
import { applyDamage } from './DamagePipeline';

export interface BulletEntityOptions {
  /** 出生点（世界坐标） */
  x: number;
  y: number;
  z: number;
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
  /** 伤害值（穿透命中实体时结算） */
  damage?: number;
}

export class BulletEntity extends EntityBase {
  /** ★ 子弹碰撞体积（球体；弹头锚点由渲染器折叠进实例变换） */
  readonly collisionVolume: { shape: import('../../services/physics/PhysicsWorld').ColliderShape; offsetY: number } = {
    shape: { type: 'ball', radius: 0.08 },
    offsetY: 0,
  };
  private lifetime = 0;
  private damage = 0;
  private active = false;
  /** ★ 回收回调（BulletManager 注册：超时 → 回池） */
  recycle: (() => void) | null = null;

  get isActive(): boolean {
    return this.active;
  }

  constructor(
    em: EntityManager,
    opts: BulletEntityOptions,
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
          ccd: true,          // ★ 连续碰撞检测：防隧穿
          restitution: 0.8,   // ★ 反弹：打地面/墙弹起
        },
      },
      // ★ 无 asset：不建动画/渲染器——纯物理实体
    });
    this.camp = opts.camp;
    this.physicsMode = 'read'; // 物理飞行 → 位置读回
    // ★ 初始即失活（入池状态）：退出管线 + 藏到地图外
    this.deactivate();
  }

  /** ★ 激活发射（池化复用：重入管线 + 设位置/速度/寿命） */
  activate(opts: BulletEntityOptions): void {
    this.camp = opts.camp;
    this.lifetime = opts.lifetime ?? 2;
    this.damage = opts.damage ?? 10;
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

  /** ★ 命中处理：同阵营忽略 / 命中实体穿透+伤害管线 / 地面反弹 */
  override onCollision(other: EntityBase | null, started: boolean): void {
    if (!this.active) return;
    if (!started) return;
    if (other && other.camp === this.camp) return;
    if (other) {
      const r = applyDamage(this.damage, this, other);
      console.log(`[bullet] 命中 ${other.constructor.name}，穿透${r.crit ? '【暴击】' : ''}（-${r.final}）`);
      return;
    }
    console.log('[bullet] 命中 地面，反弹');
  }

  protected override onUpdate(dt: number): void {
    if (!this.active) return;
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.deactivate(); // 超时回池（复用，不销毁）
      this.recycle?.();
    }
  }

  /** ★ 纯物理实体：不创建任何渲染器（绘制由 BulletRenderer 完成） */
  protected createRenderer(): null {
    return null;
  }

  /** ★ 渲染器快照：当前速度（物理；反弹后自动更新） */
  get velocity(): { x: number; y: number; z: number } {
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) return this.em.physics.getLinearVelocity(rb.handle);
    return { x: 0, y: 0, z: 0 };
  }
}
