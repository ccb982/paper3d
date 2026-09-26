// ============================================================
// EnemyBase —— 敌人基类（CharacterBase 子类 + AI 模块）
// ============================================================
// 使用特效包（.scene.zip，Asset 源）：
//   - 帧动画（前/后帧组）+ FTXQuad 渲染 + 扭曲参数（第一帧继承）
//   - ★ AI 模块：状态机驱动（巡逻/索敌/攻击，配置驱动）
//   - ★ 朝向由移动方向决定（非相机）——敌人自主转身，玩家可绕背看后帧

import * as THREE from 'three';
import {
  CharacterBase,
  DEFAULT_COLLISION_VOLUME,
  type CharacterBaseOptions,
} from './CharacterBase';
import type { EntityManager } from './EntityManager';
import type { EntityBase, EntityHitPoint, RetireReason } from './EntityBase';
import type {
  SwarmCarrier, SteerIntent, SwarmSnapshot, UnitRole, UnitAttackType,
  SquadOrderKind, DirectiveKind, TacticalOrder, UnitDirective,
} from './SwarmUnit';
import {
  orderCode, orderFromCode, directiveCode, directiveFromCode, fireCode, FIRE_FREE, roleBucket,
  UNIT_HIT_HOLD_S,
} from './SwarmUnit';
import {
  MOVE_ATOMS, resolveWeights, atomDirection, rollMove, rollFire,
} from './AtomExecutor';
import { autoGroundSinkFromFrame } from '../services/fx/groundSink';
import { EnemyLocomotion } from './enemy/EnemyLocomotion';
import { EnemyBrain } from './enemy/EnemyBrain';
import { EnemyPresentation } from './enemy/EnemyPresentation';
import type { CharacterFxAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { AIStateMachine } from '../systems/ai/AIStateMachine';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { aiSystem } from '../systems/ai/AISystem';
import type { AIConfig } from '../systems/ai/aiconfig';
import { ENEMY_ENGAGE_FLOOR } from '../systems/ai/aiconfig';
import { HealthBar } from '../services/fx/HealthBar';
import { RasterMap } from '../services/map/RasterMap';
import { eventBus } from '../core/EventBus';
import { simNow } from '../services/SimClock';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（预留） */
  /** AI 配置（无 → 静止） */
  aiConfig?: AIConfig;
  /** 生命值（默认 30） */
  hp?: number;
  /** ★ 贴片放大（默认 1） */
  scale?: number;
  /** ★ 碰撞体积放大（在 scale 基础上再乘；默认 1，命中体积与贴片可不等） */
  collisionScale?: number;
  /** ★ 防御（伤害结算：damage + 攻方 attackPower - 防方 defense） */
  defense?: number;
  /** ★ 攻击力加成（默认 0） */
  attackPower?: number;
  /** ★ 接地补偿（世界单位；纹理底部透明余量 → 往下压这么多，避免悬空）。
   *  来源：FootAnchor.footSinkRatioOf(asset) × scale（见 MobDef.groundSink）。 */
  groundSink?: number;
  /** ★ 空中层（2026-09-18）：飞行单位（悬停；不贴地/不绕坑/不掉坑判死）。
   *  来源：名册 `EnemySpec.isAir`（经 MobDef 透传）。 */
  airborne?: boolean;
  /** ★ 空中悬停高度（米，相对地表；缺省 2.6）。仅 airborne 有效。 */
  airAltitude?: number;
  /** ★ v2 兵种角色（大编队配比依据；缺省 = grunt，行为不变） */
  role?: UnitRole;
  /** ★ v2 攻击类型（缺省 = melee，行为不变） */
  attackType?: UnitAttackType;
  /** ★ 强制始终面对相机（缺省 = 自动检测：无「后」帧素材强制 billboard） */
  billboard?: boolean;
  /** ★ 自爆标签（基类字段；与 isAir/role 同级） */
  suicide?: boolean;
  /** ★ 施工能力（会挖战壕/造掩体；与 role 解耦；缺省 false） */
  canBuild?: boolean;
}

const _atomDir = { x: 0, z: 0 };

