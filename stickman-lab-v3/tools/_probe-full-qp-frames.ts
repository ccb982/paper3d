import './_boot';
import { readFileSync } from 'node:fs';
import { solveContactIdQp } from '../src/core/servo/contactIdQp';

type Frame = {
  M?: number[][]; G?: number[]; qdd?: number[]; jacobians?: number[][][];
  contacts?: Array<{ halfX?: number; halfZ?: number; mu?: number; fzMin?: number }>;
  torqueMax?: number[]; dofNames?: string[];
  legId?: { l?: Record<string, number>; r?: Record<string, number> };
};
const frames = JSON.parse(readFileSync('.tmp/contact-id-fixture-frames.json', 'utf8')) as Frame[];
const tauWeight = Number(process.env.TAU_WEIGHT ?? 100);
let ok = 0, fail = 0, cwcAll = true, baseMax = 0, tauErrMax = 0, tauErrSum = 0, tauPeak = 0, count = 0;
for (const f of frames) {
  if (!f.M || !f.G || !f.jacobians) { fail++; continue; }
  const ndof = f.M.length - 6;
  const names = f.dofNames ?? [];
  const ref = new Array(ndof).fill(0);
  for (let j = 0; j < Math.min(ndof, names.length); j++) {
    const m = /^(hip|knee|foot)_(l|r)\/2$/.exec(names[j]!);
    if (!m) continue;
    const id = f.legId?.[m[2] as 'l' | 'r'];
    ref[j] = m[1] === 'hip' ? (id?.idHip ?? 0) : m[1] === 'knee' ? (id?.idKnee ?? 0) : (id?.idAnkle ?? 0);
  }
  const out = solveContactIdQp({
    massMatrix: f.M, gravity: f.G, qddTarget: f.qdd ?? new Array(f.M.length).fill(0),
    contacts: f.jacobians.map((jacobian, i) => ({ jacobian, halfX: f.contacts?.[i]?.halfX ?? 0.12, halfZ: f.contacts?.[i]?.halfZ ?? 0.06, mu: f.contacts?.[i]?.mu ?? 0.7, fzMin: f.contacts?.[i]?.fzMin ?? 0 })),
    torqueMax: f.torqueMax ?? new Array(ndof).fill(1000), qddWeight: 100,
    torqueRef: ref, tauWeight,
  });
  if (!out.feasible) { fail++; continue; }
  ok++; count++;
  for (let a = 0; a < 6; a++) {
    let s = -(f.G[a] ?? 0);
    for (let c = 0; c < f.M.length; c++) s += f.M[a]![c]! * (out.qdd[c] ?? 0);
    for (let ci = 0; ci < f.jacobians.length; ci++) for (let r = 0; r < 6; r++) s -= (f.jacobians[ci]![r]?.[a] ?? 0) * (out.wrenches[ci]?.[r] ?? 0);
    baseMax = Math.max(baseMax, Math.abs(s));
  }
  for (const W of out.wrenches) {
    const fy = W[1] ?? 0, mu = 0.7;
    if (fy < 0 || Math.abs(W[0] ?? 0) > mu * fy + 1e-6 || Math.abs(W[2] ?? 0) > mu * fy + 1e-6) cwcAll = false;
  }
  for (let j = 0; j < out.tau.length; j++) { tauPeak = Math.max(tauPeak, Math.abs(out.tau[j]!)); tauErrSum += Math.abs(out.tau[j]! - (ref[j] ?? 0)); }
  for (let j = 0; j < Math.min(out.tau.length, ref.length); j++) tauErrMax = Math.max(tauErrMax, Math.abs(out.tau[j]! - (ref[j] ?? 0)));
}
console.log(JSON.stringify({ frames: frames.length, ok, fail, baseMax, cwcAll, tauErrMax, tauErrMean: tauErrSum / Math.max(1, count * Math.max(1, (frames[0]?.M?.length ?? 6) - 6)), tauPeak }, null, 2));
