import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const q=(k:string)=>{const b=w.body.bodies[w.body.indexByKey.get(k)!]!;const r=b.rotation();return r};
const rel=(a:string,b:string)=>{const qa=q(a),qb=q(b);const inv={x:-qb.x,y:-qb.y,z:-qb.z,w:qb.w};const dx=qa.w*inv.x+qa.x*inv.w+qa.y*inv.z-qa.z*inv.y,dy=qa.w*inv.y-qa.x*inv.z+qa.y*inv.w+qa.z*inv.x,dz=qa.w*inv.z+qa.x*inv.y-qa.y*inv.x+qa.z*inv.w,dw=qa.w*inv.w-qa.x*inv.x-qa.y*inv.y-qa.z*inv.z;return 2*Math.atan2(Math.hypot(dx,dy,dz),Math.abs(dw))*57.3};
const bx=(n:string)=>{const i=w.body.dofByName(n,2);return i>=0?w.body.dofs[i]!.anchorWorld[0]!:NaN};
const ang=(n:string)=>{const i=w.body.dofByName(n,2);return i>=0?w.body.dofs[i]!.angle*57.3:NaN};
let last=-1;
for(let i=0;i<Math.round(6/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 if(w.clock-last>=0.2){last=w.clock;const c=ctl.sensors.com; console.log(`AP t=${w.clock.toFixed(2)} ${ctl.actions.status.phase??'-'} ankleRel=${rel('shin_l','foot_l').toFixed(1)} knee=${ang('knee_l').toFixed(0)} hip=${ang('hip_l').toFixed(0)} foot2=${ang('foot_l').toFixed(0)} relKnee=${((bx('knee_l')-bx('foot_l'))*100).toFixed(1)} com=${(c[0]!*100).toFixed(1)}`);}
}
