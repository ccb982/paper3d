/** _probe-hip-axis: 释放后给 hip/0 已知力矩，测 hipY/骨盆方向 */
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
const tau=Number(env.SQC_HIP_TAU??10);
const fiL=w.body.dofByName('hip_l',0), fiR=w.body.dofByName('hip_r',0);
const sL=Number(env.SQC_HIP_L_SIGN??1)<0?-1:1, sR=Number(env.SQC_HIP_R_SIGN??1)<0?-1:1;
const hl=w.body.dofByName('hip_l',0), hr=w.body.dofByName('hip_r',0);
console.log('hip tau',tau,'sign',sL,sR);
for(let s=0;s<Math.round(2.3/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(t>=2.05&&t<2.10){if(fiL>=0)w.executor.addTorque(fiL,sL*tau);if(fiR>=0)w.executor.addTorque(fiR,sR*tau);} });
 squatFrame(w,ctl,court);
 if(t<2.03||t>2.22) continue;
 if(Math.abs((t*100)%2)>0.25) continue;
 const yL=w.body.dofs[hl]!.anchorWorld[1]!, yR=w.body.dofs[hr]!.anchorWorld[1]!;
 console.log(`${(t-2).toFixed(3)} yL=${(yL*100).toFixed(1)} yR=${(yR*100).toFixed(1)} d=${((yL-yR)*100).toFixed(2)} h0L=${(w.body.dofs[hl]!.angle*57.3).toFixed(1)} h0R=${(w.body.dofs[hr]!.angle*57.3).toFixed(1)} fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)} comZ=${(ctl.sensors.com[2]!*100).toFixed(2)}`);
}
