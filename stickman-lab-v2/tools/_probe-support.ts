import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const SUP=String(process.env.SUP??'1')==='1';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const y=(n:string)=>{const i=w.body.indexByKey.get(n);return i===undefined?NaN:w.body.bodies[i]!.translation().y};
let last=-1;
for(let i=0;i<Math.round(6/w.dt);i++){ if(SUP) supportClean(ctx,'r'); if(SUP) supportClean(ctx,'l'); w.advance(1);
 if(w.clock-last>=0.25){last=w.clock; const fL=w.body.footNormalForce('l',w.dt),fR=w.body.footNormalForce('r',w.dt); const a=(n:string)=>{const j=w.body.dofByName(n,2);return j>=0?(w.body.dofs[j]!.angle*57.3).toFixed(0):'-'}; console.log(`SP sup=${SUP} t=${w.clock.toFixed(2)} footY=${(y('foot_l')*100).toFixed(1)} archY=${(y('arch_l')*100).toFixed(1)} fz=${fL.toFixed(0)}/${fR.toFixed(0)} knee=${a('knee_l')} hip=${a('hip_l')} ankle=${a('foot_l')}`);} }
