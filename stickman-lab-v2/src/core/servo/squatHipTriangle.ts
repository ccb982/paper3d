/** 髋-膝三角控制（v3 第一阶段，默认关）。
 *
 *  不替换膝/踝基线；
 *  只给 hip/0、hip/2 加三角 residual。
 *
 *  参考：释放瞬间的 hip center + knee L/R + foot L/R。
 *  误差用有符号 x/z，不用距离。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface V2 { x: number; z: number }
interface Ref {
  hip: V2;
  kneeL: V2;
  kneeR: V2;
  footL: V2;
  footR: V2;
  symZ: number;
}

const anchor = (w: World, name: string, ax: number): V2 => {
  const i = w.body.dofByName(name, ax);
  if (i < 0) return { x: 0, z: 0 };
  const a = w.body.dofs[i]!.anchorWorld;
  return { x: a[0] ?? 0, z: a[2] ?? 0 };
};

const snapshot = (w: World): Ref => {
  const hl = anchor(w, 'hip_l', 0);
  const hr = anchor(w, 'hip_r', 0);
  return {
    hip: { x: (hl.x + hr.x) / 2, z: (hl.z + hr.z) / 2 },
    kneeL: anchor(w, 'knee_l', 2),
    kneeR: anchor(w, 'knee_r', 2),
    footL: anchor(w, 'foot_l', 0),
    footR: anchor(w, 'foot_r', 0),
    symZ: (anchor(w, 'knee_l', 2).z - anchor(w, 'foot_l', 0).z) - (anchor(w, 'knee_r', 2).z - anchor(w, 'foot_r', 0).z),
  };
};

export class SquatHipTriangleController {
  private ref: Ref | null = null;
  private com0: V2 | null = null;
  private prev: V2 | null = null;
  reset(): void { this.ref = null; this.com0 = null; this.prev = null; }
  step(w: World, st: CS): void {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (String(env.SQC_HIP_TRI ?? '0') !== '1') return;
    if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
    if (!this.ref) {
      this.ref = snapshot(w);
      this.com0 = { x: w.perception.com[0] ?? 0, z: w.perception.com[2] ?? 0 };
    }
    const cur = snapshot(w);
    const refFootMid = { x: (this.ref.footL.x + this.ref.footR.x) / 2, z: (this.ref.footL.z + this.ref.footR.z) / 2 };
    const footMid = { x: (cur.footL.x + cur.footR.x) / 2, z: (cur.footL.z + cur.footR.z) / 2 };
    const hRel = { x: this.ref.hip.x - refFootMid.x, z: this.ref.hip.z - refFootMid.z };
    const follow = Number(env.SQC_TRI_FOLLOW ?? 1);
    const comX = w.perception.com[0] ?? 0;
    const comZ = w.perception.com[2] ?? 0;
    const targetHip = {
      x: footMid.x + hRel.x + follow * (comX - (this.com0?.x ?? comX)),
      z: footMid.z + hRel.z + follow * (comZ - (this.com0?.z ?? comZ)),
    };
    const vx = this.prev ? (cur.hip.x - this.prev.x) / Math.max(1e-6, w.dt) : 0;
    const vz = this.prev ? (cur.hip.z - this.prev.z) / Math.max(1e-6, w.dt) : 0;
    this.prev = cur.hip;

    const eX = cur.hip.x - targetHip.x;
    const eZ = cur.hip.z - targetHip.z;
    const T = Math.abs(Number(env.SQC_TRI_PRED_T ?? 0.08));
    const ax = w.perception.comAcc[0] ?? 0;
    const az = w.perception.comAcc[2] ?? 0;
    const predOn = String(env.SQC_TRI_PRED ?? '1') !== '0';
    const eXp = predOn ? eX + vx * T + 0.5 * ax * T * T : eX;
    const eZp = predOn ? eZ + vz * T + 0.5 * az * T * T : eZ;
    const symZ = (cur.symZ - this.ref.symZ) * 0.5;
    const kpX = Math.abs(Number(env.SQC_TRI_KP_X ?? 120));
    const kpZ = Math.abs(Number(env.SQC_TRI_KP_Z ?? 120));
    const kdX = Math.abs(Number(env.SQC_TRI_KD_X ?? 20));
    const kdZ = Math.abs(Number(env.SQC_TRI_KD_Z ?? 20));
    const cap = Math.abs(Number(env.SQC_TRI_CAP ?? 10));
    const signX = Number(env.SQC_TRI_SIGN_X ?? 1) < 0 ? -1 : 1;
    const signZ = Number(env.SQC_TRI_SIGN_Z ?? 1) < 0 ? -1 : 1;
    const tauX = signX * clamp(-(kpX * eXp + kdX * (vx + ax * T)), -cap, cap);
    const tauZ = signZ * clamp(-(kpZ * (eZp + symZ) + kdZ * (vz + az * T)), -cap, cap);
    for (const side of ['l', 'r'] as const) {
      const hi2 = w.body.dofByName(`hip_${side}`, 2);
      const hi0 = w.body.dofByName(`hip_${side}`, 0);
      if (hi2 >= 0 && Math.abs(tauX) > 0.05) propose({ dof: hi2, kind: 'ext', pri: PRI.reflex, tau: tauX, src: 'squat.hipTriangle.sag', channel: 'active' });
      if (hi0 >= 0 && Math.abs(tauZ) > 0.05) propose({ dof: hi0, kind: 'ext', pri: PRI.reflex, tau: tauZ, src: 'squat.hipTriangle.lat', channel: 'active' });
    }
    if (String(env.SQC_TRI_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`HIP_TRI t=${w.clock.toFixed(2)} e=(${(eX * 1000).toFixed(1)},${(eZ * 1000).toFixed(1)})mm tgt=(${(targetHip.x * 1000).toFixed(1)},${(targetHip.z * 1000).toFixed(1)})mm eP=(${(eXp * 1000).toFixed(1)},${(eZp * 1000).toFixed(1)})mm symZ=${(symZ * 1000).toFixed(1)}mm v=(${(vx * 1000).toFixed(1)},${(vz * 1000).toFixed(1)})mm/s tau=(${tauX.toFixed(2)},${tauZ.toFixed(2)})`);
    }
  }
}
