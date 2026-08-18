// ============================================================
// SaveSystem.ts —— 存档系统
// 触发时机：① 返回舰船 ② 抽卡后
// 存储介质：localStorage（Web）/ 后续可替换为 Adapter
// ============================================================

import type { GameSession, InventoryGrid } from './Session';

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
      console.log(`[存档] 第 ${session.meta.day} 天已保存至舰船`);
      console.log(`[存档] 背包: 基地 ${countItems(session.inventories.base)} 件, 飞船 ${countItems(session.inventories.ship)} 件, 玩家 ${countItems(session.inventories.player)} 件`);
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
      if (!raw) {
        console.log('[存档] 未找到存档，将开始新游戏');
        return null;
      }
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
      console.log(`[存档] 读取成功，第 ${data.meta.day} 天`);
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
      console.log('[存档] 存档已清除');
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