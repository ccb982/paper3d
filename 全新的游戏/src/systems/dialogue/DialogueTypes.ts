// ============================================================
// DialogueTypes.ts —— 对话数据结构与条件求值（纯数据，无 DOM/系统依赖）
// ============================================================
// 对话树（config/dialogues.json）：
//   tree.start → 节点；节点可 next（线性推进）或 choices（分支选项）；
//   节点/选项可带 effects（领取奖励/写标记）、cond（选项可见条件）。
// 事件定义（config/events.json）复用本文件的 cond/effect 语义。
// ============================================================

import type { GameSession } from '../../core/Session';

/** 条件（全部满足才通过；未声明的字段不检查） */
export interface StoryCond {
  /** 天数下限（含） */
  minDay?: number;
  /** 天数上限（含） */
  maxDay?: number;
  /** 需要已置位的标记 */
  flag?: string;
  /** 需要未置位的标记 */
  notFlag?: string;
  /** 需要拥有的遗物 id */
  relic?: string;
}

export type DialogueEffectDef =
  | { kind: 'item'; id: string; count?: number }
  | { kind: 'relic'; id: string; count?: number }
  | { kind: 'flag'; key: string; value?: number }
  | { kind: 'heal'; amount?: number; percent?: number };

export interface DialogueChoiceDef {
  text: string;
  /** 跳转节点；缺省 = 结束对话 */
  next?: string;
  /** 选项可见/可选条件 */
  cond?: StoryCond;
  /** 选中后结算 */
  effects?: DialogueEffectDef[];
}

export interface DialogueNodeDef {
  speaker?: string;
  portrait?: string;
  text: string;
  /** 线性推进到下一节点；与 choices 互斥 */
  next?: string;
  /** 分支选项（只显示满足 cond 的） */
  choices?: DialogueChoiceDef[];
  /** 进入节点即结算 */
  effects?: DialogueEffectDef[];
  /** 显式结束（无 next/choices 时默认结束） */
  end?: boolean;
}

export interface DialogueTreeDef {
  /** 树级默认说话人/立绘（节点可覆写） */
  speaker?: string;
  portrait?: string;
  start: string;
  nodes: Record<string, DialogueNodeDef>;
}

export interface DialogueConfig {
  trees: Record<string, DialogueTreeDef>;
}

/** 条件求值（对话选项 / 事件触发共用） */
export function evalStoryCond(cond: StoryCond | undefined, session: GameSession): boolean {
  if (!cond) return true;
  const day = session.meta.day;
  if (cond.minDay != null && day < cond.minDay) return false;
  if (cond.maxDay != null && day > cond.maxDay) return false;
  const flags = session.story?.flags ?? {};
  if (cond.flag && !(flags[cond.flag] ?? 0)) return false;
  if (cond.notFlag && (flags[cond.notFlag] ?? 0)) return false;
  if (cond.relic && (session.outOfRun?.owned?.[cond.relic] ?? 0) <= 0) return false;
  return true;
}

// ============================================================
// 视图契约（DialogueSystem 只依赖此接口；UI 层 DialogueView 实现）
// ============================================================

/** 一屏对话的渲染状态 */
export interface DialogueViewState {
  speaker: string;
  /** 立绘 URL（FTX；缺省 = 占位头像） */
  portrait?: string;
  text: string;
  /** 分支选项（空 = 点击继续/结束） */
  choices: { label: string }[];
  /** 显示"点击继续"提示 */
  continueHint: boolean;
}

export interface DialogueViewHandlers {
  /** 无选项时点击/按键：推进或结束 */
  onAdvance: () => void;
  /** 选项点击（index 为可见选项序号） */
  onChoose: (index: number) => void;
}

export interface DialogueViewLike {
  open(handlers: DialogueViewHandlers): void;
  render(state: DialogueViewState): void;
  close(): void;
  readonly isOpen: boolean;
}
