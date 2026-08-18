// ============================================================
// GameLoop.ts —— 游戏主循环
// rAF 驱动，固定步长物理 + 可变步长渲染
// ============================================================

export type UpdateCallback = (dt: number) => void;
export type RenderCallback = () => void;

export class GameLoop {
  private running = false;
  private paused = false;
  private rafId = 0;
  private accumulator = 0;
  private lastTime = 0;

  /** 固定步长回调（物理/战斗逻辑） */
  private fixedSubs: UpdateCallback[] = [];
  /** 可变步长回调（渲染同步/特效/相机/UI） */
  private updateSubs: UpdateCallback[] = [];
  /** 渲染回调 */
  private renderSubs: RenderCallback[] = [];

  static readonly FIXED_DT = 1 / 60;
  static readonly MAX_FRAME_TIME = 0.1;
  static readonly MAX_STEPS = 5;

  onPause?: () => void;
  onResume?: () => void;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.accumulator = 0;
    this.tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(val: boolean): void {
    if (this.paused === val) return;
    this.paused = val;
    if (val) {
      this.onPause?.();
    } else {
      this.lastTime = performance.now() / 1000;
      this.accumulator = 0;
      this.onResume?.();
    }
  }

  get isPaused(): boolean { return this.paused; }

  onFixedUpdate(cb: UpdateCallback): () => void {
    this.fixedSubs.push(cb);
    return () => {
      const idx = this.fixedSubs.indexOf(cb);
      if (idx >= 0) this.fixedSubs.splice(idx, 1);
    };
  }

  onUpdate(cb: UpdateCallback): () => void {
    this.updateSubs.push(cb);
    return () => {
      const idx = this.updateSubs.indexOf(cb);
      if (idx >= 0) this.updateSubs.splice(idx, 1);
    };
  }

  onRender(cb: RenderCallback): () => void {
    this.renderSubs.push(cb);
    return () => {
      const idx = this.renderSubs.indexOf(cb);
      if (idx >= 0) this.renderSubs.splice(idx, 1);
    };
  }

  private tick = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const now = performance.now() / 1000;
    let dt = Math.min(now - this.lastTime, GameLoop.MAX_FRAME_TIME);
    this.lastTime = now;

    if (this.paused) {
      // 暂停时只跑渲染
      this.dispatchRender();
      return;
    }

    // 固定步长追赶
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= GameLoop.FIXED_DT && steps < GameLoop.MAX_STEPS) {
      this.dispatchFixed(GameLoop.FIXED_DT);
      this.accumulator -= GameLoop.FIXED_DT;
      steps++;
    }
    if (steps >= GameLoop.MAX_STEPS) {
      this.accumulator = 0; // 防死亡螺旋
    }

    // 可变步长
    this.dispatchUpdate(dt);
    this.dispatchRender();
  };

  private dispatchFixed(dt: number): void {
    for (const cb of this.fixedSubs) cb(dt);
  }

  private dispatchUpdate(dt: number): void {
    for (const cb of this.updateSubs) cb(dt);
  }

  private dispatchRender(): void {
    for (const cb of this.renderSubs) cb();
  }
}