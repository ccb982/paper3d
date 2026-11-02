/** 验证状态：方向检测纯函数；尚未接入控制。 */
/** 低频扰动方向检测：只读 CoM/CoP/脚载荷，不读 applied torque。 */
export interface DirectionResult {
  direction: -1 | 0 | 1;
  confidence: number;
  support: 'l' | 'r' | 'both';
  comZ: number;
  velZ: number;
}
interface State { zLp: number; vLp: number; dir: -1 | 0 | 1; hold: number; t: number }
const _state = new WeakMap<object, State>();
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function detectDirection(
  owner: object,
  dt: number,
  comZ: number,
  velZ: number,
  fzL: number,
  fzR: number,
  copZ: number,
): DirectionResult {
  let s = _state.get(owner);
  if (!s) { s = { zLp: comZ, vLp: velZ, dir: 0, hold: 0, t: 0 }; _state.set(owner, s); }
  const a = 1 - Math.exp(-dt / 0.08);
  s.zLp += (comZ - s.zLp) * a;
  s.vLp += (velZ - s.vLp) * a;
  s.t = dt;
  const dead = 0.006;
  const want: -1 | 0 | 1 = Math.abs(s.zLp) < dead && Math.abs(s.vLp) < 0.02 ? 0 : (s.zLp + 0.15 * s.vLp > 0 ? 1 : -1);
  s.hold = Math.max(0, s.hold - dt);
  if (want !== 0 && want !== s.dir) {
    if (s.hold <= 0) { s.dir = want; s.hold = 0.12; }
  } else if (want === 0) s.hold = Math.max(s.hold, 0.05);
  const total = Math.max(1, fzL + fzR);
  const support: 'l' | 'r' | 'both' = fzL / total > 0.65 ? 'l' : fzR / total > 0.65 ? 'r' : 'both';
  const confidence = clamp(Math.min(1, Math.abs(s.zLp) / 0.03 + Math.abs(s.vLp) / 0.1) * (s.dir === 0 ? 0 : 1), 0, 1);
  return { direction: s.dir, confidence, support, comZ: s.zLp, velZ: s.vLp };
}
