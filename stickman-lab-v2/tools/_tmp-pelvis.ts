import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
const keys: string[] = [];
for (const k of body.indexByKey.keys()) keys.push(String(k));
console.log('体段键(含 pelv/hip/root/waist/torso):', keys.filter((k) => /pelv|hip|root|waist|torso/i.test(k)).join(','));
ctl.actions.play('singleLegR');
const bd = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 'n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return '-';
  return (b.act + b.servo + b.ff + b.damp).toFixed(0);
};
const wv = (k: string): string => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return 'n/a';
  const a = body.bodies[ix].angvel();
  return ((a.x * 57.3).toFixed(0) + '/' + (a.y * 57.3).toFixed(0) + '/' + (a.z * 57.3).toFixed(0));
};
console.log('t | hipR0 | hipR1 | hipR2 | hipL0 | 骨盆体ω(x/y/z°/s)');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  if (s % 24 === 0 && s * w.dt > 2.7 && s * w.dt < 3.8) {
    const pelvisKey = keys.find((k) => /pelv|root|hips/i.test(k)) ?? 'torso';
    console.log(`${(s * w.dt).toFixed(2)} | ${bd('hip_r', 0)} | ${bd('hip_r', 1)} | ${bd('hip_r', 2)} | ${bd('hip_l', 0)} | ${wv(pelvisKey)} (${pelvisKey})`);
  }
}
