/** _probe-hip-axis: 静态 hip/1 力矩 → comZ / hip z */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_TASKPD='0'; env.SQC_HIP_TASK='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_ANKLE_FF='0'; env.SQC_FP_FOOT_K='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); const court=squatCourtSetup(w,ctl,2.0);
const side=(env.HA_SIDE??'l') as 'l'|'r'; const tau=Number(env.HA_TAU??10); const di=w.body.dofByName(`hip_${side}`,1); const hi=w.body.dofByName(`hip_${side}`,0);
let c0=NaN,z0=NaN;
for(let s=0;s<Math.round(2.5/w.dt);s++){const t=s*w.dt;w.advance(1,()=>{if(t>=2.05&&t<2.15&&di>=0)w.executor.addTorque(di,tau);});supportClean(ctx,'r');supportClean(ctx,'l');squatFrame(w,ctl,court);if(t<2.04){c0=ctl.sensors.com[2]!;z0=w.body.dofs[hi]!.anchorWorld[2]!;}if(t>=2.4){const c=ctl.sensors.com[2]!,z=w.body.dofs[hi]!.anchorWorld[2]!;console.log(`END ${side} tau=${tau} dComZ=${((c-c0)*100).toFixed(2)}cm dHipZ=${((z-z0)*100).toFixed(2)}cm`);break;}}
