// ============================================================
// engine/contracts —— 重写后的命令模型（唯一真源；P0 立契约）
// ============================================================
// 两层收敛（《蜂群重写计划.md》§1）：
//   复合层（引擎 → 队长）：protect / act / defend —— 由原子能力组合
//   运行模式（小队自决）：march/act = 移动原子；patrol/garrison = 行为循环驻留（§2.10b）
// 铁律：命令生命周期显式；一切令过 OrderValidator（①环内 ②密度 ③可达）。
// 本文件只放类型与常量表——不放逻辑（逻辑在各模块）。
// ============================================================

// ---------- 复合层（引擎 → 队长） ----------

export type CompositeKind = 'protect' | 'act' | 'defend';

/** ★ 两个移动原子（《RTS架构.md》§2.10b）：长寻路 march / 短寻路 act */
export type MoveAtom = 'march' | 'act';
/** ★ 小队运行模式（原子 + 行为循环驻留模式）：patrol/garrison =「取目标函数 → 移动」循环，非原子 */
export type SquadMode = MoveAtom | 'patrol' | 'garrison';

// ★ 复合 → 原子 的**解释器**在 `squad/CommandLang.ts`（唯一实现；引擎只选复合，队长解原子）。

// ---------- 命令（引擎→队长 / 队长→自己 / 玩家） ----------

export type OrderSource = 'engine' | 'player';

export interface SquadOrder {
  /** 复合命令（引擎）/ 原子能力（队长自令） */
  kind: CompositeKind | SquadMode;
  source: OrderSource;
  target: { x: number; z: number };
  /** 保护锚（仅 protect 用；铁律 G5：锚只属于保护令） */
  anchor?: { x: number; z: number };
  /** ★ 威胁点 P（仅 protect/garrison 用；引擎单源提供，队长据此算阻挡/掩体站位） */
  threat?: { x: number; z: number };
  seq: number;
  /** TTL（游戏分钟；命令/规划层用 GAME_MIN） */
  ttl: number;
  mission?: string;
}
// ★ 命令格式（用户定）：**作用对象只有队长**（引擎只指挥队长；成员一律跟队长走）。
//   · 位移命令：径向+切向 → target 过 OrderValidator（①环内②密度③可达）→ 下发（Spread 只解 θ）
//   · 防御命令：可只给 object（防御对象），也可只给 kind（守原地）
//   · 扩展新复合命令 = 加可选字段，不改既有语义（契约向后兼容）

/** 命令生命周期（显式；换令条件集中判定） */
export type OrderPhase = 'issued' | 'executing' | 'done' | 'dropped';

export interface OrderState {
  order: SquadOrder;
  phase: OrderPhase;
  /** 进度 0~1（换令稳定门：≥0.5 可换） */
  progress: number;
  issuedAt: number;
  /** 静止时长（实秒；≥ORDER_STABLE.STUCK_S 可换） */
  stillS: number;
}

// ---------- 汇报（实体/队长 → 引擎；信息单源的反向流） ----------

export interface SquadReport {
  squadId: number;
  x: number;
  z: number;
  alive: number;
  /** 当前原子能力（执行层自报） */
  atom: SquadMode;
  /** 命令阶段（引擎只记录，不逐拍指挥） */
  phase: OrderPhase;
  /** 命令进度 0~1（队长自报；稳定门用） */
  progress?: number;
  /** 静止时长（实秒；队长自报；稳定门用） */
  stillS?: number;
  /** 整队血量比 Σhp/ΣmaxHp（0~1；重伤撤回判定用——**整队危急**才撤，用户定） */
  hpRatio?: number;
}

// ---------- 实体侧契约（能力 / 升降格汇报） ----------
// 分层：实体层不依赖 systems → 类型真源在 entity/base/contracts.ts，这里 re-export 方便引擎引用。
export type { AbilityId, AbilityRequest, EntityTierReport } from '../../../entity/base/contracts';

/** 四兵种（管理器分派依据；与 SquadTable.type 对齐） */
export type MobRole = 'engineer' | 'melee' | 'ranged' | 'flyer';

/** 攻击队列归属（AttackQueues；敌人离哪个实体近就进哪个队列） */
export type QueueOwner = 'player' | 'ship' | 'ancestor' | 'ally';
