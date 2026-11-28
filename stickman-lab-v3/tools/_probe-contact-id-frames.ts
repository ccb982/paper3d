import './_boot';
import { readFileSync } from 'node:fs';
import { solveContactIdQp } from '../src/core/servo/contactIdQp';
import { planFootOrientationTask } from '../src/core/servo/footOrientationTask';

type Frame = {
  M?: number[][]; G?: number[]; qdd?: number[]; jacobians?: number[][][];
  contacts?: Array<{ halfX?: number; halfZ?: number; mu?: number; fzMin?: number }>;
  torqueMax?: number[];
  footData?: Array<{ actualQ: { x: number; y: number; z: number; w: number }; targetQ: { x: number; y: number; z: number; w: number } | null; angVel: { x: number; y: number; z: number }; jacobian: number[][] | null }>;
};
const frames = JSON.parse(readFileSync('.tmp/contact-id-fixture-frames.json', 'utf8')) as Frame[];
const useTask = process.env.FOOT_TASK === '1';
const taskWeight = Number(process.env.FOOT_TASK_WEIGHT ?? 1);
const qddWeight = Number(process.env.QDD_WEIGHT ?? 100);
let ok = 0, fail = 0, totalMs = 0, maxMs = 0, maxTau = 0, maxTaskErr = 0;
for (const f of frames) {
  if (!f.M || !f.G || !f.jacobians) { fail++; continue; }
  const tasks = useTask ? (f.footData ?? []).filter((x) => x.targetQ && x.jacobian).map((x) => {
    const t = planFootOrientationTask({ actualQ: x.actualQ, targetQ: x.targetQ!, angVel: x.angVel, kp: 100, kd: 10, accMax: 20 });
    return { jacobian: (x.jacobian ?? []).slice(3, 6), target: t.targetAcc, weight: 1 };
  }) : undefined;
  const t0 = performance.now();
  const out = solveContactIdQp({
    massMatrix: f.M, gravity: f.G, qddTarget: f.qdd ?? new Array(f.M.length).fill(0),
    contacts: f.jacobians.map((jacobian, i) => ({ jacobian, halfX: f.contacts?.[i]?.halfX ?? 0.12, halfZ: f.contacts?.[i]?.halfZ ?? 0.06, mu: f.contacts?.[i]?.mu ?? 0.7, fzMin: f.contacts?.[i]?.fzMin ?? 0 })),
    torqueMax: f.torqueMax ?? new Array(f.M.length - 6).fill(1000), qddWeight, tasks,
  });
  const ms = performance.now() - t0;
  totalMs += ms; maxMs = Math.max(maxMs, ms);
  if (out.feasible) ok++; else fail++;
  for (const v of out.tau) maxTau = Math.max(maxTau, Math.abs(v));
  for (const task of tasks ?? []) {
    for (let r = 0; r < task.jacobian.length; r++) {
      let v = 0;
      for (let a = 0; a < out.qdd.length; a++) v += (task.jacobian[r]?.[a] ?? 0) * (out.qdd[a] ?? 0);
      maxTaskErr = Math.max(maxTaskErr, Math.abs(v - (task.target[r] ?? 0)));
    }
  }
}
console.log(JSON.stringify({ frames: frames.length, ok, fail, meanMs: totalMs / Math.max(1, frames.length), maxMs, maxTau, maxTaskErr }, null, 2));
