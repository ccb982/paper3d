import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const pelvRoll = (): number => {
  const ix = body.indexByKey.get('pelvis');
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  const up = { x: 2*(q.x*q.y - q.w*q.z), y: 1-2*(q.x*q.x+q.z*q.z), z: 2*(q.y*q.z + q.w*q.x) };
  return Math.atan2(up.z, up.y) * 57.3;
};
const spAng = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
console.log('t | 骨盆世界roll | hipR0角 | hipL0角 | hipR0: stiff act servo damp ff | hipL0: act servo');
for (let s = 0; s < Math.round(3.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.9 && s % 12 === 0) {
    const br = (n: string): any => ctl.warner.drive.lastBreakdown[body.dofByName(n, 0)] as any;
    const r = br('hip_r'), l = br('hip_l');
    const F = (b: any, k: string): string => (b ? (b[k] || 0).toFixed(0) : '0').padStart(4);
    console.log(`${t.toFixed(2)} | ${pelvRoll().toFixed(1)} | ${spAng('hip_r',0).toFixed(0)} | ${spAng('hip_l',0).toFixed(0)} | ${F(r,'stiff')} ${F(r,'act')} ${F(r,'servo')} ${F(r,'damp')} ${F(r,'ff')} | ${F(l,'act')} ${F(l,'servo')}`);
  }
}
