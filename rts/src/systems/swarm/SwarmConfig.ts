// ============================================================
// SwarmConfig —— 蜂群参数（《敌人管线设计.md》§8：参数集中可调）
// ============================================================
// SWARM    分层/回收/战斗节拍；AUTONOMY 自主 LOD/大队警戒。
// 从 SwarmSystem 外置（护栏行数）；原路径 re-export 兼容旧引用。
// ============================================================

/** ★ 命令侧时间尺度（用户定 2026-09-24）：**下命令侧的时间比现实快 5 倍**
 *  （游戏内 5 秒 = 现实 1 秒）→ 1 游戏分钟 = 12 实秒（`GAME_MIN`）。
 *  约定：**只有命令/规划层计时**（队长令/成员指令门、命令 TTL、发令冷却、使命重发）用 `GAME_MIN`；
 *        日钟/施工/战斗/寻路/回收等其他计时一律保持原实秒值。 */
export const GAME_SEC = 0.2;
export const GAME_MIN = 12;

/** 分层/回收参数（§9；集中可调）★ 2026-09-21 扩大 LOD：L3 45m/36；L2 120m；L1 190m；降格 55m */
export const SWARM = {
  /** L3 实体层：升格半径 / 实体上限 */
  L3_RADIUS: 45,
  L3_CAP: 36,
  /** L2 代理层半径（L3~L2 = 代理半频） */
  L2_RADIUS: 120,
  /** L1 远群半径（超出即回收） */
  L1_RADIUS: 190,
  /** 降格半径（实体 > 此距离 → 回代理） */
  DEMOTE_RADIUS: 55,
  /** 升格预算（每帧最多几只；防一圈同时升级的尖刺） */
  PROMOTE_PER_FRAME: 2,
  /** 决策频率（Hz）：索引 = tier（1/2） */
  THINK_HZ: [0, 2, 5],
  /** 移动积分频率（Hz）：索引 = tier（1/2） */
  MOVE_HZ: [0, 10, 20],
  /** ★ E4a：L3 实体编队 steer 下发频率（Hz；《实体架构.md》§9.4） */
  STEER_HZ: 10,
  /** 近战额外射程余量（米；进入即停下挥击） */
  MELEE_PAD: 0.4,
  /** 攻击冷却区间（秒） */
  ATTACK_CD_MIN: 0.8,
  ATTACK_CD_SPAN: 0.4,
  /** 危险地形（坑）前瞻距离（米；仅非流场方向使用） */
  HAZARD_PROBE: 1.8,
  /** ★ 2026-09-14 敌群地形限制：深水判定（水深 > 此值视为不可涉水） */
  DEEP_WATER: 0.8,
  /** ★ 高台立面陡升阈值（米；配合"不延续"判定区分墙与插值坡） */
  MOVE_STEP_MAX: 0.6,

  // ---- P2：流场 / 攻击槽 / 警戒场 ----
  /** 流场重建频率（Hz） */
  FLOW_HZ: 3,
  /** 流场前瞻距离（米；用方向取前瞻点，保证收敛） */
  FLOW_LOOKAHEAD: 8,
  /** 攻击槽：环上扇区数 / 环半径 */
  SLOT_ANGLES: 10,
  SLOT_RADIUS: 1.7,
  /** 距目标多近开始占槽（米） */
  SLOT_COMMIT: 25,
  /** 同一目标同时挥击上限（攻击令牌数） */
  ATTACK_TOKENS: 3,
  /** 令牌/挥击保持窗口（秒） */
  ATTACK_HOLD: 0.3,
  /** P4 士气：低血撤退阈值 / 撤退时长区间 / 撤退冷却 / 狂暴速度倍率与时长 */
  RETREAT_HP_RATIO: 0.3,
  RETREAT_TIME_MIN: 2,
  RETREAT_TIME_SPAN: 2,
  RETREAT_COOLDOWN: 8,
  RAGE_SPEED: 1.25,
  RAGE_SECONDS: 5,
  RAGE_RADIUS: 12,
  /** ★ 无命令自主交战保底半径（米；《实体架构.md》§5.12） */
  AUTONOMY_ENGAGE_R: 16,
  /** 警戒场：持续时间 / 反应延迟区间 / 察觉时刷出的半径 / 挥击时刷出的半径 */
  ALERT_SECONDS: 6,
  ALERT_DELAY_MIN: 0.2,
  ALERT_DELAY_SPAN: 1.3,
  ALERT_PAINT_RADIUS: 12,
  ALERT_PAINT_RADIUS_ATTACK: 10,
} as const;

