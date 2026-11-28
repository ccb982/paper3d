import './_boot';
import { readFileSync } from 'node:fs';
import { solveContactIdQp, solveContactIdWrenchQp } from '../src/core/servo/contactIdQp';

const raw = JSON.parse(readFileSync('.tmp/contact-id-fixture.json', 'utf8')) as {
  massMatrix?: number[][];
  M?: number[][];
  G?: number[];
  qdd?: number[];
  jacobians?: number[][][];
  contacts?: Array<{ halfX?: number; halfZ?: number; mu?: number; fzMin?: number }>;
  torqueMax?: number[];
};
const M = raw.massMatrix ?? raw.M;
const J = raw.jacobians ?? [];
if (!M || !raw.G || !J.length) throw new Error('fixture missing M/G/Jc');
const solver = process.env.WRENCH_ONLY === '1' ? solveContactIdWrenchQp : solveContactIdQp;
const out = solver({
  massMatrix: M,
  gravity: raw.G,
  qddTarget: raw.qdd ?? new Array(M.length).fill(0),
  contacts: J.map((jacobian, i) => ({
    jacobian,
    halfX: raw.contacts?.[i]?.halfX ?? 0.12,
    halfZ: raw.contacts?.[i]?.halfZ ?? 0.06,
    mu: raw.contacts?.[i]?.mu ?? 0.7,
    fzMin: raw.contacts?.[i]?.fzMin ?? 0,
    wrenchRef: [(raw.contacts?.[i] as unknown as { fx?: number })?.fx ?? 0, (raw.contacts?.[i] as unknown as { fy?: number })?.fy ?? 0, (raw.contacts?.[i] as unknown as { fz?: number })?.fz ?? 0, 0, 0, (raw.contacts?.[i] as unknown as { tz?: number })?.tz ?? 0],
  })),
  torqueMax: raw.torqueMax ?? new Array(M.length - 6).fill(1000),
  qddWeight: 100,
});
console.log(JSON.stringify({ feasible: out.feasible, message: out.message, qdd: out.qdd.slice(0, 6), tau: out.tau.slice(0, 8), wrenches: out.wrenches }, null, 2));
