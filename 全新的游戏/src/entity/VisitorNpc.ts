// ============================================================
// VisitorNpcBase —— 访客 NPC 基类（CharacterBase 子类）
// ============================================================
// 访客机制（2026-09-15 设计）：
//   · 每天世界上生成 1~2 名访客（由访客系统按日生成，向舰船位置行进）；
//   · 抵达舰船 → 进入舰内房间（onArrive 回调交给访客系统：提示 + 舰内站位）；
//   · 每名访客独立：纹理（asset/assetUrl）、对话树（dialogue）、事件 id（eventId）。
//
// 基类职责：
//   · 步行接近（地形跟随/推挤/朝向/步行动画；可涉水、可爬坡，只避让坑洞）→ 抵达判定 → 状态机；
//   · 途中可对话（approachDialogue + interactRadius + setPaused 停下交谈 + faceToward 看向玩家）；
//   · 可被攻击：玩家侧短窗口累计伤害达阈值 / 致命伤 → 逃跑（onFlee 开始 / onFleeEnd 跑完；访客不死）；
//   · 抵达/进舰后 = 舰内：不可攻击（attackable = false，舰内本身也是无战斗场景）。
// 子类可覆写 onVisitorArrive / onVisitorFlee / onVisitorTick 实现独立事件表现；
// 生成名额、到访提示、舰内交互站/落账 = 访客系统（上层）装配，基类不碰 UI。
// ============================================================

