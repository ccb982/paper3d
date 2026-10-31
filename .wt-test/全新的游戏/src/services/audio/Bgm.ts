// ============================================================
// Bgm.ts —— 背景音乐播放器（模式级切曲）
// ============================================================
// 调用方：main.ts 的模式切换函数（enterBaseMode / enterWorldMode）。
// 平台无关：一律走 getPlatformAdapter().audio，不直接 new Audio
//   （适配器未注入 = 验收页/单测场景 → 静默返回，不抛错中断流程）。
//
// 去重分两层（缺一层就会「切模式音乐重头开始」）：
//   ① 本模块 currentKey  —— 同一个 key 重复调用直接返回；
//   ② WebAdapter 路径级去重 —— base/ship 指向同一个文件时不重设 src。
//
// 音量淡入/淡出由**适配器**负责（WebAdapter：700ms 线性；切曲 = 旧轨淡出 + 新轨淡入，
// 停止 = 淡出到 0 再 pause）—— 本模块只关心「该放哪一首」，不碰音量。
// ============================================================

import { getPlatformAdapter } from '../../platform';
import { BGM_TRACKS, type BgmKey } from '../../config/bgm';

/** 当前生效曲目（null = 未播/已停） */
let currentKey: BgmKey | null = null;

/**
 * 切到指定曲目。
 * ★ 同曲重复调用 = 空操作：基地 ↔ 出击来回切时音乐连续，不会从头开始。
 */
export function playBgm(key: BgmKey): void {
  const adapter = getPlatformAdapter();
  if (!adapter) return;
  if (currentKey === key) return;
  currentKey = key;
  adapter.audio.playBgm(BGM_TRACKS[key]);
}

/** 停播（当前无调用方；将来出现「无音乐场景」（如标题页）时用） */
export function stopBgm(): void {
  if (currentKey === null) return;
  currentKey = null;
  getPlatformAdapter()?.audio.stopBgm();
}

/** 当前曲目（调试用） */
export function currentBgmKey(): BgmKey | null {
  return currentKey;
}
