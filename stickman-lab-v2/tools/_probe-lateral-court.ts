/** _probe-lateral-court: 法庭释放前后 横向 CoM/CoP/脚/髋 回读 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { baseAng } from '../src/core/servo/baseTable';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World(); const ctl = new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const report=(tag:string):void=>{
  const b=(ctl.warner as unknown as {squatBaseBuf():Float64Array|null}).squatBaseBuf();
  const com=ctl.sensors.com, cv=ctl.sensors.comVel;
  console.log(`--- ${tag} t=${court.t.toFixed(3)} comX=${(com[0]!*100).toFixed(1)} comZ=${(com[2]!*100).toFixed(1)} vZ=${(cv[2]!*100).toFixed(1)}`);
  for (const sd of ['l','r'] as const) {
    const f=ctl.sensors.feet[sd==='l'?0:1]!;
    const hi=w.body.dofByName(`hip_${sd}`,0), ki=w.body.dofByName(`knee_${sd}`,0);
    const hd=w.body.dofs[hi]!, kd=w.body.dofs[ki]!;
    const h1=w.body.dofByName(`hip_${sd}`,1), k1=w.body.dofByName(`knee_${sd}`,1), f0=w.body.dofByName(`foot_${sd}`,0);
    const h1d=w.body.dofs[h1]!, k1d=w.body.dofs[k1]!, f0d=w.body.dofs[f0]!;
    console.log(`${sd} fz=${f.fz.toFixed(0)} copX=${(f.copX*100).toFixed(1)} copZ=${(f.copZ*100).toFixed(1)} footZ=${(f.z*100).toFixed(1)} hip0=${(hd.angle*57.3).toFixed(1)} knee0=${(kd.angle*57.3).toFixed(1)} hip0app=${w.executor.ledger[hi]!.applied.toFixed(1)} pair=${w.executor.ledger[hi]!.pair.toFixed(1)} hip0base=${(b?b[hi]??0:0).toFixed(1)} ref=${((baseAng(`hip_${sd}`,0)??NaN)*57.3).toFixed(1)} h1=${(h1d.angle*57.3).toFixed(1)} k1=${(k1d.angle*57.3).toFixed(1)} f0=${(f0d.angle*57.3).toFixed(1)}`);
  }
};
for(let s=0;s<Math.round(4.0/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 const t=court.t;
 if ([1.90,2.00,2.20,2.50,2.80,3.10,3.40,3.70].some(x=>Math.abs(t-x)<w.dt*0.55)) report(t.toFixed(2));}
