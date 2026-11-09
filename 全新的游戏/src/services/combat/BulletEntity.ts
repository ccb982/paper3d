// ============================================================
// BulletEntity —— 纯子弹实体（物理/碰撞/寿命，零渲染）
// ============================================================
// 实体信息完全独立：位置（物理 read）/速度/寿命/阵营/伤害。
// 不持有纹理、不持有渲染器、不参与 3D 场景绘制——
// 绘制由 BulletRenderer 从"位置+速度"快照完成（架构解耦）。

import { EntityBase, type EntityHitPoint, type RetireReason } from '../../entity/EntityBase';
import type { EntityManager } from '../../entity/EntityManager';
import { sameTeam } from './teams';
import { GROUP_WALL, GROUP_COVER_PLAYER } from '../physics/PhysicsWorld';
import { queryFinalStats } from './FinalStats';
import type { FrameAssetSource } from '../fx/AssetSource';
import type { ShadowFrameSource } from '../render/SilhouetteShadow';
import type { EntityKind } from '../../entity/Entity';

/** ★ 撞向命中解析层的载荷：一次物理碰撞（敌人 / 装饰物 / 地块全部归口） */
export interface BulletHitPayload {
  /** 子弹自身（作为伤害来源 EntityBase；组合层据此走 applyDamage） */
  self: BulletEntity;
  /** 敌人实体；null = 静态世界（地块 / 装饰物，由解析层细分） */
  other: EntityBase | null;
  /** ★ 静态对方的类别（other===null 时有效；2026-11-07 新增）：
   *  'ground' = 地形（可挖）/ 'structure' = 结构件（水泥台座 → 反弹，不挖地形） */
  staticKind?: EntityKind;
  /** 命中点（子弹中心，碰撞接触处） */
  point: { x: number; y: number; z: number };
  /** 子弹伤害值（穿透命中实体时结算） */
  damage: number;
}

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
  /** 伤害值（无 attackFormula 时使用；穿透命中实体时结算） */
  damage?: number;
  /** ★ 攻击公式：命中瞬间实时查询 owner 最终攻击力（子弹不再开火快照） */
  attackFormula?: { min: number; ratio: number } | null;
  /** ★ 攻击公式的主人（伤害在命中时按主人实时攻击力现算） */
  owner?: EntityBase | null;
  /** ★ 命中/落地后在该点生成站桩友军（itemId；如祖宗弹） */
  allyOnHit?: string;
  /** ★ 投射落点（准星收敛点；发射时由组合层计算）——命中窗口放大的基准点 */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  /** ★ 无视墙（玩家贴城墙开枪时置位）：碰撞分组 filter 掉 GROUP_WALL，子弹穿墙 */
  ignoreWalls?: boolean;
  /** ★ 本阵营掩体背面豁免（用户定 2026-09-29） */
  ignoreOwnCovers?: boolean;
}

/** ★ 子弹命中判定半径（米）——逻辑命中口径（蜂群线段判定等）×
 *  2026-09-14 定：与物理体积解耦（物理体积极小 0.05，见 BULLET_BODY_RADIUS） */
export const BULLET_HIT_RADIUS = 0.9;

/** ★ 常规物理半径（2026-09-14 用户定：0.9 → 0.05）——飞行期间物理体积始终极小：
 *  不误触地形/装饰物/自军；命中由「逻辑判定(0.9) + 临近落点放大(1.5)」保证 */
export const BULLET_BODY_RADIUS = 0.05;

/** ★ 命中窗口放大（2026-09-14）：临近"投射落点"（准星收敛点）时的物理半径——
 *  补偿目标移动/弹道与准星的细微偏差：飞抵落点前放大 → 过点后缩回常规体积 */
export const BULLET_BULGE_RADIUS = 1.5;
/** ★ 命中窗口放大：距投射落点多近开始放大（米） */
export const BULLET_BULGE_DIST = 5.0;
/** ★ 近点小弹（2026-09-14）：投射落点离出生点 ≤ 本距离（米）→ 全程保持小体积
 *  （不放大）：近距离射击不误触地形/装饰物/自军，手感最干净（用户定：15m 内都是近点） */
