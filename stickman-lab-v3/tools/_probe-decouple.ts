/** _probe-decouple: 逆矩阵离线验证 */
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
const M=[-0.48640886,0.95122194,-0.76739369,-0.04580552,-2.39025439,1.81115042,0.48159928,0.46446801,0.95756448];
const y=[Number(env.SQC_DC_COP??1),Number(env.SQC_DC_KNEE??0),Number(env.SQC_DC_HIP??0)];
const u=[M[0]*y[0]+M[1]*y[1]+M[2]*y[2],M[3]*y[0]+M[4]*y[1]+M[5]*y[2],M[6]*y[0]+M[7]*y[1]+M[8]*y[2]];
const fi=w.body.dofByName('foot_l',0), ki=w.body.dofByName('knee_l',1), hi=w.body.dofByName('hip_l',0);
const hr=w.body.dofByName('hip_r',0);
const read=()=>{const f=ctl.sensors.feet[0]!;const h=w.body.dofs[hi]!,r=w.body.dofs[hr]!;return {cop:f.copZ*100,k1:w.body.dofs[ki]!.angle*57.3,dy:(h.anchorWorld[1]!-r.anchorWorld[1]!)*100,com:ctl.sensors.com[2]!*100};};
let b:any=null,a:any=null;
for(let s=0;s<Math.round(2.3/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{if(t>=2.05&&t<2.10){w.executor.addTorque(fi,u[0]);w.executor.addTorque(ki,u[1]);w.executor.addTorque(hi,u[2]);}});
 squatFrame(w,ctl,court);
 if(t>=2.03&&t<2.04)b=read(); if(t>=2.12&&t<2.13)a=read();
}
console.log('y',y,'u',u,'base',b,'after',a);
