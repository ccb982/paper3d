export interface PassiveParams {
  slack: number;
  k1: number;
  k3: number;
  b: number;
  cap: number;
}

export function passiveTorque(e: number, edot: number, p: PassiveParams): number {
  const s = e > 0 ? 1 : e < 0 ? -1 : 0;
  const x = Math.abs(e) <= p.slack ? 0 : e - s * p.slack;
  const tau = p.k1 * x + p.k3 * x * x * x + p.b * edot;
  return Math.max(-p.cap, Math.min(p.cap, tau));
}
