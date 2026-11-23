/** 上身执行 PD：只消费 upperBodyCommand 的目标/前馈，不生成新策略。 */
import type { World } from '../world';
import { propose, PRI } from '../proposalBus';
import { AntagonistPair } from './squatV6/muscle';
import type { JointConfig, MuscleParams } from './squatV6/types';
import type { UpperCommand } from './upperBodyCommand';

const UPPER = ['spine1', 'spine2', 'spine3', 'neck'] as const;
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const _spinePair = new WeakMap<World, Map<string, AntagonistPair>>();
const envN = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
function spinePair(w: World, key: string): AntagonistPair {
  let m = _spinePair.get(w);
  if (!m) { m = new Map(); _spinePair.set(w, m); }
  let p = m.get(key);
  if (!p) { p = new AntagonistPair(); p.prime(envN('SQC_SPINE_CO', 0.15)); m.set(key, p); }
  return p;
}
function spineParams(cap: number): MuscleParams {
  return {
    f0: Math.max(120, cap * 4), momentArm: 0.1, length0: 0, lengthRange: 0.3,
    k1: 20, k3: 50, b: 4, kSr: envN('SQC_SPINE_KSR', 4000), xSr: 0.005, slack: 0.005,
    tauAct: 0.05, tauDeact: 0.08, cap: Math.max(100, cap * 1.2),
  };
}

export class UpperTaskPD {
  private readonly velLp = new WeakMap<World, Map<number, number>>();

  step(w: World, cmd: UpperCommand, baseOnly = false): void {
    const kp = num('SQC_UPPER_KP', 220);
    const kd = num('SQC_UPPER_KD', 36);
    const kdSag = num('SQC_UPPER_SAG_KD', 56);
    const kpLat = num('SQC_UPPER_LAT_KP', 20);
    const kdLat = num('SQC_UPPER_LAT_KD', 16);
    const capLat = Math.abs(num('SQC_UPPER_LAT_CAP', 40));
    const cap = Math.abs(num('SQC_UPPER_CAP', 120));
    const lp = clamp(num('SQC_UPPER_VEL_LP', 0.35), 0, 1);
    let vm = this.velLp.get(w);
    if (!vm) { vm = new Map(); this.velLp.set(w, vm); }
    const torsoKp = Math.abs(num('SQC_UPPER_TORSO_KP', 80));
    const torsoKd = Math.abs(num('SQC_UPPER_TORSO_KD', 15));
    const torsoCap = Math.abs(num('SQC_UPPER_TORSO_CAP', 60));
    const torsoW: Record<string, number> = {
      spine1: Math.abs(num('SQC_UPPER_TORSO_W1', 0.40)),
      spine2: Math.abs(num('SQC_UPPER_TORSO_W2', 0.35)),
      spine3: Math.abs(num('SQC_UPPER_TORSO_W3', 0.25)),
    };
    const wSum = Math.max(1e-6, torsoW.spine1! + torsoW.spine2! + torsoW.spine3!);
    let qTorso = 0;
    let qdTorso = 0;
    let qTargetTorso = 0;
    for (const n of ['spine1', 'spine2', 'spine3'] as const) {
      const i = w.body.dofByName(n, 2);
      if (i < 0) continue;
      qTorso += w.body.dofs[i]!.angle;
      qdTorso += w.body.dofs[i]!.vel;
      qTargetTorso += cmd.targets.get(i) ?? w.body.dofs[i]!.angle;
    }
    const torsoErr = qTargetTorso - qTorso;
    const torsoTorque = clamp(torsoKp * torsoErr - torsoKd * qdTorso, -torsoCap, torsoCap) * cmd.ramp;
    (globalThis as { __UPPER_DBG?: Record<string, number> }).__UPPER_DBG = {
      torsoAngle: qTorso, torsoVel: qdTorso, torsoTarget: qTargetTorso, torsoErr, torsoTorque,
    };
    for (const n of UPPER) {
      for (const ax of [0, 1, 2] as const) {
        const i = w.body.dofByName(n, ax);
        if (i < 0) continue;
        const d = w.body.dofs[i]!;
        const baseScale = Math.max(0, envN('SQC_UPPER_BASE_SCALE', 1));
        const sagAct = ax === 2 ? Math.max(0, envN('SQC_UPPER_SAG_ACT_SCALE', 1)) : 1;
        const base = clamp(cmd.base.get(i) ?? 0, -d.tauMax, d.tauMax) * baseScale * sagAct;
        const baseOn = envN('SQC_UPPER_BASE_ON', 1) !== 0;
        const spinePairOn = n !== 'neck' && envN('SQC_SPINE_PAIR', 0) === 1 && (ax === 0 || envN('SQC_SPINE_PAIR_ALL', 0) === 1);
        if (baseOn && base !== 0 && !spinePairOn) {
          propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'support', tau: base, src: 'squat.upperBase' });
        }
        if (baseOnly) continue;
        if (spinePairOn) {
          const target0 = cmd.targets.get(i) ?? d.angle;
          const cfg: JointConfig = {
            inertia: Math.max(0.02, d.inertia), jointDamping: envN('SQC_SPINE_DAMP', 0),
            ref: target0, base, co: envN('SQC_SPINE_CO', 0.15), kp: kp, kd: kd, compression: 1,
            params: spineParams(Math.abs(num('SQC_SPINE_CAP', 120))),
          };
          const m = spinePair(w, `${n}:${ax}`).step(d.angle, d.vel, w.dt, cfg);
          if (Math.abs(m.torque) > 1e-6) {
            propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'support', tau: m.torque, src: 'squat.spinePair' });
          }
          continue;
        }
        const v0 = vm.get(i) ?? d.vel;
        const v = v0 + (d.vel - v0) * lp;
        vm.set(i, v);
        const target = cmd.targets.get(i) ?? d.angle;
        const e = target - d.angle;
        const useKp = ax === 2 ? kp : kpLat;
        const useKd = ax === 2 ? kdSag : kdLat;
        const useCap = ax === 2 ? cap : capLat;
        let right = 0;
        if (ax === 2 && n !== 'neck') {
          right = (torsoTorque * (torsoW[n] ?? 0)) / wSum;
        } else if (ax === 2 && n === 'neck') {
          right = clamp(Math.abs(num('SQC_UPPER_NECK_KP', 40)) * e - Math.abs(num('SQC_UPPER_NECK_KD', 6)) * v, -cap, cap) * cmd.ramp;
        } else {
          right = clamp(useKp * e - useKd * v, -useCap, useCap) * cmd.ramp * sagAct;
        }
        if (n === 'spine1' && ax === 2) {
          const maxDef = Math.abs(num('SQC_UPPER_H_MAXDEF', 0.12));
          let hCorr = cmd.hCorr * Math.abs(num('SQC_UPPER_H_PD_SCALE', 0.2));
          if (hCorr * (d.angle - target) > 0 && Math.abs(d.angle - target) >= maxDef) hCorr = 0;
          right = clamp(right + hCorr, -d.tauMax, d.tauMax);
        }
        if (right !== 0) {
          propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'active', tau: right, src: 'squat.upperRighting' });
        }
      }
    }
  }
}
