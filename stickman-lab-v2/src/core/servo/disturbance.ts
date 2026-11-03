/** 验证状态：方向检测纯函数；尚未接入控制。 */
/** 低频扰动方向检测：只读 CoM/CoP/脚载荷，不读 applied torque。 */
export interface DirectionResult {
  direction: -1 | 0 | 1;
  confidence: number;
  support: 'l' | 'r' | 'both';
  comZ: number;
  velZ: number;
  copZ: number;
  comRel: number;
  loadDiff: number;
}
interface State { zLp: number; vLp: number; copLp: number; loadLp: number; loadBase: number; dir: -1 | 0 | 1; hold: number; t: number }
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
  if (!s) { s = { zLp: comZ, vLp: velZ, copLp: copZ, loadLp: 0, loadBase: 0, dir: 0, hold: 0, t: 0 }; _state.set(owner, s); }
  const a = 1 - Math.exp(-dt / 0.08);
  s.zLp += (comZ - s.zLp) * a;
  s.vLp += (velZ - s.vLp) * a;
  s.copLp += (copZ - s.copLp) * a;
  s.t = dt;
  const rel = s.zLp - s.copLp;
  const totalW = Math.max(1, fzL + fzR);
  if (fzL + fzR < 1) { s.dir = 0; s.hold = 0; return { direction: 0, confidence: 0, support: 'both', comZ: s.zLp, velZ: s.vLp, copZ: s.copLp, comRel: s.zLp - s.copLp, loadDiff: 0 }; }
  const loadDiff = (fzL - fzR) / totalW;
  const al = 1 - Math.exp(-dt / 0.05);
  s.loadLp += (loadDiff - s.loadLp) * al;
  const ab = 1 - Math.exp(-dt / 0.4);
  s.loadBase += (loadDiff - s.loadBase) * ab;
  const loadDelta = loadDiff - s.loadBase;
  const dead = 0.006;
  const loaded = Math.abs(loadDelta) > 0.15;
  const want: -1 | 0 | 1 = loaded ? (loadDelta > 0 ? 1 : -1) : (Math.abs(s.vLp) < 0.04 ? 0 : (rel + 0.15 * s.vLp > 0 ? 1 : -1));
  s.dir = want;
  s.hold = 0;
  const total = totalW;
  const support: 'l' | 'r' | 'both' = fzL / total > 0.65 ? 'l' : fzR / total > 0.65 ? 'r' : 'both';
  const confidence = clamp(Math.max(Math.min(1, Math.abs(rel) / 0.03 + Math.abs(s.vLp) / 0.1), Math.min(1, Math.abs(loadDelta) / 0.4)) * (s.dir === 0 ? 0 : 1), 0, 1);
  return { direction: s.dir, confidence, support, comZ: s.zLp, velZ: s.vLp, copZ: s.copLp, comRel: rel, loadDiff: loadDelta };
}
