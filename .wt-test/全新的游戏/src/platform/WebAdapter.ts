import type { PlatformAdapter, TouchEvent } from './PlatformAdapter';

// ============================================================
// WebAdapter —— 浏览器实现（开发默认）
// ============================================================

/** ★ BGM 淡入/淡出时长（ms）：切入淡入、离场/切曲淡出（2026-09-17 用户定调） */
const BGM_FADE_MS = 700;
/** ★ BGM 目标音量（淡入终点） */
const BGM_VOLUME = 1;
/** ★ 循环音效通道目标音量（引擎轰鸣：要听得见但不能盖过音乐/音效） */
const LOOP_SFX_VOLUME = 0.55;
/**
 * ★ 循环轨淡入/淡出时长（ms）：比 BGM 的 700ms 短得多。
 *   原因：循环轨跟的是**秒级动作**（在水里游一下就出来了），
 *   700ms 淡入会造成"起来了又停了，等于没声"。
 */
const LOOP_FADE_MS = 220;

/**
 * ★ 循环音效通道元素句柄（独立于 bgmAudio 的第二条常驻音轨）。
 *   存在意义：引擎轰鸣是"音效"不是"音乐"，且必须和 BGM 同时响——
 *   共用 BGM 通道会导致二选一互相顶掉。
 */
interface LoopTrack {
  el: HTMLAudioElement;
  src: string;
  /**
   * ★ 该轨**已下达**的淡入目标音量（2026-09-18 修）：
   *   调用方可能每帧调 playLoopSfx（涉水轨就是这样），若不看目标就每次 fadeTo，
   *   fadeTo 会 clearInterval 上一个、从当前音量重新起一段淡入 → 淡入被无限打断，
   *   音量指数逼近、1.5~2s 才升到目标，短促涉水时等于没声。
   *   记下目标后，只有目标真的变了才重新淡。
   */
  target: number;
}

export class WebAdapter implements PlatformAdapter {
  private bgmAudio: HTMLAudioElement | null = null;
  /** ★ 当前 BGM 资源路径（路径级去重：base/ship 指向同一文件时切模式不重头播放） */
  private bgmSrc = '';
  /** ★ 被浏览器自动播放策略拦下的曲目：首次用户手势后补播 */
  private bgmPending: string | null = null;
  /** 一次性补播监听是否已挂（防重复挂） */
  private autoplayArmed = false;
  /** ★ 每条约上正在跑的淡化计时器（元素 → interval id）：切断淡化时按元素清理 */
  private bgmFades = new Map<HTMLAudioElement, number>();
  /**
   * ★ 循环音效通道（引擎轰鸣 / 涉水声等）：**按 src 分轨 → 多条可同时响**
   *   （2026-09-18：涉水轨要在引擎轨之外独立存在，两者不互相顶掉）。
   */
  private loopTracks = new Map<string, LoopTrack>();

  createCanvas(): HTMLCanvasElement {
    return document.createElement('canvas');
  }