export const BULLET_CLOSE_DIST = 15.0;

/**
 * ★ 关于「子弹偶尔穿透地块」的实测结论（2026-11-07，rapier 0.14 真跑，
 *   50 m/s、物理步长 1/60 s、碰撞球半径 0.05 m）：
 *     无 CCD → 1m 厚墙 / 水平薄面 / 30° 斜面  全部穿透
 *     有 CCD → 三种场景 全部挡住
 *   ⇒ 刚体级 ccd:true 已足够，**不需要**软 CCD 预测（额外每步预测开销 → 已撤除）。
 *
 *   ★ 真因是【地形物理分区懒建】：chunk 创建时只有 1/9 的分区建了 collider，
 *     玩家周边 1 chunk 外的其余分区永不预建 ⇒ 大片看得见的地形**没有碰撞体**
 *     ⇒ 子弹打上去不产生接触事件 → 直接穿过去。
 *     修法见 services/combat/TerrainSweep.ts（数据层高度场扫掠兜底命中）。
 */

export class BulletEntity extends EntityBase {
  /** 共享剪影画布（BulletManager 初始化时提取一次；**按池**写成实例字段，
   *  ★ 多弹种（玩家圆弹 / 敌方箭矢）并存时不能只靠 static —— 后建的池会覆盖前一个） */
  static sharedSilhouetteCanvas: HTMLCanvasElement | null = null;
  /** ★ 本实例所属子弹池的剪影画布（BulletManager 建池时注入；null → 回退 static） */
  silhouetteCanvas: HTMLCanvasElement | null = null;

  /** ★ 子弹逻辑命中体积（球体；物理体积另见 BULLET_BODY_RADIUS，二者解耦） */
  readonly collisionVolume: { shape: import('../../services/physics/PhysicsWorld').ColliderShape; offsetY: number } = {
    shape: { type: 'ball', radius: BULLET_HIT_RADIUS },
    offsetY: 0,
  };
  private lifetime = 0;
  private damage = 0;
  /** ★ 攻击公式（命中时按 owner 实时最终攻击力现算；null = 固定伤害） */
  private attackFormula: { min: number; ratio: number } | null = null;
  /** ★ 公式的主人（发射者） */
  private owner: EntityBase | null = null;
  private active = false;
  /** ★ 命中窗口放大：投射落点（null = 无 → 不做临近放大） */
  private target: { x: number; y: number; z: number } | null = null;
  /** ★ 命中窗口放大：当前是否处于放大态 */
  private bulged = false;
  /** ★ 近点小弹：投射落点离出生点很近（≤ BULLET_CLOSE_DIST）→ 全程小体积 */
  private closeShot = false;
  /** ★ 无视墙（玩家贴城墙开枪）：碰撞分组 filter 掉 GROUP_WALL */
  private ignoreWalls = false;
  private ignoreOwnCovers = false;
  /** ★ 命中/落地后生成站桩友军（itemId；null = 普通子弹） */
  allyOnHit: string | null = null;
  /** ★ 回收回调（BulletManager 注册：超时 → 回池） */
  recycle: (() => void) | null = null;
  /** ★ 命中特效回调（BulletManager 注册：每次碰撞开始只调用一次；
   *   other=null 表示静态世界；由组合层决定挂实体槽/固定点播放） */
  hitFx: ((other: EntityBase | null) => void) | null = null;
  /** ★ 命中解析层回调（BulletManager 注册）：每次碰撞开始把所有命中——
   *   敌人实体 / 装饰物 / 地块 —— 一律交给解析层（WorldMode.resolveBulletHit）分类结算 */
  onHit: ((payload: BulletHitPayload) => void) | null = null;

  get isActive(): boolean {
    return this.active;
  }

  /** ★ 影子声明（子弹：沿弹道方向的拉长剪影椭圆，固定长轴模式——
   *  高速运动体不参与太阳投影，但浓度仍随白昼因子衰减） */
  protected override get shadowShape(): { w: number; len?: number; alpha?: number } | null {
    return { w: 1.3, len: 2.08, alpha: 0.38 };
  }