export class EnemyBase extends CharacterBase implements SwarmCarrier {
  private assetRef: CharacterFxAssetSource;
  /** ★ E5：移动器（危险地形绕行；纯搬运） */
  private readonly locomotion = new EnemyLocomotion();
  /** ★ E5：表现器（显示帧/转身/扭曲；纯搬运） */
  private readonly presentation = new EnemyPresentation();
  /** ★ E5：行为器（眩晕/保底攻击/指令→原子；纯搬运） */
  private readonly brain = new EnemyBrain();

  // ============================================================
  // ★ 蜂群预留字段（《RTS架构.md》§5.3；v2 由 SwarmTierPort 填值）
  //   当前全部为默认值（散兵/未编队/地面/近战）→ 行为零变化。
  // ============================================================
  /** 稳定 uid（升格/降格往返不变；替代裸 index） */
  swarmUid = 0;
  /** 当前载体（L3 实体恒为 'entity'） */
  readonly carrier = 'entity' as const;
  /** ★ 激活态（2026-09-19 单一单位模型）：实体载体恒 active（代理池 = dormant） */
  readonly activation = 'active' as const;
  /** ★ 是否本队队长（指挥权转移写；dormant 恒 false） */
  isLeader = false;
  /** ★ 是否代理载体（实体恒 false；carrier 派生位，逻辑分支统一读它） */
  readonly isAgent = false;
  /** ★ 自爆标签（基类字段；构造从 MobDef，快照跨 LOD） */
  suicide = false;
  /** ★ 施工能力（挖战壕/造掩体；与 role 解耦） */
  canBuild = false;
  /** ★ 被击免降格截止（秒；步骤 10；队长/大队警觉在 swarm 侧） */
  noDemoteUntil = 0;
  /** ★ 感知（E3b 预留；步骤 9 通信/感知接线填值）：最后目击 + 仇恨来源 */
  lastSeenX = 0;
  lastSeenZ = 0;
  lastSeenAt = 0;
  aggroFrom = 0;

  // ============================================================
  // ★ 步骤 9b：命令 / 个体指令（低频推送；随快照跨 LOD）
  //   'none' = 无命令 → 本地自主（无命令自主 / 有命令命令优先）
  // ============================================================
  /** 小队命令镜像（kind/target/until/seq） */
  orderKind: SquadOrderKind | 'none' = 'none';
  orderTargetX = 0;
  orderTargetZ = 0;
  orderUntil = 0;
  orderSeq = 0;
  /** 个体指令（kind/target/ward/until/fire/speedMul/seq） */
  directiveKind: DirectiveKind | 'none' = 'none';
  directiveTargetX = 0;
  directiveTargetZ = 0;
  directiveWard = 0;
  directiveUntil = 0;
  directiveFire = FIRE_FREE;
  directiveSpeedMul = 1;
  directiveSeq = 0;

  /** ★ E5：本段开火门控（行为层读取；由 EnemyBrain 写入） */
  get fireHold(): boolean { return this.brain.fireHold; }
  /** ★ E5：本段移动原子下标（255 = 无覆盖） */
  get atomMove(): number { return this.brain.atomMove; }
  /** 探针：移动器承诺方向（诊断用） */
  get locomotionHeld(): { x: number; z: number; until: number } { return this.locomotion.heldDbg; }
  /** ★ E5：是否眩晕中（行为器判定） */
  get isStunned(): boolean { return this.brain.isStunned; }

  private fbCd = 0;
  /** 大编队（-1 = 未编队；权威在 Squad.battalion，实体只存副本） */
  battalionId = -1;
  /** 小编队（-1 = 散兵/未编队） */
  squadId = -1;
  /** 阵型槽位（-1 = 未分配） */
  formSlot = -1;
  /** 沿走廊推进进度（waypoint 索引） */
  corridorIdx = -1;
  /** 兵种角色（软约束） */
  role: UnitRole = 'grunt';
  /** 移动目标点（世界坐标；编队/寻路下发，hold 语义；null = 无目标） */
  moveTarget: { x: number; y: number; z: number } | null = null;
  /** ★ 编队移动速度（m/s；steer 消费；随快照跨 LOD） */
  moveSpeed = 2.5;
  /** 攻击类型：none/melee/ranged/bombard */
  attackType: UnitAttackType = 'melee';
  /** ★ 控制权（唯一切换点；只允许在 Phase 4 改） */
  controlSource: 'swarm' | 'local' = 'local';
  /** 飞天/悬停高度 = CharacterBase 的 airborne/airAltitude（单一事实源） */
  get isAir(): boolean { return this.airborne; }
  get altitude(): number { return this.airAltitude; }

