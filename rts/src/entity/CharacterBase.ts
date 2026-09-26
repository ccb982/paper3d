// ============================================================
// CharacterBase —— 角色基类（EntityBase 子类）
// ============================================================
// 集成：CharacterController（相机相对移动/跳跃/朝向）+ 动画/渲染管线
// 物理：velocity 模式（速度驱动 + 位置读回，碰撞交给 rapier）
// 子类：Player（输入驱动）/ Ally / Enemy（AI 驱动）

import * as THREE from "three";
import { EntityBase, type EntityBaseOptions, type EntityHitPoint } from "./EntityBase";
import type { EntityManager } from "./EntityManager";
import {
  CharacterController,
  type CharacterAnimMap,
} from "../systems/player/CharacterController";
import type { InputActions } from "../platform/input/InputActions";
import type { CameraFrame } from "../services/camera/CameraController";
import { shapeExtents, separateXZ, pushOutOBB } from "../services/physics/Collision";
import { CharacterHitDye } from "../services/fx/CharacterHitDye";
import { CharacterDeathFx } from "../services/fx/CharacterDeathFx";
import { RasterMap } from "../services/map/RasterMap";
import { EDGE_CLIFF_BAND } from "../services/map/Refinements";
import { entityPerf } from "./EntityPerf";
import { SHORE_CLIMB_MAX } from "./TerrainAssist";
import { CharacterCore, canShift, unbuyGroundY, type TerrainProbe  } from "./base/CharacterCore";
import { createRasterProbe } from "./base/RasterProbe";
import { queryStaticObstaclesInto, type StaticObstacle } from "../services/physics/StaticObstacleRegistry";

/** ★ 静态障碍查询复用缓冲（零分配；单帧内各角色顺序使用） */
const _obstacleBuf: StaticObstacle[] = [];
/** ★ 命中点→贴片局部坐标的 scratch（命中是低频事件，但仍不分配） */
const _hitLocal = new THREE.Vector3();

export interface CharacterBaseOptions extends EntityBaseOptions {
  /** 动画状态表（状态 → 帧名序列，按朝向分组） */
  animMap: CharacterAnimMap;
  /** 移动速度（世界单位/秒） */
  moveSpeed?: number;
  /** 初始朝向 */
  facing?: string;
}

/** ★ 角色默认碰撞体积（长方体，2D 贴片正反面都扁：
 *   正面（x）宽 0.56 对齐贴片宽度；厚度（z）0.3 薄片；
 *   高 2.0（贴片 2.5 的 80%，脚底到肩部）
 *   模块级常量：super() 时字段尚未初始化，构造参数只能引用常量 */
export const DEFAULT_COLLISION_VOLUME = {
  shape: { type: "cuboid", hx: 0.28, hy: 1.0, hz: 0.15 } as const,
  offsetY: 1.0,
};

export abstract class CharacterBase extends EntityBase {
  readonly controller: CharacterController;
  /** ★ 无视地形落差行进（载具：爬坡/过坑；开启后不再被 EDGE_CLIFF_BAND 立面阻挡） */
  climbAnyTerrain = false;
  /** ★ 是否允许爬掩体/可攀工事（用户定 2026-09-25：RTS 先给敌人关掉——行军路过就反复翻→卡） */
  canClimbCovers = true;
  /** ★ 限制爬崖（敌人等开启）：禁止朝高台立面位移——只能走插值坡/≤EDGE_CLIFF_BAND 小台阶，
   *  防"贴墙被 clampCharacter 抬升"式瞬移上高台。玩家默认关（boss4D 走 requireRealLanding） */
  blockCliffClimb = false;

