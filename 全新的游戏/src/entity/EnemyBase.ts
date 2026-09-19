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
import type { EntityBase, RetireReason } from './EntityBase';
import type {
  SwarmCarrier, SteerIntent, SwarmSnapshot, UnitRole, UnitAttackType,
  SquadOrderKind, DirectiveKind, TacticalOrder, UnitDirective,
} from './SwarmUnit';
import {
  orderCode, orderFromCode, directiveCode, directiveFromCode, fireCode, FIRE_FREE, roleBucket,
} from './SwarmUnit';
import {
  MOVE_ATOMS, resolveWeights, atomDirection, rollMove, rollFire,
} from './AtomExecutor';
import { autoGroundSinkFromFrame } from '../services/fx/groundSink';
import type { CharacterFxAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { AIStateMachine } from '../systems/ai/AIStateMachine';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { aiSystem } from '../systems/ai/AISystem';
import type { AIConfig } from '../systems/ai/aiconfig';
import { HealthBar } from '../services/fx/HealthBar';
import { RasterMap } from '../services/map/RasterMap';
import { eventBus } from '../core/EventBus';

export interface EnemyOptions extends Omit<CharacterBaseOptions, 'kind' | 'asset'> {
  /** 攻击行为标记（预留） */
  aggressive?: boolean;
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
}

const _atomDir = { x: 0, z: 0 };

export class EnemyBase extends CharacterBase implements SwarmCarrier {
  private assetRef: CharacterFxAssetSource;
  readonly aggressive: boolean;

  // ============================================================
  // ★ 蜂群预留字段（《实体架构.md》§5.3；v2 由 SwarmTierPort 填值）
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

  // ============================================================
  // ★ 执行层（瞬时，不入快照）：指令 → 原子（移动/开火）；承诺窗口
  // ============================================================
  /** 当前移动原子下标（255 = 无覆盖） */
  atomMove = 255;
  /** 本段开火门控（true = 本段不开火；meleeSwing/rangedShot 消费） */
  fireHold = false;
  private atomSeq = -1;
  private atomUntil = 0;
  private atomMoveIdx = 4;
  private atomFire = true;

  // ============================================================
  // ★ 保底攻击（2026-09-19 用户定调）：无指令且状态机未接管时，
  //   目标在射程内 → 直接开火（构造时从 AI 配置解析一次）——防“贴脸不打”。
  // ============================================================
  private fbKind: 'none' | 'melee' | 'ranged' | 'suicide' = 'none';
  private fbRadius = 3;
  private fbRange = 1.8;
  private fbDamage = 8;
  private fbSpeed = 26;
  private fbLifetime = 2.4;
  private fbAim = 0;
  private fbMuzzle = 0;
  private fbSpread = 0.05;
  private fbSkin = 'arrow';
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
  /** 攻击类型：none/melee/ranged/bombard */
  attackType: UnitAttackType = 'melee';
  /** ★ 控制权（唯一切换点；只允许在 Phase 4 改） */
  controlSource: 'swarm' | 'local' = 'local';
  /** 飞天/悬停高度 = CharacterBase 的 airborne/airAltitude（单一事实源） */
  get isAir(): boolean { return this.airborne; }
  get altitude(): number { return this.airAltitude; }

  /** ★ steer 保持窗口（秒）：超时自动回落 local（不允许停摆，v2 铁律 3） */
  static readonly STEER_TTL = 0.5;
  /** 最近一次 steer（hold；E4 消费，当前仅记录不参与移动决策） */
  private readonly steerState: SteerIntent = { dirX: 0, dirZ: 0, speed: 0, source: 'none' };
  private steerFreshUntil = 0;

  /** Phase 1→2：swarm 下发移动意图（hold 语义；null = 清除） */
  applySteer(intent: SteerIntent | null): void {
    if (!intent) {
      this.steerState.source = 'none';
      return;
    }
    Object.assign(this.steerState, intent);
    this.steerFreshUntil = performance.now() / 1000 + EnemyBase.STEER_TTL;
  }

  /** 是否有新鲜 steer（E4 起 Brain→移动消费；当前仅供调试/断言） */
  get hasFreshSteer(): boolean {
    return this.steerState.source !== 'none' && performance.now() / 1000 <= this.steerFreshUntil;
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
    if (snap.isLeader !== undefined) this.isLeader = snap.isLeader;
    if (snap.lastSeenX !== undefined) this.lastSeenX = snap.lastSeenX;
    if (snap.lastSeenZ !== undefined) this.lastSeenZ = snap.lastSeenZ;
    if (snap.lastSeenAt !== undefined) this.lastSeenAt = snap.lastSeenAt;
    if (snap.aggroFrom !== undefined) this.aggroFrom = snap.aggroFrom;
    if (snap.aiStateIdx !== undefined) this.aiStateMachine?.importState(snap.aiStateIdx, snap.aiTimer ?? 0);
    if (snap.suicide !== undefined) this.suicide = snap.suicide;
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
  /** ★ 眩晕截止 / 免疫截止时刻（秒；祖宗激光效果，2026-09-14 用户定调） */
  private stunUntil = 0;
  private stunImmuneUntil = 0;
  /** 眩晕时长（秒）/ 眩晕结束后的免疫时长（秒）——防连续锁死 */
  private static readonly STUN_SECONDS = 1.0;
  private static readonly STUN_IMMUNE_AFTER = 2.0;
  aiMoveDir = { x: 1, z: 0 };
  /** ★ 危险地形转向节流计时（前方坑洞/悬崖 → 禁止直行，转向避让） */
  private hazardTurnTimer = 0;
  /** ★ 上次采纳的安全绕行航向（贴边连续走，不来回抖动；null=无） */
  private hazardSafeDir: { x: number; z: number } | null = null;
  /** ★ 前方探测距离（米；> 碰撞半宽，提前一个身位避开坑沿） */
  private static readonly HAZARD_PROBE = 2.0;
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
    this.assetRef = asset;    this.aggressive = opts.aggressive ?? false;
    this.suicide = opts.suicide === true;
    // ★ 蜂群预留字段：从名册透传（缺省 = 行为不变）
    this.role = opts.role ?? 'grunt';
    this.attackType = opts.attackType ?? 'melee';
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
    this.setFrameAnimated(this.billboard ? '前' : ((opts.facing ?? '前') as '前' | '后'));
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
      this.parseFallbackAttack(opts.aiConfig);
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
    if (ctx.focusX !== undefined && ctx.focusZ !== undefined) {
      const dx = this.entity.position.x - ctx.focusX;
      const dz = this.entity.position.z - ctx.focusZ;
      const r = this.aiActiveRadius;
      if (dx * dx + dz * dz > r * r) return;
    }
    this.aiStateMachine?.update(this, ctx);
    // ★ 执行层（§5.13）：指令活跃 → 原子掷覆盖移动 + 开火门控
    this.applyDirectiveAtoms(dt, ctx);
    // ★ 保底攻击：无指令且状态机未进攻时，目标在射程内直接开火
    this.fallbackAttack(dt, ctx);
  }

  /** ★ 解析保底攻击参数（构造期一次；从 AI 配置的 inRange 转移 + 攻击行为取值） */
  private parseFallbackAttack(cfg: AIConfig): void {
    // ★ 标签兜底：自爆单位即使 AI 没配 selfDestruct 也保底自爆
    if (this.suicide) this.fbKind = 'suicide';
    for (const st of Object.values(cfg.states)) {
      for (const tr of st.transitions) {
        if (tr.cond === 'inRange' && tr.params?.radius !== undefined) {
          this.fbRange = Number(tr.params.radius);
        }
      }
    }
    for (const st of Object.values(cfg.states)) {
      for (const b of st.behaviors) {
        const p = b.params ?? {};
        if (b.name === 'meleeSwing') {
          this.fbKind = 'melee';
          this.fbDamage = Number(p.damage ?? 8);
          if (p.range !== undefined) this.fbRange = Math.max(this.fbRange, Number(p.range));
          return;
        }
        if (b.name === 'selfDestruct') {
          this.fbKind = 'suicide';
          this.fbDamage = Number(p.damage ?? 26);
          this.fbRadius = Number(p.radius ?? 3);
          return;
        }
        if (b.name === 'rangedShot') {
          this.fbKind = 'ranged';
          this.fbDamage = Number(p.damage ?? 8);
          this.fbSpeed = Number(p.speed ?? 26);
          this.fbLifetime = Number(p.lifetime ?? 2.4);
          this.fbAim = Number(p.aimHeight ?? 0);
          this.fbMuzzle = Number(p.muzzleHeight ?? 0);
          this.fbSpread = Number(p.spread ?? 0.05);
          this.fbSkin = String(p.skin ?? 'arrow');
          return;
        }
      }
    }
  }

  /** ★ 保底攻击：无指令 + 状态机未处于 attack → 目标在射程内直接开火（冷却节流） */
  private fallbackAttack(dt: number, ctx: BehaviorContext): void {
    if (this.fbKind === 'none') return;
    this.fbCd -= dt;
    if (this.fbCd > 0) return;
    if (this.directiveKind !== 'none') return;                 // 命令优先
    if (this.aiStateMachine?.currentState === 'attack') return; // 状态机在打 → 让位（防双开火）
    // 目标：优先自选候选（状态机未评估 seePlayer 时 ctx.target 可能为空）
    let t: { x: number; z: number } | null = null;
    const cands = ctx.targetCandidates?.(this);
    if (cands && cands.length > 0) {
      for (const c of cands) {
        const d2 = (c.x - this.position.x) ** 2 + (c.z - this.position.z) ** 2;
        if (d2 <= this.fbRange * this.fbRange) { t = c; break; }
      }
    }
    if (!t) t = ctx.target;
    if (!t) return;
    const d = Math.hypot(t.x - this.position.x, t.z - this.position.z);
    if (d > this.fbRange) return;
    this.fbCd = 0.9 + Math.random() * 0.4;
    if (this.fbKind === 'suicide') {
      // ★ 自爆保底：范围爆炸 + 自身死亡（与 selfDestruct 行为同口径）
      ctx.attack({
        type: 'aoe',
        source: this,
        x: this.position.x,
        y: this.position.y + 0.8,
        z: this.position.z,
        radius: this.fbRadius,
        damage: this.fbDamage,
        camp: 'enemy',
      });
      this.onDeath(null);
      return;
    }
    if (this.fbKind === 'melee') {
      ctx.attack({
        type: 'melee',
        source: this,
        x: this.position.x,
        y: this.position.y + 1.0,
        z: this.position.z,
        range: this.fbRange,
        damage: this.fbDamage,
        camp: 'enemy',
      });
      return;
    }
    // 远程：真弹道（与 rangedShot 同构：出膛点/矄准点/散布/出膛前移）
    const ox = this.position.x;
    const oy = this.hitAnchorY() + this.fbMuzzle;
    const oz = this.position.z;
    const ty = (ctx.focusY ?? this.hitAnchorY()) + this.fbAim;
    let dx = t.x - ox, dy = ty - oy, dz = t.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (this.fbSpread > 0) {
      const a = (Math.random() - 0.5) * 2 * this.fbSpread;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = dx * ca - dz * sa;
      const nz = dx * sa + dz * ca;
      dx = nx; dz = nz;
      dy += (Math.random() - 0.5) * this.fbSpread;
      const l2 = Math.hypot(dx, dy, dz) || 1;
      dx /= l2; dy /= l2; dz /= l2;
    }
    const muzzle = 0.7;
    ctx.attack({
      type: 'projectile',
      source: this,
      x: ox + dx * muzzle, y: oy + dy * muzzle, z: oz + dz * muzzle,
      dirX: dx, dirY: dy, dirZ: dz,
      speed: this.fbSpeed, camp: 'enemy', lifetime: this.fbLifetime,
      damage: this.fbDamage, bulletSkin: this.fbSkin,
    });
  }

  /** ★ 执行层（§5.13）：指令活跃 → 原子掷覆盖移动 + 开火门控（危险地形绕行仍生效） */
  private applyDirectiveAtoms(dt: number, ctx: BehaviorContext): void {
    const now = performance.now() / 1000;
    const dk = this.directiveKind;
    // 无指令 / 指令过期 → 回落本地自主（旧行为）
    if (dk === 'none' || !(this.directiveUntil === 0 || now < this.directiveUntil)) {
      this.atomMove = 255;         // 无指令 → 本地自主（旧行为）
      this.fireHold = false;
      this.directiveSpeedMul = 1;
      return;
    }
    const t = ctx.target;
    const dist = t ? Math.hypot(t.x - this.position.x, t.z - this.position.z) : 0;
    const range = this.attackType === 'ranged' ? 12 : 2.2;   // 近似（精确射程在 aiConfig；后续配置化）
    const w = resolveWeights(dk, this.orderKind, roleBucket(this.role), {
      inRange: !!t && dist <= range,
      lowHp: this.hp < this.maxHp * 0.3,
      justHit: false,            // 后续接入受击时间戳
      hasTarget: !!t,
    });
    // 承诺窗口：指令变更 / 到段边界 → 重掷
    if (this.directiveSeq !== this.atomSeq || now >= this.atomUntil) {
      this.atomSeq = this.directiveSeq;
      this.atomMoveIdx = rollMove(w.move);
      this.atomFire = rollFire(w.fire);
      this.atomUntil = now + 0.35 * (0.7 + Math.random() * 0.6);
    }
    this.atomMove = this.atomMoveIdx;
    this.fireHold = !this.atomFire;
    // 方向：指令目标点 > 当前目标 > 不移动
    let tx = 0, tz = 0;
    const dtx = this.directiveTargetX - this.position.x;
    const dtz = this.directiveTargetZ - this.position.z;
    const td = Math.hypot(dtx, dtz);
    if (td > 0.5) { tx = dtx / td; tz = dtz / td; }
    else if (t && dist > 1e-3) { tx = (t.x - this.position.x) / dist; tz = (t.z - this.position.z) / dist; }
    if (tx !== 0 || tz !== 0) {
      atomDirection(MOVE_ATOMS[this.atomMoveIdx], tx, tz, _atomDir);
      if (_atomDir.x !== 0 || _atomDir.z !== 0) {
        // 近似基础速度（2.5 m/s；精确移速后续配置化）× 指令限速
        this.moveBy(_atomDir.x, _atomDir.z, dt, 2.5 * this.directiveSpeedMul);
      }
    }
  }

  /** ★ 当前是否眩晕中（祖宗激光；眩晕期间 AI 完全停摆） */
  get isStunned(): boolean {
    return performance.now() / 1000 < this.stunUntil;
  }

  /** ★ 施加眩晕（祖宗激光命中）：免疫期内/已死亡 → 不生效。
   *  眩晕同时打断当前挥击（可读性：被打断即中止）。返回是否实际眩晕。 */
  applyStun(): boolean {
    const now = performance.now() / 1000;
    if (this.hp <= 0 || now < this.stunImmuneUntil) return false;
    this.stunUntil = now + EnemyBase.STUN_SECONDS;
    this.stunImmuneUntil = now + EnemyBase.STUN_SECONDS + EnemyBase.STUN_IMMUNE_AFTER;
    this.aiAttackTimer = 0; // 打断当前挥击
    this.aiSwingDone = true;
    return true;
  }

  /** ★ 移动（统一走 CharacterController 基类函数，与玩家一致）：
   *   moveToward 设期望方向 → CharacterBase 速度驱动 → rapier 结算位置
   *   ★ 角色朝向 = 移动方向：贴片绕 Y 旋转到移动方向角（任意角度）
   *   ★ 防掉坑：移动前探测前方地形，坑洞/悬崖/水面前提前停下转向 */
  moveBy(dx: number, dz: number, dt: number, speed: number): void {
    // ★ 危险地形回避：若目标方向前方 HAZARD_PROBE 米内有坑/悬崖，
    //   不朝该方向直行，改沿安全方向绕行
    if (this.isDangerAhead(dx, dz)) {
      // ★ 若上次安全航向仍安全（且与目标方向不相反）→ 延续，贴边连续走
      if (this.hazardSafeDir) {
        const k = this.hazardSafeDir;
        if (k.x * dx + k.z * dz > -0.1 && !this.isDangerAhead(k.x, k.z)) {
          this.controller.moveToward(k.x, k.z, dt, speed);
          this.yawBase = Math.atan2(k.x, k.z);
          return;
        }
        this.hazardSafeDir = null;
      }
      // ★ 节流：只隔一段时间重新扫向（避免原地高频抖动/每帧重算）
      this.hazardTurnTimer -= dt;
      if (this.hazardTurnTimer > 0) {
        this.controller.moveDir.x = 0;
        this.controller.moveDir.y = 0;
        return;
      }
      this.hazardTurnTimer = 0.45;
      // ★ 扫描候选航向：从小到大偏转 ±22.5°、±45°… 直到找到安全方向
      const base = Math.atan2(dz, dx);
      let found: { x: number; z: number } | null = null;
      for (let k = 1; k <= 8; k++) {
        const dev = (Math.PI / 8) * k;
        for (const s of [1, -1] as const) {
          const a = base + dev * s;
          const cdx = Math.cos(a), cdz = Math.sin(a);
          if (!this.isDangerAhead(cdx, cdz)) { found = { x: cdx, z: cdz }; break; }
        }
        if (found) break;
      }
      if (found) {
        this.hazardSafeDir = found;
        dx = found.x;
        dz = found.z;
      } else {
        // 全部方向都危险（深坑孤岛）：本帧不动，等下一轮节流再试
        this.controller.moveDir.x = 0;
        this.controller.moveDir.y = 0;
        return;
      }
    } else {
      this.hazardTurnTimer = 0;
      this.hazardSafeDir = null;
    }
    this.controller.moveToward(dx, dz, dt, speed);
    // 贴片朝向 = 移动方向（绕 Y 旋转：+z 指向移动方向）
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      this.yawBase = Math.atan2(dx, dz);
    }
  }

  /** ★ 前方是否有危险地形（只挡"坑/深水/高台立面"）：
   *   从脚下向 (dx,dz) 方向探测 HAZARD_PROBE 米，
   *   落点是坑洞地块（lethal）或表面过低（深坑底）→ 危险；
   *   ★ 深水（水深 > 0.8m）→ 危险（敌人不过水）；
   *   ★ 高台立面（近探陡升且不继续延伸 = 墙）→ 危险；插值坡（连续上升）放行。
   *   用 RasterMap 高度场（静态），不依赖物理体，成本极低。 */
  private isDangerAhead(dx: number, dz: number): boolean {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    // ★ 空中层（2026-09-18）：飞行单位不吃地面危险（坑/深水/立面）→ 永远"前方安全"
    if (this.airborne) return false;
    const ux = dx / len, uz = dz / len;
    const raster = RasterMap.current;
    if (!raster) return false;
    const p = this.entity.position;
    const p1 = EnemyBase.HAZARD_PROBE;
    const p2 = p1 * 0.55; // 中间采样点（更早发现坑沿，转角更平滑）
    // ★ 第二层高度（浮空洞顶）：用自身当前高度选层——站在山上的敌人不会把洞当坑
    const h0 = raster.surfaceHeightAtFor(p.x, p.z, p.y);
    for (const d of [p2, p1]) {
      const hx = p.x + ux * d;
      const hz = p.z + uz * d;
      const role = raster.tileDefAt(hx, hz).genRole;
      const h = raster.surfaceHeightAtFor(hx, hz, p.y);
      // 坑洞地块（lethal 深坑）：不可站立 → 危险
      if (role === 'pit') return true;
      // 坑底过低（挖深/坑洞的深底，判定死亡线以下）→ 危险
      if (h < -1.2) return true;
      // ★ 深水（水面 0 − 水底 > 0.8m）：敌人不涉水 → 危险
      if (role === 'liquid' && h < -0.8) return true;
    }
    // ★ 高台立面判定：0.45m 处陡升 > 0.6m，且 1.2m 处没有同斜率延续 → 墙（插值坡放行）
    const hNear = raster.surfaceHeightAtFor(p.x + ux * 0.45, p.z + uz * 0.45, p.y);
    const hFar = raster.surfaceHeightAtFor(p.x + ux * 1.2, p.z + uz * 1.2, p.y);
    const riseNear = hNear - h0;
    const riseFar = hFar - hNear;
    if (riseNear > 0.6 && riseFar < riseNear * 0.5) return true;
    return false;
  }

  /** 切帧（显示帧：由相机判定，见 onUpdate） */
  private setFrameAnimated(facing: '前' | '后'): void {
    if (this.showFacing === facing) return;
    this.showFacing = facing;
    const source = this.anim!.source;
    // 缺帧回退：目标帧 → 前帧 → 资产单帧「帧 1」；都没有 = 保持第 0 帧（不刷警告）
    let name: string | null = null;
    if (source.hasFrame(facing)) name = facing;
    else if (source.hasFrame('前')) name = '前';
    else if (source.hasFrame('帧 1')) name = '帧 1';
    if (name) this.anim!.playFrames([name], { loop: true, fps: 1 });
  }
  /** 贴片朝向角（移动方向决定） */
  private yawBase = 0;
  /** 当前显示帧（相机判定） */
  private showFacing: '前' | '后' | null = null;

  /** ★ 渲染距离应用（基类联动动画/渲染管线；基类 viewLod 供子类降级表现） */
  override applyViewDistance(distance: number): void {
    super.applyViewDistance(distance);
    // 立即按等级应用扭曲开关（不等下一帧 onUpdate）
    this.applyDistort();
  }

  protected override onUpdate(dt: number): void {
    // ★ 基类位置推进（moveDir × speed → 位置；无输入时 controller.update 不跑）
    super.onUpdate(dt);
    // ★ 显示帧 + 转身由相机判定（旁观者视角）：
    //   相机在角色正面侧 → 前帧 + 贴片保持移动方向朝向
    //   相机在背面侧 → 后帧 + 贴片转身 180°（面向相机绘制背面）
    // ★ 视锥外不做这些纯表现计算（动画/朝向/扭曲），回到视野下一帧自动恢复
    if (!this.inFrustum) return;
    if (this.billboard) {
      // ★ 无背面素材：始终正面朝相机（billboard 由 EntityBase.render 应用）——
      //   不转身、不切后帧（否则露出背面空白/镜像贴图）
      this.setFrameAnimated('前');
    } else if (this.camera) {
      const camDirZ = this.camera.position.z - this.entity.position.z;
      const camDirX = this.camera.position.x - this.entity.position.x;
      // 贴片正面方向（+z 经 yawBase 旋转）
      const fz = Math.cos(this.yawBase);
      const fx = Math.sin(this.yawBase);
      // 相机是否在正面侧（点积 > 0）
      const facingCam = (camDirX * fx + camDirZ * fz) >= 0;
      if (facingCam) {
        this.setFrameAnimated('前');
        this.applyYaw(this.yawBase);
      } else {
        this.setFrameAnimated('后');
        this.applyYaw(this.yawBase + Math.PI);
      }
    }

    // ★ 每帧应用当前帧的扭曲参数（特效包参数，第一帧已继承到所有帧；
    //   ★ LOD 降级：viewLod 1+ 不应用扭曲——省计算，视觉可接受）
    this.applyDistort();
  }

  /** 应用当前帧扭曲参数（按 viewLod 开关）。
   *  ★ 兼容两种资产：特效包(Asset)走 getFrameRenderData；纯纹理包(FtxAsset)
   *    无该方法，改从 getFtxFrame 读同一组 distort 字段。 */
  private applyDistort(): void {
    const idx = this.anim!.state.frameIndex;
    let d: {
      distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
      distortSpeed: number; distortRotation: number;
    } | null | undefined;
    const a = this.assetRef as unknown as {
      getFrameRenderData?: (i: number) => {
        distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
        distortSpeed: number; distortRotation: number;
      } | null;
    };
    if (typeof a.getFrameRenderData === 'function') {
      d = a.getFrameRenderData(idx);
      if (d && 'distortEnabled' in d) {
        // 特效包：直接使用
      } else {
        d = null;
      }
    } else {
      // 纯纹理包(FtxAsset)：无特效包 distort 参数 → 默认关闭
      const f = this.assetRef.getFtxFrame(idx) as unknown as {
        distortEnabled?: boolean; distortAmplitude?: number; distortFrequency?: number;
        distortSpeed?: number; distortRotation?: number;
      } | null;
      d = f ? {
        distortEnabled: !!f.distortEnabled, distortAmplitude: f.distortAmplitude ?? 0.06,
        distortFrequency: f.distortFrequency ?? 5.0, distortSpeed: f.distortSpeed ?? 1.2,
        distortRotation: f.distortRotation ?? 0,
      } : null;
    }
    if (d && this.renderer) {
      (this.renderer as FTXQuad).setDistort({
        enabled: this.viewLod === 0 && d.distortEnabled,
        amplitude: d.distortAmplitude,
        frequency: d.distortFrequency,
        speed: d.distortSpeed,
        rotation: d.distortRotation,
      });
    }
  }

  /** 贴片绕 Y 旋转（朝相机侧显示对应面） */
  private applyYaw(rad: number): void {
    if (this.renderer && 'setYaw' in this.renderer) {
      (this.renderer as { setYaw(r: number): void }).setYaw(rad);
    }
  }

  /** ★ 退役业务钩子：真击杀在此上报当天击杀统计（retire('killed') 由 onDeath 触发）；
   *  降格/回收/清场走其他 reason → 天然不计击杀（取代 killedByCombat/deathReported） */
  protected override onRetire(reason: RetireReason): void {
    if (reason === 'killed') {
      eventBus.emit('enemy_killed', { source: this.deathSource, x: this.entity.position.x, z: this.entity.position.z });
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
