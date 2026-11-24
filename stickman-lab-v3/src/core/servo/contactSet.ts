export interface ContactLatchState {
  active: boolean;
  since: number;
  lostAt: number;
  count: number;
  fzLp: number;
}

export interface ContactLatchCfg {
  onFz: number;
  offFz: number;
  minOnTime: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function updateContactLatch(
  prev: ContactLatchState | undefined,
  fz: number,
  count: number,
  now: number,
  dt: number,
  cfg: ContactLatchCfg,
): ContactLatchState {
  const a = 1 - Math.exp(-dt / 0.04);
  const fzLp = prev ? prev.fzLp + (fz - prev.fzLp) * a : fz;
  let active = prev?.active ?? false;
  let since = prev?.since ?? now;
  let lostAt = prev?.lostAt ?? -1;
  if (!active) {
    if (fzLp > cfg.onFz || count > 0) {
      active = true;
      since = now;
      lostAt = -1;
    }
  } else {
    const onLongEnough = now - since >= cfg.minOnTime;
    if (onLongEnough && fzLp < cfg.offFz && count === 0) {
      active = false;
      lostAt = now;
    }
  }
  return { active, since, lostAt, count, fzLp: clamp(fzLp, 0, 1e6) };
}
