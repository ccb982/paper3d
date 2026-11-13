import type { World } from '../world';
import type { SquatFrame } from './frame';
import { SquatModel } from './model';
import { solveSquat3d, type Squat3dOutput } from './qp3d';

export interface Squat2Command {
  tau: Float64Array;
  qp: Squat3dOutput;
  debug: { bias: number[]; qddTerm: number[]; contactTerm: number[]; fL: number[]; fR: number[] };
}

export function computeSquat2Command(w: World, frame: SquatFrame): Squat2Command {
  const axes: number[] = [];
  for (const side of ['l', 'r'] as const) {
    for (const [joint, ax] of [['hip', 0], ['hip', 1], ['hip', 2], ['knee', 0], ['knee', 1], ['knee', 2], ['foot', 0], ['foot', 1], ['foot', 2]] as const) {
      const i = w.body.dofByName(`${joint}_${side}`, ax);
      if (i >= 0) axes.push(i);
    }
  }
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
    if (!c) return [new Array(axes.length).fill(0), new Array(axes.length).fill(0), new Array(axes.length).fill(0)];
    const J = new Float64Array(w.body.dofs.length * 3);
    model.pointJacobian(c.x, c.y, c.z, J);
    return [0, 1, 2].map((k) => axes.map((a, idx) => {
      if (side === 'l' && idx >= 9) return 0;
      if (side === 'r' && idx < 9) return 0;
      return J[3 * a + k]!;
    }));
  };
  const jFootL = footJ('l');
  const jFootR = footJ('r');
  const angJ = (side: 'l' | 'r'): number[][] => [0, 2].map((k) => axes.map((a, idx) => {
    if (side === 'l' && idx >= 3) return 0;
    if (side === 'r' && idx < 3) return 0;
    return w.body.dofs[a]!.axisWorld[k]!;
  }));
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const qp = solveSquat3d({
    mass,
    bias: axes.map((a) => h[a] ?? 0),
    jCom,
    jFootL,
    jFootR,
    jFootAngularL: angJ('l'),
    jFootAngularR: angJ('r'),
    axis: axes.map((a) => [w.body.dofs[a]!.axisWorld[0]!, w.body.dofs[a]!.axisWorld[1]!, w.body.dofs[a]!.axisWorld[2]!]),
    com: frame.com,
    comTarget: frame.comTarget,
    comVel: frame.comVel,
    bodyMass: w.sk.massTotal,
    mu: 0.6,
    tauMin: axes.map((a) => -w.body.dofs[a]!.tauMax),
    tauMax: axes.map((a) => w.body.dofs[a]!.tauMax),
    q: axes.map((a) => frame.q[a]!),
    qd: axes.map((a) => frame.qd[a]!),
    qTarget: axes.map((a) => frame.qTarget[a]!),
    qMin: axes.map((a) => w.body.dofs[a]!.min),
    qMax: axes.map((a) => w.body.dofs[a]!.max),
    dt: w.dt,
    footXL: frame.contacts.find((c) => c.side === 'l')?.x ?? 0,
    footXR: frame.contacts.find((c) => c.side === 'r')?.x ?? 0,
    footZL: frame.contacts.find((c) => c.side === 'l')?.z ?? 0,
    footZR: frame.contacts.find((c) => c.side === 'r')?.z ?? 0,
    copMinXL: frame.support.minX, copMaxXL: frame.support.maxX,
    copMinZL: frame.support.minZ, copMaxZL: frame.support.maxZ,
    copMinXR: frame.support.minX, copMaxXR: frame.support.maxX,
    copMinZR: frame.support.minZ, copMaxZR: frame.support.maxZ,
    wCom: Number(env.SQC_SQ2_WCOM ?? 1000000),
    wPosture: Number(env.SQC_SQ2_WPOST ?? 100),
    wFoot: Number(env.SQC_SQ2_WFOOT ?? 100),
  });
  const tau = new Float64Array(w.body.dofs.length);
  axes.forEach((a, k) => { tau[a] = qp.tau[k]!; });
  const qddTerm = mass.map((row) => row.reduce((s, v, j) => s + v * qp.qdd[j]!, 0));
  const contactTerm = axes.map((_, r) => qp.fL[0]! * jFootL[0]![r]! + qp.fL[1]! * jFootL[1]![r]! + qp.fL[2]! * jFootL[2]![r]! + qp.fR[0]! * jFootR[0]![r]! + qp.fR[1]! * jFootR[1]![r]! + qp.fR[2]! * jFootR[2]![r]!);
  return { tau, qp, debug: { bias: axes.map((a) => h[a] ?? 0), qddTerm, contactTerm, fL: qp.fL, fR: qp.fR } };
}
