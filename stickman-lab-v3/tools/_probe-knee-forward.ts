import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const bx=(n:string)=>{const i=w.body.dofByName(n,2); return i>=0?w.body.dofs[i]!.anchorWorld[0]!:NaN};
const ang=(n:string)=>{const i=w.body.dofByName(n,2); return i>=0?w.body.dofs[i]!.angle*57.3:NaN};
let last=-1;
for(let i=0;i<Math.round(6.5/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 if(w.clock-last>=0.2){last=w.clock;const c=ctl.sensors.com; console.log(`KF t=${w.clock.toFixed(2)} ph=${ctl.actions.status.phase??'-'} kneeX=${(bx('knee_l')*100).toFixed(1)} hipX=${(bx('hip_l')*100).toFixed(1)} footX=${(bx('foot_l')*100).toFixed(1)} relKnee=${((bx('knee_l')-bx('foot_l'))*100).toFixed(1)} comX=${(c[0]!*100).toFixed(1)} hipA=${ang('hip_l').toFixed(0)} kneeA=${ang('knee_l').toFixed(0)} footA=${ang('foot_l').toFixed(0)}`);}
}
