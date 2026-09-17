// ============================================================
// DialogueSystem.ts —— 对话运行时（分支推进/条件/效果，无 DOM）
// ============================================================
// 职责：
//   · 载入对话树（config/dialogues.json）→ 按节点推进
//   · 分支选项：只显示满足 cond 的选项；选择即跳转
//   · 效果结算：物资 / 遗物 / 标记 / 治疗（复用 Session / ItemManager）
//   · 结束时回调 onEnd(eventId)（事件模块据此落账"已完成"）
// UI 由 DialogueViewLike 注入（基地/战斗共用同一实现）。
// ============================================================

import type { GameSession } from '../../core/Session';
import { SaveSystem } from '../../core/SaveSystem';
import { rollRandomRelic } from '../../core/RandomRelic';
import { RELIC_ITEM_CONFIG } from '../../config/relics';
import type { ItemManager } from '../inventory/ItemManager';
import dialogueConfigJson from '../../config/dialogues.json';
import {
  evalStoryCond,
  type DialogueChoiceDef,
  type DialogueConfig,
  type DialogueEffectDef,
  type DialogueNodeDef,
  type DialogueTreeDef,
  type DialogueViewLike,
} from './DialogueTypes';

/**
 * ★ 对话给出的奖励（物资 / 遗物）。
 *   DialogueSystem 本身不碰 UI —— 它只把"到手了什么"报给上层，
 *   由模式层决定怎么提示（世界模式 → 右上角"获得物品"播报）。
 */
export interface DialogueGrant {
  kind: 'item' | 'relic';
  id: string;
  count: number;
  /** 是否真正到手（背包满 = false；遗物恒为 true，写进 owned 即生效） */
  success: boolean;
}

export interface DialogueSystemOptions {
  session: GameSession;
  itemManager: ItemManager;
  view: DialogueViewLike;
  /** 对话结束回调（参数 = start 时传入的 eventId；主动关闭不触发） */
  onEnd?: (eventId: string | null) => void;
  /** ★ 奖励到手回调（每件物资/遗物各触发一次；UI 用它弹提示） */
  onGrant?: (grant: DialogueGrant) => void;
}

export class DialogueSystem {
  private readonly session: GameSession;
  private readonly itemManager: ItemManager;
  private readonly view: DialogueViewLike;
  private readonly onEnd?: (eventId: string | null) => void;
  private readonly onGrant?: (grant: DialogueGrant) => void;

  private tree: DialogueTreeDef | null = null;
  private eventId: string | null = null;

  constructor(opts: DialogueSystemOptions) {
    this.session = opts.session;
    this.itemManager = opts.itemManager;
    this.view = opts.view;
    this.onEnd = opts.onEnd;
    this.onGrant = opts.onGrant;
  }

  /** 是否有对话进行中 */
  get isActive(): boolean {
    return this.tree !== null;
  }

  /** 开始一段对话（treeId 不存在时告警并返回 false） */
  start(treeId: string, opts?: { eventId?: string }): boolean {
    if (this.tree) this.close();
    const tree = (dialogueConfigJson as DialogueConfig).trees[treeId];
    if (!tree) {
      console.warn(`[对话] 未知对话树：${treeId}`);
      return false;
    }
    this.tree = tree;
    this.eventId = opts?.eventId ?? null;
    this.view.open({
      onAdvance: () => this.advance(),
      onChoose: (i) => this.choose(i),
    });
    this.enter(tree.start);
    return true;
  }

  /** 无选项节点：点击/按键推进（有选项时必须选择） */
  advance(): void {
    const node = this.currentNode();
    if (!node) return;
    if (this.visibleChoices(node).length > 0) return;
    if (node.next) this.enter(node.next);
    else this.finish();
  }

  /** 选择分支（index = 可见选项序号） */
  choose(index: number): void {
    const node = this.currentNode();
    if (!node) return;
    const choice = this.visibleChoices(node)[index];
    if (!choice) return;
    this.applyEffects(choice.effects);
    if (choice.next) this.enter(choice.next);
    else this.finish();
  }

  /** 主动关闭（模式退出等；不触发 onEnd 落账） */
  close(): void {
    if (!this.tree) return;
    this.tree = null;
    this.eventId = null;
    this.view.close();
  }

  // ============================================================
  // 内部
  // ============================================================

  private currentNode(): DialogueNodeDef | null {
    return this._nodeId ? (this.tree?.nodes[this._nodeId] ?? null) : null;
  }

  private _nodeId: string | null = null;

