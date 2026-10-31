// ============================================================
// PlatformAdapter —— 平台抽象接口（唯一碰平台 API 的地方）
// 游戏核心绝不 import wx./tt./window，只依赖本接口。
// ============================================================

export interface TouchPoint {
  x: number;
  y: number;
}

export interface TouchEvent {
  type: 'start' | 'move' | 'end';
  touches: TouchPoint[];
}

export interface PlatformAdapter {
  /** 创建画布（第一个 = 主渲染 canvas，后续 = 离屏 canvas） */
  createCanvas(): HTMLCanvasElement;

  /** 加载资源（包内/远程，返回 ArrayBuffer） */
  loadAsset(path: string): Promise<ArrayBuffer>;

  /** 本地存储（存档/设置，key-value） */
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };

  /** 音频统一入口（BGM 由实现方负责淡入淡出，业务层只管"放哪一首"） */
  audio: {
    playBgm(src: string): void;
    stopBgm(): void;
    /**
     * 短音效（一次性通道：每次 new 一个元素）。
     * @param rate 播放速率（1 = 原速；<1 慢放并降调，用于水里这种"黏滞"的场景）。
     *   微信侧对应 InnerAudioContext.playbackRate，语义一致。
     */
    playSfx(src: string, rate?: number): void;
    /**
     * ★ 循环音效通道（与 BGM 通道**互相独立**、可同时响）：
     *   - 按 src 分轨 → **多条可同时响**（引擎 + 涉水各占一条，不互相顶掉）
     *   - `opts.rate` 播放速率（<1 慢放并降调；慢放不改变循环性）
     *   - `opts.volume` 该轨目标音量（不传 = 默认 LOOP_SFX_VOLUME）
     *   - `stopLoopSfx(src?)`：不给 src = 全停
     *   引擎轰鸣这类"要一直响、但属于音效不属于音乐"的走这里，
     *   否则会跟 BGM 抢同一个元素（换 BGM 时把引擎顶掉 / 反之）。
     */
    playLoopSfx(src: string, opts?: { rate?: number; volume?: number }): void;
    /** @param src 不传 = 停掉所有循环轨 */
    stopLoopSfx(src?: string): void;
  };

  /** 触摸/鼠标事件（映射为抽象触摸事件） */
  onTouch(handler: (e: TouchEvent) => void): void;

  /** 生命周期回调（切后台/回前台） */
  onHide(handler: () => void): void;
  onShow(handler: () => void): void;

  /** 平台信息 */
  info: {
    width: number;
    height: number;
    dpr: number;
  };
}
