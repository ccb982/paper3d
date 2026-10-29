/** _probe-support-axis: 静态给 knee/2 已知力矩，测 comY 方向 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_TASKPD='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_ANKLE_FF='0'; env.SQC_FP_FOOT_K='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const side=(env.SU_SIDE??'l') as 'l'|'r'; const tau=Number(env.SU_TAU??10); const di=w.body.dofByName(`knee_${side}`,2);
let y0=NaN;
for(let s=0;s<Math.round(2.6/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{if(t>=2.05&&t<2.15&&di>=0)w.executor.addTorque(di,tau);});
 supportClean(ctx,'r');supportClean(ctx,'l');squatFrame(w,ctl,court);
 if(t<2.04)y0=ctl.sensors.com[1]!;
 if(t>=2.45){const y=ctl.sensors.com[1]!;console.log(`END ${side} tau=${tau} comY0=${(y0*100).toFixed(2)} comY=${(y*100).toFixed(2)} Δ=${((y-y0)*100).toFixed(2)}cm knee2=${(w.body.dofs[di]!.angle*57.3).toFixed(1)}`);break;}
}
