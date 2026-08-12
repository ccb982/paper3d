// ============================================================
// PhysicsWorld —— 物理世界封装（唯一接触 rapier API 的地方）
// ============================================================
// 架构 4.9：游戏代码/实体系统不直接碰 rapier，全部走本封装。
// 提供：刚体创建（按形状）、位置驱动（玩家/运动学）、固定步进、
// 碰撞事件转发（contact / sensor）、球体查询（爆炸/范围）。

import RAPIER from '@dimforge/rapier3d';

/** ⚠ 关键经验（踩坑记录）：
 *   rapier 0.14.0 的 createRigidBody 返回的 handle 是 u32 的 Float64 错读值
 *   （如 index=1 被读成 0x0000000000000001 = 5e-324）。但 rapier 内部的
 *   Coarena.map 用**原样 handle** 做 key（查询时位转换还原索引）——
 *   ★ 我们存取必须**原样**（不做归一化），否则 key 不匹配会查到别的刚体。
 *   ★ 之前"归一化成整数"导致 getRigidBody(1) 命中 ground（Float64(1) 低32位=0）。 */

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
  /** ★ 实体身份标记（entity.id，碰撞事件携带；★ handle 会被 rapier 复用，
   *   不能用 handle 对应实体——userData 才是稳定身份） */
  userData?: number;
}

export interface CollisionEvent {
  /** 碰撞双方的实体 id（userData；0/缺失 = 静态世界） */
  aId: number;
  bId: number;
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
  addFixed(position: { x: number; y: number; z: number }, shape: ColliderShape, userData = 0): number {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    desc.userData = userData; // ★ 实体身份（碰撞事件携带，见 CollisionEvent）
    const body = this.world.createRigidBody(desc);
    this.attachCollider(body, shape);
    return body.handle; // ★ 原样（rapier 内部 key 一致，勿归一化）
  }

  /** 创建动态刚体（角色/敌人/子弹/掉落物） */
  addDynamic(position: { x: number; y: number; z: number }, opts: BodyOptions): number {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(opts.linearDamping ?? 0)
      .setCanSleep(opts.canSleep ?? true)
      .setGravityScale(opts.gravityScale ?? 1);
    desc.userData = opts.userData ?? 0; // ★ 实体身份（碰撞事件携带，见 CollisionEvent）
    const body = this.world.createRigidBody(desc);
    this.attachCollider(body, opts.shape, opts.sensor ?? false);
    return body.handle; // ★ 原样（rapier 内部 key 一致，勿归一化）
  }

  private attachCollider(body: RAPIER.RigidBody, shape: ColliderShape, sensor = false): void {
    const desc = makeColliderDesc(shape);
    if (sensor) desc.setSensor(true);
    this.world.createCollider(desc, body);
  }

  /** 强制设刚体位置（玩家输入驱动 / 运动学位移） */
  setPosition(handle: number, x: number, y: number, z: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return; }
    body.setTranslation({ x, y, z }, true);
  }

  /** ★ 移除刚体（实体销毁联动：不移除 = 物理世界泄漏膨胀） */
  removeBody(handle: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return; }
    this.world.removeRigidBody(body);
  }

  /** 读取刚体位置（同步到实体时用） */
  getPosition(handle: number): { x: number; y: number; z: number } {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return { x: 0, y: 0, z: 0 }; }
    return body.translation();
  }

  /** 设刚体速度（子弹发射/敌人追击） */
  setLinearVelocity(handle: number, x: number, y: number, z: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return; }
    body.setLinvel({ x, y, z }, true);
  }

  /** ★ 只覆盖 x/z 速度（保留 y：角色移动同步用，不干扰重力下落） */
  setVelocityXZ(handle: number, x: number, z: number): void {
    const rb = this.world.getRigidBody(handle);
    if (!rb) { this.warnMissing(handle); return; }
    const v = rb.linvel();
    rb.setLinvel({ x, y: v.y, z }, true);
  }

  /** 读刚体速度 */
  getLinearVelocity(handle: number): { x: number; y: number; z: number } {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return { x: 0, y: 0, z: 0 }; }
    return body.linvel();
  }

  /** 施力（击退/爆炸冲击） */
  applyImpulse(handle: number, x: number, y: number, z: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) { this.warnMissing(handle); return; }
    body.applyImpulse({ x, y, z }, true);
  }

  /** 刚体缺失告警（防重复刷屏） */
  private missingWarned = new Set<number>();
  private warnMissing(handle: number): void {
    if (this.missingWarned.has(handle)) return;
    this.missingWarned.add(handle);
    console.warn(`[physics] 刚体不存在 handle=${handle}（已移除或从未创建）——实体销毁/刚体生命周期不一致，见架构 4.9`);
  }

  /** 固定步长物理步进（1/60）+ 碰撞事件派发
   *   ★ 关键：drain 回调中只收集事件，step 返回后才派发——
   *     回调中 removeBody/addBody 会破坏正在迭代的 narrow-phase 数据
   *     （wasm 内存损坏 → 后续创建刚体返回垃圾 handle） */
  step(): void {
    this.world.step(this.eventQueue);

    // 收集（回调中禁止修改物理世界；★ 事件携带 userData（实体 id）而非 handle——
    //  handle 会被 rapier 复用，延迟派发时按 handle 查会误伤新实体）
    const events: CollisionEvent[] = [];
    this.eventQueue.drainCollisionEvents((c1, c2, started) => {
      // 刚体可能已在上次派发中移除 → 判空
      const col1 = this.world.getCollider(c1);
      const col2 = this.world.getCollider(c2);
      if (!col1 || !col2) return;
      events.push({
        aId: (col1.parent()?.userData ?? 0) as number,
        bId: (col2.parent()?.userData ?? 0) as number,
        started,
      });
    });

    // step 结束后统一派发（此阶段可安全修改世界）
    for (const e of events) {
      for (const h of this.contactHandlers) h(e);
    }
  }

  /** ★ 射线查询（玩家瞄准落点：摄像机沿准星发线 → 目标/地面交点；
   *   返回命中刚体 handle + 落点；null = 无命中） */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi = 200,
    excludeBodyHandle?: number,
  ): { handle: number; point: { x: number; y: number; z: number } } | null {
    const excl = excludeBodyHandle !== undefined ? this.world.getRigidBody(excludeBodyHandle) : undefined;
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, excl);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const parent = hit.collider.parent();
    return {
      handle: parent ? parent.handle : -1, // ★ 原样（与 Coarena key 一致）
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
    };
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
      if (parent) hits.push(parent.handle); // ★ 原样（与 Coarena key 一致）
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
