import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const bd = (n: string, ax: number) => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0, tot: 0, ang: 0, vel: 0 };
  const b = drive?.lastBreakdown?.[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
  const d = w.body.dofs[di]!;
  return { ...b, tot: b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp, ang: d.angle * 57.3, vel: d.vel };
};
console.log('t | 摆踝L2: ang vel [srv ff act damp] | 摆膝L2: ang vel [srv ff act damp] | 摆足L0: ang vel [srv ff act damp]');
for (let s = 0; s < Math.round(3.7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 3.4) continue;
  if (s % 4 !== 0) continue;
  const a = bd('foot_l', 2), k = bd('knee_l', 2), f = bd('foot_l', 0);
  const fmt = (x: ReturnType<typeof bd>) => `${x.ang.toFixed(1).padStart(6)} ${(x.vel).toFixed(1).padStart(6)} [${x.servo.toFixed(0).padStart(4)} ${x.ff.toFixed(0).padStart(4)} ${x.act.toFixed(0).padStart(4)} ${x.damp.toFixed(0).padStart(4)}]`;
  console.log(`${t.toFixed(3)} | ${fmt(a)} | ${fmt(k)} | ${fmt(f)}`);
}
