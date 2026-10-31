import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const y=(n:string)=>{const i=w.body.indexByKey.get(n);return i===undefined?NaN:w.body.bodies[i]!.translation().y};
const cop=new Float64Array(3);
let last=-1;
for(let i=0;i<Math.round(6/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 if(w.clock-last>=0.2){last=w.clock; const fL=w.body.footNormalForce('l',w.dt), fR=w.body.footNormalForce('r',w.dt); const okL=w.body.footCoP('l',w.dt,cop); const copL=okL?cop[1]!*100:NaN; const p=w.perception.feet[0]!; const ka=(n:string)=>{const i=w.body.dofByName(n,2);return i>=0?(w.body.dofs[i]!.angle*57.3).toFixed(0):'-'}; console.log(`FF t=${w.clock.toFixed(2)} ${ctl.actions.status.phase??'-'} footY=${(y('foot_l')*100).toFixed(1)} archY=${(y('arch_l')*100).toFixed(1)} mfootY=${(y('mfoot_l')*100).toFixed(1)} fzL=${fL.toFixed(0)} fzR=${fR.toFixed(0)} knee=${ka('knee_l')} ankle=${ka('foot_l')} copL=${copL.toFixed(1)} contact=${p.contact?1:0} slip=${p.slip?1:0} fric=${p.frictionUse.toFixed(2)}`);}
}