  /** ★ steer 保持窗口（秒）：超时自动回落 local（不允许停摆，v2 铁律 3） */
  static readonly STEER_TTL = 0.5;
  /** 最近一次 steer（hold；swarm 控制时每帧消费） */
  private readonly steerState: SteerIntent = { dirX: 0, dirZ: 0, speed: 0, source: 'none' };
  private steerFreshUntil = 0;
  /** ★ E4a：steer 消费内的 moveBy 重入豁免（本地 AI 走 moveBy 一律被拦） */
  private applyingSteer = false;

  /** ★ 编队控制中（swarm 且 steer 新鲜）：本地 AI 只保留战斗决策（《RTS架构.md》§9.4） */
  get swarmControlled(): boolean {
    return this.controlSource === 'swarm' && this.hasFreshSteer;
  }

  /** Phase 1→2：swarm 下发移动意图（hold 语义；null = 清除） */
  applySteer(intent: SteerIntent | null): void {
    if (!intent) {
      this.steerState.source = 'none';
      this.climbOrdered = false;   // 凭证随 steer 清除
      this.climbPt = undefined;
      return;
    }
    Object.assign(this.steerState, intent);
    this.climbOrdered = intent.climb === true;   // ★ 爬坡凭证（路线发放）
    this.climbPt = intent.climbPt;               // ★ 凭证点（爬坡执行比对用）
    this.steerFreshUntil = performance.now() / 1000 + EnemyBase.STEER_TTL;
    // ★ E4a：收到 steer = 控制权交给 swarm（超时回落由 applySteerMovement 执行）
    this.controlSource = 'swarm';
  }

  /** 是否有新鲜 steer（steer 消费 / 调试用） */
  get hasFreshSteer(): boolean {
    return this.steerState.source !== 'none' && performance.now() / 1000 <= this.steerFreshUntil;
  }

  /** ★ E4a：消费 steer（编队槽位求导 + 局部避障 + 位移）；超时未刷新 → 回落 local */
  private applySteerMovement(dt: number): void {
    if (this.controlSource !== 'swarm') return;
    if (!this.hasFreshSteer) {
      this.controlSource = 'local';
      return;
    }
    const s = this.steerState;
    // ★ 收敛（用户定 2026-09-26）：方向只认 steer 的 dirX/dirZ（= 格边步/路线修正产物）；
    //   moveTarget 只用于**到达停步**，不再直线朝槽位（那是绕过路线的独立移动实现 → 撞崖/原地摆）。
    const dx = s.dirX, dz = s.dirZ;
    if (this.moveTarget && s.source === 'formation') {
      const d = Math.hypot(this.moveTarget.x - this.entity.position.x, this.moveTarget.z - this.entity.position.z);
      if (d < 0.55) {
        this.controller.moveDir.x = 0;
        this.controller.moveDir.y = 0;
        return;
      }
    }
    if (dx === 0 && dz === 0) {
      this.controller.moveDir.x = 0;
      this.controller.moveDir.y = 0;
      return;
    }
    // ★ 队长指令限速（ROE/压迫档）仍生效；本地 AI 的方向选择被让位
    let mul = this.directiveKind !== 'none' ? this.directiveSpeedMul : 1;
    if (this.climbOrdered && mul < 1) mul = 1;   // 凭证在身：不被零限速压死
    const base = s.speed > 0 ? s.speed : this.moveSpeed;
    this.applyingSteer = true;
    this.moveBy(dx, dz, dt, base * mul);
    this.applyingSteer = false;
  }