  async loadAsset(path: string): Promise<ArrayBuffer> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`加载资源失败: ${path} (${res.status})`);
    return res.arrayBuffer();
  }

  storage = {
    get: (key: string) => localStorage.getItem(key),
    set: (key: string, value: string) => localStorage.setItem(key, value),
    remove: (key: string) => localStorage.removeItem(key),
  };

  audio = {
    playBgm: (src: string) => {
      const cur = this.bgmAudio;
      // ---- ① 同一首曲子（同一路径）：不换元素、不重设 src，音乐连续 ----
      if (cur && this.bgmSrc === src) {
        this.bgmPending = src;
        if (cur.paused) {
          // 暂停中（刚淡出过）→ 从暂停处续播并淡入
          cur.volume = 0;
          cur.play()
            .then(() => { this.bgmPending = null; this.fadeIn(cur); })
            .catch(() => { this.armAutoplayRetry(); });
        } else if (cur.volume < BGM_VOLUME) {
          // 正在淡出 → 拉回来淡入（打断淡出，别让音量一路掉到 0）
          this.fadeIn(cur);
        }
        return;
      }
      // ---- ② 换曲：旧轨淡出（不阻塞），新轨淡入 ----
      if (cur) this.fadeOut(cur);
      const el = new Audio();
      el.loop = true;
      el.volume = 0;
      this.bgmAudio = el;
      this.bgmSrc = src;
      this.bgmPending = src;
      el.src = src;
      el.play()
        .then(() => { this.bgmPending = null; this.fadeIn(el); })
        .catch(() => { this.armAutoplayRetry(); });
    },
    stopBgm: () => {
      this.bgmPending = null;   // 淡出之后不要再被手势补播
      const el = this.bgmAudio;
      if (el && !el.paused) this.fadeOut(el);
    },
    playSfx: (src: string, rate?: number) => {
      const a = new Audio(src);
      // ★ 慢放：水里涉水声降速 + 降调（更黏滞）；必须在 play 之前设，否则首帧仍是原速
      if (rate && rate > 0) a.playbackRate = rate;
      a.play().catch(() => {});
    },
    playLoopSfx: (src: string, opts?: { rate?: number; volume?: number }) => {
      const vol = opts?.volume ?? LOOP_SFX_VOLUME;
      const rate = opts?.rate ?? 1;
      const cur = this.loopTracks.get(src);
      // ① 同一条已在册：不重设 src（避免重头播），暂停中就续播 + 淡入
      if (cur) {
        if (cur.el.paused) {
          cur.el.volume = 0;
          cur.el.play()
            .then(() => this.fadeTo(cur.el, vol, null, LOOP_FADE_MS))
            .catch(() => {});
          cur.target = vol;
        } else if (Math.abs(cur.target - vol) > 0.001) {
          cur.target = vol;
          this.fadeTo(cur.el, vol, null, LOOP_FADE_MS);   // 目标变了才重新淡
        }
        // ★ 慢放比例即时生效（同一条循环轨换速率不必重建元素）
        if (cur.el.playbackRate !== rate) cur.el.playbackRate = rate;
        return;
      }
      // ② 首次起轨（不再顶掉别的轨：引擎与涉水可同时响）
      const el = new Audio();
      el.loop = true;
      el.volume = 0;
      el.playbackRate = rate;   // ★ 必须在 play 之前设
      el.src = src;
      this.loopTracks.set(src, { el, src, target: vol });
      el.play()
        .then(() => this.fadeTo(el, vol, null, LOOP_FADE_MS))
        .catch(() => { /* 自动播放被拦：等下一次调用或用户手势再补 */ });
    },
    stopLoopSfx: (src?: string) => {
      if (src) {
        const cur = this.loopTracks.get(src);
        if (!cur) return;
        this.loopTracks.delete(src);   // 先解绑，淡出期间再调 play 会新建元素
        this.fadeTo(cur.el, 0, () => { cur.el.pause(); }, LOOP_FADE_MS);
        return;
      }
      // 全停（退模式 / 回基地）
      for (const cur of this.loopTracks.values()) {
        this.fadeTo(cur.el, 0, () => { cur.el.pause(); }, LOOP_FADE_MS);
      }
      this.loopTracks.clear();
    },
  };

  // ============================================================
  // ★ BGM 音量淡化（2026-09-17 用户定调：音乐开始播放用淡入淡出）
  // ============================================================

  /** 淡入到目标音量（同元素上正在跑的淡化会被打断） */
  private fadeIn(el: HTMLAudioElement): void {
    this.fadeTo(el, BGM_VOLUME, null);
  }

  /** 淡出到 0 后暂停该音轨 */
  private fadeOut(el: HTMLAudioElement): void {
    this.fadeTo(el, 0, () => el.pause());
  }

  /**
   * 单条音轨音量线性渐变到目标值（默认 BGM_FADE_MS 完成；循环轨传 LOOP_FADE_MS
   * —— 游动是秒级动作，700ms 淡入等于"来不及响"）。
   * 用 setInterval 而非 rAF：切后台时 rAF 停摆，音量会卡在半途。
   */
  private fadeTo(
    el: HTMLAudioElement,
    to: number,
    onDone: (() => void) | null,
    ms: number = BGM_FADE_MS,
  ): void {
    const prev = this.bgmFades.get(el);
    if (prev !== undefined) {
      window.clearInterval(prev);
      this.bgmFades.delete(el);
    }
    const from = el.volume;
    if (Math.abs(to - from) < 0.001) {   // 已在目标音量：不空转
      if (onDone) onDone();
      return;
    }
    const t0 = Date.now();
    const timer = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      el.volume = from + (to - from) * k;
      if (k >= 1) {
        window.clearInterval(timer);
        this.bgmFades.delete(el);
        if (onDone) onDone();
      }
    }, 16);
    this.bgmFades.set(el, timer);
  }

  /**
   * ★ 自动播放被浏览器拦下（进页面还没有用户手势）→ 首次 pointerdown / keydown
   *   补播一次。只挂一次，补播成功或再次失败都卸载监听。
   */
  private armAutoplayRetry(): void {
    if (this.autoplayArmed) return;
    this.autoplayArmed = true;
    const retry = () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
      this.autoplayArmed = false;
      const el = this.bgmAudio;
      const src = this.bgmPending;
      if (!el || !src) return;
      if (this.bgmSrc !== src) { this.bgmSrc = src; el.src = src; }
      el.volume = 0;   // 补播同样淡入（不突兀）
      el.play()
        .then(() => { this.bgmPending = null; this.fadeIn(el); })
        .catch(() => {});
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
  }

  onTouch(handler: (e: TouchEvent) => void): void {
    const toTouch = (clientX: number, clientY: number) => ({ x: clientX, y: clientY });
    window.addEventListener('pointerdown', (ev) => {
      handler({ type: 'start', touches: [toTouch(ev.clientX, ev.clientY)] });
    });
    window.addEventListener('pointermove', (ev) => {
      handler({ type: 'move', touches: [toTouch(ev.clientX, ev.clientY)] });
    });
    window.addEventListener('pointerup', (ev) => {
      handler({ type: 'end', touches: [toTouch(ev.clientX, ev.clientY)] });
    });
  }

  onHide(handler: () => void): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handler();
    });
  }

  onShow(handler: () => void): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) handler();
    });
  }

  info = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  };
}
