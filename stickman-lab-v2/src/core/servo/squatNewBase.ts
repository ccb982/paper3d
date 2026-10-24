/** 新基线升级层（默认关）：
 *   13.88 基线 + 膝盖水平 + 脚力申请。
 *
 *  只在 levelY 超阈值时介入；
 *  hip 差动力矩与对应脚载荷请求成对出现。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';
import { setSquatLoadBias } from './squatLoadBias';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const anchor = (w: World, name: string, ax: number): { x: number; z: number; y: number } => {
  const i = w.body.dofByName(name, ax);
  if (i < 0) return { x: 0, y: 0, z: 0 };
  const a = w.body.dofs[i]!.anchorWorld;
  return { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 };
};

export class SquatNewBaseController {
  step(w: World, st: CS): void {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (String(env.SQC_NEWBASE ?? '0') !== '1') return;
    if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
    const kl = anchor(w, 'knee_l', 2);
    const kr = anchor(w, 'knee_r', 2);
    const footL = anchor(w, 'foot_l', 0);
    const footR = anchor(w, 'foot_r', 0);
    const kneeRelLZ = kl.z - footL.z;
    const kneeRelRZ = kr.z - footR.z;
    const levelY = kl.y - kr.y;
    const vertOn = String(env.SQC_NB_VERT ?? '1') === '1';
    if (String(env.SQC_NB_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`NB t=${w.clock.toFixed(2)} levelY=${(levelY * 1000).toFixed(1)}mm kneeRelZ=${(kneeRelLZ * 1000).toFixed(1)}/${(kneeRelRZ * 1000).toFixed(1)}mm`);
    }
    const dead = Math.abs(Number(env.SQC_NB_LEVEL_DEAD ?? 2)) / 1000;
    if (Math.abs(levelY) <= dead) { setSquatLoadBias(st, 0); return; }

    const sign = Number(env.SQC_NB_LEVEL_SIGN ?? 1) < 0 ? -1 : 1;
    const kp = Math.abs(Number(env.SQC_NB_LEVEL_KP ?? 80));
    const cap = Math.abs(Number(env.SQC_NB_LEVEL_CAP ?? 2));
    let tauC = 0, tauD = 0;
    if (vertOn) {
      const kpV = Math.abs(Number(env.SQC_NB_VERT_KP ?? 40));
      const capV = Math.abs(Number(env.SQC_NB_VERT_CAP ?? 1));
      const hl = anchor(w, 'hip_l', 0);
      const hr = anchor(w, 'hip_r', 0);
      let eC = (kneeRelLZ + kneeRelRZ) / 2;
      let eD = (kneeRelLZ - kneeRelRZ) / 2 + (hl.y - hr.y);
      const deadV = Math.abs(Number(env.SQC_NB_VERT_DEAD ?? 1)) / 1000;
      if (Math.abs(eC) <= deadV) eC = 0;
      if (Math.abs(eD) <= deadV) eD = 0;
      tauC = sign * clamp(-kpV * eC, -capV, capV);
      tauD = sign * clamp(-kpV * eD, -capV, capV);
    } else {
      let tau = sign * clamp(-kp * levelY, -cap, cap);
      tauD = tau;
    }

    const fl = w.body.footNormalForce('l', w.dt);
    const fr = w.body.footNormalForce('r', w.dt);
    const W = w.sk.massTotal * 9.81;
    const stance = Math.max(0.05, Math.abs(footL.z - footR.z));
    let dfz = (Math.abs(tauC) + Math.abs(tauD)) / stance;
    const margin = Math.max(0, Math.min(fl, fr) - 0.1 * W);
    if (dfz > margin) {
      const scl = margin / Math.max(1e-6, dfz);
      tauC *= scl; tauD *= scl;
      dfz = margin;
    }
    const bias = clamp((dfz / Math.max(1, W * 0.1)) * Math.sign(tauC || tauD), -1, 1);
    setSquatLoadBias(st, bias);

    for (const [side, sgn] of [['l', 1], ['r', -1]] as const) {
      const hi = w.body.dofByName(`hip_${side}`, 0);
      const tau = tauC + sgn * tauD;
      if (hi >= 0 && Math.abs(tau) > 0.05) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.newbase.level', channel: 'active' });
    }
    if (String(env.SQC_NB_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`NB t=${w.clock.toFixed(2)} levelY=${(levelY * 1000).toFixed(1)}mm kneeRelZ=${(kneeRelLZ * 1000).toFixed(1)}/${(kneeRelRZ * 1000).toFixed(1)}mm tauC=${tauC.toFixed(2)} tauD=${tauD.toFixed(2)} dfz=${dfz.toFixed(0)}N bias=${bias.toFixed(2)}`);
    }
  }
}
