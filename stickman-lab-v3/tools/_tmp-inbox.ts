import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
import { isLiftDone } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const UB = ['torso','spine4','spine3','spine2','head','neck'];
let pv: any = null;
const ubAcc = (): { ax: number; az: number } => {
  let vx=0,vz=0,mm=0;
  for (const k of UB) { const ix=body.indexByKey.get(k); if(ix===undefined)continue; const b=body.bodies[ix]; const v=b.linvel(); vx+=v.x*b.mass(); vz+=v.z*b.mass(); mm+=b.mass(); }
  vx/=mm; vz/=mm;
  if (!pv) { pv={x:vx,z:vz}; return {ax:0,az:0}; }
  const a = { ax: (vx-pv.x)*240*100, az: (vz-pv.z)*240*100 };
  pv={x:vx,z:vz};
  return a;
};
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const T = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di<0) return NaN; const b = dr.lastBreakdown[di] as any; return b ? ((b.act||0)) : NaN; };
console.log('t | pitchRel | tiltRel | UBaz | UBax | hip2act | sp1x2act | sp1x0act | hip0act');
for (let s = 0; s < Math.round(4.1 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.0 && t < 4.05 && s % 12 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const a = ubAcc();
    const flag = isLiftDone() ? 'B' : ' ';
    console.log(`${t.toFixed(2)}${flag}| ${U.pitchRelDeg.toFixed(1).padStart(6)} | ${U.tiltRelDeg.toFixed(1).padStart(6)} | ${a.az.toFixed(0).padStart(5)} | ${a.ax.toFixed(0).padStart(5)} | ${T('hip_r',2).toFixed(0).padStart(5)} | ${T('spine1',2).toFixed(0).padStart(5)} | ${T('spine1',0).toFixed(0).padStart(5)} | ${T('hip_r',0).toFixed(0).padStart(5)}`);
  }
}
