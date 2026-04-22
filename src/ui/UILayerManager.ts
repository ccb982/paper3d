// 全局UI层级管理器
class UILayerManager {
  private static instance: UILayerManager;
  private activeUI: 'backpack' | 'box' | null = null;
  private listeners: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): UILayerManager {
    if (!UILayerManager.instance) {
      UILayerManager.instance = new UILayerManager();
    }
    return UILayerManager.instance;
  }

  public setActiveUI(ui: 'backpack' | 'box'): void {
    this.activeUI = ui;
    this.notifyListeners();
  }

  public getActiveUI(): 'backpack' | 'box' | null {
    return this.activeUI;
  }

  public addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  public removeListener(listener: () => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const uiLayerManager = UILayerManager.getInstance();