/** ★ 自主 LOD / 大队警戒参数（2026-09-19；《实体架构.md》§5.10；集中可调） */
export const AUTONOMY = {
  /** 单位被击免降格窗口（秒） */
  UNIT_HOLD_S: 6,
  /** 小队警觉窗口（秒；任一成员被击 → 全队） */
  SQUAD_ALERT_S: 8,
  /** 大队警觉统计窗口（秒） */
  BATTALION_WINDOW_S: 12,
  /** 触发倾盆而出所需“不同小队被击”数 */
  COUNTER_SQUADS: 3,
  /** 倾盆而出持续（秒） */
  COUNTER_S: 20,
  /** 倾盆而出全图警戒半径（米） */
  COUNTER_ALERT_R: 220,
  /** 倾盆而出动态算力：L3 上限 / 每帧升格 加成 */
  L3_CAP_BOOST: 15,
  PROMOTE_BOOST: 4,
} as const;

/** ★ 卡死回收（用户定调 2026-09-21）：代理/队长长时间停在"很小范围"→ 自动回收（归还编制）。
 *  **口径从严（宁可错杀，不能放过）**：唯一命令豁免 = 驻守（garrison）；交火期（被击 8s 内）豁免。
 *  施工/巡逻等不豁免——它们靠"窗口内有实际位移（包围盒 > BBOX_R）"自然逃逸。
 *  原地左右摇摆（净活动范围 < BBOX_R）同样清除。 */
export const STUCK = {
  /** 判定节拍（秒） */
  CHECK_S: 1,
  /** 窗口包围盒上限（米；净活动范围不超过它 = 被困/原地摇摆） */
  BBOX_R: 4,
  /** 持续时长（秒；连续超时 → 回收） */
  HOLD_S: 25,
} as const;

/** ★ 指挥层重发/寿命常量（P5 收口：重发常量统一——原 RESEND_S 等散落各写各的） */
export const RESEND = {
  /** 大队任务周期重发（游戏分钟；T+ 重发保持使命存活） */
  MISSION_S: 10 * GAME_MIN,
  /** 使命 TTL 余量（游戏分钟；重发间隔 + 余量 = 下发 TTL，防两拍之间掉令） */
  TTL_PAD: 5 * GAME_MIN,
} as const;

/** ★ 命令保护（用户定 2026-09-24）：时间+距离保护 + 命令记忆（OrderGate 消费）
 *  成员指令：走 8m 或卡 4 **游戏分钟**（净<3m）才换目标；反向拉扯拒绝；卡住偏 55° 找没下过的方向 */
export const DIRECTIVE_GATE = {
  minMove: 8, retarget: 8, holdS: 4 * GAME_MIN, netMin: 3, forceS: 15 * GAME_MIN,
  arriveR: 3, persistS: 3 * GAME_MIN, stableM: 2, reverseDot: -0.2, histN: 3, biasDeg: 55,
} as const;

/** ★ 队长自主令：走 20m 或卡 8 **游戏分钟**（净<4m）才换目标；其余同上 */
export const LEADER_GATE = {
  minMove: 20, retarget: 15, holdS: 8 * GAME_MIN, netMin: 4, forceS: 20 * GAME_MIN,
  arriveR: 6, persistS: 3 * GAME_MIN, stableM: 2, reverseDot: -0.3, histN: 3, biasDeg: 50,
} as const;
