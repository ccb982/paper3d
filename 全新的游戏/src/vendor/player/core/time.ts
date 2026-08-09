export type PlaybackOrder =
  | 'linear'
  | 'reverse'
  | 'loop'
  | 'pingpong'
  | { type: 'sequence'; frames: number[] }
  | { type: 'hold'; frame: number };

export type ControllerState = 'idle' | 'delay' | 'playing' | 'paused' | 'done';

export interface TimeState {
  state: ControllerState;
  frameIndex: number;
  localTime: number;
  frameCount: number;

  fps: number;
  speed: number;
  order: PlaybackOrder;
  delay: number;
  randomOffset: number;
  initialFrame: number;
  loopMax: number | boolean;

  loopCount: number;
  delayRemaining: number;
  pingpongDirection: number;
  isHolding: boolean;
  holdFrame: number;

  _prevState: ControllerState;
  _prevFrameIndex: number;
  _dirty: boolean;
}

export interface PlaybackConfig {
  fps?: number;
  speed?: number;
  order?: PlaybackOrder;
  delay?: number;
  randomOffset?: number;
  initialFrame?: number;
  loop?: boolean | number;
}

export function createTimeState(frameCount: number, config: PlaybackConfig = {}): TimeState {
  const fps = config.fps ?? 30;
  const delay = config.delay ?? 0;
  const randomOffset = config.randomOffset ?? 0;
  const randomStart = randomOffset > 0 ? Math.random() * randomOffset : 0;

  return {
    state: delay > 0 ? 'delay' : 'playing',
    frameIndex: config.initialFrame ?? 0,
    localTime: randomStart,
    frameCount,

    fps,
    speed: config.speed ?? 1,
    order: config.order ?? 'loop',
    delay,
    randomOffset,
    initialFrame: config.initialFrame ?? 0,
    loopMax: config.loop ?? true,

    loopCount: 0,
    delayRemaining: delay,
    pingpongDirection: 1,
    isHolding: false,
    holdFrame: 0,

    _prevState: 'idle',
    _prevFrameIndex: 0,
    _dirty: true,
  };
}

function computeFrameIndex(ts: TimeState): { frameIndex: number; direction: number; cycleEnd: boolean } {
  const n = ts.frameCount;
  if (n <= 0) return { frameIndex: 0, direction: 1, cycleEnd: false };

  const raw = ts.localTime * ts.fps;

  switch (ts.order as PlaybackOrder) {
    case 'reverse': {
      const t = Math.floor(raw);
      const idx = Math.max(0, n - 1 - t);
      return { frameIndex: idx, direction: -1, cycleEnd: t >= n };
    }

    case 'loop': {
      const idx = Math.floor(raw) % n;
      return { frameIndex: idx, direction: 1, cycleEnd: raw >= n };
    }

    case 'pingpong': {
      if (n <= 1) return { frameIndex: 0, direction: 1, cycleEnd: raw >= 1 };
      const cycle = 2 * (n - 1);
      const t = Math.floor(raw) % cycle;
      const fwd = t < n;
      return {
        frameIndex: fwd ? t : cycle - t,
        direction: fwd ? 1 : -1,
        cycleEnd: raw >= cycle,
      };
    }

    case 'linear':
    default: {
      const idx = Math.min(Math.floor(raw), n - 1);
      return { frameIndex: idx, direction: 1, cycleEnd: raw >= n };
    }
  }
}

function computeFrameIndexExplicit(ts: TimeState, order: { type: 'sequence'; frames: number[] } | { type: 'hold'; frame: number }): { frameIndex: number; direction: number; cycleEnd: boolean } {
  if (order.type === 'hold') {
    return { frameIndex: order.frame, direction: 1, cycleEnd: false };
  }

  const frames = order.frames;
  if (frames.length === 0) return { frameIndex: 0, direction: 1, cycleEnd: false };

  const raw = Math.floor(ts.localTime * ts.fps);
  const idx = raw % frames.length;
  return {
    frameIndex: frames[idx],
    direction: 1,
    cycleEnd: raw >= frames.length,
  };
}

function resolveFrameIndex(ts: TimeState): { frameIndex: number; direction: number; cycleEnd: boolean } {
  if (typeof ts.order === 'object') {
    return computeFrameIndexExplicit(ts, ts.order);
  }
  return computeFrameIndex(ts);
}

