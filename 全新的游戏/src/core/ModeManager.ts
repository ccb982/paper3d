// ============================================================
// ModeManager.ts —— 模式状态机
// 管理 BOOT/SHIP/WORLD/BOSS/RESULT 模式切换
// ============================================================

export type ModeId = 'boot' | 'ship' | 'world' | 'boss' | 'result';

export interface ModeContext {
  dt: number;
}

export interface Mode {
  readonly id: ModeId;
  onEnter(ctx?: any): void;
  onExit(): void;
  update(dt: number): void;
  render(): void;
}

export class ModeManager {
  private modes = new Map<ModeId, Mode>();
  private current: Mode | null = null;
  private previousId: ModeId | null = null;

  /** 注册模式实例 */
  register(mode: Mode): void {
    this.modes.set(mode.id, mode);
  }

  /** 切换到指定模式 */
  switchMode(id: ModeId, context?: any): void {
    const next = this.modes.get(id);
    if (!next) {
      console.error(`[ModeManager] 模式 ${id} 未注册`);
      return;
    }
    if (this.current) {
      this.previousId = this.current.id;
      console.log(`[ModeManager] 退出模式: ${this.current.id}`);
      this.current.onExit();
    }
    this.current = next;
    console.log(`[ModeManager] 进入模式: ${id}`);
    this.current.onEnter(context);
  }

  /** 获取当前模式 */
  getCurrent(): Mode | null {
    return this.current;
  }

  /** 获取当前模式 ID */
  getCurrentId(): ModeId | null {
    return this.current?.id ?? null;
  }

  /** 获取上一个模式 ID */
  getPreviousId(): ModeId | null {
    return this.previousId;
  }

  /** 更新当前模式 */
  update(dt: number): void {
    this.current?.update(dt);
  }

  /** 渲染当前模式 */
  render(): void {
    this.current?.render();
  }

  /** 清理所有模式 */
  clear(): void {
    if (this.current) {
      this.current.onExit();
      this.current = null;
    }
    this.modes.clear();
    this.previousId = null;
  }
}