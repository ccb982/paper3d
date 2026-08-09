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

  /** 音频统一入口 */
  audio: {
    playBgm(src: string): void;
    stopBgm(): void;
    playSfx(src: string): void;
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