export function advance(ts: TimeState, dt: number): boolean {
  ts._prevState = ts.state;
  ts._prevFrameIndex = ts.frameIndex;
  ts._dirty = true;

  if (ts.state === 'done') return false;
  if (ts.state === 'paused') return false;

  if (ts.state === 'delay') {
    ts.delayRemaining -= dt;
    if (ts.delayRemaining > 0) return false;
    ts.state = 'playing';
    ts.delayRemaining = 0;
  }

  ts.localTime += dt * ts.speed;

  if (!ts.isHolding) {
    const result = resolveFrameIndex(ts);

    if (result.cycleEnd && ts.loopMax !== true) {
      if (ts.loopMax === false) {
        ts.state = 'done';
        ts.frameIndex = ts.frameCount - 1;
        return true;
      }
      ts.loopCount++;
      if (typeof ts.loopMax === 'number' && ts.loopCount >= ts.loopMax) {
        ts.state = 'done';
        ts.frameIndex = ts.frameCount - 1;
        return true;
      }
    }

    ts.frameIndex = result.frameIndex;
    ts.pingpongDirection = result.direction;
  }

  return ts._prevFrameIndex !== ts.frameIndex || ts._prevState !== ts.state;
}

export function goto(ts: TimeState, frame: number): void {
  ts._prevFrameIndex = ts.frameIndex;
  ts.frameIndex = Math.max(0, Math.min(ts.frameCount - 1, frame));
  ts._dirty = true;
}

export function gotoTime(ts: TimeState, seconds: number): void {
  ts.localTime = Math.max(0, seconds);
  ts._prevFrameIndex = ts.frameIndex;
  if (!ts.isHolding) {
    const result = resolveFrameIndex(ts);
    ts.frameIndex = result.frameIndex;
  }
  ts._dirty = true;
}

export function stepForward(ts: TimeState, n: number = 1): void {
  ts._prevFrameIndex = ts.frameIndex;
  ts.frameIndex = Math.min(ts.frameCount - 1, ts.frameIndex + n);
  ts._dirty = true;
}

export function stepBackward(ts: TimeState, n: number = 1): void {
  ts._prevFrameIndex = ts.frameIndex;
  ts.frameIndex = Math.max(0, ts.frameIndex - n);
  ts._dirty = true;
}

export function hold(ts: TimeState): void {
  ts.isHolding = true;
  ts.holdFrame = ts.frameIndex;
}

export function release(ts: TimeState): void {
  ts.isHolding = false;
  const result = resolveFrameIndex(ts);
  ts._prevFrameIndex = ts.frameIndex;
  ts.frameIndex = result.frameIndex;
  ts._dirty = true;
}

export function play(ts: TimeState): void {
  if (ts.state === 'idle' || ts.state === 'done') {
    ts.state = ts.delay > 0 ? 'delay' : 'playing';
    ts.delayRemaining = ts.delay;
    ts.loopCount = 0;
    ts.pingpongDirection = 1;
    ts._dirty = true;
  } else if (ts.state === 'paused') {
    ts.state = 'playing';
    ts._dirty = true;
  }
}

export function pause(ts: TimeState): void {
  if (ts.state === 'playing') {
    ts.state = 'paused';
    ts._dirty = true;
  }
}

export function resume(ts: TimeState): void {
  if (ts.state === 'paused') {
    ts.state = 'playing';
    ts._dirty = true;
  }
}

export function stop(ts: TimeState): void {
  ts.state = 'done';
  ts._dirty = true;
}

export function reset(ts: TimeState, config?: PlaybackConfig): void {
  if (config) {
    ts.fps = config.fps ?? ts.fps;
    ts.speed = config.speed ?? ts.speed;
    ts.order = config.order ?? ts.order;
    ts.delay = config.delay ?? 0;
    ts.randomOffset = config.randomOffset ?? 0;
    ts.initialFrame = config.initialFrame ?? 0;
    ts.loopMax = config.loop ?? ts.loopMax;
  }

  ts.state = ts.delay > 0 ? 'delay' : 'playing';
  ts.frameIndex = ts.initialFrame;
  ts.localTime = ts.randomOffset > 0 ? Math.random() * ts.randomOffset : 0;
  ts.loopCount = 0;
  ts.delayRemaining = ts.delay;
  ts.pingpongDirection = 1;
  ts.isHolding = false;
  ts.holdFrame = 0;
  ts._dirty = true;
}

export function progress(ts: TimeState): number {
  if (ts.frameCount <= 1) return 0;
  return ts.frameIndex / (ts.frameCount - 1);
}
