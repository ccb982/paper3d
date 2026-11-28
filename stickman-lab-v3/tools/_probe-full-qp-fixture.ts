import './_boot';
import { readFileSync } from 'node:fs';
import { solveContactIdQp } from '../src/core/servo/contactIdQp';

const raw = JSON.parse(readFileSync('.tmp/contact-id-fixture.json', 'utf8')) as {
  M?: number[][]; G?: number[]; qdd?: number[]; jacobians?: number[][][];
  contacts?: Array<{ halfX?: number; halfZ?: number; mu?: number; fzMin?: number }>;
  torqueMax?: number[];
  tau?: number[];
};
const M = raw.M;
const G = raw.G;
const J = raw.jacobians ?? [];
if (!M || !G || !J.length) throw new Error('missing fixture');
const ndof = M.length - 6;
const out = solveContactIdQp({
  massMatrix: M, gravity: G, qddTarget: raw.qdd ?? new Array(M.length).fill(0),
  contacts: J.map((jacobian, i) => ({ jacobian, halfX: raw.contacts?.[i]?.halfX ?? 0.12, halfZ: raw.contacts?.[i]?.halfZ ?? 0.06, mu: raw.contacts?.[i]?.mu ?? 0.7, fzMin: raw.contacts?.[i]?.fzMin ?? 0 })),
  torqueMax: raw.torqueMax ?? new Array(ndof).fill(1000), qddWeight: 100,
});
let baseMax = 0;
if (out.feasible) {
  for (let a = 0; a < 6; a++) {
    let s = -(G[a] ?? 0);
    for (let c = 0; c < M.length; c++) s += M[a]![c]! * (out.qdd[c] ?? 0);
    for (let ci = 0; ci < J.length; ci++) for (let r = 0; r < 6; r++) s -= (J[ci]![r]?.[a] ?? 0) * (out.wrenches[ci]?.[r] ?? 0);
    baseMax = Math.max(baseMax, Math.abs(s));
  }
}
let cwc = true;
for (const W of out.wrenches) {
  const fy = W[1] ?? 0;
  if (fy < 0 || Math.abs(W[0] ?? 0) > 0.7 * fy + 1e-6 || Math.abs(W[2] ?? 0) > 0.7 * fy + 1e-6) cwc = false;
}
const signMatch = (raw.tau ?? []).slice(0, Math.min(8, out.tau.length)).map((v, i) => Math.sign(v) === Math.sign(out.tau[i]!) || Math.abs(v) < 1e-6 || Math.abs(out.tau[i]!) < 1e-6);
console.log(JSON.stringify({ feasible: out.feasible, message: out.message, baseMax, cwc, qdd: out.qdd.slice(0, 6), tau: out.tau.slice(0, 8), oldTau: (raw.tau ?? []).slice(0, 8), signMatch }, null, 2));
