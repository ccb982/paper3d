// ============================================================
// PhysicsWorld —— 物理世界封装（唯一接触 rapier API 的地方）
// ============================================================
// 架构 4.9：游戏代码/实体系统不直接碰 rapier，全部走本封装。
// 提供：刚体创建（按形状）、位置驱动（玩家/运动学）、固定步进、
// 碰撞事件转发（contact / sensor）、球体查询（爆炸/范围）。

import RAPIER from '@dimforge/rapier3d';

/** ⚠ 关键经验（踩坑记录）：
 *   rapier 0.14.0 的 createRigidBody 返回值是坏的（wasm 绑定错读）——
 *   玩家/敌人早期创建碰巧读到小整数（≈索引）才"能玩"，子弹创建时读到
 *   递增垃圾值（栈内数据）→ Coarena 索引越界 → 刚体找不到。
 *   ★ 根治：不信任 body.handle，PhysicsWorld 内部自管 id → RigidBody 映射，
 *     对外接口不变（仍返回 number id），调用方完全无感。 */

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
  /** ★ 碰撞体密度（默认 1；物品调大 → 更重，玩家推不动/不滑远） */
  density?: number;
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
  /** ★ 自管刚体映射（绕过 rapier 坏 handle：id → RigidBody，id 不复用） */
  private bodyById = new Map<number, RAPIER.RigidBody>();
  private nextBodyId = 1;

  constructor(gravity: { x: number; y: number; z: number } = { x: 0, y: -9.8, z: 0 }) {
    this.world = new RAPIER.World(gravity);
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** 注册刚体到自管映射（返回稳定 id） */
  private registerBody(body: RAPIER.RigidBody): number {
    const id = this.nextBodyId++;
    this.bodyById.set(id, body);
    return id;
  }

  /** 刚体缺失：静默防御（正常销毁后的残余访问是良性的——事件批次内先销毁后查，
   *   或已删除实体的一帧遗留；防御返回默认值即可，不再告警刷屏） */
  private getBody(id: number): RAPIER.RigidBody | null {
    return this.bodyById.get(id) ?? null;
  }

  /** 创建固定刚体（地面/墙/静态障碍） */
  addFixed(position: { x: number; y: number; z: number }, shape: ColliderShape, userData = 0): number {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    desc.userData = userData; // ★ 实体身份（碰撞事件携带，见 CollisionEvent）
    const body = this.world.createRigidBody(desc);
    this.attachCollider(body, shape);
    return this.registerBody(body);
  }

  /** 创建运动学刚体（角色/敌人：位置 100% 代码驱动，推挤 dynamic，不受力/重力） */
  addKinematic(position: { x: number; y: number; z: number }, shape: ColliderShape, userData = 0): number {
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z);
    desc.userData = userData;
    const body = this.world.createRigidBody(desc);
    this.attachCollider(body, shape);
    return this.registerBody(body);
  }

  /** ★ 运动学位置驱动（step 前调用；rapier 自动计算对 dynamic 的推挤） */
  setKinematicPosition(id: number, x: number, y: number, z: number): void {
    const body = this.getBody(id);
    if (!body) return;
    body.setNextKinematicTranslation({ x, y, z });
  }

  /** 创建动态刚体（物品/子弹/掉落物——纯物理，零代码修正） */
  addDynamic(position: { x: number; y: number; z: number }, opts: BodyOptions): number {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(opts.linearDamping ?? 0)
      .setCanSleep(opts.canSleep ?? true)
      .setGravityScale(opts.gravityScale ?? 1);
    desc.userData = opts.userData ?? 0; // ★ 实体身份（碰撞事件携带，见 CollisionEvent）
    const body = this.world.createRigidBody(desc);
    this.attachCollider(body, opts.shape, opts.sensor ?? false, opts.density);
    return this.registerBody(body);
  }

  private attachCollider(body: RAPIER.RigidBody, shape: ColliderShape, sensor = false, density?: number): void {
    const desc = makeColliderDesc(shape);
    if (sensor) desc.setSensor(true);
    if (density !== undefined) desc.setDensity(density);
    this.world.createCollider(desc, body);
  }

  /** 强制设刚体位置（玩家输入驱动 / 运动学位移） */
  setPosition(id: number, x: number, y: number, z: number): void {
    const body = this.getBody(id);
    if (!body) { return; }
    body.setTranslation({ x, y, z }, true);
  }

  /** ★ 移除刚体（实体销毁联动：不移除 = 物理世界泄漏膨胀） */
  removeBody(id: number): void {
    const body = this.getBody(id);
    if (!body) { return; }
    this.world.removeRigidBody(body);
    this.bodyById.delete(id);
  }

  /** 读取刚体位置（同步到实体时用） */
  getPosition(id: number): { x: number; y: number; z: number } {
    const body = this.getBody(id);
    if (!body) { return { x: 0, y: 0, z: 0 }; }
    return body.translation();
  }

  /** 设刚体速度（子弹发射） */
  setLinearVelocity(id: number, x: number, y: number, z: number): void {
    const body = this.getBody(id);
    if (!body) { return; }
    body.setLinvel({ x, y, z }, true);
  }

  /** 读刚体速度 */
  getLinearVelocity(id: number): { x: number; y: number; z: number } {
    const body = this.getBody(id);
    if (!body) { return { x: 0, y: 0, z: 0 }; }
    return body.linvel();
  }

  /** 施力（击退/爆炸冲击） */
  applyImpulse(id: number, x: number, y: number, z: number): void {
    const body = this.getBody(id);
    if (!body) { return; }
    body.applyImpulse({ x, y, z }, true);
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
   *   返回命中实体的 userData（实体 id）+ 落点；null = 无命中） */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi = 200,
    excludeBodyId?: number,
  ): { handle: number; point: { x: number; y: number; z: number } } | null {
    const excl = excludeBodyId !== undefined ? (this.getBody(excludeBodyId) ?? undefined) : undefined;
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, excl);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const parent = hit.collider.parent();
    return {
      handle: parent ? (parent.userData as number) : -1, // ★ 实体 id（userData）
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
    };
  }

  /** 球体查询（爆炸范围/范围效果） → 命中的实体 id（userData）列表 */
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
      if (parent) hits.push(parent.userData as number); // ★ 实体 id（userData）
      exclude = c;
    }
    return hits;
  }

  /** ★ 移动探测：位置处放置形状，是否与任意碰撞体相交（排除自身刚体）
   *   返回命中实体的 userData（实体 id）；null = 无碰撞；-1 = 查询异常 */
  intersects(position: { x: number; y: number; z: number }, shape: ColliderShape, excludeBodyId?: number): number | null {
    try {
      const s = makeShape(shape);
      const rot = new RAPIER.Quaternion(0, 0, 0, 1);
      const excl = excludeBodyId !== undefined ? (this.getBody(excludeBodyId) ?? undefined) : undefined;
      const c = this.world.intersectionWithShape(position, rot, s, undefined, undefined, undefined, excl);
      if (!c) return null;
      const parent = c.parent();
      return parent ? (parent.userData as number) : null;
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
