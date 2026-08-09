import type { PlatformAdapter, TouchEvent } from './PlatformAdapter';

// ============================================================
// WebAdapter —— 浏览器实现（开发默认）
// ============================================================

export class WebAdapter implements PlatformAdapter {
  private bgmAudio: HTMLAudioElement | null = null;

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
      if (!this.bgmAudio) {
        this.bgmAudio = new Audio();
        this.bgmAudio.loop = true;
      }
      this.bgmAudio.src = src;
      this.bgmAudio.play().catch(() => {});
    },
    stopBgm: () => {
      this.bgmAudio?.pause();
    },
    playSfx: (src: string) => {
      const a = new Audio(src);
      a.play().catch(() => {});
    },
  };

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
