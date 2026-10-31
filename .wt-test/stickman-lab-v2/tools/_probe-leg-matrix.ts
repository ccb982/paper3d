/** _probe-leg-matrix: 单脚 3 输入 → CoP/knee1/hip0/hipY 响应 */
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
const axis=String(env.SQC_MX_AXIS??'foot'); const tau=Number(env.SQC_MX_TAU??10);
const side='l' as const;
const di = axis==='foot' ? w.body.dofByName('foot_l',0) : axis==='knee' ? w.body.dofByName('knee_l',1) : w.body.dofByName('hip_l',0);
const read=()=>{const f=ctl.sensors.feet[0]!;const ki=w.body.dofByName('knee_l',1);const hi=w.body.dofByName('hip_l',0);const hiR=w.body.dofByName('hip_r',0);return {cop:f.copZ, k1:w.body.dofs[ki]!.angle, h0:w.body.dofs[hi]!.angle, dy:w.body.dofs[hi]!.anchorWorld[1]!-w.body.dofs[hiR]!.anchorWorld[1]!, com:ctl.sensors.com[2]!};};
let base:ReturnType<typeof read>|null=null, after:ReturnType<typeof read>|null=null;
for(let s=0;s<Math.round(2.3/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(t>=2.05&&t<2.10&&di>=0) w.executor.addTorque(di, axis==='knee'?tau:tau); });
 squatFrame(w,ctl,court);
 if(t>=2.03&&t<2.04) base=read();
 if(t>=2.12&&t<2.13) after=read();
}
console.log('axis',axis,'tau',tau,'base',base,'after',after);
if(base&&after) console.log('delta', {cop:(after.cop-base.cop)*100, k1:(after.k1-base.k1)*57.3, h0:(after.h0-base.h0)*57.3, dy:after.dy*100, com:after.com*100});