  // ---- ★ 空中层（2026-09-18；《RTS架构.md》§7）----
  /** 飞行单位：悬停在「地表高 + airAltitude」，不贴地、不受地形落差阻挡、不吃掉坑判死。
   *  ★ y 的唯一驱动点是 `WorldMode.clampCharacter`（它会优先处理飞行分支）；
   *    开启者在 EnemyBase 构造里按名册 `isAir` 设置，并同时打开 `climbAnyTerrain`。 */
  airborne = false;
  /** 空中悬停高度（米，**相对地表**） */
  airAltitude = 2.6;
  /** 空中浮动相位（每只随机；避免整队同频上下摆） */
  airPhase = Math.random() * Math.PI * 2;
  /** ★ 起跳站立面高（空中 y 基准；落地时刷新为当前贴地高）。真实跳跃用 */
  private airborneStandY = 0;
  // ---- ★ 攀爬（可攀工事：掩体等 walkableTop 矩形；持续顶住自动翻上） ----
  /** 可攀最大高差（米）：顶面高于脚底不超过此值才能攀（掩体 3m 也在内） */
  static readonly CLIMB_MAX = 3.2;
  /** 持续顶住时长（秒）→ 触发攀爬（防误触） */
  private static readonly CLIMB_HOLD = 0.25;
  /** 攀爬时长（秒） */
  private static readonly CLIMB_TIME = 0.45;
  /** ★ 过掩体优化：翻越后冷却（毫秒；防来回翻） */
  private static readonly CLIMB_CD_MS = 1200;
  private climbT = -1;
  /** ★ 寻路明确标注"要爬坡"（用户定 2026-09-24；EnemyBase 由 steer 写入） */
  /** ★ 重写 P1：推进/爬坡/立面/贴地统一走 CharacterCore（L2/L3 同内核） */
  private readonly core = new CharacterCore();
  /** ★ 爬坡凭证（路线 climb=true → steer.climb；用户定 2026-09-26） */
  climbOrdered = false;
  /** ★ 凭证点（路线发放；内核判"在坡点"用） */
  climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number };
  /** ★ 地形探针（两载体共用一份：`entity/base/RasterProbe`；重写 P1） */
  private readonly probe: TerrainProbe = createRasterProbe(() => this.entity.position.y);
  private climbFromX = 0; private climbFromY = 0; private climbFromZ = 0;
  private climbToX = 0; private climbToY = 0; private climbToZ = 0;
  private climbContactT = 0;
  private climbCand: { top: number; ix: number; iz: number } | null = null;
  /** ★ 过掩体优化：翻越后冷却（毫秒时间戳；防"翻过去又被推回来"来回翻） */
  private climbCdUntil = 0;
  /** ★ 是否正在攀爬（CharacterClamp 跳过贴地，避免抢位置） */
  get isClimbing(): boolean { return this.climbT >= 0; }

  /** ★ 角色碰撞体积（实例基类属性；子类可覆写为不同体型） */
  collisionVolume: {
    shape: import("../services/physics/PhysicsWorld").ColliderShape;
    offsetY: number;
  } = DEFAULT_COLLISION_VOLUME;

  constructor(em: EntityManager, opts: CharacterBaseOptions) {
    super(em, {
      kind: opts.kind,
      x: opts.x,
      y: opts.y,
      z: opts.z,
      // ★ 角色 = 运动学刚体：位置 100% 代码驱动（x/z 输入/AI、y 模式层钉地形），
      //   物理只做推挤（踢开物品/子弹碰撞事件），不受重力/力 → 无抖动/无爆炸
      physics: opts.physics ?? {
        type: "kinematic",
        options: { shape: DEFAULT_COLLISION_VOLUME.shape },
      },
      asset: opts.asset,
      animInitial: opts.facing ? { facing: opts.facing } : undefined,
    });
    this.physicsMode = "kinematic";
    if (!this.anim) throw new Error("CharacterBase 需要动画资产");
    this.controller = new CharacterController(
      this.anim,
      opts.animMap,
      opts.moveSpeed ?? 2.5,
    );
  }

  protected override onUpdate(
    dt: number,
    input?: InputActions,
    cameraFrame?: CameraFrame,
  ): void {
    const _ct = entityPerf.enabled;
    const _c0 = _ct ? performance.now() : 0;
    // ★ 攀爬中：位置由攀爬插值接管（不接受输入移动）
    if (this.climbT >= 0) {
      this.stepClimb(dt);
      return;
    }
    if (input && cameraFrame) {
      this.controller.update(dt, input, cameraFrame);
    }
    // ★ 位置推进（kinematic：直接移动实体位置 → syncPhysics 驱动刚体；
    //   y 由角色二态（落地/空中）在下方统一结算）
    const dir = this.controller.moveDir;
    const speed = this.controller.moveSpeed;
    const prevX = this.entity.position.x;
    const prevZ = this.entity.position.z;
    const vol = shapeExtents(this.collisionVolume.shape);
    const step = this.core.step(
      {
        x: prevX, y: this.entity.position.y, z: prevZ, dt,
        dirX: dir.x, dirZ: dir.y, speed,
        climbOrdered: this.climbOrdered,
        climbPt: this.climbPt,
        blockCliffClimb: this.blockCliffClimb,
        climbAnyTerrain: this.climbAnyTerrain,
        hx: vol.hx, hz: vol.hz,
        suspended: false,
      },
      this.probe,
      performance.now() / 1000,
    );
    const dx = step.dx;
    const dz = step.dz;
    const climbing = step.climbing;
    const stepLimit = this.probe.wetAt(prevX, prevZ) ? SHORE_CLIMB_MAX : EDGE_CLIFF_BAND;
    this.entity.position.x += dx;
    this.entity.position.z += dz;
    const p = this.entity.position;
    const gy = unbuyGroundY(p.x, p.z, p.y);   // ★ 贴地/脱埋（顶层；两载体同口径）
    if (step.unburied) {
      p.y = gy;                 // ★ 脱埋吸附：直接抬到顶层（不当作墙回退）
      this.airborneStandY = gy;
    } else if (this.controller.isAirborne()) {
      // ★ 空中态：真实离地，y = 起跳站立面 + 抛物线偏移（峰值 0.8 → 可越 0.5 高差）。
      //   落地交给 WorldMode 落回贴地。横向位移已在上面按分量做了垂直壁受阻检查，
      //   因此跳跃无法朝壁方向推进（不穿模、不会横向切入壁腹被 clamp 抬升）。
      p.y = this.airborneStandY + this.controller.getHeightOffset();
    } else {
      // ★ 落地态：刷新站立基准；cliff（大落差）水平阻挡仅落地态适用——
      //   位移后目标贴地高比当前脚高高出 EDGE_CLIFF_BAND(0.6) 以上 → 回退，
      //   0.6 以下小台阶由 clampCharacter 上行限速自动踏过（stepHeight ≡ EDGE_CLIFF_BAND）。
      this.airborneStandY = gy;
      if (!climbing && !this.climbAnyTerrain && gy - p.y > stepLimit) {
        p.x = prevX;
        p.z = prevZ;
      }
    }
    // ★ 真实贴地信号（boss4D 玩家跳跃资格用）：落地态 ∧ 脚底已贴合实际站位
    //   地表高（±0.05）才算"在地面上"。悬崖回退后重新采样，避免用位移前采样。
    //   悬空/虚空（地表低于脚底）→ 不贴地 → 长按跳跃不生效。
    if (this.controller.requireRealLanding && !this.climbAnyTerrain) {
      const floorY = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
      this.controller.onFloor =
        !this.controller.isAirborne() && Math.abs(p.y - floorY) <= 0.05;
    }
    // ★ 角色间推挤（kinematic 无物理响应 → 实体层处理互相阻挡）
    const _pX = p.x, _pZ = p.z;   // ★ H2：推挤前位置（层守卫基准）
    const _c1 = _ct ? performance.now() : 0;
    if (!climbing) this.separateFromOthers();   // 爬坡态跳过分离（防坡面扎堆互推卡死）
    const _c2 = _ct ? performance.now() : 0;
    // ★ 地图装饰物推挤（碎石等 fixed cuboid 障碍）
    //   ★ 2026-09-11：改查 JS 空间索引（廉价）→ 恢复每帧（推挤手感最好）
    this.separateFromStatics();
    // ★ H2 层守卫：推挤不得跨层/越台阶（不合格 → 回退推挤；跳跃/攀爬/免限单位除外）
    if (!climbing && !this.controller.isAirborne() && !this.airborne && !this.climbAnyTerrain) {
      const lim = this.probe.wetAt(_pX, _pZ) ? SHORE_CLIMB_MAX : EDGE_CLIFF_BAND;
      if (!canShift(this.probe, _pX, _pZ, p.y, p.x, p.z, lim)) { p.x = _pX; p.z = _pZ; }
    }
    // ★ 攀爬：持续顶住可攀工事（climbCand）→ 自动翻上去；★ 过掩体优化：翻完加冷却，防反复翻/来回翻
    if (this.climbCand && !this.controller.isAirborne() && !this.airborne
      && performance.now() >= this.climbCdUntil) {
      this.climbContactT += dt;
      if (this.climbContactT >= CharacterBase.CLIMB_HOLD) this.beginClimb(this.climbCand);
    } else {
      this.climbContactT = 0;
    }
    const _c3 = _ct ? performance.now() : 0;
    // ★ 受击染料推进（降频解算 + 每步持续注入 + 计时释放）
    this.hitDyeFx.update(dt);
    const _c4 = _ct ? performance.now() : 0;
    entityPerf.move += _c1 - _c0;
    entityPerf.sepOther += _c2 - _c1;
    entityPerf.sepStatic += _c3 - _c2;
    entityPerf.dye += _c4 - _c3;
  }

  /** ★ 受击染料流体纹理（有染料时贴片采样 composite；Timer 结束后恢复 null） */
  protected override getFluidTexture(): THREE.Texture | null {
    return this.hitDyeFx.getCompositeTexture();
  }

  /** ★ 角色间推挤：分块查询邻近角色（querySphere）→ 水平重叠 → 最小分离轴推开
   *   （公共规则库 separateXZ，各推一半）。物品/子弹不参与（dynamic，走物理） */
  private separateFromOthers(): void {
    const vol = this.collisionVolume;
    if (!vol) return;
    const p = this.entity.position;
    const me = shapeExtents(vol.shape);
    if (me.hx <= 0 || me.hz <= 0) return;
    // 分块查询（RasterMap）：半径 = 自身半宽 + 最大角色半宽余量（可调参）
    const near = this.em.querySphere(p.x, p.z, me.hx + 0.6);
    for (const o of near) {
      if (o === this || !(o instanceof CharacterBase)) continue;
      const ov = o.collisionVolume;
      if (!ov) continue;
      const op = o.entity.position;
      // 高度差过大（不同层）不分离
      if (Math.abs(p.y - op.y) > 1.5) continue;
      const other = shapeExtents(ov.shape);
      const sep = separateXZ(
        p.x,
        p.z,
        me.hx,
        me.hz,
        op.x,
        op.z,
        other.hx,
        other.hz,
      );
      if (!sep) continue;
      p.x += sep.ax;   // ★ 水=正常地块（无水中分离折减）
      p.z += sep.az;
      op.x += sep.bx;
      op.z += sep.bz;
    }
  }

  /** ★ 地图装饰物推挤（碎石等 fixed cuboid；kinematic 无物理响应 → 手动弹出）。
   *   与角色间推挤同套路：圆形重叠 → 沿连线把角色推出障碍半径外。
   *   ★ 2026-09-11：改查 JS 空间索引（StaticObstacleRegistry）——原 rapier
   *   queryStaticObstacles 在装饰物密集区单次毫秒级（实测静态段 11.4ms/帧）。 */
  private separateFromStatics(): void {
    const vol = this.collisionVolume;
    if (!vol) return;
    const me = shapeExtents(vol.shape);
    if (me.hx <= 0 || me.hz <= 0) return;
    const p = this.entity.position;
    this.climbCand = null;   // ★ 每帧重置攀爬候选（接触期间由下面的推出分支写入）
    queryStaticObstaclesInto(p.x, p.z, me.hx + 0.4, _obstacleBuf);
    for (const o of _obstacleBuf) {
      const topY = o.y + o.hy;
      if (o.walkableTop) {
        // ★ 顶面可站（船体）：脚底已在顶面以上 → 不推（站在/跳在甲板上）
        if (p.y >= topY - 0.1) continue;
      } else {
        // 层差过滤：角色脚底不在障碍高度带内不推挤（允许上下平台重叠）
        const baseY = o.y - o.hy;
        if (p.y < baseY - me.hy - 0.3 || p.y > topY + me.hy + 0.3) continue;
      }
      // ★ 定向矩形（船体分段/掩体）：圆 vs OBB 推出
      if (o.hw !== undefined && o.hl !== undefined && o.yaw !== undefined) {
        const push = pushOutOBB(p.x, p.z, Math.max(me.hx, me.hz), o.x, o.z, o.hw, o.hl, o.yaw);
        if (push) {
          p.x += push.dx; p.z += push.dz;
          // ★ 攀爬候选：顶面可站 + 高差在可攀范围（0.4~CLIMB_MAX）→ 持续顶住则翻上去
          const top = o.y + o.hy;
          const rise = top - p.y;
          if (this.canClimbCovers && o.walkableTop && rise > 0.4 && rise <= CharacterBase.CLIMB_MAX) {
            const len = Math.hypot(push.dx, push.dz) || 1;
            const ix = -push.dx / len, iz = -push.dz / len;   // 指向掩体（推挤反方向）
            // ★ 沿路才爬（用户定 2026-09-25）：只有期望方向朝掩体（掩体在路上）才触发爬，防行军路过反复翻
            const md = this.controller.moveDir;
            const want = Math.hypot(md.x, md.y) || 1;
            const into = (md.x * ix + md.y * iz) / want;
            if (into > 0.6) this.climbCand = { top, ix, iz };
          }
        }
        continue;
      }
      const dx = p.x - o.x,
        dz = p.z - o.z;
      const minDist = me.hx + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        p.x = o.x + minDist;
        continue;
      } // 正中心：任选一侧推出
      const push = (minDist - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    }
  }

  /** ★ 开始攀爬（目标 = 沿"朝墙内"方向前进一个身位 + 顶面高度） */
  private beginClimb(cand: { top: number; ix: number; iz: number }): void {
    const p = this.entity.position;
    const vol = this.collisionVolume;
    const me = vol ? shapeExtents(vol.shape) : { hx: 0.3, hy: 1, hz: 0.3 };
    const reach = Math.max(0.5, Math.max(me.hx, me.hz) + 0.35);
    this.climbFromX = p.x; this.climbFromY = p.y; this.climbFromZ = p.z;
    this.climbToX = p.x + cand.ix * reach;
    this.climbToZ = p.z + cand.iz * reach;
    this.climbToY = cand.top + 0.02;
    this.climbT = 0;
    this.climbContactT = 0;
    this.climbCand = null;
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
  }

  /** ★ 攀爬步进：前 60% 时间升到顶，随后水平推进；结束交还贴地 */
  private stepClimb(dt: number): void {
    this.climbT += dt;
    const k = Math.min(1, this.climbT / CharacterBase.CLIMB_TIME);
    const ex = k * k * (3 - 2 * k);
    const ky = Math.min(1, k / 0.6);
    const ey = ky * ky * (3 - 2 * ky);
    const p = this.entity.position;
    p.x = this.climbFromX + (this.climbToX - this.climbFromX) * ex;
    p.z = this.climbFromZ + (this.climbToZ - this.climbFromZ) * ex;
    p.y = this.climbFromY + (this.climbToY - this.climbFromY) * ey;
    if (k >= 1) {
      p.y = this.climbToY;
      this.climbT = -1;
      this.controller.onFloor = true;
      this.climbCdUntil = performance.now() + CharacterBase.CLIMB_CD_MS;   // 过掩体：翻完冷却
    }
  }

  protected override heightOffset(): number {
    return this.controller.getHeightOffset();
  }

  /** ★ 刚体偏移：构造时 collisionVolume 尚未初始化（super 后）→ fallback 常量，
   *   否则初始刚体位置不修正（kinematic 不受力，不会自动推正 → 埋地） */
  protected override physicsBodyOffsetY(): number {
    return this.collisionVolume?.offsetY ?? DEFAULT_COLLISION_VOLUME.offsetY;
  }

  /** ★ 按纹理宽高比设置角色缩放（避免竖长/横长纹理被压扁）——子类 attach 后调用 */
  protected applyRenderScale(baseSize = 1.5): void {
    if (this.renderer && "setScaleKeepAspect" in this.renderer) {
      (
        this.renderer as { setScaleKeepAspect(s: number): void }
      ).setScaleKeepAspect(baseSize);
    }
  }

  /** ★ 影子声明（角色：宽/视觉高=贴片尺寸；太阳投影模式，早晚影子方向长度随日照变化） */
  protected override get shadowShape(): {
    w: number;
    h?: number;
    alpha?: number;
  } | null {
    const r = this.renderer as unknown as { mesh?: THREE.Mesh } | null;
    if (!r?.mesh) return null;
    return {
      w: Math.abs(r.mesh.scale.x || 1.2),
      h: Math.abs(r.mesh.scale.y || 1),
      alpha: 0.38,
    };
  }

  /** ★ 死亡动画（组合件 `services/fx/CharacterDeathFx`）：任何角色死亡 →
   *  纹理所有权转移给死亡动画（独立流体撕碎消散，纯表现，不阻塞掉落/结算）。
   *  `deathAnimEnabled` 保留为转发访问器（如玩家死亡 = 传送复活，覆写 onDeath 跳过）。 */
  protected readonly deathFx = new CharacterDeathFx();
  protected get deathAnimEnabled(): boolean { return this.deathFx.enabled; }
  protected set deathAnimEnabled(v: boolean) { this.deathFx.enabled = v; }

  /** ★ 受击染料（组合件 `services/fx/CharacterHitDye`）：FTX 残差通道染色 +
   *  持续注入 + 按 step 降频解算（仅 LOD0 启用）；配置默认值/说明见该文件。 */
  protected readonly hitDyeFx = new CharacterHitDye();

  /** ★ 受伤钩子：受击染红 + 死亡动画（正常扣血/死亡流程不变） */
  override onTakeDamage(dmg: number, source: EntityBase | null, hitPoint?: EntityHitPoint): void {
    // ★ 受击染料：注入点 = 真实命中点换算到贴片 bbox（拿不到点 → 回退上半身居中微偏）
    this.hitDyeFx.spawn(this.anim, this.viewLod, this.hitUvOf(hitPoint));
    super.onTakeDamage(dmg, source, hitPoint);
  }

  /** ★ 命中点（世界）→ 贴片注入点（bbox 局部归一化：x 0~1 左→右，y 0~1 上→下）。
   *  依据：
   *   ① `FluidEffect` 约定「注入源位置 = bbox 归一化 (0~1)，Y 向下为正」，解算器分辨率 = 帧 bbox；
   *   ② 敌人/玩家都调 `setFrameMapping({w:b.w,h:b.h}, {0,0,w,h})` ⇒ `texUV = vUv`（bbox 正好铺满贴片）
   *      ⇒ bbox 归一化坐标 = 贴片 uv；
   *   ③ 贴片几何是 `PlaneGeometry(1,1)` ⇒ 挂点局部坐标 ∈ [-0.5, 0.5]，`u = 0.5 + local.x`、`v = 0.5 - local.y`。
   *  ★★ 用 `mesh.worldToLocal()` 一次处理**三件事**（此前只做了第 1 件，另两件是"位置偏"的来源）：
   *      · **位置**：mesh.position 已是贴片中心（`FTXQuad.setPosition` 自动抬半高 − groundSink）；
   *      · **镜像**：`applyFlip` 把 scale 取负 ⇒ worldToLocal 自动带符号（不必手乘 ±1）；
   *      · **竖牌朝向**：`setBillboard` 每帧把贴片绕 Y 轴转向相机 ⇒ 世界 x 轴 ≠ 贴片局部 x 轴。
   *        相机不在 +Z 轴上时（第三人称绕圈时几乎总是如此），只用 `point.x − center.x` 会**横向偏移**。
   *  ★ 夹取到 [0.12,0.88] / [0.08,0.85]：命中点常在体外（挥击中心/远处射手）⇒ 落到"身体近侧边缘"。
   */
  private hitUvOf(point: EntityHitPoint | null | undefined): { x: number; y: number } {
    const fallback = (): { x: number; y: number } => ({
      x: 0.5 + (Math.random() - 0.5) * 0.2,
      y: 0.35 + (Math.random() - 0.5) * 0.2,
    });
    if (!point) return fallback();
    const mesh = (this.renderer as unknown as { mesh?: THREE.Mesh } | null)?.mesh;
    if (!mesh) return fallback();
    const w = Math.abs(mesh.scale.x);
    const h = Math.abs(mesh.scale.y);
    if (!(w > 1e-4) || !(h > 1e-4)) return fallback();
    mesh.updateMatrixWorld();
    _hitLocal.set(point.x, point.y, point.z ?? 0);
    mesh.worldToLocal(_hitLocal);
    const u = 0.5 + _hitLocal.x;
    const v = 0.5 - _hitLocal.y;
    return {
      x: Math.min(0.88, Math.max(0.12, u)),
      y: Math.min(0.85, Math.max(0.08, v)),
    };
  }

  /** ★ 受击锚点高度：贴片竖直 65% 处（胸口）。
   *  贴片中心在 50% ⇒ `centerY + 0.15 × 贴片高`。
   *  ★ 基类的"脚底 +1.0m"对 3.7m 敌人只有 v≈0.73（大腿）、对 BOSS 更低 ⇒ 必须问贴片自己。 */
  override hitAnchorY(): number {
    const mesh = (this.renderer as unknown as { mesh?: THREE.Mesh } | null)?.mesh;
    const h = mesh ? Math.abs(mesh.scale.y) : 0;
    if (mesh && h > 1e-4) return mesh.position.y + h * 0.15;
    return super.hitAnchorY();
  }

  /** ★ 只触发死亡动画（不销毁实体）——玩家死亡（传送复活）用 */
  playDeathAnim(): void {
    const p = this.entity.position;
    this.deathFx.spawn(this.anim, p.x, p.y, p.z, this.deathAnimWorldSize());
  }

  /** ★ 死亡动画贴片高度：取角色贴片当前世界高度（跟随体型放大/缩放，
   *   死亡瞬间尺寸与活着一致；兜底 2.0 = 玩家贴片高） */
  private deathAnimWorldSize(): number {
    const r = this.renderer as unknown as { mesh?: THREE.Mesh } | null;
    const h = r?.mesh?.scale.y;
    return h ? Math.abs(h) : 2.0;
  }

  /** ★ 销毁：释放受击染料流体（恢复原纹理资源） */
  override dispose(): void {
    this.hitDyeFx.dispose();
    super.dispose();
  }

  /** ★ 死亡：先触发死亡动画（冻结死亡帧 → 流体消散），再走默认销毁 */
  override onDeath(source: EntityBase | null): void {
    const p = this.entity.position;
    this.deathFx.spawn(this.anim, p.x, p.y, p.z, this.deathAnimWorldSize());
    super.onDeath(source);
  }

  /** 角色世界位置（物理读回后，x/z）——相机/模式层读取 */
  get controllerPosition(): { x: number; y: number } {
    return { x: this.entity.position.x, y: this.entity.position.z };
  }

  /** ★ 当前跳跃高度偏移（相机聚焦点跟随用：跳跃时相机跟着升） */
  get jumpHeight(): number {
    return this.controller.getHeightOffset();
  }
}
