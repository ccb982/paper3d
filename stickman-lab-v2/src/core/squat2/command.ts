import type { World } from '../world';
import type { SquatFrame } from './frame';
import { SquatModel } from './model';
import { solveSquat2Qp, type Squat2QpOutput } from './qp';

export interface Squat2Command {
  tau: Float64Array;
  qp: Squat2QpOutput;
  debug: { bias: number[]; qddTerm: number[]; contactTerm: number[]; fL: [number, number]; fR: [number, number] };
}

export function computeSquat2Command(w: World, frame: SquatFrame): Squat2Command {
  const axes = [
    w.body.dofByName('hip_l', 2), w.body.dofByName('knee_l', 2), w.body.dofByName('foot_l', 2),
    w.body.dofByName('hip_r', 2), w.body.dofByName('knee_r', 2), w.body.dofByName('foot_r', 2),
  ];
  const n = axes.length;
  const model = new SquatModel(w);
  const M = new Float64Array(n * n);
  model.massMatrix(axes, M);
  const mass = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => M[r * n + c]!));
  const h = new Float64Array(w.body.dofs.length);
  model.bias(h);
  const JcomRaw = new Float64Array(w.body.dofs.length * 3);
  model.comJacobian(JcomRaw);
  const jCom = [0, 1, 2].map((k) => axes.map((a) => JcomRaw[3 * a + k]!));
  const footJ = (side: 'l' | 'r'): number[][] => {
    const c = frame.contacts.find((x) => x.side === side);
    if (!c) return [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
    const J = new Float64Array(w.body.dofs.length * 3);
    model.pointJacobian(c.x, c.y, c.z, J);
    return [0, 1, 2].map((k) => axes.map((a, idx) => {
      if (side === 'l' && idx >= 3) return 0;
      if (side === 'r' && idx < 3) return 0;
      return J[3 * a + k]!;
    }));
  };
  const jFootL = footJ('l');
  const jFootR = footJ('r');
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const qp = solveSquat2Qp({
    mass,
    bias: axes.map((a) => h[a] ?? 0),
    jCom,
    jFootL,
    jFootR,
    com: frame.com,
    comTarget: frame.comTarget,
    comVel: frame.comVel,
    bodyMass: w.sk.massTotal,
    mu: 0.6,
    tauMin: axes.map((a) => w.body.dofs[a]!.tauMax * -1),
    tauMax: axes.map((a) => w.body.dofs[a]!.tauMax),
    qddMin: -100,
    qddMax: 100,
    fnMax: w.sk.massTotal * 9.81 * 2,
    wCom: Number(env.SQC_SQ2_WCOM ?? 100),
    wPosture: Number(env.SQC_SQ2_WPOST ?? 1000000),
    q: axes.map((a) => frame.q[a]!),
    qd: axes.map((a) => frame.qd[a]!),
    qTarget: axes.map((a) => frame.qTarget[a]!),
    qMin: axes.map((a) => w.body.dofs[a]!.min),
    qMax: axes.map((a) => w.body.dofs[a]!.max),
    dt: w.dt,
    footXL: frame.contacts.find((c) => c.side === 'l')?.x ?? 0,
    footXR: frame.contacts.find((c) => c.side === 'r')?.x ?? 0,
    copMinL: frame.support.minX, copMaxL: frame.support.maxX,
    copMinR: frame.support.minX, copMaxR: frame.support.maxX,
  });
  const tau = new Float64Array(w.body.dofs.length);
  axes.forEach((a, k) => { tau[a] = qp.tau[k]!; });
  const qddTerm = mass.map((row) => row.reduce((s, v, j) => s + v * qp.qdd[j]!, 0));
  const contactTerm = axes.map((_, r) => qp.fL[1] * jFootL[0]![r]! + qp.fL[0] * jFootL[1]![r]! + qp.fR[1] * jFootR[0]![r]! + qp.fR[0] * jFootR[1]![r]!);
  return { tau, qp, debug: { bias: axes.map((a) => h[a] ?? 0), qddTerm, contactTerm, fL: qp.fL, fR: qp.fR } };
}
