// ============================================================
// PhysicsWorld —— 物理世界封装（唯一接触 rapier API 的地方）
// ============================================================
// 架构 4.9：游戏代码/实体系统不直接碰 rapier，全部走本封装。
// 提供：刚体创建（按形状）、位置驱动（玩家/运动学）、固定步进、
// 碰撞事件转发（contact / sensor）、球体查询（爆炸/范围）。

import RAPIER from '@dimforge/rapier3d';

export type ColliderShape =
  | { type: 'ball'; radius: number }
  | { type: 'cuboid'; hx: number; hy: number; hz: number }
  /** 胶囊（角色用：贴片宽/高更真实）；halfHeight=半高（不含帽），radius=半径，轴=Y */
  | { type: 'capsule'; halfHeight: number; radius: number };

/** 形状 → rapier 碰撞体描述 */
function makeColliderDesc(shape: ColliderShape): RAPIER.ColliderDesc {
  switch (shape.type) {
    case 'ball':
      return RAPIER.ColliderDesc.ball(shape.radius);
    case 'cuboid':
      return RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
    case 'capsule':
      return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
  }
}

/** 形状 → 查询用几何体（intersectionWithShape 用） */
function makeShape(shape: ColliderShape): RAPIER.Shape {
  switch (shape.type) {
    case 'ball':
      return new RAPIER.Ball(shape.radius);
    case 'cuboid':
      return new RAPIER.Cuboid(shape.hx, shape.hy, shape.hz);
    case 'capsule':
      return new RAPIER.Capsule(shape.halfHeight, shape.radius);
  }
}

export interface BodyOptions {
  shape: ColliderShape;
  /** 线性阻尼（越大越"黏"，玩家用高阻尼防滑） */
  linearDamping?: number;
  /** 是否允许睡眠（默认 true；玩家设 false 保持活跃） */
  canSleep?: boolean;
  /** 是否为传感器（无碰撞响应，仅触发事件） */
  sensor?: boolean;
  /** ★ 重力缩放（默认 1；子弹 0 = 直线弹道） */
  gravityScale?: number;
}

export interface CollisionEvent {
  a: number; // 刚体 handle
  b: number;
  /** 接触开始（true）/ 结束（false） */
  started: boolean;
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private eventQueue: RAPIER.EventQueue;
  private contactHandlers: Array<(e: CollisionEvent) => void> = [];

  constructor(gravity: { x: number; y: number; z: number } = { x: 0, y: -9.8, z: 0 }) {
    this.world = new RAPIER.World(gravity);
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** 创建固定刚体（地面/墙/静态障碍） */
  addFixed(position: { x: number; y: number; z: number }, shape: ColliderShape): number {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    this.attachCollider(body, shape);
    return body.handle;
  }

  /** 创建动态刚体（角色/敌人/子弹/掉落物） */
  addDynamic(position: { x: number; y: number; z: number }, opts: BodyOptions): number {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(opts.linearDamping ?? 0)
        .setCanSleep(opts.canSleep ?? true)
        .setGravityScale(opts.gravityScale ?? 1),
    );
    this.attachCollider(body, opts.shape, opts.sensor ?? false);
    return body.handle;
  }

  private attachCollider(body: RAPIER.RigidBody, shape: ColliderShape, sensor = false): void {
    const desc = makeColliderDesc(shape);
    if (sensor) desc.setSensor(true);
    this.world.createCollider(desc, body);
  }

  /** 强制设刚体位置（玩家输入驱动 / 运动学位移） */
  setPosition(handle: number, x: number, y: number, z: number): void {
    this.world.getRigidBody(handle).setTranslation({ x, y, z }, true);
  }

  /** ★ 移除刚体（实体销毁联动：不移除 = 物理世界泄漏膨胀） */
  removeBody(handle: number): void {
    const body = this.world.getRigidBody(handle);
    this.world.removeRigidBody(body);
  }

  /** 读取刚体位置（同步到实体时用） */
  getPosition(handle: number): { x: number; y: number; z: number } {
    return this.world.getRigidBody(handle).translation();
  }

  /** 设刚体速度（子弹发射/敌人追击） */
  setLinearVelocity(handle: number, x: number, y: number, z: number): void {
    this.world.getRigidBody(handle).setLinvel({ x, y, z }, true);
  }

  /** ★ 只覆盖 x/z 速度（保留 y：角色移动同步用，不干扰重力下落） */
  setVelocityXZ(handle: number, x: number, z: number): void {
    const rb = this.world.getRigidBody(handle);
    const v = rb.linvel();
    rb.setLinvel({ x, y: v.y, z }, true);
  }

  /** 读刚体速度 */
  getLinearVelocity(handle: number): { x: number; y: number; z: number } {
    return this.world.getRigidBody(handle).linvel();
  }

  /** 施力（击退/爆炸冲击） */
  applyImpulse(handle: number, x: number, y: number, z: number): void {
    this.world.getRigidBody(handle).applyImpulse({ x, y, z }, true);
  }

  /** 固定步长物理步进（1/60）+ 碰撞事件派发 */
  step(): void {
    this.world.step(this.eventQueue);

    // 碰撞事件（h1/h2 为 collider handle → 转 rigid body handle）
    this.eventQueue.drainCollisionEvents((c1, c2, started) => {
      const b1 = this.world.getCollider(c1).parent()?.handle;
      const b2 = this.world.getCollider(c2).parent()?.handle;
      if (b1 === undefined || b2 === undefined) return;
      const e: CollisionEvent = { a: b1, b: b2, started };
      for (const h of this.contactHandlers) h(e);
    });
  }

  /** 球体查询（爆炸范围/范围效果） → 命中的刚体 handle 列表 */
  querySphere(center: { x: number; y: number; z: number }, radius: number): number[] {
    const hits: number[] = [];
    const shape = new RAPIER.Ball(radius);
    const rot = new RAPIER.Quaternion(0, 0, 0, 1);
    let exclude: RAPIER.Collider | undefined = undefined;
    // intersectionWithShape 返回单个 collider → 循环排除收集全部
    for (let i = 0; i < 64; i++) {
      const c = this.world.intersectionWithShape(center, rot, shape, undefined, undefined, exclude, undefined);
      if (!c) break;
      const parent = c.parent();
      if (parent) hits.push(parent.handle);
      exclude = c;
    }
    return hits;
  }

  /** ★ 移动探测：位置处放置形状，是否与任意碰撞体相交（排除自身刚体）
   *   write 模式角色移动阻挡用：被挡 → 调用方回退位移
   *   返回命中刚体 handle（null = 无碰撞；-1 = 查询异常） */
  intersects(position: { x: number; y: number; z: number }, shape: ColliderShape, excludeBodyHandle?: number): number | null {
    try {
      const s = makeShape(shape);
      const rot = new RAPIER.Quaternion(0, 0, 0, 1);
      const excl = excludeBodyHandle !== undefined ? this.world.getRigidBody(excludeBodyHandle) : undefined;
      const c = this.world.intersectionWithShape(position, rot, s, undefined, undefined, undefined, excl);
      if (!c) return null;
      return c.parent()?.handle ?? null;
    } catch (err) {
      console.error('[physics] intersects 查询异常:', err);
      return -1;
    }
  }

  /** 碰撞事件监听（阵营过滤在游戏层做） */
  onCollision(handler: (e: CollisionEvent) => void): void {
    this.contactHandlers.push(handler);
  }

}