  /** ★ 影子朝向 = 弹道方向（弹头指向前方）。
   *  剪影贴图 row0=顶部=弹头（FTX 约定），映射到影子网格后弹头位于局部 +Z；
   *  局部 +Z 转到世界速度方向需要 θ=atan2(dx,dz)，而基类 groundShadowYaw
   *  内含 +π 偏移 → 此处再 +π 抵消。 */
  protected override get shadowYaw(): number {
    return this.groundShadowYaw + Math.PI;
  }

  /** 剪影源：本池画布优先（多弹种正确），缺省回退 static 共享张 */
  protected override getShadowFrameData(): ShadowFrameSource | null {
    const canvas = this.silhouetteCanvas ?? BulletEntity.sharedSilhouetteCanvas;
    return canvas ? { canvas } : null;
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
          shape: { type: 'ball', radius: opts.radius ?? BULLET_BODY_RADIUS },
          canSleep: false,
          gravityScale: 0,    // ★ 无重力：直线弹道
          ccd: true,          // ★ 连续碰撞检测：防隧穿（实测对薄面/斜面已足够）
          restitution: 0.8,   // ★ 反弹：打地面/墙弹起
        },
      },
      // ★ 无 asset：不建动画/渲染器——纯物理实体
    });
    this.camp = opts.camp;
    this.physicsMode = 'read'; // 物理飞行 → 位置读回
    // ★ 子弹豁免视锥裁剪 + 距离 LOD：高速小物体被裁剪漏画 + 生命周期短
    this.lodExempt = true;
    // ★ 初始即失活（入池状态）：退出管线 + 藏到地图外
    this.deactivate();
  }

  /** ★ 激活发射（池化复用：重入管线 + 设位置/速度/寿命） */
  activate(opts: BulletEntityOptions): void {
    this.camp = opts.camp;
    this.lifetime = opts.lifetime ?? 2;
    this.damage = opts.damage ?? 10;
    this.attackFormula = opts.attackFormula ?? null;
    this.owner = opts.owner ?? null;
    this.allyOnHit = opts.allyOnHit ?? null;
    this.ignoreWalls = opts.ignoreWalls ?? false;
    this.ignoreOwnCovers = opts.ignoreOwnCovers ?? false;
    this.entity.position.x = opts.x;
    this.entity.position.y = opts.y;
    this.entity.position.z = opts.z;
    // ★ 命中窗口放大：记录投射落点（无则 null）；近点小弹：落点近 → 全程小体积
    this.target = (opts.targetX !== undefined && opts.targetY !== undefined && opts.targetZ !== undefined)
      ? { x: opts.targetX, y: opts.targetY, z: opts.targetZ }
      : null;
    this.closeShot = !!this.target
      && Math.hypot(this.target.x - opts.x, this.target.y - opts.y, this.target.z - opts.z) <= BULLET_CLOSE_DIST;
    this.bulged = false;
    this.active = true;
    this.visible = true;
    // ★ 池化复用：清掉上一发残留的状态（否则首帧就被误判为「物理层已命中」）
    this.hitStaticByPhysics = false;
    this.prevPhysPos = { x: opts.x, y: opts.y, z: opts.z };
    this.prevGroundH = null; // ★ 池化复用：上一发的地表高度提示作废
    this.em.register(this);
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      // ★ 池化刚体：发射时恢复模拟（入池时已禁用，见 deactivate）
      this.em.physics.setBodyEnabled(rb.handle, true);
      this.em.physics.setPosition(rb.handle, opts.x, opts.y, opts.z);
      // ★ 常规物理体积全程极小（0.05）：近点不放大；远点由 onUpdate 临近落点放大
      this.em.physics.setBallRadius(rb.handle, BULLET_BODY_RADIUS);
      // ★ 子弹 vs 三道具（用户定 2026-09-29）：
      //   玩家城墙 / 玩家墙 = 实心（GROUP_COVER_SOLID）→ 任何子弹都不豁免（含背面）；
      //   敌人掩体 = GROUP_WALL → **敌弹始终豁免**（穿自家）；正面可穿真孔（物理复合体）；玩家弹打墙体。
      let mask = 0xffff;
      if (this.ignoreOwnCovers) mask &= ~(this.camp === 'enemy' ? GROUP_WALL : GROUP_COVER_PLAYER);
      if (this.ignoreWalls) mask &= ~GROUP_WALL;   // 调试：无视敌掩体
      this.em.physics.setCollisionGroups(rb.handle, (0xffff << 16) | mask);
      const len = Math.hypot(opts.dirX, opts.dirY, opts.dirZ) || 1;
      this.em.physics.setLinearVelocity(
        rb.handle,
        (opts.dirX / len) * opts.speed,
        (opts.dirY / len) * opts.speed,
        (opts.dirZ / len) * opts.speed,
      );
    }
  }

  /** ★ 失活回收（池化复用：退出管线 + 藏到地图外 + 清速；不销毁）
   *  ★ 2026-09-12：同时禁用刚体——池内 100 个 dynamic body 不再参与 rapier
   *  模拟/宽相（物理步空转清零），发射时 activate 恢复。 */
  deactivate(): void {
    this.active = false;
    this.visible = false;
    this.em.unregister(this);
    this.entity.position.x = 0;
    this.entity.position.y = -50;
    this.entity.position.z = 0;
    const rb = this.entity.rigidBody;
    if (rb && this.em.physics) {
      // ★ 命中窗口复位：池内不残留放大态（回常规小体积）
      if (this.bulged) this.em.physics.setBallRadius(rb.handle, BULLET_BODY_RADIUS);
      this.bulged = false;
      this.closeShot = false;
      this.target = null;
      this.em.physics.setLinearVelocity(rb.handle, 0, 0, 0);
      this.em.physics.setPosition(rb.handle, 0, -50, 0);
      this.em.physics.setBodyEnabled(rb.handle, false);
    }
  }

  /** ★ 命中瞬间伤害：有攻击公式 → 实时查询主人最终攻击力（遗物/装备/限时全实时）；
   *  无公式 → 固定伤害值（开火时给定的炮弹） */
  damageAtHit(): number {
    const f = this.attackFormula;
    if (f && this.owner) {
      return Math.max(f.min, Math.round(queryFinalStats(this.owner).attackPower * f.ratio));
    }
    return this.damage;
  }

  /**
   * ★ 本帧是否已被物理层报过静态命中（地形/结构件/装饰物）。
   *   用途：数据层高度场扫掠（CombatSystem.updateGroundHits）据此让位 ——
   *   物理层已拦下并结算过的命中，不再重复判定（否则同一个坑被挖两次）。
   */
  hitStaticByPhysics = false;

  /**
   * ★ 上一物理步结束时的位置（数据层高度场扫掠的线段起点）。
   *   为什么不用「当前速度 × dt」反推：反弹后速度方向已变，反推的起点是错的
   *   ⇒ 会算出根本不存在的弹道段。直接记位置 = 弹道段恒等于真实轨迹。
   */
  prevPhysPos: { x: number; y: number; z: number } | null = null;

  /**
   * ★ 上一物理步终点处的地表高度（数据层扫掠的起点高度提示）。
   *   相邻物理步：上一步的终点 = 这一步的起点 ⇒ 该高度上一步已采样过
   *   ⇒ 直接复用，省掉每步重复的一次高度采样（扫掠是每帧每弹的高频路径）。
   *   null = 未知（上一步未采样到 / 数据未加载）→ 调用方自行采样。
   */
  prevGroundH: number | null = null;

  /**
   * ★ 扫掠出参复用对象（避免每物理步分配临时对象 → 免 GC 压力）。
   *   h = 本段终点处的地表高度（下一步的起点高度提示）。
   */
  readonly sweepEndH: { h: number | null } = { h: null };

  /** ★ 命中处理：同阵营忽略 / 一律交给命中解析层（敌人=伤害结算，静态世界=细分）。
   *   每次碰撞开始（started）只触发一次命中特效（不再一直播放）。
   *   子弹实体零世界认知：不判地形不判装饰物不扣伤害——全是解析层（组合层）的事。
   *   ★ 2026-11-07：staticKind 透传（'structure' = 水泥台座等结构件 → 解析层走反弹，不挖地形）。 */
  override onCollision(other: EntityBase | null, started: boolean, staticKind?: EntityKind): void {
    if (!this.active) return;
    if (!started) return;
    // ★ 静态命中标记（供数据层扫掠去重；other===null 即静态世界）
    if (other === null) this.hitStaticByPhysics = true;
    if (other && sameTeam(other.camp, this.camp)) return; // ★ 友军过滤（唯一真源：player/ally 互免）
    this.hitFx?.(other);
    this.onHit?.({
      self: this,
      other,
      staticKind,
      point: {
        x: this.entity.position.x,
        y: this.entity.position.y,
        z: this.entity.position.z,
      },
      damage: this.damageAtHit(),
    });
  }

  /**
   * ★ 被打掉（近战/范围/对向子弹命中）：子弹是池化对象，必须走 deactivate + recycle，
   *   不能进入 EntityBase 的 retire → dispose 流程——那条路只销毁刚体，
   *   不会把 active 置回 false、也不会把槽位还给池，结果就是永久残影 + 池位泄漏。
   */
  override onTakeDamage(_dmg: number, _source: EntityBase | null, _hitPoint?: EntityHitPoint): void {
    if (!this.active) return;
    this.deactivate();
    this.recycle?.();
  }

  /** ★ 兜底：任何其他退役路径（模式清场等）都先摘掉渲染批次与更新队列，避免留残影 */
  protected override onRetire(_reason: RetireReason): void {
    if (this.active) this.deactivate();
  }

  protected override onUpdate(dt: number): void {
    if (!this.active) return;
    // ★ 命中窗口放大：远点弹临近投射落点放大物理体积（1.5），过点/远离立即缩回常规（0.05）
    //   近点小弹（落点 ≤ BULLET_CLOSE_DIST）→ 全程小体积，不放大
    if (this.target && !this.closeShot) {
      const t = this.target;
      const tx = t.x - this.entity.position.x;
      const ty = t.y - this.entity.position.y;
      const tz = t.z - this.entity.position.z;
      const rem2 = tx * tx + ty * ty + tz * tz;
      let want = false;
      if (rem2 <= BULLET_BULGE_DIST * BULLET_BULGE_DIST) {
        const v = this.velocity;
        want = v.x * tx + v.y * ty + v.z * tz > 0; // 仍在接近落点（否则已过点）
      }
      if (want !== this.bulged) {
        this.bulged = want;
        const rb = this.entity.rigidBody;
        if (rb && this.em.physics) {
          this.em.physics.setBallRadius(rb.handle, want ? BULLET_BULGE_RADIUS : BULLET_BODY_RADIUS);
        }
      }
    }
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.deactivate();
      this.recycle?.();
    }
  }

  /** ★ 当前对敌判定半径（蜂群线段命中用）：逻辑口径 0.9 / 放大 1.5（与物理体积解耦） */
  get hitRadius(): number {
    return this.bulged ? BULLET_BULGE_RADIUS : BULLET_HIT_RADIUS;
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
   *   弹头锚点：quad 中心 = 实体位置 + long × 半高（弹头端压在碰撞点/判定点）。
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
    target[offset + 12] = position.x + t.long.x * halfH;
    target[offset + 13] = position.y + t.long.y * halfH;
    target[offset + 14] = position.z + t.long.z * halfH;
    target[offset + 15] = 1;
  }

  /** ★ 世界尺寸（基类公共函数）：宽 = baseWidth（默认 3.0），高按纹理宽高比 */
  static computeWorldSize(asset: FrameAssetSource, baseWidth = 3.0): { width: number; height: number } {
    const pair = asset.getFramePair(0);
    const aspect = pair ? pair.base.image.height / pair.base.image.width : 3.79;
    return { width: baseWidth, height: baseWidth * aspect };
  }
}
