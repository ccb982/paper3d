// ============================================================
// InteractionManager.ts —— 交互管理（共享业务逻辑层）
// 无 UI 依赖，只做交互分发决策。
// ShipMode 和 WorldMode 共用同一个类，各自实例化。
// ============================================================

import type { GameSession } from '../../core/Session';
import { ItemManager } from '../inventory/ItemManager';

export interface Interactable {
  id: string;
  type: 'item' | 'npc' | 'crafting_table' | 'container' | 'exit';
  data?: any;
}

export interface InteractionContext {
  session: GameSession;
  itemManager: ItemManager;
}

export interface InteractionResult {
  action: string;
  payload?: any;
  message?: string;
}

export class InteractionManager {
  constructor(private ctx: InteractionContext) {}

  /** 核心：处理任何交互 */
  interact(target: Interactable): InteractionResult {
    switch (target.type) {
      case 'item':
        return this.handleItem(target);
      case 'crafting_table':
        return this.handleCraftingTable(target);
      case 'npc':
        return this.handleNpc(target);
      case 'container':
        return this.handleContainer(target);
      case 'exit':
        return { action: 'exit', message: '返回舰船' };
      default:
        return { action: 'none', message: '无法交互' };
    }
  }

  private handleItem(target: Interactable): InteractionResult {
    return {
      action: 'show_item_detail',
      payload: {
        itemId: target.data?.itemId,
        grid: target.data?.grid,
        row: target.data?.row,
        col: target.data?.col,
      },
    };
  }

  private handleCraftingTable(target: Interactable): InteractionResult {
    return {
      action: 'open_crafting',
      payload: {
        station: target.data?.level || 'ship',
      },
    };
  }

  private handleNpc(target: Interactable): InteractionResult {
    return {
      action: 'start_dialogue',
      payload: {
        npcId: target.data?.npcId,
        dialogueTree: target.data?.dialogueTree || 'default',
      },
    };
  }

  private handleContainer(target: Interactable): InteractionResult {
    return {
      action: 'open_container',
      payload: {
        containerId: target.data?.containerId,
        inventory: target.data?.inventory,
      },
    };
  }

  /** 快捷辅助：拾取（WorldMode 专用） */
  pickup(itemId: string, fromWorld: boolean = true): boolean {
    return this.ctx.itemManager.addItem('player', itemId, 1);
  }
}