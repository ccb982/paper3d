import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const IAP = drive?.opt?.iapSpineStiffness ?? 180;
const bd = (n: string, ax: number) => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0, tot: 0, ang: 0 };
  const b = drive?.lastBreakdown?.[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
  return { ...b, tot: b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp, ang: w.body.dofs[di]!.angle * 57.3 };
};
const f1 = (v: number) => v.toFixed(0).padStart(5);
console.log('=== 脊柱1/2/3 轴2（矢状）力矩分解 [servo/act/stiff/lum/damp | IAP估 | 总] (角度°) ===');
console.log('t     | sp1: srv  act  stf  lum damp | IAP | tot (ang) | sp2 tot (ang) | sp3 tot (ang)');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 3.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const a = bd('spine1', 2), b = bd('spine2', 2), c = bd('spine3', 2);
  const iap1 = IAP * (0 - a.ang / 57.3);
  console.log(`${t.toFixed(1)} | ${f1(a.servo)} ${f1(a.act)} ${f1(a.stiff)} ${f1(a.lum)} ${f1(a.damp)} | ${f1(iap1)} | ${f1(a.tot)} (${a.ang.toFixed(0)}) | ${f1(b.tot)} (${b.ang.toFixed(0)}) | ${f1(c.tot)} (${c.ang.toFixed(0)})`);
}
console.log('=== 髋/膝/踝 力矩 [总(srv/act/ff)] × (角度°) ===');
console.log('t     | 摆髋L2 (srv) | 摆膝L2 | 摆踝L2 | 支髋R2 (srv/ff) | 支髋R0 (ab)');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 3.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const hl = bd('hip_l', 2), kl = bd('knee_l', 2), fl = bd('foot_l', 2), hr = bd('hip_r', 2), hr0 = bd('hip_r', 0);
  console.log(`${t.toFixed(1)} | ${f1(hl.tot)} (${f1(hl.servo)}) (${hl.ang.toFixed(0)}) | ${f1(kl.tot)} (${kl.ang.toFixed(0)}) | ${f1(fl.tot)} (${fl.ang.toFixed(0)}) | ${f1(hr.tot)} (${f1(hr.servo)}/${f1(hr.ff)}) (${hr.ang.toFixed(0)}) | ${f1(hr0.tot)} (${hr0.ang.toFixed(0)})`);
}
