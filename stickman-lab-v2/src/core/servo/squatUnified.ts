/** 蹲姿统一任务控制器（实验分支，SQC_UNIFIED=1）。
 *
 *  统一入口：
 *    - 上身 pitch（roll 仍由 BSS）
 *    - 膝对齐：复用统一之前已验证的 SquatKneeAnkleController
 *    - 矢状 CoM → hip/2
 *
 *  只写 spine1-3 axis2、hip/0、hip/2；foot 仍由 ankleVector 负责。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';
import { SquatKneeAnkleController } from './squatKneeAnkle';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class SquatUnifiedController {
  private readonly leg: SquatKneeAnkleController;
  private logged = false;
  constructor() {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    this.leg = new SquatKneeAnkleController({
      hipKp: Number(env.SQC_RC2_KP ?? 90),
      hipCap: Number(env.SQC_RC2_K_CAP ?? 3),
      ankleKp: Number(env.SQC_RC2_AKP ?? 30),
      ankleCap: Number(env.SQC_RC2_A_CAP ?? 0.5),
      dead: Number(env.SQC_RC2_K_DEAD ?? 0.001),
      loadScale: String(env.SQC_RC2_K_LOAD ?? '1') !== '0',
      ki: Number(env.SQC_RC2_KI ?? 10),
      rate: Number(env.SQC_RC2_K_RATE ?? 20),
    });
  }
  reset(): void { this.leg.reset(); this.logged = false; }

  step(w: World, ctl: ControlModule, st: CS): void {
    if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (!this.logged) { this.logged = true; console.log('[UNIFIED] active'); }

    const p = ctl.sensors.torsoTilt[0]!;
    const wz = ctl.sensors.torsoAngVel[2]!;
    const kpU = Math.abs(Number(env.SQC_U_KP ?? 260));
    const kdU = Math.abs(Number(env.SQC_U_KD ?? 18));
    const capU = Math.abs(Number(env.SQC_U_CAP ?? 18));
    const deadU = Math.abs(Number(env.SQC_U_DEAD ?? 0.5)) / 57.3;
    let eP = st.p0 - p;
    if (Math.abs(eP) <= deadU) eP = 0;
    const tauP = clamp(kpU * eP - kdU * wz, -capU, capU);
    const wts = [0.25, 0.35, 0.40] as const;
    for (let k = 0; k < 3; k++) {
      const name = (['spine1', 'spine2', 'spine3'] as const)[k]!;
      const di = w.body.dofByName(name, 2);
      if (di >= 0 && Math.abs(tauP) > 0.05) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau: tauP * wts[k]!, src: 'squat.unified.pitch', channel: 'active' });
    }

    // 髋共同侧向：统一层不能只靠 BSS/膝层；恢复旧 RC2 H 的髋侧向支撑。
    if (String(env.SQC_U_HIP_ROLL ?? '1') !== '0') {
      const tr = ctl.lateral.parts['trunk'];
      const trR = tr ? tr.roll - st.r0 : (st.r0 - ctl.sensors.torsoTilt[1]!);
      const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
      const trRate = ti !== undefined ? w.body.bodies[ti]!.angvel().x : 0;
      const hkp = Math.abs(Number(env.SQC_U_HIP_KP ?? 80));
      const hkd = Math.abs(Number(env.SQC_U_HIP_KD ?? 8));
      const hcap = Math.abs(Number(env.SQC_U_HIP_CAP ?? 20));
      const hipH = -1 * clamp(hkp * trR + hkd * trRate, -hcap, hcap);
      for (const side of ['l', 'r'] as const) {
        const hi = w.body.dofByName(`hip_${side}`, 0);
        if (hi >= 0 && Math.abs(hipH) > 0.05) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: hipH, src: 'squat.unified.hipRoll', channel: 'active' });
      }
    }

    const r = this.leg.step(w, 1);
    if (r) {
      const slipL = w.perception.feet[0]?.slip ? Math.abs(Number(env.SQC_SLIP_SCALE ?? 0.2)) : 1;
      const slipR = w.perception.feet[1]?.slip ? Math.abs(Number(env.SQC_SLIP_SCALE ?? 0.2)) : 1;
      for (const [side, tau] of [['l', r.cmd.hipL * slipL], ['r', r.cmd.hipR * slipR]] as const) {
        const hi = w.body.dofByName(`hip_${side}`, 0);
        if (hi >= 0 && Math.abs(tau) > 0.05) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.unified.knee', channel: 'active' });
      }
    }

    const eX = ctl.perception.com[0]! - st.c0.x;
    const vX = ctl.perception.comVel[0]!;
    const kpS = Math.abs(Number(env.SQC_U_SAG_KP ?? 60));
    const kdS = Math.abs(Number(env.SQC_U_SAG_KD ?? 10));
    const capS = Math.abs(Number(env.SQC_U_SAG_CAP ?? 15));
    const hip2 = clamp(-(kpS * eX + kdS * vX), -capS, capS);
    for (const side of ['l', 'r'] as const) {
      const hi = w.body.dofByName(`hip_${side}`, 2);
      if (hi >= 0 && Math.abs(hip2) > 0.05) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: hip2, src: 'squat.unified.sag', channel: 'active' });
    }
  }
}
