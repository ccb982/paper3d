// ============================================================
// MiniGameTypes.ts —— 小游戏契约（框架唯一依赖的接口）
// ============================================================
// 设计目标：以后会加很多小游戏，所以契约必须**窄而稳**：
//   · 框架只认 mount / dispose 两个动作 + 一个 finish 回调；
//   · 小游戏自己管自己的动画循环（rAF / 定时器 / 事件），框架不插手玩法；
//   · 分数口径统一为 0~100，由调用方（对话/事件）按档位解释。
//
// ★ 新增一个小游戏 = 在 games/ 下新建文件 + 底部 registerMiniGame(...)，
//   框架用 import.meta.glob 自动发现，**不需要改任何索引文件**。
// ============================================================

/** 小游戏结算结果 */
export interface MiniGameResult {
  /** 分数：0~100（口径由各小游戏自定，调用方按档位解释） */
  score: number;
  /** 可选的展示用描述（如"命中 4/5"） */
  detail?: string;
}

/**
 * 宿主句柄（由框架注入给小游戏）。
 * ★ finish 与 cancel 都**只可调用一次**，框架内部已做幂等保护。
 */
export interface MiniGameHost {
  /** 正常完成：交出分数 */
  finish(score: number, detail?: string): void;
  /** 主动放弃：不结算 */
  cancel(): void;
}

/** 一个小游戏实例 */
export interface MiniGame {
  /** 唯一 id（与 registerMiniGame 的第一个参数一致） */
  readonly id: string;
  /** 面板标题 */
  readonly title: string;
  /** 面板副标题/玩法提示（可选） */
  readonly hint?: string;
  /**
   * 挂载：把 DOM 加进 root，开始自己的循环。
   * ★ 必须能在 dispose 里**完整撤销**在这里做的一切（rAF/定时器/监听）。
   */
  mount(root: HTMLElement, host: MiniGameHost): void;
  /** 卸载：清 rAF / 定时器 / 事件监听 / DOM */
  dispose(): void;
}

/** 工厂（每次开局 new 一个，避免实例间残留状态） */
export type MiniGameFactory = () => MiniGame;
