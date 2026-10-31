// ============================================================
// SaveSystem.ts —— 存档系统
// 触发时机：① 返回舰船 ② 抽卡后
// 存储介质：localStorage（Web）/ 后续可替换为 Adapter
// ============================================================

import type { GameSession, InventoryGrid } from './Session';
import { RELIC_ITEM_CONFIG } from '../config/relics';

const STORAGE_KEY = 'arknights_rogue_save';

export const SaveSystem = {
  /**
   * ★ 保存存档（仅在安全点调用）。
   *   ★ 2026-09-11 拆分职责：唯一副作用 = 刷新 `meta.lastSavedAt`（存档时间元数据）。
   *   需要"零副作用纯写入"的调用方请改用 `write()`（自行决定时间戳）。
   */
  save(session: GameSession): void {
    this.touch(session);
    this.write(session);
  },

  /** ★ 刷新存档时间戳（独立职责，不写存储；如需显式控制保存时间可单独调用） */
  touch(session: GameSession): void {
    session.meta.lastSavedAt = new Date().toISOString();
  },

  /** ★ 纯写入：不修改 session 任何字段（时间戳由调用方自行 touch） */
  write(session: GameSession): void {
    try {
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
      if (!data?.meta?.version || !data.inventories) {
        console.warn('[存档] 存档缺失必要字段，将丢弃');
        return null;
      }
      this.sanitize(data);
      return data;
    } catch (e) {
      console.error('[存档] 读取失败:', e);
      return null;
    }
  },

  /**
   * ★ 存档矫正（2026-09-17）：**遗物不该出现在背包里**。
   *   Session 里写明遗物是「永久生效、不入背包、拥有即全局生效」，
   *   但早期对话把遗物写成了 `kind:'item'` → 往背包网格塞了一个"遗物"格：
   *   既占格子，遗物列表（CharacterStatsPanel）里又看不见它。
   *
   *   这里在**读取时**把这类格子摘掉，件数**补进 outOfRun.owned**
   *   —— 只搬位置、不吞玩家已得到的东西（重复即叠加，语义不变）。
   *   幂等：修正后存档里不再有遗物格，下次读取无操作。
   */
  sanitize(session: GameSession): void {
    const grids = session.inventories as unknown as Record<string, InventoryGrid> | undefined;
    const owned = session.outOfRun?.owned;
    if (!grids || !owned) return;
    for (const layer of Object.keys(grids)) {
      const grid = grids[layer];
      if (!Array.isArray(grid)) continue;
      for (const row of grid) {
        if (!Array.isArray(row)) continue;
        for (let i = 0; i < row.length; i++) {
          const cell = row[i];
          if (!cell || !RELIC_ITEM_CONFIG[cell.itemId]) continue;
          const n = cell.stackSize || 1;
          owned[cell.itemId] = (owned[cell.itemId] ?? 0) + n;
          console.warn(
            `[存档] 背包里的遗物「${RELIC_ITEM_CONFIG[cell.itemId].name}」×${n}` +
            ` 已移出背包 → 计入遗物列表（${layer}）`,
          );
          row[i] = null;
        }
      }
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