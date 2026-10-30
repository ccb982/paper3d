/** 姿势相关软限位：只产生越过限位后的回正力矩。 */
export function softJointLimit(
  q: number,
  vel: number,
  lo: number,
  hi: number,
  kp: number,
  kd: number,
  cap: number,
): number {
  if (!Number.isFinite(q) || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  let tau = 0;
  if (q < lo) tau = -kp * (q - lo) - kd * vel;
  else if (q > hi) tau = -kp * (q - hi) - kd * vel;
  return Math.max(-cap, Math.min(cap, tau));
}
