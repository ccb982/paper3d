/** 蹲姿专属：矢状踝/髋任务。
 *
 *  踝（ankleVector）负责小误差 CoP；
 *  当踝接近背屈/跖屈限位时，髋/2 接手，
 *  避免继续把 foot/2 顶到限位。
 *
 *  只写 hip/2，不重复写 foot/0、foot/2。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface SagittalState {
  eX: number;
  vX: number;
  ankleRelL: number;
  ankleRelR: number;
  nearLimit: boolean;
}

export function estimateSagittal(w: World, st: CS): SagittalState {
  const eX = (w.perception.com[0] ?? 0) - st.c0.x;
  const vX = w.perception.comVel[0] ?? 0;
  const rel = (side: 'l' | 'r'): number => {
    const di = w.body.dofByName(`foot_${side}`, 2);
    if (di < 0) return 0;
    const a0 = st.ang0?.get(di);
    return a0 === undefined ? 0 : w.body.dofs[di]!.angle - a0;
  };
  return { eX, vX, ankleRelL: rel('l'), ankleRelR: rel('r'), nearLimit: false };
}

export interface SagittalOpts {
  kp?: number;
  kd?: number;
  cap?: number;
  sign?: number;
  limitDeg?: number;
  boost?: number;
  lead?: number;
  dead?: number;
}

/** 返回 hip/2 力矩（左右同号；矢状对称）。 */
export function planSagittal(s: SagittalState, opts: SagittalOpts = {}): number {
  const kp = opts.kp ?? 60;
  const kd = opts.kd ?? 10;
  const cap = opts.cap ?? 15;
  const sign = (opts.sign ?? 1) < 0 ? -1 : 1;
  const lim = (opts.limitDeg ?? 18) / 57.3;
  const boost = opts.boost ?? 1.5;
  const lead = opts.lead ?? 0.2;
  const dead = opts.dead ?? 0;
  const near = Math.max(Math.abs(s.ankleRelL), Math.abs(s.ankleRelR)) > lim;
  const e = Math.abs(s.eX) <= dead ? 0 : s.eX - Math.sign(s.eX) * dead;
  const raw = -(kp * (e + lead * s.vX) + kd * s.vX);
  return sign * clamp(raw * (near ? boost : 1), -cap, cap);
}

const _sagSeen = new WeakSet<CS>();
export function squatSagittalAssist(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_SAG ?? '0') !== '1') return;
  if (st.fall >= 0 || !st.released) return;
  if (!_sagSeen.has(st)) { _sagSeen.add(st); console.log('[SAG] active'); }
  const s = estimateSagittal(w, st);
  s.nearLimit = Math.max(Math.abs(s.ankleRelL), Math.abs(s.ankleRelR)) > (Number(env.SQC_SAG_LIMIT_DEG ?? 18) / 57.3);
  const tau = planSagittal(s, {
    kp: Number(env.SQC_SAG_KP ?? 60),
    kd: Number(env.SQC_SAG_KD ?? 10),
    cap: Number(env.SQC_SAG_CAP ?? 15),
    sign: Number(env.SQC_SAG_HIP_SIGN ?? 1),
    limitDeg: Number(env.SQC_SAG_LIMIT_DEG ?? 18),
    boost: Number(env.SQC_SAG_BOOST ?? 1.5),
    lead: Number(env.SQC_SAG_LEAD ?? 0.2),
    dead: Number(env.SQC_SAG_DEAD ?? 0),
  });
  for (const side of ['l', 'r'] as const) {
    const hi = w.body.dofByName(`hip_${side}`, 2);
    if (hi >= 0 && Math.abs(tau) > 0.05) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.sagittal', channel: 'active' });
  }
  if (String(env.SQC_SAG_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    console.log(`SAG t=${w.clock.toFixed(2)} eX=${(s.eX * 1000).toFixed(1)} vX=${(s.vX * 1000).toFixed(1)} aL=${(s.ankleRelL * 57.3).toFixed(1)} aR=${(s.ankleRelR * 57.3).toFixed(1)} tau=${tau.toFixed(2)}`);
  }
}
