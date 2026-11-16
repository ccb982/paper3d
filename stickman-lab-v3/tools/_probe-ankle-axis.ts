/** _probe-ankle-axis: 法庭释放后给 foot/0 已知力矩，测 CoP/方向 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_FALL_SUPPORT='0'; env.SQC_FALL_ANKLE='0'; env.SQC_ANKLE_ONLY='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_LEG_SOFT='0'; env.SQC_LEG_RIGHTING='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const tau=Number(env.SQC_AXIS_TAU??10);
const side=(env.SQC_AXIS_SIDE??'l') as 'l'|'r';
const fi=w.body.dofByName(`foot_${side}`,0);
console.log('foot_l/0 tau',tau);
for(let s=0;s<Math.round(2.3/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(t>=2.05&&t<2.10&&fi>=0) w.executor.addTorque(fi,tau); });
 squatFrame(w,ctl,court);
 if(t<2.03||t>2.22) continue;
 if(Math.abs((t*100)%2)>0.25) continue;
 const fl=ctl.sensors.feet[0]!, fr=ctl.sensors.feet[1]!; const d=w.body.dofs[fi]!;
 const ki=w.body.dofByName(`knee_${side}`,1), hi=w.body.dofByName(`hip_${side}`,0);
 console.log(`${(t-2).toFixed(3)} fz=${fl.fz.toFixed(0)}/${fr.fz.toFixed(0)} copZL=${(fl.copZ*100).toFixed(1)} copZR=${(fr.copZ*100).toFixed(1)} foot0=${(d.angle*57.3).toFixed(2)} v=${d.vel.toFixed(2)} knee1=${(w.body.dofs[ki]!.angle*57.3).toFixed(2)} hip0=${(w.body.dofs[hi]!.angle*57.3).toFixed(2)} comZ=${(ctl.sensors.com[2]!*100).toFixed(2)}`);
}