  /** ★ 被击（步骤 10 自主 LOD）：单位级免降格窗口 + 广播（小队/大队警觉由 WorldMode 转交 swarm） */
  override onTakeDamage(dmg: number, source: EntityBase | null, hitPoint?: EntityHitPoint): void {
    this.noDemoteUntil = simNow() + UNIT_HIT_HOLD_S;   // ★ 模拟时钟（倍速同步）
    eventBus.emit('enemy_hit', { squadId: this.squadId });
    super.onTakeDamage(dmg, source, hitPoint);
  }

  /** Phase 4 升格：快照灌入（只覆盖快照携带的字段，其余保持构造默认） */
  hydrate(snap: SwarmSnapshot): void {
    if (snap.uid !== undefined) this.swarmUid = snap.uid;
    if (snap.battalionId !== undefined) this.battalionId = snap.battalionId;
    if (snap.squadId !== undefined) this.squadId = snap.squadId;
    if (snap.formSlot !== undefined) this.formSlot = snap.formSlot;
    if (snap.corridorIdx !== undefined) this.corridorIdx = snap.corridorIdx;
    if (snap.role !== undefined) this.role = snap.role;
    if (snap.attackType !== undefined) this.attackType = snap.attackType;
    if (snap.moveSpeed !== undefined && snap.moveSpeed > 0) this.moveSpeed = snap.moveSpeed;
    if (snap.isLeader !== undefined) this.isLeader = snap.isLeader;
    if (snap.lastSeenX !== undefined) this.lastSeenX = snap.lastSeenX;
    if (snap.lastSeenZ !== undefined) this.lastSeenZ = snap.lastSeenZ;
    if (snap.lastSeenAt !== undefined) this.lastSeenAt = snap.lastSeenAt;
    if (snap.aggroFrom !== undefined) this.aggroFrom = snap.aggroFrom;
    if (snap.aiStateIdx !== undefined) this.aiStateMachine?.importState(snap.aiStateIdx, snap.aiTimer ?? 0);
    if (snap.suicide !== undefined) this.suicide = snap.suicide;
    if (snap.canBuild !== undefined) this.canBuild = snap.canBuild;
    if (snap.noDemoteUntil !== undefined) this.noDemoteUntil = snap.noDemoteUntil;
    // ★ 步骤 9b：命令/指令回灌（编码 → 可读类型）
    if (snap.orderKind !== undefined) this.orderKind = orderFromCode(snap.orderKind);
    if (snap.orderTargetX !== undefined) this.orderTargetX = snap.orderTargetX;
    if (snap.orderTargetZ !== undefined) this.orderTargetZ = snap.orderTargetZ;
    if (snap.orderUntil !== undefined) this.orderUntil = snap.orderUntil;
    if (snap.orderSeq !== undefined) this.orderSeq = snap.orderSeq;
    if (snap.directiveKind !== undefined) this.directiveKind = directiveFromCode(snap.directiveKind);
    if (snap.directiveTargetX !== undefined) this.directiveTargetX = snap.directiveTargetX;
    if (snap.directiveTargetZ !== undefined) this.directiveTargetZ = snap.directiveTargetZ;
    if (snap.directiveWard !== undefined) this.directiveWard = snap.directiveWard;
    if (snap.directiveUntil !== undefined) this.directiveUntil = snap.directiveUntil;
    if (snap.directiveFire !== undefined) this.directiveFire = snap.directiveFire;
    if (snap.directiveSpeedMul !== undefined) this.directiveSpeedMul = snap.directiveSpeedMul;
    if (snap.directiveSeq !== undefined) this.directiveSeq = snap.directiveSeq;
    if (snap.moveTargetX !== undefined && snap.moveTargetZ !== undefined) {
      this.moveTarget = { x: snap.moveTargetX, y: snap.moveTargetY ?? 0, z: snap.moveTargetZ };
    }
  }

