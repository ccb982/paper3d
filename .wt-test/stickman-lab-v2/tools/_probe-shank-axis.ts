/** _probe-shank-axis: 固定脚，给 knee/1 或 foot/0 力矩，测小腿相对脚底角度 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_SPD='0'; env.SQC_HIP_LEVEL='0'; env.SQC_ANKLE_FF='0'; env.SQC_ANKLE_ASSIST='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const side=(env.SQC_SA_SIDE??'l') as 'l'|'r'; const axis=(env.SQC_SA_AXIS??'knee') as 'knee'|'foot';
const tau=Number(env.SQC_SA_TAU??10);
const di=w.body.dofByName(`${axis}_${side}`, axis==='knee'?1:0);
const ki=w.body.dofByName(`knee_${side}`,2), ai=w.body.dofByName(`foot_${side}`,2);
for(let s=0;s<Math.round(2.4/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{if(t>=2.05&&t<2.15&&di>=0)w.executor.addTorque(di,tau);});
 squatFrame(w,ctl,court);
}
const kd=w.body.dofs[ki]!, ad=w.body.dofs[ai]!;
const dz=kd.anchorWorld[2]!-ad.anchorWorld[2]!, dy=Math.max(0.05,kd.anchorWorld[1]!-ad.anchorWorld[1]!);
console.log('END',side,axis,'tau',tau,'tilt_deg',Math.atan2(dz,dy)*57.3,'knee1',(w.body.dofByName(`knee_${side}`,1)>=0?w.body.dofs[w.body.dofByName(`knee_${side}`,1)]!.angle*57.3:0),'foot0',(w.body.dofs[w.body.dofByName(`foot_${side}`,0)]!.angle*57.3));