  private visibleChoices(node: DialogueNodeDef): DialogueChoiceDef[] {
    return (node.choices ?? []).filter((c) => evalStoryCond(c.cond, this.session));
  }

  private enter(nodeId: string): void {
    const tree = this.tree;
    const node = tree?.nodes[nodeId];
    if (!tree || !node) {
      console.warn(`[对话] 节点缺失：${nodeId}`);
      this.finish();
      return;
    }
    this._nodeId = nodeId;
    this.applyEffects(node.effects);
    const choices = this.visibleChoices(node);
    this.view.render({
      speaker: node.speaker ?? tree.speaker ?? '???',
      portrait: node.portrait ?? tree.portrait,
      text: node.text,
      choices: choices.map((c) => ({ label: c.text })),
      continueHint: choices.length === 0,
    });
  }

  private finish(): void {
    const eventId = this.eventId;
    this.tree = null;
    this._nodeId = null;
    this.eventId = null;
    this.view.close();
    this.onEnd?.(eventId);
  }

  /** 效果结算（物资入玩家背包 / 遗物永久生效 / 写标记 / 治疗） */
  private applyEffects(effects?: DialogueEffectDef[]): void {
    if (!effects || effects.length === 0) return;
    for (const ef of effects) {
      switch (ef.kind) {
        case 'item': {
          const count = ef.count ?? 1;
          // ★ 防呆（2026-09-17）：**遗物写成 kind:'item' 会掉进背包格子** ——
          //   背包是格子制、遗物是 outOfRun.owned 永久叠加，混进去两头都不对
          //   （背包里多一个占格子的"遗物"，遗物列表里反而没有它）。
          //   这里直接改走遗物通道，并大声告警，方便把配置改回 kind:'relic'。
          if (RELIC_ITEM_CONFIG[ef.id]) {
            console.warn(
              `[对话] ${ef.id} 是遗物（relics.ts 已登记），却写成 kind:'item' —— ` +
              '已自动改走遗物通道；请把配置改成 kind:\'relic\'',
            );
            const owned = this.session.outOfRun.owned;
            owned[ef.id] = (owned[ef.id] ?? 0) + count;
            this.onGrant?.({ kind: 'relic', id: ef.id, count, success: true });
            break;
          }
          // ★ 取 addItem 的返回值判成败（背包满 = false）→ 上层据此播报
          const ok = this.itemManager.addItem('player', ef.id, count);
          this.onGrant?.({ kind: 'item', id: ef.id, count, success: ok });
          break;
        }
        case 'relic': {
          const count = ef.count ?? 1;
          // ★ 反向防呆：非遗物 id 写成 kind:'relic' 会塞进遗物列表，
          //   而它没有 RELIC_ITEM_CONFIG（无名字/无图标/无效果）→ 掉进背包才是对的。
          if (!RELIC_ITEM_CONFIG[ef.id]) {
            console.warn(
              `[对话] ${ef.id} 不是遗物（relics.ts 未登记），却写成 kind:'relic' —— ` +
              '已自动改走背包通道；请把配置改成 kind:\'item\'',
            );
            const ok = this.itemManager.addItem('player', ef.id, count);
            this.onGrant?.({ kind: 'item', id: ef.id, count, success: ok });
            break;
          }
          const owned = this.session.outOfRun.owned;
          owned[ef.id] = (owned[ef.id] ?? 0) + count;
          this.onGrant?.({ kind: 'relic', id: ef.id, count, success: true });
          break;
        }
        case 'random_relic': {
          // ★ 随机遗物：抽 N 件，每件单独报一次（UI 一物一条播报）
          const count = ef.count ?? 1;
          const owned = this.session.outOfRun.owned;
          for (let i = 0; i < count; i++) {
            const id = rollRandomRelic();
            if (!id) {
              console.warn('[对话] 随机遗物池为空，本次未发放');
              break;
            }
            owned[id] = (owned[id] ?? 0) + 1;
            this.onGrant?.({ kind: 'relic', id, count: 1, success: true });
          }
          break;
        }
        case 'flag':
          this.session.story.flags[ef.key] = ef.value ?? 1;
          break;
        case 'heal': {
          const maxHp = this.session.player.maxHp;
          const amount = ef.amount ?? Math.round(maxHp * (ef.percent ?? 0));
          this.session.player.hp = Math.min(maxHp, this.session.player.hp + amount);
          break;
        }
      }
    }
    // 对话产出即持久化（奖励/标记不因中途退出丢失）
    SaveSystem.save(this.session);
  }
}
