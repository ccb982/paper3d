/** 蹲姿 HAT 姿态任务：把胸廓/上身拉回释放姿态。
 *
 *  CoM 回中不等于上身回正；这里单独控 torso pitch。
 *  只写 spine1-3 矢状轴（2），避免和 BSS 的侧向 roll 轴（0）重复。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';
import { setSquatLoadBias } from './squatLoadBias';
import { courtTarget } from '../court';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function squatHatOrientation(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HAT_ORIENT ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const kp = Math.abs(Number(env.SQC_HAT_KP ?? 300));
  const kd = Math.abs(Number(env.SQC_HAT_KD ?? 20));
  const dead = Math.abs(Number(env.SQC_HAT_DEAD ?? 0.5)) / 57.3;
  const rateDead = Math.abs(Number(env.SQC_HAT_RATE_DEAD ?? 2)) / 57.3;
  const fl = w.body.footNormalForce('l', w.dt);
  const fr = w.body.footNormalForce('r', w.dt);
  const W = w.sk.massTotal * 9.81;
  const margin = Math.max(0, Math.min(fl, fr) - 0.1 * W);
  const footL = w.body.dofByName('foot_l', 0);
  const footR = w.body.dofByName('foot_r', 0);
  const stance = Math.max(0.05, footL >= 0 && footR >= 0 ? Math.abs(w.body.dofs[footL]!.anchorWorld[2]! - w.body.dofs[footR]!.anchorWorld[2]!) : 0.15);
  const forceBudget = String(env.SQC_HAT_FORCE_BUDGET ?? '1') === '1' ? margin * stance * 0.5 : Infinity;
  const cap = Math.min(Math.abs(Number(env.SQC_HAT_CAP ?? 20)), forceBudget);

  const p = ctl.sensors.torsoTilt[0]!;
  const wv = ctl.sensors.torsoAngVel[2]!;
  const target = courtTarget(st);
  const targetP = String(env.SQC_HAT_TARGET_ZERO ?? '1') === '1' ? 0 : target.pitch;
  const lead = Math.abs(Number(env.SQC_HAT_LEAD ?? 0.04));
  let e = targetP - p;
  if (Math.abs(e) <= dead) e = 0;
  const rateP = Math.abs(wv) <= rateDead ? 0 : wv;
  const tau = clamp(kp * (e - lead * rateP) - kd * rateP, -cap, cap);
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const di = w.body.dofByName((['spine1', 'spine2', 'spine3'] as const)[k]!, 2);
    if (di >= 0 && Math.abs(tau) > 0.05) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau: tau * wts[k]!, src: 'squat.hatPitch', channel: 'active' });
  }
  // 上身侧偏：roll → 世界水平。
  if (String(env.SQC_HAT_ROLL ?? '1') === '1') {
    const r = ctl.sensors.torsoTilt[1]!;
    const wx = ctl.sensors.torsoAngVel[0]!;
    const kpR = Math.abs(Number(env.SQC_HAT_ROLL_KP ?? 240));
    const kdR = Math.abs(Number(env.SQC_HAT_ROLL_KD ?? 16));
    const capR = Math.min(Math.abs(Number(env.SQC_HAT_ROLL_CAP ?? 15)), forceBudget);
    let eR = r - st.r0;
    if (Math.abs(eR) <= dead) eR = 0;
    const rateR = Math.abs(wx) <= rateDead ? 0 : wx;
    const tauR = clamp(-kpR * (eR - lead * rateR) - kdR * rateR, -capR, capR);
    // 修正侧对应脚预加载：小偏差不转移载荷，避免把腿带偏。
    const loadDead = Math.abs(Number(env.SQC_HAT_ROLL_LOAD_DEAD ?? 1.5)) / 57.3;
    const eLoad = Math.abs(eR) <= loadDead ? 0 : eR - Math.sign(eR) * loadDead;
    setSquatLoadBias(st, Math.max(-1, Math.min(1, Number(env.SQC_HAT_ROLL_LOAD ?? 1) * (eLoad / 0.15))));
    for (let k = 0; k < 3; k++) {
      const di = w.body.dofByName((['spine1', 'spine2', 'spine3'] as const)[k]!, 0);
      if (di >= 0 && Math.abs(tauR) > 0.05) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau: tauR * wts[k]!, src: 'squat.hatRoll', channel: 'active' });
    }
  }
}
