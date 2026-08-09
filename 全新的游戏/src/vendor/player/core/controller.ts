import {
  type TimeState,
  type PlaybackOrder,
  type ControllerState,
  type PlaybackConfig,
  createTimeState,
  advance as advanceState,
  goto as gotoState,
  gotoTime as gotoTimeState,
  stepForward as stepForwardState,
  stepBackward as stepBackwardState,
  hold as holdState,
  release as releaseState,
  play as playState,
  pause as pauseState,
  resume as resumeState,
  stop as stopState,
  reset as resetState,
  progress as calcProgress,
} from './time';
import type { Asset } from '../index';

export type { PlaybackOrder, ControllerState, PlaybackConfig };

export interface FramePlaybackCallbacks {
  onFrameChange?: (index: number, prev: number) => void;
  onComplete?: () => void;
  onStateChange?: (state: ControllerState, prev: ControllerState) => void;
  onLoopStart?: (loopIndex: number) => void;
  onLoopEnd?: (loopIndex: number) => void;
}

export class FramePlaybackController {
  private _ts: TimeState;
  readonly assetRef: Asset;
  callbacks: FramePlaybackCallbacks;

  constructor(
    asset: Asset,
    frameCount: number,
    config: PlaybackConfig = {},
    callbacks: FramePlaybackCallbacks = {},
  ) {
    this.assetRef = asset;
    this._ts = createTimeState(frameCount, config);
    this.callbacks = callbacks;
  }

  get state(): ControllerState { return this._ts.state; }
  get frameIndex(): number { return this._ts.frameIndex; }
  get frameCount(): number { return this._ts.frameCount; }
  get localTime(): number { return this._ts.localTime; }
  get progress(): number { return calcProgress(this._ts); }
  get currentLoop(): number { return this._ts.loopCount; }
  get fps(): number { return this._ts.fps; }
  get isHolding(): boolean { return this._ts.isHolding; }

  advance(dt: number): void {
    const prev = this._ts._prevFrameIndex;
    const prevState = this._ts._prevState;
    const changed = advanceState(this._ts, dt);

    if (this._ts.state !== prevState) {
      this.callbacks.onStateChange?.(this._ts.state, prevState);
    }
    if (this._ts.frameIndex !== prev) {
      this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
    }
    if (this._ts.state === 'done') {
      this.callbacks.onComplete?.();
    }
  }

  goto(frame: number): void {
    const prev = this._ts.frameIndex;
    gotoState(this._ts, frame);
    if (this._ts.frameIndex !== prev) {
      this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
    }
  }

  gotoTime(seconds: number): void {
    const prev = this._ts.frameIndex;
    gotoTimeState(this._ts, seconds);
    if (this._ts.frameIndex !== prev) {
      this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
    }
  }

  stepForward(n: number = 1): void {
    const prev = this._ts.frameIndex;
    stepForwardState(this._ts, n);
    if (this._ts.frameIndex !== prev) {
      this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
    }
  }

  stepBackward(n: number = 1): void {
    const prev = this._ts.frameIndex;
    stepBackwardState(this._ts, n);
    if (this._ts.frameIndex !== prev) {
      this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
    }
  }

  hold(): void { holdState(this._ts); }
  release(): void { releaseState(this._ts); }

  play(): void { playState(this._ts); }
  pause(): void { pauseState(this._ts); }
  resume(): void { resumeState(this._ts); }
  stop(): void { stopState(this._ts); }
  reset(config?: PlaybackConfig): void { resetState(this._ts, config); }

  dispose(): void {
    this.callbacks = {};
  }
}
