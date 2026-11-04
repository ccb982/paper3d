import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { setBaseState } from '../src/core/servo/baseTable';
import { upperBodyCommand } from '../src/core/servo/upperBodyCommand';
import type { CourtState as CS } from '../src/core/court';
import { PROPOSALS } from '../src/core/proposalBus';

const w = new World();
w.reset();
w.switchPoseState('squat');
setBaseState('squat');
const torso = w.body.indexByKey.get('torso')!;
const rb = w.body.bodies[torso]!;
const p0 = { ...rb.translation() };
const q0 = { ...rb.rotation() };
w.setGravity(-9.81);

const names = ['spine1', 'spine2', 'spine3', 'neck'] as const;
const di = new Map<string, number>();
for (const n of names) di.set(n, w.body.dofByName(n, 2));
const q0j = new Map<string, number>();
for (const n of names) q0j.set(n, w.body.dofs[di.get(n)!]!.angle);

w.controller = { step(): void { for (const p of PROPOSALS) if (p.kind === 'ext') w.executor.addTorque(p.dof, p.tau ?? 0); PROPOSALS.length = 0; } };
const fake = { t: 0, settle: 0, p0: 0, released: true } as unknown as CS;
const SEC = Number(process.env.SEC ?? 3);
let maxDev = 0;
let maxTau = 0;
for (let s = 0; s < Math.round(SEC / w.dt); s++) {
  w.advance(1, () => {
    rb.setTranslation(p0, true);
    rb.setRotation(q0, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    upperBodyCommand(w, fake);
    fake.t += w.dt;
  });
  let dev = 0;
  for (const n of names) {
    const i = di.get(n)!;
    const d = w.body.dofs[i]!;
    dev = Math.max(dev, Math.abs(d.angle - q0j.get(n)!));
    maxTau = Math.max(maxTau, Math.abs(w.executor.ledger[i]!.applied));
  }
  maxDev = Math.max(maxDev, dev);
  if ((s + 1) % Math.round(0.05 / w.dt) === 0 && fake.t < 1.2) {
    console.log(`t=${fake.t.toFixed(2)} ` + names.map((n) => { const i = di.get(n)!; const d = w.body.dofs[i]!; const u = d.axisWorld; return `${n} q=${(d.angle*57.3).toFixed(1)} v=${d.vel.toFixed(2)} tau=${w.executor.ledger[i]!.applied.toFixed(0)} ax=(${u[0]!.toFixed(2)},${u[1]!.toFixed(2)},${u[2]!.toFixed(2)})`; }).join(' | '));
  }
}
console.log(`SUMMARY maxDev=${(maxDev * 57.3).toFixed(1)}deg maxTau=${maxTau.toFixed(0)} end=` +
  names.map((n) => ((w.body.dofs[di.get(n)!]!.angle - q0j.get(n)!) * 57.3).toFixed(1)).join(','));
