// ============================================================
// engine/DecisionChain.ts —— 显式优先链（重写 P3；铁律 3 单源决策）
// ============================================================
// 每队每拍**只有一个决策源**产出命令——按显式优先级取第一个成立者：
//   ① 玩家令（最高；在身 → 引擎不产令，铁律 1）
//   ② 重伤（<0.5 血量 → 往玩家/舰船撤）
//   ③ 事态介入（到事态函数上限 → 防御；被打 → 保护）
//   ④ 干预（扎堆/越位/磨蹭 → 纠正令）
//   ⑤ 常规部署（兵种管理器的目标分配）
// 纯函数（不靠调用顺序，不隐式耦合）→ 可独立自检。
// ============================================================

export type DecisionSource = 'player' | 'wounded' | 'situation' | 'intervention' | 'routine';

export interface DecisionInput {
  /** 玩家令在身（未过期） */
  playerOrder: boolean;
  /** 血量比例 0~1 */
  hpRatio: number;
  /** 到事态函数上限（d ≥ ringMax） */
  atRingMax: boolean;
  /** 该队被打（玩家/威胁在打它） */
  underAttack: boolean;
  /** 干预纠正目标（扎堆/越位/磨蹭；null=无） */
  intervention: { x: number; z: number } | null;
  /** 常规部署目标（兵种管理器分配；null=无） */
  routine: { x: number; z: number } | null;
  /** ★ 撤退点（向**后**：远离战场——本队扇区中心外圈；用户定）。
   *  为 null = 无后撤点（不撤，保持现状）。 */
  retreat: { x: number; z: number } | null;
}

export interface Decision {
  source: DecisionSource;
  /** 原子/复合命令（重伤撤退 = march 到基准） */
  kind: 'act' | 'march' | 'garrison' | 'defend' | 'protect';
  target: { x: number; z: number } | null;
  reason: string;
}

/** 显式优先链：返回第一个成立的决策；全不成立 → null（保持现状） */
export function decideChain(inp: DecisionInput): Decision | null {
  // ① 玩家令在身：引擎不产令（玩家令优先）
  if (inp.playerOrder) return null;
  // ② 重伤（整队血量比 < 0.5）：向**后**撤——远离战场（扇区中心外圈；用户定）
  if (inp.hpRatio < 0.5) {
    if (!inp.retreat) return null;   // 无后撤点 → 不产令（保持现状）
    return { source: 'wounded', kind: 'march', target: inp.retreat, reason: `hp=${inp.hpRatio.toFixed(2)}` };
  }
  // ③ 事态介入：到上限 → 防御；被打 → 保护
  if (inp.atRingMax) return { source: 'situation', kind: 'defend', target: null, reason: '到事态上限' };
  if (inp.underAttack) return { source: 'situation', kind: 'protect', target: null, reason: '被打' };
  // ④ 干预：扎堆/越位/磨蹭的纠正
  if (inp.intervention) return { source: 'intervention', kind: 'act', target: inp.intervention, reason: '干预' };
  // ⑤ 常规部署
  if (inp.routine) return { source: 'routine', kind: 'act', target: inp.routine, reason: '常规' };
  return null;
}
