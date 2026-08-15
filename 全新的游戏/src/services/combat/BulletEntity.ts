// ============================================================
// BulletEntity —— 纯子弹实体（物理/碰撞/寿命，零渲染）
// ============================================================
// 实体信息完全独立：位置（物理 read）/速度/寿命/阵营/伤害。
// 不持有纹理、不持有渲染器、不参与 3D 场景绘制——
// 绘制由 BulletRenderer 从"位置+速度"快照完成（架构解耦）。

import { EntityBase } from '../../entity/EntityBase';
import type { EntityManager } from '../../entity/EntityManager';
import type { FrameAssetSource } from '../fx/AssetSource';
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

  /**
   * ★ 飞行方向解析（基类公共函数）：
   *   速度 3D 方向；零速（静止/纯竖直前的一帧）→ 保持上次方向（反弹/静止无跳变）。
   */
  static resolveFlightDirection(
    velocity: { x: number; y: number; z: number },
    last: { x: number; y: number; z: number } | null,
  ): { x: number; y: number; z: number } {
    if (Math.hypot(velocity.x, velocity.y, velocity.z) > 1e-6) {
      return { x: velocity.x, y: velocity.y, z: velocity.z };
    }
    if (last && Math.hypot(last.x, last.y, last.z) > 1e-6) {
      return { x: last.x, y: last.y, z: last.z };
    }
    return { x: 0, y: 0, z: 1 };
  }

  /**
   * ★ 渲染朝向（提取为子弹基类公共函数，只绕头尾轴旋转）：
   *   - 长轴（头尾，头向前）= 【速度方向全 3D 共线】——反弹后速度变向，
   *     头尾轴自动跟随新方向（不会"横着走"）
   *   - 绕长轴滚转使【平面法线尽量朝相机】→ 摄像机看到的子弹面积最大
   *     （标准 velocity-aligned billboard）
   *   - 视线沿长轴（正对/背对飞行）→ 法线退化为世界 up ⊥ 长轴
   * 返回右手系基：long（头尾）、normal（平面法线）、right = long × normal（宽）。
   */
  static computeRenderTransform(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    camPos: { x: number; y: number; z: number },
  ): {
    right: { x: number; y: number; z: number };
    long: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  } {
    // 长轴（头尾，头向前）：与速度方向全 3D 共线（取反：纹理上端 = 弹头朝前）
    let lx = -velocity.x, ly = -velocity.y, lz = -velocity.z;
    const llen = Math.hypot(lx, ly, lz);
    if (llen < 1e-6) { lx = 1; ly = 0; lz = 0; } else { lx /= llen; ly /= llen; lz /= llen; }
    // 视线（子弹 → 相机）
    let vx = camPos.x - position.x, vy = camPos.y - position.y, vz = camPos.z - position.z;
    const vlen = Math.hypot(vx, vy, vz);
    if (vlen < 1e-6) { vx = 0; vy = 1; vz = 0; } else { vx /= vlen; vy /= vlen; vz /= vlen; }
    // 法线 = 视线投影 ⊥ 长轴（绕头尾轴滚转到最朝相机 → 面积最大）
    const dot = vx * lx + vy * ly + vz * lz;
    let nx = vx - lx * dot, ny = vy - ly * dot, nz = vz - lz * dot;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-6) {
      // 视线沿长轴（正对/背对飞行）：世界 up ⊥ 长轴兜底；长轴竖直时用 +x
      nx = 0; ny = 1; nz = 0;
      if (Math.abs(ly) > 0.99) { nx = 1; ny = 0; nz = 0; }
    } else {
      nx /= nlen; ny /= nlen; nz /= nlen;
    }
    // right = long × normal（右手系）
    const rx = ly * nz - lz * ny;
    const ry = lz * nx - lx * nz;
    const rz = lx * ny - ly * nx;
    return {
      right: { x: rx, y: ry, z: rz },
      long: { x: lx, y: ly, z: lz },
      normal: { x: nx, y: ny, z: nz },
    };
  }

  /**
   * ★ 实例矩阵（基类公共函数）：computeRenderTransform + 弹头锚点 + 缩放
   *   → 列主序 16 元素写入 target[offset..offset+16]（零分配，渲染器直接消费）。
   *   弹头锚点：quad 中心 = 实体位置 - long × 半高（弹头端压在碰撞点）。
   */
  static writeRenderMatrix(
    target: Float32Array | number[],
    offset: number,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    camPos: { x: number; y: number; z: number },
    size: { width: number; height: number },
  ): void {
    const t = this.computeRenderTransform(position, velocity, camPos);
    const halfH = size.height / 2;
    target[offset] = t.right.x * size.width;
    target[offset + 1] = t.right.y * size.width;
    target[offset + 2] = t.right.z * size.width;
    target[offset + 3] = 0;
    target[offset + 4] = t.long.x * size.height;
    target[offset + 5] = t.long.y * size.height;
    target[offset + 6] = t.long.z * size.height;
    target[offset + 7] = 0;
    target[offset + 8] = t.normal.x;
    target[offset + 9] = t.normal.y;
    target[offset + 10] = t.normal.z;
    target[offset + 11] = 0;
    target[offset + 12] = position.x - t.long.x * halfH;
    target[offset + 13] = position.y - t.long.y * halfH;
    target[offset + 14] = position.z - t.long.z * halfH;
    target[offset + 15] = 1;
  }

  /** ★ 世界尺寸（基类公共函数）：宽 = baseWidth（默认 3.0），高按纹理宽高比 */
  static computeWorldSize(asset: FrameAssetSource, baseWidth = 3.0): { width: number; height: number } {
    const pair = asset.getFramePair(0);
    const aspect = pair ? pair.base.image.height / pair.base.image.width : 3.79;
    return { width: baseWidth, height: baseWidth * aspect };
  }
}
