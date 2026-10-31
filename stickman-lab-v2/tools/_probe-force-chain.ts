import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatResetLimits } from '../src/core/servo/squat';
import { staticBalance } from '../src/core/servo/staticBalance';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl; w.reset(); ctl.actions.idleEnabled = false; ctl.manual.clear(); squatResetLimits(w);
squatCourtSetup(w, ctl, 2.0);

const body = w.body;
const W = w.sk.massTotal * 9.81;
const com = new Float64Array(3); body.com(com);
const fpos = (side: 'l' | 'r') => {
  const bi = body.indexByKey.get(`foot_${side}`)!;
  return body.bodies[bi]!.translation();
};
const fl = fpos('l'), fr = fpos('r');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const foot = (side: 'l' | 'r') => {
  const p = side === 'l' ? fl : fr;
  const z = clamp(com[2]!, p.z - 0.06, p.z + 0.06);
  const x = clamp(com[0]!, p.x - 0.12, p.x + 0.12);
  return { N: W / 2, copX: x, copZ: z };
};
const l = foot('l'), r = foot('r');
const buf = new Float64Array(body.dofs.length);
staticBalance(body, buf, { l, r });

console.log(`W=${W.toFixed(1)}N com=(${(com[0] * 100).toFixed(1)},${(com[2] * 100).toFixed(1)})cm`);
console.log(`footL=(${(fl.x * 100).toFixed(1)},${(fl.z * 100).toFixed(1)}) footR=(${(fr.x * 100).toFixed(1)},${(fr.z * 100).toFixed(1)})`);
console.log(`copL=(${(l.copX * 100).toFixed(1)},${(l.copZ * 100).toFixed(1)}) copR=(${(r.copX * 100).toFixed(1)},${(r.copZ * 100).toFixed(1)})`);
console.log('joint axis angle tauReq tauCap util%');
for (const d of body.dofs) {
  if (!/^(hip|knee|foot)_/.test(d.name)) continue;
  const tau = buf[d.dofIndex] ?? 0;
  const cap = d.tauMax || 1;
  console.log(`${d.name}/${d.axis} ${(d.angle * 57.3).toFixed(1)} ${tau.toFixed(1)} ${cap.toFixed(0)} ${(Math.abs(tau) / cap * 100).toFixed(1)}`);
}

// 静态力链闭合条件
const supZmin = Math.min(fl.z, fr.z) - 0.10;
const supZmax = Math.max(fl.z, fr.z) + 0.10;
const supXmin = Math.min(fl.x, fr.x) - 0.156;
const supXmax = Math.max(fl.x, fr.x) + 0.156;
const nOk = Math.abs(l.N + r.N - W) < 1e-6;
const copOk = com[2]! >= supZmin && com[2]! <= supZmax && com[0]! >= supXmin && com[0]! <= supXmax;
console.log(`CHECK N=${nOk} CoP=${copOk} supportX=[${(supXmin*100).toFixed(1)},${(supXmax*100).toFixed(1)}] supportZ=[${(supZmin*100).toFixed(1)},${(supZmax*100).toFixed(1)}]`);