import type * as THREE from 'three';
import { CharacterBase } from './CharacterBase';
import type { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { CharacterAnimMap } from '../systems/player/CharacterController';
import type { CameraFrame } from '../services/camera/CameraController';
import { FTXQuad } from '../services/render/FTXQuad';
import type { FxRendererBase } from '../services/render/FxRendererBase';
import { VisitorBodyRenderer, type VisitorBodyStyle } from '../services/render/VisitorBodyRenderer';
import { sameTeam } from '../services/combat/teams';
import { RasterMap } from '../services/map/RasterMap';

/** 访客状态：接近舰船 →（抵达待进舰 / 被打跑）→ 已进舰 / 已逃走（均为世界侧退场） */
export type VisitorPhase = 'approaching' | 'arrived' | 'fleeing' | 'fled' | 'entered';

/** 默认到舰判定半径（世界单位，米） */
export const VISITOR_ARRIVE_RADIUS = 10;
/** 默认步行速度（世界单位/秒） */
export const VISITOR_MOVE_SPEED = 3.2;
/** 默认生命上限（访客不死，只逃） */
export const VISITOR_MAX_HP = 120;
/** 默认逃跑阈值 = 生命上限 × 此比例（短窗口内累计玩家伤害达到 → 逃） */
export const VISITOR_FLEE_HP_PCT = 0.35;
/** 默认伤害统计窗口（秒） */
export const VISITOR_FLEE_WINDOW = 3;
/** 逃跑速度倍率（相对步行） */
export const VISITOR_FLEE_SPEED_MUL = 1.6;
/** 逃跑脱战距离（米；离威胁点超过即视为逃走成功） */
export const VISITOR_FLEE_ESCAPE_DIST = 40;
/** 逃跑最长时长（秒；地形卡住兜底） */
export const VISITOR_FLEE_MAX_TIME = 12;
/** 危险地形探测距离（米）：只探测坑洞（访客可涉水/爬坡，不避水与坡） */
export const VISITOR_HAZARD_PROBE = 2.0;
/** 爬坡速度（米/秒，贴地上行；与玩家 clampCharacter 同口径） */
export const VISITOR_CLIMB_SPEED = 7.5;
/** 下坡跟进速度（米/秒，贴地下行） */
export const VISITOR_DESCEND_SPEED = 25;

/** ★ 访客身份/配置：每名 NPC 一份（纹理 + 对话 + 事件 + 行进/战斗参数） */
export interface VisitorDef {
  /** 唯一 id（注册表/存档/事件键） */
  id: string;
  /** 显示名（途中交互/舰内交互/提示） */
  name: string;
  /** 立绘资产 URL（世界贴片 + 舰内站位 + 对话头像共用） */
  assetUrl: string;
  /** 对话树 id（config/dialogues.json；抵达后/舰内使用） */
  dialogue: string;
  /** 事件 id（config/events.json；对话结束 → EventSystem 落账；缺省不落账） */
  eventId?: string;
  /** 途中对话树覆盖（缺省 = dialogue；途中对话由上层决定是否落事件账） */
  dialogueOnApproach?: string;
  /** 步行速度覆盖（缺省 VISITOR_MOVE_SPEED） */
  moveSpeed?: number;
  /** 贴片缩放覆盖（世界宽；缺省 2.0，与主角一致） */
  scale?: number;
  /** 到舰半径覆盖（缺省 VISITOR_ARRIVE_RADIUS） */
  arriveRadius?: number;
  /** 交互半径覆盖（缺省 3.2，与事件 NPC 一致） */
  interactRadius?: number;
  /** 生命上限覆盖（缺省 VISITOR_MAX_HP） */
  maxHp?: number;
  /** 防御覆盖（减法减伤；缺省 0） */
  defense?: number;
  /** 短窗口累计伤害逃跑阈值覆盖（缺省 maxHp × VISITOR_FLEE_HP_PCT） */
  fleeDamageThreshold?: number;
  /** 伤害统计窗口覆盖（秒；缺省 VISITOR_FLEE_WINDOW） */
  fleeWindow?: number;
  /** ★ 程序化身体（球头 + 方身 + 关节胶囊四肢；每名访客只换脸纹理）。
   *  填了则不走 FTX 贴片（纹理资产只取首帧/前帧作脸）；不填 = 传统贴片访客 */
  body?: VisitorBodyStyle;
}

export interface VisitorNpcOptions {
  def: VisitorDef;
  x: number;
  y: number;
  z: number;
  /** ★ 目标点（舰船当前位置）读取器：每帧调用，舰船移动后也能追上 */
  getTarget: () => { x: number; z: number } | null;
  /** ★ 抵达舰船回调（访客系统接管：进舰提示 + 舰内入住 + 世界侧退场） */
  onArrive?: (visitor: VisitorNpcBase) => void;
  /** ★ 被打跑回调（访客系统接管：取消本次拜访 + 世界侧退场；台词/提示由上层播） */
  onFlee?: (visitor: VisitorNpcBase) => void;
  /** ★ 逃跑完成回调（跑出脱战距离/超时；上层可在此 dispose/清理记录） */
  onFleeEnd?: (visitor: VisitorNpcBase) => void;
  /** 相机帧读取器（可选；有则按镜头判定 前/后 帧 + 左右翻转） */
  getCameraFrame?: () => CameraFrame | null;
  /** 动画表覆盖（缺省按纹理帧名推导：前/后 前缀分组；无方向名则整组循环） */
  animMap?: CharacterAnimMap;
}

export class VisitorNpcBase extends CharacterBase {
  readonly def: VisitorDef;
  readonly moveSpeed: number;
  readonly arriveRadius: number;
  /** 交互半径（途中 E 对话判定；与事件 NPC 同口径） */
  readonly interactRadius: number;

  private phase: VisitorPhase = 'approaching';
  private readonly fleeThreshold: number;
  private readonly fleeWindow: number;
  /** 对话暂停（途中交谈：停下等玩家看完，结束恢复行进） */
  private paused = false;

  // ---- 被攻击 → 逃跑（统计窗口内玩家侧累计伤害） ----
  private dmgWindow = 0;
  private dmgWindowStart = 0;
  private fleeElapsed = 0;
  private fleeFrom: { x: number; z: number } | null = null;

  // ---- 危险地形回避（只避坑洞；水/坡不避——访客可涉水、可爬坡） ----
  private hazardSafeDir: { x: number; z: number } | null = null;
  private hazardTurnTimer = 0;

  private readonly getTarget: () => { x: number; z: number } | null;
  private readonly onArriveCb?: (visitor: VisitorNpcBase) => void;
  private readonly onFleeCb?: (visitor: VisitorNpcBase) => void;
  private readonly onFleeEndCb?: (visitor: VisitorNpcBase) => void;
  private readonly getCameraFrame?: () => CameraFrame | null;
  private readonly visitorAnimMap: CharacterAnimMap;
  /** 当前动画态（幂等：状态不变不重播） */
  private animMoving: boolean | null = null;
  /** ★ 程序化身体渲染器（def.body 时启用；关节动画由它自己驱动） */
  private bodyRenderer: VisitorBodyRenderer | null = null;

  constructor(em: EntityManager, scene: THREE.Scene, asset: FrameAssetSource, opts: VisitorNpcOptions) {
    const animMap = opts.animMap ?? deriveVisitorAnimMap(asset);
    super(em, {
      kind: 'npc',
      x: opts.x,
      y: opts.y,
      z: opts.z,
      asset,
      animMap,
      moveSpeed: opts.def.moveSpeed ?? VISITOR_MOVE_SPEED,
      facing: '前',
    });
    this.def = opts.def;
    this.moveSpeed = opts.def.moveSpeed ?? VISITOR_MOVE_SPEED;
    this.arriveRadius = opts.def.arriveRadius ?? VISITOR_ARRIVE_RADIUS;
    this.interactRadius = opts.def.interactRadius ?? 3.2;
    // ★ 生命/防御：访客可被攻击（不死，致命伤 → 逃）
    this.maxHp = opts.def.maxHp ?? VISITOR_MAX_HP;
    this.hp = this.maxHp;
    this.defense = opts.def.defense ?? 0;
    this.fleeThreshold = opts.def.fleeDamageThreshold ?? this.maxHp * VISITOR_FLEE_HP_PCT;
    this.fleeWindow = opts.def.fleeWindow ?? VISITOR_FLEE_WINDOW;
    this.getTarget = opts.getTarget;
    this.onArriveCb = opts.onArrive;
    this.onFleeCb = opts.onFlee;
    this.onFleeEndCb = opts.onFleeEnd;
    this.getCameraFrame = opts.getCameraFrame;
    this.visitorAnimMap = animMap;
    this.camp = 'neutral';
    // ★ 程序化身体：关 billboard（3D 身体按移动方向 yaw，不用面向相机的 2D 贴片）
    if (opts.def.body) this.billboard = false;
    // ★ 访客不参战；地形跟随与玩家同款：可涉水、可爬坡，仅绕开坑洞
    this.blockCliffClimb = false;
    this.attachToScene(scene);
    const scale = opts.def.scale ?? 2.0;
    if (this.renderer && 'setScaleKeepAspect' in this.renderer) {
      (this.renderer as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(scale);
    }
    this.playVisitorAnim(true); // 生成即行进 → 走入步行动画
  }

  /** 当前状态（访客系统读取：approaching/fleeing 世界侧活跃；arrived 待进舰；entered/fled 已退场） */
  get visitPhase(): VisitorPhase {
    return this.phase;
  }

  /** 访客 id（登记/存档键） */
  get visitorId(): string {
    return this.def.id;
  }

  /** 显示名（提示/交互） */
  get displayName(): string {
    return this.def.name;
  }

  /** ★ 小地图/大地图：NPC 金色点常显（世界侧行进/逃跑中标记为移动） */
  override get minimapInfo(): { kind: string; moving: boolean } {
    return {
      kind: 'npc',
      moving: this.phase === 'approaching' || this.phase === 'fleeing',
    };
  }

  /** ★ 是否可被攻击：仅世界侧行进/逃跑中；抵达/进舰后（舰内）免疫 */
  get attackable(): boolean {
    return this.phase === 'approaching' || this.phase === 'fleeing';
  }

  /** 途中对话树（缺省 = dialogue；落账与否由上层决定） */
  get approachDialogue(): string {
    return this.def.dialogueOnApproach ?? this.def.dialogue;
  }

  /** 舰内对话树 */
  get visitDialogue(): string {
    return this.def.dialogue;
  }

  /** 到舰距离（无目标返回 Infinity；上层可做提示/标记） */
  distanceToTarget(): number {
    const target = this.getTarget();
    if (!target) return Infinity;
    const p = this.entity.position;
    return Math.hypot(target.x - p.x, target.z - p.z);
  }

  /** ★ 面向世界点（途中/舰内对话时让访客看向玩家；贴片按相机帧、身体直接转 yaw） */
  faceToward(x: number, z: number): void {
    const p = this.entity.position;
    if (this.bodyRenderer) {
      this.bodyRenderer.setYaw(Math.atan2(x - p.x, z - p.z));
      return;
    }
    this.updateFacing(x - p.x, z - p.z);
  }

  /** ★ 途中交谈：暂停/恢复行进（停下说话；结束后继续走向舰船） */
  setPaused(v: boolean): void {
    this.paused = v;
    if (v) {
      this.stopMove();
      this.playVisitorAnim(false);
    }
  }

  /** ★ 渲染器：程序化身体（def.body）或 FTXQuad billboard 贴片（与 NPC / 主角同管线） */
  protected createRenderer(scene: THREE.Scene): FxRendererBase | null {
    if (this.def.body) {
      const body = new VisitorBodyRenderer(scene, this.anim?.source ?? null, this.def.body);
      this.bodyRenderer = body;
      return body;
    }
    if (!this.anim) return null;
    return new FTXQuad(scene, this.anim.source);
  }

  protected override onUpdate(dt: number): void {
    this.updateMotion(dt);
    // ★ 程序化身体：关节步态每帧驱动（视锥外省算，回到视野下一帧恢复）
    if (this.bodyRenderer && this.inFrustum) this.bodyRenderer.update(dt);
  }

  private updateMotion(dt: number): void {
    if (this.paused) {
      this.stopMove();
      this.playVisitorAnim(false);
      return;
    }
    if (this.phase === 'approaching') {
      this.updateApproach(dt);
      return;
    }
    if (this.phase === 'fleeing') {
      this.updateFlee(dt);
      return;
    }
    this.stopMove();
  }

  // ============ 被攻击 / 逃跑 ============

  /** ★ 受击：仅世界侧可被攻击；玩家侧短窗口累计 → 逃；致命伤 → 逃（访客不死） */
  override onTakeDamage(dmg: number, source: EntityBase | null): void {
    if (!this.attackable) return;
    if (this.isPlayerSide(source)) this.trackPlayerDamage(dmg, source); // 可能直接触发逃跑
    if (this.phase === 'fleeing') {
      super.onTakeDamage(0, source); // 触发/逃跑中不再扣血（保留受击表现）
      return;
    }
    if (dmg >= this.hp) {
      this.hp = 1;
      super.onTakeDamage(0, source); // 受击表现
      this.startFlee(source);        // 未被"短时爆发"触发时的致命一击 → 逃
      return;
    }
    super.onTakeDamage(dmg, source);
  }

  /** ★ 访客不死：任何致死路径都转为逃跑（防止误触发 killed 结算） */
  override onDeath(source: EntityBase | null): void {
    this.startFlee(source);
  }

  /** 玩家侧伤害累计（窗口过期清零；达到阈值 → 逃跑） */
  private trackPlayerDamage(dmg: number, source: EntityBase | null): void {
    const now = performance.now() / 1000;
    if (now - this.dmgWindowStart > this.fleeWindow) {
      this.dmgWindowStart = now;
      this.dmgWindow = 0;
    }
    this.dmgWindow += dmg;
    if (this.phase === 'approaching' && this.dmgWindow >= this.fleeThreshold) {
      this.startFlee(source);
    }
  }

  /** 是否玩家侧伤害（玩家 / 玩家召唤物；与命中过滤同一真源） */
  private isPlayerSide(source: EntityBase | null): boolean {
    return !!source && sameTeam(source.camp, 'player');
  }

  /** ★ 开逃：远离威胁点（伤害来源；无来源则远离舰船方向）跑路，出界/超时即退场 */
  private startFlee(source: EntityBase | null): void {
    if (this.phase !== 'approaching') return;
    this.phase = 'fleeing';
    this.paused = false;
    this.stopMove();
    this.fleeElapsed = 0;
    const target = this.getTarget();
    const p = this.entity.position;
    this.fleeFrom = source
      ? { x: source.position.x, z: source.position.z }
      : target
        ? { x: target.x, z: target.z }
        : { x: p.x - 1, z: p.z }; // 兜底：无来源/无目标 → 朝生成朝向反方向
    this.onVisitorFlee();
    this.onFleeCb?.(this);
  }

  private updateFlee(dt: number): void {
    const from = this.fleeFrom;
    if (!from) {
      this.finishFlee();
      return;
    }
    const p = this.entity.position;
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    if (Math.hypot(dx, dz) >= VISITOR_FLEE_ESCAPE_DIST || this.fleeElapsed >= VISITOR_FLEE_MAX_TIME) {
      this.finishFlee();
      return;
    }
    this.steerAndAdvance(dx, dz, dt, this.moveSpeed * VISITOR_FLEE_SPEED_MUL, false);
    this.fleeElapsed += dt;
  }

  /** 逃成功：世界侧退场（上层见 fled 后 dispose） */
  private finishFlee(): void {
    this.phase = 'fled';
    this.stopMove();
    this.playVisitorAnim(false);
    this.visible = false;
    this.onFleeEndCb?.(this);
  }

  /** 子类钩子：被玩家打跑（独立事件表现；退场由访客系统接管） */
  protected onVisitorFlee(): void {}

  // ============ 接近 / 抵达 ============

  private updateApproach(dt: number): void {
    const target = this.getTarget();
    if (!target) {
      this.stopMove();
      this.playVisitorAnim(false);
      return;
    }
    const p = this.entity.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= this.arriveRadius) {
      this.arrive();
      return;
    }
    // ★ 登舰段（距舰 ≤ 2×到舰半径）不再避障：舰船可能停在水边/浅滩，最后一段直接走
    this.steerAndAdvance(dx, dz, dt, this.moveSpeed, dist <= this.arriveRadius * 2);
    this.onVisitorTick(dt);
  }

  /** 行进统一入口：坑洞探测/绕行 → 移动 → 地形跟随 → 朝向 → 步行动画 → 基类推进 */
  private steerAndAdvance(dx: number, dz: number, dt: number, speed: number, skipHazard: boolean): void {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      this.stopMove();
      return;
    }
    let nx = dx / len;
    let nz = dz / len;
    if (!skipHazard && this.isHazardAhead(nx, nz)) {
      const safe = this.resolveHazardDir(nx, nz, dt);
      if (!safe) {
        this.stopMove(); // 全方向危险（坑中孤岛）→ 站住等下一轮
        this.playVisitorAnim(false);
        return;
      }
      nx = safe.x;
      nz = safe.z;
    } else {
      this.hazardSafeDir = null;
      this.hazardTurnTimer = 0;
    }
    this.controller.moveToward(nx, nz, dt, speed);
    if (this.bodyRenderer) {
      // 程序化身体：朝向 = 移动方向；步态交给自己（含频率/关节/起伏）
      this.bodyRenderer.setYaw(Math.atan2(nx, nz));
      this.bodyRenderer.setLocomotion(true, speed);
    } else {
      this.updateFacing(nx, nz);
      this.playVisitorAnim(true);
    }
    super.onUpdate(dt);
    this.followTerrain(dt);
  }

  /** ★ 贴地跟随（访客不在 WorldMode.clampCharacter 名单内，自行结算）：
   *  上坡按 VISITOR_CLIMB_SPEED 爬升（可爬坡），下坡/入水按 VISITOR_DESCEND_SPEED 跟进（可涉水）。 */
  private followTerrain(dt: number): void {
    const raster = RasterMap.current;
    if (!raster) return;
    const p = this.entity.position;
    const gy = raster.surfaceHeightAtFor(p.x, p.z, p.y);
    const dy = gy - p.y;
    if (dy > 0) p.y += Math.min(dy, VISITOR_CLIMB_SPEED * dt);
    else if (dy < 0) p.y += Math.max(dy, -VISITOR_DESCEND_SPEED * dt);
  }

  /** 前方危险地形 → 就近安全航向（沿用上次安全方向；节流扫描 ±22.5°…±180°） */
  private resolveHazardDir(nx: number, nz: number, dt: number): { x: number; z: number } | null {
    const kept = this.hazardSafeDir;
    if (kept && !this.isHazardAhead(kept.x, kept.z)) return kept;
    this.hazardSafeDir = null;
    this.hazardTurnTimer -= dt;
    if (this.hazardTurnTimer > 0) return null;
    this.hazardTurnTimer = 0.35;
    const base = Math.atan2(nz, nx);
    for (let k = 1; k <= 8; k++) {
      const dev = (Math.PI / 8) * k;
      for (const s of [1, -1] as const) {
        const a = base + dev * s;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        if (!this.isHazardAhead(cx, cz)) {
          const dir = { x: cx, z: cz };
          this.hazardSafeDir = dir;
          return dir;
        }
      }
    }
    return null;
  }

  /** ★ 前方是否有坑洞（可涉水/爬坡，只挡"掉进去"的天然坑）：
   *  坑洞地块（pit）且该处有效地表深（< -1.2）→ 危险；水面/浮空洞顶（cap）不挡。 */
  private isHazardAhead(ux: number, uz: number): boolean {
    const raster = RasterMap.current;
    if (!raster) return false;
    const p = this.entity.position;
    for (const d of [VISITOR_HAZARD_PROBE * 0.55, VISITOR_HAZARD_PROBE]) {
      const hx = p.x + ux * d;
      const hz = p.z + uz * d;
      if (raster.tileDefAt(hx, hz).genRole !== 'pit') continue;
      if (raster.surfaceHeightAtFor(hx, hz, p.y) < -1.2) return true;
    }
    return false;
  }

  /** ★ 访客系统调用：标记已进舰（世界侧退场 = 舰内；此后不可攻击；dispose 时机由系统决定） */
  markEntered(): void {
    if (this.phase !== 'arrived') return;
    this.phase = 'entered';
    this.stopMove();
    this.visible = false;
  }

  /** 子类钩子：抵达舰船（独立事件表现；进舰逻辑由访客系统接管） */
  protected onVisitorArrive(): void {}

  /** 子类钩子：接近阶段每帧（独立表现/事件判定） */
  protected onVisitorTick(_dt: number): void {}

  private arrive(): void {
    this.phase = 'arrived';
    this.stopMove();
    this.playVisitorAnim(false);
    this.onVisitorArrive();
    this.onArriveCb?.(this);
  }

  private stopMove(): void {
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
    this.bodyRenderer?.setLocomotion(false, 0);
  }

  /** 朝向：按相机帧判定 前/后 帧组 + 左右镜像（无相机读取器则保持 前 + 不翻转）。
   *  程序化身体由 setYaw 控制，不走这里 */
  private updateFacing(dx: number, dz: number): void {
    if (this.bodyRenderer) return;
    const frame = this.getCameraFrame?.() ?? null;
    if (!frame || !this.anim) return;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = dx / len;
    const nz = dz / len;
    const fDot = nx * frame.forward.x + nz * frame.forward.z;
    if (fDot > 0.35) this.anim.setFacing('后');
    else if (fDot < -0.35) this.anim.setFacing('前');
    const rDot = nx * frame.right.x + nz * frame.right.z;
    if (rDot < -0.35) this.anim.setFlipX(true);
    else if (rDot > 0.35) this.anim.setFlipX(false);
  }

  /** 步行/待机动画（幂等；帧组取当前朝向；程序化身体交给自己驱动） */
  private playVisitorAnim(walking: boolean): void {
    if (this.bodyRenderer) return;
    if (this.animMoving === walking) return;
    this.animMoving = walking;
    if (!this.anim) return;
    const facing = this.anim.state.facing;
    const group = this.visitorAnimMap.states[walking ? 'walk' : 'idle'][facing];
    if (!group || group.length === 0) return;
    this.anim.playFrames(walking ? group : [group[0]], {
      loop: true,
      fps: walking ? (this.visitorAnimMap.fps?.walk ?? 5) : 1,
    });
  }
}

/** ★ 默认动画表：帧名以 前/后 开头 → 分朝向；无方向名 → 整组帧按 前 循环
 *  （单帧资产退化为站姿；具体访客可用 animMap 覆盖） */
export function deriveVisitorAnimMap(source: FrameAssetSource): CharacterAnimMap {
  const names = source.frameNames();
  const fallback = names.length > 0 ? names : ['前'];
  const pick = (facing: '前' | '后'): string[] => {
    const hit = names.filter((n) => n.startsWith(facing));
    return hit.length > 0 ? hit : fallback;
  };
  const front = pick('前');
  const back = pick('后');
  return {
    states: {
      idle: { 前: [front[0]], 后: [back[0]] },
      walk: { 前: front, 后: back },
      attack: { 前: [front[0]], 后: [back[0]] },
    },
    fps: { idle: 2, walk: 5, attack: 6 },
  };
}
