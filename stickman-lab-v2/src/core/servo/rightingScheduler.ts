/** 矢状 / 侧向回正轮流：只切方向回正，不切 base/support。 */
import type { CourtState as CS } from '../court';

export type RightingMode = 'none' | 'sagittal' | 'lateralL' | 'lateralR';

export interface RightingSchedulerInput {
  active: boolean;
  now: number;
  lateralSide: 'l' | 'r' | null;
  lateralError: number;
  minLateral?: number;
  /** 侧向通道是否具备执行条件（抓地/力链/接触）；缺省 true。
   *  不满足时调度器不进入侧向，或从侧向退回矢状（架构 §12）。 */
  lateralReady?: boolean;
}

export interface RightingSchedulerOutput {
  mode: RightingMode;
  lateralSide: 'l' | 'r' | null;
  sagittalOn: boolean;
}

interface SchedState {
  mode: RightingMode;
  since: number;
  demandSide: 'l' | 'r' | null;
  demandSince: number;
  quietSince: number;
}

const _state = new WeakMap<CS, SchedState>();
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function scheduleRighting(st: CS, i: RightingSchedulerInput): RightingSchedulerOutput {
  const minHold = clamp(num('SQC_MODE_MIN_HOLD', 0.05), 0.05, 2.0);
  const confirm = clamp(num('SQC_MODE_CONFIRM', 0.02), 0.02, 1.0);
  const cooldown = clamp(num('SQC_MODE_COOLDOWN', 0.10), 0.0, 1.0);
  let s = _state.get(st);
  if (!s) { s = { mode: 'none', since: i.now, demandSide: null, demandSince: 0, quietSince: 0 }; _state.set(st, s); }
  if (!i.active) {
    s.mode = 'none';
    s.since = i.now;
    s.demandSide = null;
    return { mode: 'none', lateralSide: null, sagittalOn: false };
  }
  if (s.mode === 'none') {
    s.mode = 'sagittal';
    s.since = i.now;
    s.demandSide = null;
    s.quietSince = 0;
  }
  const minLat = Math.abs(i.minLateral ?? 0.01);
  const lateralReady = i.lateralReady ?? true;
  const wantSide = lateralReady && i.lateralSide && i.lateralError >= minLat ? i.lateralSide : null;
  if (wantSide !== s.demandSide) {
    s.demandSide = wantSide;
    s.demandSince = i.now;
  }
  const currentLat = s.mode === 'lateralL' ? 'l' : s.mode === 'lateralR' ? 'r' : null;
  const currentActive = currentLat !== null;
  const demandForCurrent = currentLat !== null && wantSide === currentLat;
  if (currentActive) {
    if (demandForCurrent) s.quietSince = 0;
    else if (s.quietSince === 0) s.quietSince = i.now;
  } else {
    s.quietSince = 0;
  }
  if (s.mode === 'sagittal') {
    const ready = i.now - s.since >= minHold;
    const confirmed = wantSide !== null && i.now - s.demandSince >= confirm;
    if (ready && confirmed) {
      s.mode = wantSide === 'l' ? 'lateralL' : 'lateralR';
      s.since = i.now;
      s.quietSince = 0;
    }
  } else if (currentActive) {
    const ready = i.now - s.since >= minHold;
    const quiet = s.quietSince > 0 && i.now - s.quietSince >= confirm + cooldown;
    if (ready && quiet) {
      s.mode = 'sagittal';
      s.since = i.now;
      s.demandSide = null;
      s.demandSince = i.now;
    }
  }
  const lateralSide = s.mode === 'lateralL' ? 'l' : s.mode === 'lateralR' ? 'r' : null;
  return { mode: s.mode, lateralSide, sagittalOn: s.mode === 'sagittal' };
}
