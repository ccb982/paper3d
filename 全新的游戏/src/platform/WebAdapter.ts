import type { PlatformAdapter, TouchEvent } from './PlatformAdapter';

// ============================================================
// WebAdapter —— 浏览器实现（开发默认）
// ============================================================

/** ★ BGM 淡入/淡出时长（ms）：切入淡入、离场/切曲淡出（2026-09-17 用户定调） */
const BGM_FADE_MS = 700;
/** ★ BGM 目标音量（淡入终点） */
const BGM_VOLUME = 1;

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
    playSfx: (src: string) => {
      const a = new Audio(src);
      a.play().catch(() => {});
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
   * 单条音轨音量线性渐变到目标值（约 BGM_FADE_MS 完成）。
   * 用 setInterval 而非 rAF：切后台时 rAF 停摆，音量会卡在半途。
   */
  private fadeTo(el: HTMLAudioElement, to: number, onDone: (() => void) | null): void {
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
      const k = Math.min(1, (Date.now() - t0) / BGM_FADE_MS);
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
