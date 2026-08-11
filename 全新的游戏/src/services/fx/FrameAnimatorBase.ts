// ============================================================
// FrameAnimatorBase —— 动画管线基类（共用最基础版本）
// ============================================================
// 职责（语义层 + 时间层）：
//   - 播放指定帧序列（playFrames：帧名列表 → resolver → controller）
//   - 每帧推进时间轴（controller.advance）→ 写 FrameState.frameIndex
//   - 朝向 / 翻转状态（FrameState.facing / flipX，由输入层派生后调用）
//   - LOD 控制（lodLevel → 帧率节流 / 暂停时间轴，接口 P7 启用）
//   - 单次动画播完回调（子类用于"回 idle"闭环）
//
// 子类扩展点：
//   - 角色动画：状态机（idle/walk/attack）+ 朝向帧组选择（anims.json）
//   - 特效播放：loopMode（循环/一次/受击触发）
// 基类不关心"状态语义"，只做最通用的帧序列播放。

import type { FrameAssetSource } from './AssetSource';
import type { FrameState } from './FrameState';
import { createFrameState } from './FrameState';
import type { FramePlaybackController } from '../../vendor/player/core/controller';

export interface PlayFramesOptions {
  /** 是否循环（默认 true） */
  loop?: boolean;
  /** 基础帧率（默认 3） */
  fps?: number;
  /** 播放顺序（默认 loop 或 linear，随 loop 决定） */
  order?: 'loop' | 'linear' | 'reverse' | 'pingpong';
}

export class FrameAnimatorBase {
  readonly source: FrameAssetSource;
  /** 衔接层状态（渲染管线只读此对象） */
  readonly state: FrameState;

  protected controller: FramePlaybackController;
  private _curNames: string[] = [];
  private _curIdxs: number[] = [];
  private _loop = true;
  private _baseFps = 3;
  private _lod1Tick = 0;
  /** 单次动画播完回调（子类设置：回 idle） */
  onAnimationComplete: (() => void) | null = null;

  constructor(source: FrameAssetSource, initial?: Partial<FrameState>) {
    this.source = source;
    this.state = createFrameState(initial);
    this.controller = source.createController({ fps: this._baseFps, order: 'loop' });
    this.controller.callbacks.onComplete = () => {
      if (!this._loop) {
        // 单次播完：停在序列最后一帧（time.ts done 时指向资产末帧）
        this.controller.goto(this._curIdxs[this._curIdxs.length - 1]);
        this.onAnimationComplete?.();
      }
    };
    this.controller.callbacks.onFrameChange = (idx) => {
      this.state.frameIndex = idx;
    };
  }

  // ============ 播放控制（帧序列级） ============

  /** 播放帧序列（子类状态机/外部最终调用） */
  playFrames(names: string[], opts: PlayFramesOptions = {}): void {
    if (names.length === 0) return;
    this._curNames = names.slice();
    this._loop = opts.loop ?? true;
    this._baseFps = opts.fps ?? 3;
    // 帧名 → 索引序列（time.ts 原生支持 sequence 顺序，循环只在序列内）
    const frameIdxs: number[] = [];
    for (const name of names) {
      const idx = this.source.resolveFrame(name);
      if (idx !== null) frameIdxs.push(idx);
    }
    if (frameIdxs.length === 0) {
      console.warn(`[FrameAnimator] 帧序列 "${names.join(',')}" 均不存在于资产`);
      return;
    }
    this._curIdxs = frameIdxs.slice();
    this.controller.reset({
      fps: this._baseFps,
      order: { type: 'sequence', frames: frameIdxs },
      loop: this._loop,
    });
    this.controller.goto(frameIdxs[0]);
    this.controller.play();
  }

  /** 按名字单帧跳转（保持当前播放状态） */
  goto(name: string): boolean {
    const idx = this.source.resolveFrame(name);
    if (idx === null) return false;
    this.controller.goto(idx);
    return true;
  }

  play(): void { this.controller.play(); }
  pause(): void { this.controller.pause(); }
  stop(): void { this.controller.stop(); }

  /** 冻结当前帧（时间轴暂停，画面保持） */
  hold(): void { this.controller.hold(); }
  release(): void { this.controller.release(); }

  // ============ 朝向 / 翻转（输入层派生后调用，控制解耦） ============

  /** 设置朝向（帧组前缀，如 "前"/"后"） */
  setFacing(facing: string): void {
    this.state.facing = facing;
  }

  /** 左右反转（★ 状态延续：动画切换不重置，只由新输入方向修改） */
  setFlipX(flip: boolean): void {
    this.state.flipX = flip;
  }

  /** 上下反转（预留） */
  setFlipY(flip: boolean): void {
    this.state.flipY = flip;
  }

  // ============ LOD（P7 启用完整逻辑，接口现在可用） ============

  /** 渲染侧下发 LOD 等级（0=全帧 1=减帧 2=单帧） */
  setLodLevel(level: number): void {
    this.state.lodLevel = Math.max(0, Math.min(2, Math.floor(level)));
    this._lod1Tick = 0;
  }

  // ============ 每帧推进 ============

  update(dt: number): void {
    // LOD 2：时间轴暂停（保持当前帧画面）
    if (this.state.lodLevel >= 2) {
      this.state.frameIndex = this.controller.frameIndex;
      return;
    }
    // LOD 1：帧率减半（advance 节流，不 reset 时间轴）
    if (this.state.lodLevel === 1) {
      this._lod1Tick = (this._lod1Tick + 1) % 2;
      if (this._lod1Tick !== 0) {
        this.state.frameIndex = this.controller.frameIndex;
        return;
      }
    }
    this.controller.advance(dt);
    // frameIndex 已由 onFrameChange 回调同步（hold/暂停时同步一次）
    this.state.frameIndex = this.controller.frameIndex;
  }

  get frameIndex(): number {
    return this.controller.frameIndex;
  }

  get isPlaying(): boolean {
    return this.controller.state === 'playing';
  }

  dispose(): void {
    this.controller.dispose();
    this.onAnimationComplete = null;
  }
}
