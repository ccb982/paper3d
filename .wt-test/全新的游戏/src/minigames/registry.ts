// ============================================================
// registry.ts —— 小游戏注册表
// ============================================================
// ★ 小游戏**自己注册自己**（在各自文件底部调 registerMiniGame），
//   index.ts 用 import.meta.glob 自动 import games/ 下所有文件 →
//   加新游戏 = 丢一个文件进 games/，**零索引改动**。
// ============================================================

import type { MiniGame, MiniGameFactory } from './MiniGameTypes';

const registry = new Map<string, MiniGameFactory>();

/** 注册一个小游戏（同名重复注册会告警并忽略后者） */
export function registerMiniGame(id: string, factory: MiniGameFactory): void {
  if (registry.has(id)) {
    console.warn(`[小游戏] 重复注册：${id}（已忽略）`);
    return;
  }
  registry.set(id, factory);
}

/** 是否登记过 */
export function hasMiniGame(id: string): boolean {
  return registry.has(id);
}

/** 造一个新实例（未登记 = null） */
export function createMiniGame(id: string): MiniGame | null {
  const f = registry.get(id);
  return f ? f() : null;
}

/** 已登记的全部 id（调试用） */
export function listMiniGames(): string[] {
  return [...registry.keys()];
}
