/** P2 支撑/被动模型：纯计算，不写执行器。 */
export interface SupportPassiveDof {
  name: string;
  axis: number;
  angle: number;
  vel: number;
  inertia: number;
}

export interface SupportPassiveParts {
  ref: number;
  k: number;
  b: number;
  e: number;
  tau: number;
}

export function computeSupportPassive(
  d: SupportPassiveDof,
  ref: number,
  supportScale: number,
  env: Record<string, string>,
): SupportPassiveParts {
  const isHip = /^hip_/.test(d.name);
  const isKnee = /^knee_/.test(d.name);
  const isFoot = /^foot_/.test(d.name);
  const isFoot0 = isFoot && d.axis === 0;
  if (!((d.axis === 2 && (isHip || isKnee || isFoot)) || (d.axis === 0 && (isHip || isFoot)))) {
    return { ref, k: 0, b: 0, e: 0, tau: 0 };
  }
  if (isHip && d.axis === 2) return { ref, k: 0, b: 0, e: 0, tau: 0 };
  const p2Scale = isHip ? supportScale : 1;
  const k0 = (isHip ? Number(env.SQC_P2_HIP_K ?? 150) : isKnee ? Number(env.SQC_P2_KNEE_K ?? 30) : isFoot0 ? Number(env.SQC_P2_FOOT0_K ?? 80) : Number(env.SQC_P2_FOOT_K ?? 60)) * p2Scale;
  const b0 = isHip ? Number(env.SQC_P2_HIP_B ?? 10) : isKnee ? Number(env.SQC_P2_KNEE_B ?? 3) : isFoot0 ? Number(env.SQC_P2_FOOT0_B ?? 4) : Number(env.SQC_P2_FOOT_B ?? 2);
  const cap = (isHip ? Number(env.SQC_P2_HIP_CAP ?? 50) : isKnee ? Number(env.SQC_P2_KNEE_CAP ?? 15) : isFoot0 ? Number(env.SQC_P2_FOOT0_CAP ?? 40) : Number(env.SQC_P2_FOOT_CAP ?? 120)) * p2Scale;
  const e0 = d.angle - ref;
  const dead = (isFoot0 ? Number(env.SQC_P2_FOOT0_DEAD ?? 2) : isFoot ? Number(env.SQC_P2_FOOT_DEAD ?? 5) : 1) / 57.3;
  const soft = (isFoot0 ? Number(env.SQC_P2_FOOT0_SOFT ?? 5) : isFoot ? Number(env.SQC_P2_FOOT_SOFT ?? 10) : 3) / 57.3;
  const e = Math.abs(e0) <= dead ? 0 : Math.sign(e0) * (Math.abs(e0) - dead);
  const over = Math.max(0, Math.abs(e) - soft);
  const norm = e / Math.max(1e-8, soft);
  const k3 = isFoot && !isFoot0 ? Number(env.SQC_P2_FOOT_K3 ?? 0) : 0;
  const transient = Math.min(1, Math.abs(d.vel) / 0.6);
  const dir = e0 > 0 ? Number(env.SQC_P2_POS ?? 1.2) : Number(env.SQC_P2_NEG ?? 1.0);
  const hardK = k0 * Number(env.SQC_P2_HARD ?? 60) * dir;
  const nExp = isFoot ? Number(env.SQC_P2_FOOT_N ?? 4) : 2;
  const k = k0 + hardK * Math.pow(over / Math.max(1e-8, soft), nExp) * transient;
  const b = Math.max(b0, 1.6 * Math.sqrt(k * Math.max(1e-9, d.inertia)));
  const tau = Math.max(-cap, Math.min(cap, -k * e - k3 * norm * norm * norm - b * d.vel));
  return { ref, k, b, e, tau };
}