  /** Phase 4 降格：抽干实体侧字段（def 派生项由 WorldSpawner 桥接层补齐） */
  drain(): SwarmSnapshot {
    const out: SwarmSnapshot = {
      uid: this.swarmUid,
      battalionId: this.battalionId,
      squadId: this.squadId,
      formSlot: this.formSlot,
      corridorIdx: this.corridorIdx,
      role: this.role,
      moveSpeed: this.moveSpeed,
      attackType: this.attackType,
      isLeader: this.isLeader,
      lastSeenX: this.lastSeenX,
      lastSeenZ: this.lastSeenZ,
      lastSeenAt: this.lastSeenAt,
      aggroFrom: this.aggroFrom,
    };
    const st = this.aiStateMachine?.exportState();
    if (st) {
      out.aiStateIdx = st.idx;
      out.aiTimer = st.timer;
    }
    out.suicide = this.suicide;
    out.canBuild = this.canBuild;
    out.noDemoteUntil = this.noDemoteUntil;
    // ★ 步骤 9b：命令/指令抽干（可读类型 → 编码）
    out.orderKind = orderCode(this.orderKind);
    out.orderTargetX = this.orderTargetX;
    out.orderTargetZ = this.orderTargetZ;
    out.orderUntil = this.orderUntil;
    out.orderSeq = this.orderSeq;
    out.directiveKind = directiveCode(this.directiveKind);
    out.directiveTargetX = this.directiveTargetX;
    out.directiveTargetZ = this.directiveTargetZ;
    out.directiveWard = this.directiveWard;
    out.directiveUntil = this.directiveUntil;
    out.directiveFire = this.directiveFire;
    out.directiveSpeedMul = this.directiveSpeedMul;
    out.directiveSeq = this.directiveSeq;
    if (this.moveTarget) {
      out.moveTargetX = this.moveTarget.x;
      out.moveTargetY = this.moveTarget.y;
      out.moveTargetZ = this.moveTarget.z;
    }
    return out;
  }

  /** ★ 步骤 9b：接收命令/指令（低频推送，与 applySteer 同范式；seq 防旧包回放） */
  applyOrder(
    order: { kind: SquadOrderKind | 'none'; targetX: number; targetZ: number; until: number; seq: number },
    directive: {
      kind: DirectiveKind | 'none'; targetX: number; targetZ: number; wardUid: number;
      until: number; fire: number; speedMul: number; seq: number;
    },
  ): void {
    if (order.seq >= this.orderSeq) {
      this.orderKind = order.kind;
      this.orderTargetX = order.targetX;
      this.orderTargetZ = order.targetZ;
      this.orderUntil = order.until;
      this.orderSeq = order.seq;
    }
    if (directive.seq >= this.directiveSeq) {
      this.directiveKind = directive.kind;
      this.directiveTargetX = directive.targetX;
      this.directiveTargetZ = directive.targetZ;
      this.directiveWard = directive.wardUid;
      this.directiveUntil = directive.until;
      this.directiveFire = directive.fire;
      this.directiveSpeedMul = directive.speedMul;
      this.directiveSeq = directive.seq;
    }
  }

