/** _probe-sag-axis: 给 knee/2 或 foot/2 已知力矩，测矢状小腿角方向 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_TASKPD='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_ANKLE_FF='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const side=(env.SA_SIDE??'l') as 'l'|'r';
const part=(env.SA_PART??'knee') as 'knee'|'foot';
const tau=Number(env.SA_TAU??10);
const di=w.body.dofByName(`${part}_${side}`,2);
const ki=w.body.dofByName(`knee_${side}`,2), ai=w.body.dofByName(`foot_${side}`,2);
let before=NaN;
for(let s=0;s<Math.round(2.5/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{if(t>=2.05&&t<2.10&&di>=0)w.executor.addTorque(di,tau);});
 squatFrame(w,ctl,court);
 const kd=w.body.dofs[ki]!, ad=w.body.dofs[ai]!;
 const sag=Math.atan2(kd.anchorWorld[0]!-ad.anchorWorld[0]!,Math.max(0.05,kd.anchorWorld[1]!-ad.anchorWorld[1]!));
 if(t<2.04) before=sag;
 if(t>=2.3){console.log(`END ${side} ${part} tau=${tau} sag0=${(before*57.3).toFixed(2)}° sag=${(sag*57.3).toFixed(2)}° Δ=${((sag-before)*57.3).toFixed(2)}° comX=${(ctl.sensors.com[0]!*100).toFixed(2)}`);break;}
}
