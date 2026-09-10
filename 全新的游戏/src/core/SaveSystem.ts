// ============================================================
// SaveSystem.ts —— 存档系统
// 触发时机：① 返回舰船 ② 抽卡后
// 存储介质：localStorage（Web）/ 后续可替换为 Adapter
// ============================================================

import type { GameSession, InventoryGrid } from './Session';
import { migrateGrid, mergeDuplicatesInGrid, GRID_DIMENSIONS, SLOT_COUNT } from './Session';

const STORAGE_KEY = 'arknights_rogue_save';

export const SaveSystem = {
  /**
   * ★ 保存存档（仅在安全点调用）
   */
  save(session: GameSession): void {
    try {
      session.meta.lastSavedAt = new Date().toISOString();
      const json = JSON.stringify(session);
      localStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      console.error('[存档] 保存失败:', e);
    }
  },

  /**
   * 读取存档
   */
  load(): GameSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as GameSession;
      if (!data.meta || !data.meta.version) {
        console.warn('[存档] 存档版本不兼容，将丢弃');
        return null;
      }
      // 确保四层背包完整
      if (!data.inventories) {
        console.warn('[存档] 缺少 inventories 字段，将丢弃');
        return null;
      }

      // ★ 修复网格尺寸（防止旧存档行列数不匹配导致越界）
      const inv = data.inventories;
      inv.base = migrateGrid(inv.base, GRID_DIMENSIONS.base.rows, GRID_DIMENSIONS.base.cols, 'base');
      inv.ship = migrateGrid(inv.ship, GRID_DIMENSIONS.ship.rows, GRID_DIMENSIONS.ship.cols, 'ship');
      inv.player = migrateGrid(inv.player, GRID_DIMENSIONS.player.rows, GRID_DIMENSIONS.player.cols, 'player');

      // ★ 同层合并归一（旧存档可能有同 itemId 多堆 → 合并为 1 格求和）
      for (const layer of ['base', 'ship', 'player'] as (keyof GameSession['inventories'])[]) {
        if (mergeDuplicatesInGrid(inv[layer])) {
          console.warn(`[迁移] ${layer} 背包重复堆已合并（一格一类）`);
        }
      }

      // ★ 旧存档迁移：弹药池（无则默认）
      if (!data.player.ammo || typeof data.player.ammo !== 'object') {
        data.player.ammo = {};
      }
      // ★ 旧存档迁移 → 出击槽池（v0.2.0）：
      //   合并旧装备位（weapon/armor/headgear）+ 旧友军槽（deployedAllies）→ player.slots[12]
      //   （装备优先，容量不足截断；旧字段随后清除）
      if (!Array.isArray(data.player.slots)) {
        const merged: (string | null)[] = [];
        const d = data as unknown as {
          deployedAllies?: unknown;
          player: { equips?: { weapon?: string; armor?: string; headgear?: string } };
        };
        for (const k of ['weapon', 'armor', 'headgear'] as const) {
          const id = d.player.equips?.[k];
          if (id) merged.push(id);
        }
        if (Array.isArray(d.deployedAllies)) {
          for (const id of d.deployedAllies) {
            if (typeof id === 'string' && merged.length < SLOT_COUNT) merged.push(id);
          }
        }
        data.player.slots = merged.slice(0, SLOT_COUNT);
        while (data.player.slots.length < SLOT_COUNT) data.player.slots.push(null);
      }
      // ★ 旧字段清理（已并入槽池）
      delete (data as unknown as { deployedAllies?: unknown }).deployedAllies;
      delete (data.player as { equips?: unknown }).equips;

      return data;
    } catch (e) {
      console.error('[存档] 读取失败:', e);
      return null;
    }
  },

  /**
   * 清除存档（舰船被毁 / 通关 / 手动开新局）
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[存档] 清除失败:', e);
    }
  },

  /**
   * 检查是否存在存档
   */
  hasSave(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  },

  /**
   * 获取存档大小（调试用）
   */
  getSize(): number {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? raw.length : 0;
  },
};

function countItems(grid: InventoryGrid): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== null) count++;
    }
  }
  return count;
}