  // ---- AI 状态（behaviors/conditions 访问） ----
  aiStateMachine: AIStateMachine | null = null;
  aiTurnTimer = 0;
  aiAttackTimer = 0;
  /** ★ 本次挥击是否已播完（attackFinished 条件用） */
  aiSwingDone = false;
  aiMoveDir = { x: 1, z: 0 };
  /** ★ 远距影子强 LOD（2026-09-12 用户定调）：lod1 起 80% 敌人无影子、lod2 起全无
   *  （剪影解析前裁剪 → 逐顶点贴地采样/仿射全免） */
  private static readonly SHADOW_FAR_CULL = 0.8;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: CharacterFxAssetSource,
    opts: EnemyOptions,
    private camera?: THREE.Camera,
  ) {
    // ★ 体型：贴片 × scale；碰撞体积在 scale 基础上再 × collisionScale（默认 1）
    const scale = opts.scale ?? 1;
    const colScale = (opts.scale ?? 1) * (opts.collisionScale ?? 1);
    const baseVol = DEFAULT_COLLISION_VOLUME;
    const shape = baseVol.shape.type === 'cuboid'
      ? { type: 'cuboid' as const, hx: baseVol.shape.hx * colScale, hy: baseVol.shape.hy * colScale, hz: baseVol.shape.hz * colScale }
      : baseVol.shape;
    const offsetY = baseVol.offsetY * colScale;
    super(em, {
      ...opts,
      kind: 'enemy',
      asset,
      // 物理碰撞体（子弹命中/推挤）形状与碰撞体积声明同步放大
      physics: opts.physics ?? { type: 'kinematic', options: { shape } },
    });
    // ★ 推挤/偏移逻辑读取的碰撞体积 = 实际物理形状（super 后字段可写）
    this.collisionVolume = { shape, offsetY };
    this.camp = 'enemy';
    // ★ 2026-09-14 用户定调：敌人只能从插值坡上高台（禁止贴墙瞬移攀爬）
    this.blockCliffClimb = true;
    // ★ 爬掩体开启，但有'沿路才爬'门控（CharacterBase：期望方向朝掩体才触发）
    // ★ 空中层（2026-09-18）：飞行单位 —— 悬停 + 不贴地 + 无视地形落差/危险地形。
    //   climbAnyTerrain 关掉 CharacterBase 的立面阻挡（飞在空中不该被墙挡住）；
    //   y 由 WorldMode.clampCharacter 的飞行分支统一驱动。
    if (opts.airborne) {
      this.airborne = true;
      this.airAltitude = opts.airAltitude ?? this.airAltitude;
      this.climbAnyTerrain = true;
      // 出生即抬到悬停高度（否则第一帧从地面"弹"上去）
      this.entity.position.y = (RasterMap.current?.surfaceHeightAt(this.entity.position.x, this.entity.position.z) ?? 0) + this.airAltitude;
    }
    this.hp = opts.hp ?? 30; // ★ 敌人生命（普瑞赛斯 30；子弹 10 伤害 × 3 发）
    this.maxHp = this.hp;
    this.defense = opts.defense ?? 0;       // ★ 防御（高防 = 子弹/近战都更难打动）
    this.attackPower = opts.attackPower ?? 0; // ★ 攻击力加成（叠加在 AI 近战伤害上）
    this.assetRef = asset;
    this.suicide = opts.suicide === true;
    this.canBuild = opts.canBuild === true;
    // ★ 蜂群预留字段：从名册透传（缺省 = 行为不变）
    this.role = opts.role ?? 'grunt';
    this.attackType = opts.attackType ?? 'melee';
    // ★ E4a：编队速度 = 构造 moveSpeed（缺省 2.5，与本地 AI 同口径）
    this.moveSpeed = this.controller.moveSpeed;
    this.attachToScene(scene);
    // ★ 远距影子强 LOD：80% 远敌无影子（lod≥2 全无）
    this.shadowFarCull = EnemyBase.SHADOW_FAR_CULL;

    // bbox 映射（base/residual 纹理已按 bbox 裁剪 → 尺寸 = bbox.w×bbox.h，
    // 但 bbox 偏移量已裁掉，shader 映射必须用原点 0，否则内容被二次平移裁剪）
    const ftxFrame = asset.getFtxFrame(0);
    if (ftxFrame && this.renderer) {
      const b = ftxFrame.bbox;
      (this.renderer as FTXQuad).setFrameMapping(
        { width: b.w, height: b.h },
        { x: 0, y: 0, w: b.w, h: b.h },
      );
    }
    // ★ 背面素材检测（2026-09-18）：没有「后」帧的敌人 → 始终面对相机（billboard），
    //   不做相机侧换帧/转身 180°（否则会露出背面空白/镜像贴图）。
    //   有「后」帧 = 维持原双向贴片逻辑；可用 opts.billboard 强制覆盖。
    // ★ 2026-09-19 强化：声明了「后」但为空帧（bbox 为 0）的资产同样按无背面处理（billboard）
    const backIdx = asset.resolveFrame('后');
    const backFrame = backIdx !== null ? asset.getFtxFrame(backIdx) : null;
    const hasBackFrame = !!backFrame && backFrame.bbox.w > 0 && backFrame.bbox.h > 0;
    this.billboard = opts.billboard ?? !hasBackFrame;
    // 初始朝向（贴片朝 +z；显示帧由相机判定；无背面素材恒为「前」）
    this.presentation.setFrameAnimated(this.anim!, this.billboard ? '前' : ((opts.facing ?? '前') as '前' | '后'));
    // 纹理宽高比缩放（不压扁；宽 = scale，高 = scale×bbox高宽比）
    this.applyRenderScale(scale);
    // ★ 接地补偿：必须在 applyRenderScale 之后（半高由缩放决定）
    //   2026-09-19：未配置 groundSink 时按前帧底部透明余量自动计算（治“穿着浮空”）
    const sinkAspect = ftxFrame ? ftxFrame.bbox.h / ftxFrame.bbox.w : 1;
    let sink = opts.groundSink ?? 0;
    if (!(sink > 0)) {
      const frontIdx = asset.resolveFrame('前') ?? 0;
      const pair = asset.getFramePair(frontIdx);
      const img = pair?.base?.image as unknown as
        | { data?: Float32Array | Uint8Array; width: number; height: number }
        | undefined;
      if (img?.data) sink = autoGroundSinkFromFrame(img, scale * sinkAspect);
    }
    const quad = this.renderer as unknown as { setGroundSink?: (s: number) => void };
    if (sink > 0 && quad?.setGroundSink) quad.setGroundSink(sink);
    // ★ 头顶血条：按放大后的实际贴片高度定位（顶端 + 0.4 余量），宽度随体型
    //   ★ 减去 groundSink：接地补偿把贴片整体压低了，血条要跟着走（否则血条悬空）
    const aspect = ftxFrame ? ftxFrame.bbox.h / ftxFrame.bbox.w : 1;
    this.attachEffect('health', new HealthBar(scene, this, {
      width: 0.8 * scale,
      offsetY: scale * aspect + 0.4 - sink,
    }));

    // ---- AI：配置驱动状态机 + 注册到系统 ----
    if (opts.aiConfig) {
      this.aiStateMachine = new AIStateMachine(opts.aiConfig);
      aiSystem.register(this);
      this.brain.parse(this, opts.aiConfig);
    }
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }


  /** ★ AI 激活半径（与玩家超过此距离 → AI 休眠：不索敌/不追击/不游走，省算力） */
  aiActiveRadius = 75;

  /** ★ AI 驱动入口（AISystem 每帧调用） */
  updateAI(dt: number, ctx: BehaviorContext): void {
    // ★ 本帧默认不移动；行为调 moveBy 才设方向（否则攻击等无移动行为会残留速度漂移）
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
    // ★ 眩晕中：禁止移动/攻击/状态机推进（祖宗激光命中效果）
    if (this.isStunned) return;
    // ★ 距离分级：超出 AI 激活半径 → 休眠（chunk 波次可能在 100m+ 外生成，
    //   全图 AI 全速跑没意义——进入半径自动唤醒，状态机保留）
    //   ★ E4a：编队控制中不休眠（移动/Brain 由 swarm 负责；本地只跑战斗决策）
    if (!this.swarmControlled && ctx.focusX !== undefined && ctx.focusZ !== undefined) {
      const dx = this.entity.position.x - ctx.focusX;
      const dz = this.entity.position.z - ctx.focusZ;
      const r = this.aiActiveRadius;
      if (dx * dx + dz * dz > r * r) return;
    }
    this.aiStateMachine?.update(this, ctx);
    // ★ E5：执行层（原子覆盖）+ 保底攻击（EnemyBrain；纯搬运）
    this.brain.tick(this, dt, ctx);
    // ★ E4a：swarm steer 消费（编队移动；本地 AI 的 moveBy 已被让位）
    this.applySteerMovement(dt);
    // ★ 感知上报（逻辑单位）：有目标 → 持续刷新最后目击（小队评级/选举/威胁数用）
    const t = ctx.target;
    if (t) {
      this.lastSeenX = t.x;
      this.lastSeenZ = t.z;
      this.lastSeenAt = performance.now() / 1000;
    }
  }

  /** ★ E5：施加眩晕（祖宗激光命中）——转发 EnemyBrain */
  applyStun(): boolean {
    return this.brain.applyStun(this);
  }

  /** ★ 移动（统一走 CharacterController 基类函数，与玩家一致）：
   *   moveToward 设期望方向 → CharacterBase 速度驱动 → rapier 结算位置
   *   ★ 角色朝向 = 移动方向：贴片绕 Y 旋转到移动方向角（任意角度）
   *   ★ 防掉坑：移动前探测前方地形，坑洞/悬崖/水面前提前停下转向 */
  moveBy(dx: number, dz: number, dt: number, speed: number): void {
    // ★ 收敛（用户定 2026-09-25）：**移动只走统一链**——只有 steer 消费（applyingSteer）允许位移；
    //   本地 AI / EnemyBrain / AI behaviors 一律不得自行移动（选路/移动统一由引擎→队长→格边/短长寻路）。
    if (!this.applyingSteer) return;
    // ★ E5：危险地形绕行由 EnemyLocomotion 解析（纯搬运）
    const r = this.locomotion.resolve(
      this.entity.position.x, this.entity.position.y, this.entity.position.z,
      this.airborne, dx, dz, dt,
    );
    if (!r.move) {
      this.controller.moveDir.x = 0;
      this.controller.moveDir.y = 0;
      return;
    }
    this.controller.moveToward(r.x, r.z, dt, speed);   // ★ 水=正常地块（无限速）
    // 贴片朝向 = 移动方向（绕 Y 旋转：+z 指向移动方向）
    if (Math.abs(r.x) > 0.001 || Math.abs(r.z) > 0.001) {
      this.presentation.yawBase = Math.atan2(r.x, r.z);
    }
  }

  /** ★ 渲染距离应用（基类联动动画/渲染管线；基类 viewLod 供子类降级表现） */
  override applyViewDistance(distance: number): void {
    super.applyViewDistance(distance);
    // 立即按等级应用扭曲开关（不等下一帧 onUpdate）
    this.presentation.applyDistort({
      anim: this.anim!, asset: this.assetRef, renderer: this.renderer, viewLod: this.viewLod,
    });
  }

  protected override onUpdate(dt: number): void {
    // ★ 基类位置推进（moveDir × speed → 位置；无输入时 controller.update 不跑）
    super.onUpdate(dt);
    // ★ 显示帧 + 转身由相机判定（旁观者视角）：
    //   相机在角色正面侧 → 前帧 + 贴片保持移动方向朝向
    //   相机在背面侧 → 后帧 + 贴片转身 180°（面向相机绘制背面）
    // ★ 视锥外不做这些纯表现计算（动画/朝向/扭曲），回到视野下一帧自动恢复
    if (!this.inFrustum) return;
    // ★ E5：显示帧 + 转身 + 扭曲由 EnemyPresentation 处理（纯搬运）
    this.presentation.update({
      anim: this.anim!, asset: this.assetRef, renderer: this.renderer, viewLod: this.viewLod,
      billboard: this.billboard, camera: this.camera,
      x: this.entity.position.x, z: this.entity.position.z,
    });
  }

  /** ★ 退役业务钩子：真击杀在此上报当天击杀统计（retire('killed') 由 onDeath 触发）；
   *  降格/回收/清场走其他 reason → 天然不计击杀（取代 killedByCombat/deathReported）；
   *  ★ 2026-09-20 账本口径：killed → 击杀+1/存活−1；非击杀离场 → 存活−1（demoted 除外）。 */
  protected override onRetire(reason: RetireReason): void {
    if (reason === 'killed') {
      eventBus.emit('enemy_killed', {
        uid: this.swarmUid,
        source: this.deathSource,
        x: this.entity.position.x,
        z: this.entity.position.z,
      });
    } else if (reason !== 'demoted') {
      // recycled / despawned / mode_cleanup：蜂群账本存活 −1（不算击杀）
      eventBus.emit('enemy_removed', { uid: this.swarmUid, reason });
    }
    super.onRetire(reason);
  }

  /** 销毁：从 AI 系统注销（幂等；任何 dispose 路径都必须注销） */
  override dispose(): void {
    aiSystem.unregister(this);
    super.dispose();
  }

  /** ★ 致死来源（onDeath 记下，供统计区分玩家/友军/环境） */
  private deathSource: EntityBase | null = null;

  /** ★ 致死钩子：记下来源供统计，再走统一退役（默认 killed） */
  override onDeath(source: EntityBase | null): void {
    this.deathSource = source;
    super.onDeath(source);
  }
}
