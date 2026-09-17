// ============================================================
// index.ts —— 小游戏模块入口（对外只暴露 startMiniGame / 状态查询）
// ============================================================
// ★★ 加小游戏的正确姿势（2026-09-17 定）：
//   1. 在 games/ 下新建 `XxxGame.ts`；
//   2. 实现 MiniGame 接口（mount / dispose）；
//   3. 文件底部 `registerMiniGame('xxx', () => new XxxGame())`。
//   —— 完事。**不用改本文件**：下面的 import.meta.glob 会自动 import
//      games/ 下所有文件，副作用即注册。
//
// 调用方（对话/事件）只需要：
//   startMiniGame('alignment_trial', { onFinish: (r) => ...按 r.score 分档... })
// ============================================================

import { MiniGameOverlay } from './MiniGameOverlay';
import { createMiniGame, hasMiniGame, listMiniGames } from './registry';
import type { MiniGameResult } from './MiniGameTypes';

export type { MiniGame, MiniGameHost, MiniGameResult } from './MiniGameTypes';
export { registerMiniGame, hasMiniGame, listMiniGames } from './registry';

// ★ 自动发现并注册 games/ 下的所有小游戏（eager = 构建期静态展开）
const gameModules = import.meta.glob('./games/*.ts', { eager: true });
void gameModules; // 只为副作用（各模块底部自注册）；保留引用避免被摇树删掉

export interface StartMiniGameOptions {
  /** 正常结算 */
  onFinish: (result: MiniGameResult) => void;
  /** 主动放弃（点返回 / ESC）；不传则放弃等同于 finish(0) */
  onCancel?: () => void;
}

/** 同一时刻只允许一个小游戏 */
let current: MiniGameOverlay | null = null;

/** 是否有小游戏在跑（模式层据此锁输入） */
export function isMiniGameRunning(): boolean {
  return current !== null;
}

/**
 * 开一局小游戏。
 * @returns 是否成功开局（id 未登记 / 已有小游戏在跑 = false）
 */
export function startMiniGame(id: string, opts: StartMiniGameOptions): boolean {
  if (current) {
    console.warn('[小游戏] 已有小游戏在跑，忽略：', id);
    return false;
  }
  if (!hasMiniGame(id)) {
    console.warn('[小游戏] 未登记：', id, '（已登记：', listMiniGames(), '）');
    return false;
  }
  const game = createMiniGame(id);
  if (!game) return false;

  const overlay = new MiniGameOverlay({
    game,
    onFinish: (r) => {
      current = null;
      opts.onFinish(r);
    },
    onCancel: () => {
      current = null;
      if (opts.onCancel) opts.onCancel();
      else opts.onFinish({ score: 0, detail: '放弃' });
    },
  });
  current = overlay;
  overlay.mount();
  return true;
}

/** ★ 强制关闭（模式退出 / 换场景）：不触发任何回调 */
export function closeMiniGame(): void {
  current?.forceClose();
  current = null;
}
