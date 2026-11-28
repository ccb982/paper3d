import './_boot';
import { readFileSync } from 'node:fs';
import { solveContactIdWrenchQp } from '../src/core/servo/contactIdQp';
const raw = JSON.parse(readFileSync('.tmp/contact-id-fixture.json', 'utf8')) as {
  M?: number[][]; G?: number[]; qdd?: number[]; jacobians?: number[][][];
  contacts?: Array<{ x?: number; halfX?: number; halfZ?: number; mu?: number; fzMin?: number }>;
  torqueMax?: number[]; dofNames?: string[];
};
if (!raw.M || !raw.G || !raw.jacobians?.length) throw new Error('no fixture');
const ndof = raw.M.length - 6;
const out = solveContactIdWrenchQp({
  massMatrix: raw.M, gravity: raw.G, qddTarget: (raw.qdd ?? new Array(raw.M.length).fill(0)).map((v, k) => (k < 6 ? 0 : v)),
  contacts: raw.jacobians.map((jacobian, i) => ({ jacobian, halfX: raw.contacts?.[i]?.halfX ?? 0.12, halfZ: raw.contacts?.[i]?.halfZ ?? 0.06, mu: raw.contacts?.[i]?.mu ?? 0.7, fzMin: raw.contacts?.[i]?.fzMin ?? 0 })),
  torqueMax: raw.torqueMax ?? new Array(ndof).fill(1000),
});
const names = raw.dofNames ?? [];
for (const key of ['hip_l/2', 'knee_l/2', 'foot_l/2', 'hip_r/2', 'knee_r/2', 'foot_r/2']) {
  const j = names.indexOf(key);
  console.log(key, 'idx', j, 'tau', j >= 0 ? out.tau[j] : null);
}
for (let ci = 0; ci < out.wrenches.length; ci++) {
  const W = out.wrenches[ci]!;
  const c = raw.contacts?.[ci];
  console.log('contact', ci, 'fy', W[1], 'tz', W[5], 'cop', c?.x !== undefined && W[1] ? c.x + W[5]! / W[1]! : null);
}
console.log('qdd0..5', out.qdd.slice(0, 6), 'feasible', out.feasible, out.message);
