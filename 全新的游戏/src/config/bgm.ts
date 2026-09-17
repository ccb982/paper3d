// ============================================================
// bgm.ts —— 背景音乐曲目表（曲目路径的唯一真源）
// ============================================================
// 播放策略（用户定调 2026-09-17：只在船内有音乐，出击到露天就不放）：
//   基地（罗德岛号舱内）  main.enterBaseMode                     → 'base'
//   舰内舱                WorldMode.syncShipBgm（interior）        → 'ship'
//   露天（航行 sail / 下机 explore）  WorldMode.syncShipBgm         → 停
// 要换曲子 = 把文件丢进 public/music/，改下面两行路径，**核心代码零改动**。
//
// ★ 文件名含中文 → 一律先 encodeURI（与 BaseMode 的 DEPART_SFX 同一约定；
//   本地 vite dev / build 产物 / 将来的小游戏包体路径都能正确解析）。
// ★ base / ship 指向同一个文件时，切模式**不会**重头播放（见 WebAdapter.playBgm
//   的路径级去重）——所以两首暂时都填《生命流》时，基地↔出击音乐是连续的。
// ============================================================

/** BGM 域：基地 / 舰船 */
export type BgmKey = 'base' | 'ship';

/** 曲目表：key → 资源路径（要换曲子改这里） */
export const BGM_TRACKS: Record<BgmKey, string> = {
  /** 基地（罗德岛号：返回后的界面） */
  base: encodeURI('/music/生命流.mp3'),
  /** 舰船（舰内舱；航行段与下机探索都在外面 → 停播） */
  ship: encodeURI('/music/生命流.mp3'),
};
