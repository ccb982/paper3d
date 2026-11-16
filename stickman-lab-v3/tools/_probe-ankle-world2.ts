import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const P=(n:string,ax:number)=>{const i=w.body.dofByName(n,ax);if(i<0)return null;const a=w.body.dofs[i]!.anchorWorld;return {x:a[0]!,y:a[1]!,z:a[2]!}};
const W=(n:string)=>{const i=w.body.indexByKey.get(n);if(i===undefined)return null;const p=w.body.bodies[i]!.translation();return {x:p.x,y:p.y,z:p.z}};
let last=-1;
for(let i=0;i<Math.round(6/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 if(w.clock-last>=0.2){last=w.clock;const kn=P('knee_l',2),an=P('foot_l',2),ar=W('arch_l'); if(kn&&an&&ar){const s=Math.atan2(an.x-kn.x, -(an.y-kn.y))*57.3;const f=Math.atan2(ar.x-an.x, -(ar.y-an.y))*57.3;console.log(`AW2 t=${w.clock.toFixed(2)} ${ctl.actions.status.phase??'-'} shin=${s.toFixed(1)} foot=${f.toFixed(1)} diff=${(f-s).toFixed(1)} knee=(${(kn.x*100).toFixed(1)},${(kn.y*100).toFixed(1)}) ankle=(${(an.x*100).toFixed(1)},${(an.y*100).toFixed(1)}) arch=(${(ar.x*100).toFixed(1)},${(ar.y*100).toFixed(1)})`);} }
}
