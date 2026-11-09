export interface BaseTrimConfig {
  enabled: boolean;
  gain: number;
  tau: number;
  max: number;
  deadband: number;
}

export interface BaseTrimInput {
  contactL: boolean;
  contactR: boolean;
  fzL: number;
  fzR: number;
}

export interface BaseTrimState {
  trim: number;
}

export interface BaseTrimOutput {
  trim: number;
  left: number;
  right: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function stepBaseTrim(state: BaseTrimState, cfg: BaseTrimConfig, input: BaseTrimInput, dt: number): BaseTrimOutput {
  if (!cfg.enabled || !input.contactL || !input.contactR) {
    return { trim: state.trim, left: state.trim, right: -state.trim };
  }
  const raw = input.fzL - input.fzR;
  const e = Math.abs(raw) <= cfg.deadband ? 0 : raw;
  const target = clamp(cfg.gain * e, -cfg.max, cfg.max);
  const a = 1 - Math.exp(-dt / Math.max(1e-3, cfg.tau));
  const trim = state.trim + (target - state.trim) * a;
  return { trim, left: trim, right: -trim };
}
