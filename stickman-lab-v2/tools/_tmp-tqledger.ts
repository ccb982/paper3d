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
  if (di < 0) return { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0, tot: 0 };
  const b = drive?.lastBreakdown?.[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
  return { ...b, tot: b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp };
};
console.log('t | 摆髋L_2(servo) | 摆膝L_2 | 支髋R_2(ff=锚) | sp1_2 servo/act/damp | sp2_2 servo/act/damp | 摆髋L角度° 支髋R角度°');
for (let s = 0; s < Math.round(3.7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 3.6) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const s1 = bd('spine1', 2), s2 = bd('spine2', 2), hl = bd('hip_l', 2), hr = bd('hip_r', 2);
  const ang = (n: string) => { const di = w.body.dofByName(n, 2); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  console.log(`${t.toFixed(1)} | ${hl.tot.toFixed(0).padStart(5)}(srv ${hl.servo.toFixed(0).padStart(4)}) | ${bd('knee_l', 2).tot.toFixed(0).padStart(5)} | ${hr.tot.toFixed(0).padStart(5)}(ff ${hr.ff.toFixed(0).padStart(4)}) | ${s1.servo.toFixed(0).padStart(5)}/${s1.act.toFixed(0).padStart(4)}/${s1.damp.toFixed(0).padStart(4)} | ${s2.servo.toFixed(0).padStart(5)}/${s2.act.toFixed(0).padStart(4)}/${s2.damp.toFixed(0).padStart(4)} | ${ang('hip_l').toFixed(0).padStart(6)} ${ang('hip_r').toFixed(0).padStart(6)}`);
}
