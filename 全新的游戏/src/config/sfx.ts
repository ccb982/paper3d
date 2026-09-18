// ============================================================
// sfx.ts —— 环境音效表（路径唯一真源）
// ============================================================
// 素材：public/sfx/*.mp3（64kbps 单声道，单条 5~12KB；全部来自 Mixkit
//   —— Mixkit Free License：免费商用、无需署名，来源与原始文件名见
//   public/sfx/来源.txt）。中文文件名一律 encodeURI（与 music 同一约定）。
//
// 玩法映射（接线点都在 WorldMode）：
//   stepGrass / stepStone / stepDirt —— 地上走动，按脚下地块 + 附近植被选
//   waterEnter / waterWade           —— 入水瞬间 / 水中移动节拍（复用水面泛波节拍）
//   grassBrush                       —— 玩家穿过草丛
//   grassHit                         —— 子弹/攻击打中草丛
//
// 要换音 = 丢文件进 public/sfx/ 改下表一行；要加变体 = 数组里多写一条（随机取）。
// ============================================================

/** 音效 id → 候选资源（多个 = 随机变体，避免重复听腻） */
export const SFX = {
  /** 脚步：草地（单步两版交替） */
  stepGrass: [encodeURI('/sfx/脚步草.mp3'), encodeURI('/sfx/脚步草重.mp3')],
  /** 脚步：硬地（高台 / 石面） */
  stepStone: [encodeURI('/sfx/脚步石.mp3')],
  /** 脚步：土地 / 泥地 */
  stepDirt: [encodeURI('/sfx/脚步土.mp3'), encodeURI('/sfx/踩水坑.mp3')],
  /** 入水（一次，走进/落入水面） */
  waterEnter: [encodeURI('/sfx/入水.mp3')],
  /** 拨草（走过草丛的沙沙声） */
  grassBrush: [encodeURI('/sfx/拨草.mp3'), encodeURI('/sfx/落叶沙沙.mp3')],
  /** 击中草丛（★ 「割草」版已按用户要求移除，不要再把它加回来） */
  grassHit: [encodeURI('/sfx/击草.mp3')],
  /** 子弹/攻击打中地面（泥土 / 硬地；打在水里改响 bulletWater） */
  bulletGround: [encodeURI('/sfx/击中地面.mp3'), encodeURI('/sfx/击中地面2.mp3')],
  /** ★ 子弹打在水面上（短促水花；从 入水.mp3 的入水瞬态裁出，提速+提频） */
  bulletWater: [encodeURI('/sfx/击中水面.mp3')],
  /** ★ 激光发射（祖宗远程 / 无人机挥击 / 祖宗挖矿 共用；两条随机变体） */
  laserFire: [encodeURI('/sfx/激光发射.mp3'), encodeURI('/sfx/激光发射2.mp3')],
  /** ★ 舰船触地（重击 + 低频增强；1.55s） */
  shipLand: [encodeURI('/sfx/舰船着陆.mp3')],
} as const;

export type SfxId = keyof typeof SFX;

/**
 * ★ 循环音效表（走**独立通道**，和 BGM 同时响；见 WebAdapter.playLoopSfx）
 *   只放"要一直响、但属于音效不属于音乐"的（引擎轰鸣等）。
 *   每条素材必须做过**无缝循环**处理，否则 loop 接缝会有咔哒。
 */
export const LOOP_SFX = {
  /** 舰船航行期引擎轰鸣（10s 无缝循环，48kbps 单声道 59KB） */
  shipEngine: encodeURI('/sfx/飞行引擎.mp3'),
  /**
   * ★ 水中持续游动（0.64s 无缝循环，64kbps 单声道 5.5KB）。
   *   选段来源 = **「入水.mp3」的 0.45~1.25s 持续尾段**（平坦的水流余韵，
   *   40ms 窗 RMS -18~-23dB、起伏 6.5dB），不是「涉水.mp3」——后者是"哗"的一声瞬态，
   *   crest 15dB、平均只有 -22dB，循环起来听着就是"一下一下"。
   *   加工：主体 atrim 0:0.64 + 尾 0.16s 淡出 → amix 叠回开头（否则 loop 接缝咔哒）
   *   + 归一到 -1.5dBFS。★ 播放速率由调用方每次入水随机（慢放降调）。
   */
  waterSwim: encodeURI('/sfx/涉水_loop.mp3'),
} as const;

export type LoopSfxId = keyof typeof LOOP_SFX;
