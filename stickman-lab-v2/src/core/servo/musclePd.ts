export interface MusclePdParams {
  b: number;
  k: number;
  dead: number;
  qRef: number;
  cap: number;
}

export function softzone(e: number, dead: number): number {
  const d = Math.max(0, dead);
  const a = Math.abs(e);
  if (a <= d) return 0;
  return Math.sign(e) * (a - d);
}

export function muscleTau(tauCmd: number, q: number, qd: number, p: MusclePdParams): number {
  const damp = -p.b * qd;
  const passive = -p.k * softzone(q - p.qRef, p.dead);
  const cap = Math.abs(p.cap);
  return Math.max(-cap, Math.min(cap, tauCmd + damp + passive));
}
