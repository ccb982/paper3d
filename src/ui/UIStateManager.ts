// UI状态管理器
type UIState = 'only_backpack' | 'only_box' | 'both' | 'none';

class UIStateManager {
  private static instance: UIStateManager;
  private state: UIState = 'none';
  private currentBox: any = null;
  private listeners: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): UIStateManager {
    if (!UIStateManager.instance) {
      UIStateManager.instance = new UIStateManager();
    }
    return UIStateManager.instance;
  }

  // 打开背包
  public openBackpack(): void {
    if (this.currentBox) {
      this.state = 'both';
    } else {
      this.state = 'only_backpack';
    }
    this.notifyListeners();
  }

  // 关闭背包
  public closeBackpack(): void {
    if (this.currentBox) {
      this.state = 'only_box';
    } else {
      this.state = 'none';
    }
    this.notifyListeners();
  }

  // 打开箱子
  public openBox(box: any): void {
    this.currentBox = box;
    this.state = 'both';
    this.notifyListeners();
  }

  // 关闭箱子
  public closeBox(): void {
    this.currentBox = null;
    this.state = 'only_backpack';
    this.notifyListeners();
  }

  // 获取当前状态
  public getState(): UIState {
    return this.state;
  }

  // 获取当前箱子
  public getCurrentBox(): any {
    return this.currentBox;
  }

  // 添加监听器
  public addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  // 移除监听器
  public removeListener(listener: () => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  // 通知监听器
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const uiStateManager = UIStateManager.getInstance();