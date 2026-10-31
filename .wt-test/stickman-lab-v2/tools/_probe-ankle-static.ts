/** _probe-ankle-static: 固定脚，foot/0 恒力矩稳态 → CoP 标定 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_FALL_SUPPORT='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_LEG_SOFT='0'; env.SQC_AW='0'; env.SQC_HIP_LEVEL='0'; env.SQC_ANKLE_FF='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const side=(env.SQC_AS_SIDE??'l') as 'l'|'r'; const tau=Number(env.SQC_AS_TAU??0);
const fi=w.body.dofByName(`foot_${side}`,0);
console.log('side',side,'tau',tau);
for(let s=0;s<Math.round(2.6/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(t>=2.10&&t<2.35&&fi>=0) w.executor.addTorque(fi,tau); });
 squatFrame(w,ctl,court);
}
const f=ctl.sensors.feet[side==='l'?0:1]!; const d=w.body.dofs[fi]!;
console.log(`END tau=${tau} fz=${f.fz.toFixed(0)} copZ=${(f.copZ*100).toFixed(2)} foot0=${(d.angle*57.3).toFixed(2)} comZ=${(ctl.sensors.com[2]!*100).toFixed(2)}`);
