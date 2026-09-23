// ============================================================
// Sfx.ts —— 短音效播放器（随机变体 + 同 id 节流）
// ============================================================
// 调用方：WorldMode（脚步 / 涉水 / 拨草 / 击草）。
// 平台无关：一律走 getPlatformAdapter().audio.playSfx（未注入适配器 = 静默，
//   验收页/单测不会因为缺平台能力而抛错）。
//
// ★ 为什么必须节流：脚步/草丛这类触发点在 update 里，多颗子弹同一帧扫到同一片
//   草会一帧响十几次。minGapMs 是「同一 id 两次发声的最小间隔」，默认 90ms。
// ============================================================

import { getPlatformAdapter } from '../../platform';
import { SFX, type SfxId, LOOP_SFX, type LoopSfxId } from '../../config/sfx';

/** 每个 id 上次发声时间（performance.now） */
const lastAt = new Map<SfxId, number>();

/**
 * 播一个短音效。
 * @param id      曲目 id（见 config/sfx.ts）
 * @param minGapMs 同 id 最小间隔（毫秒；0 = 不节流）
 * @param rate    播放速率（1 = 原速；<1 慢放并降调）。★ 慢放会拉长时长，
 *                minGapMs 要跟着放大，否则多个实例叠着响 = 一片糊声。
 * @returns 本次是否真的发声（被节流掉 = false）
 */
export function playSfx(id: SfxId, minGapMs = 90, rate?: number): boolean {
  const adapter = getPlatformAdapter();
  if (!adapter) return false;
  const now = performance.now();
  if (now - (lastAt.get(id) ?? -1e9) < minGapMs) return false;
  const list = SFX[id];
  const src = list.length === 1 ? list[0] : list[(Math.random() * list.length) | 0];
  lastAt.set(id, now);
  adapter.audio.playSfx(src, rate);
  return true;
}

/** 清空节流记录（换局/退模式时用） */
export function resetSfxThrottle(): void {
  lastAt.clear();
}

// ============================================================
// ★ 循环音效（独立通道，与 BGM 同时响）
// ============================================================
// 用途：引擎轰鸣这类"要一直响、但属于音效"的。
// 不放进 playSfx：那是一次性通道（每次 new Audio），拿它循环会一帧叠一个实例。

/**
 * 起一条循环音效（同 id 重复调用 = 幂等，不会重头播）。
 * ★ 多条可同时响（按 src 分轨），引擎与涉水互不顶掉。
 * @param id 见 config/sfx.ts 的 LOOP_SFX
 * @param opts.rate 播放速率（<1 慢放并降调）；opts.volume 该轨目标音量
 */
export function playLoopSfx(id: LoopSfxId, opts?: { rate?: number; volume?: number }): void {
  const adapter = getPlatformAdapter();
  if (!adapter) return;
  adapter.audio.playLoopSfx(LOOP_SFX[id], opts);
}

/**
 * 停掉循环音效（淡出后暂停）；没在播 = 无操作。
 * @param id 不传 = 停掉所有循环轨（退模式 / 回基地用）
 */
export function stopLoopSfx(id?: LoopSfxId): void {
  const adapter = getPlatformAdapter();
  if (!adapter) return;
  adapter.audio.stopLoopSfx(id ? LOOP_SFX[id] : undefined);
}
