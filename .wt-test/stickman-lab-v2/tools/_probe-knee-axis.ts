/** _probe-knee-axis: 给 knee/1 已知力矩，测膝/脚 CoP 方向 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_FALL_SUPPORT='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_LEG_SOFT='0'; env.SQC_AW='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const side=(env.SQC_KNEE_SIDE??'l') as 'l'|'r';
const tau=Number(env.SQC_KNEE_TAU??10);
const ki=w.body.dofByName(`knee_${side}`,1);
const fi=w.body.dofByName(`foot_${side}`,0), hi=w.body.dofByName(`hip_${side}`,0);
console.log('knee',side,'tau',tau);
for(let s=0;s<Math.round(2.3/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(t>=2.05&&t<2.10&&ki>=0) w.executor.addTorque(ki,tau); });
 squatFrame(w,ctl,court);
 if(t<2.03||t>2.22) continue;
 if(Math.abs((t*100)%2)>0.25) continue;
 const f=ctl.sensors.feet[side==='l'?0:1]!;
 console.log(`${(t-2).toFixed(3)} fz=${f.fz.toFixed(0)} copZ=${(f.copZ*100).toFixed(1)} knee1=${(w.body.dofs[ki]!.angle*57.3).toFixed(2)} hip0=${(w.body.dofs[hi]!.angle*57.3).toFixed(2)} foot0=${(w.body.dofs[fi]!.angle*57.3).toFixed(2)} comZ=${(ctl.sensors.com[2]!*100).toFixed(2)}`);
}
