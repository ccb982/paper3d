import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; ctl.actions.idleEnabled=false; (globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
w.reset(); w.switchPoseState('stand'); ctl.actions.play('squatDown');
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const wp=(n:string)=>{const i=w.body.indexByKey.get(n); if(i===undefined)return null; return w.body.bodies[i]!.translation()};
const angV=(a:{x:number,y:number,z:number},b:{x:number,y:number,z:number})=>{const dx=b.x-a.x,dy=b.y-a.y;return Math.atan2(dx,-dy)*57.3};
let last=-1;
for(let i=0;i<Math.round(6/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 if(w.clock-last>=0.2){last=w.clock;const kn=wp('knee_l'),an=wp('foot_l'),ar=wp('arch_l'),mf=wp('mfoot_l'); if(kn&&an&&ar){const shin=angV(kn,an); const foot=angV(an,ar); console.log(`AW t=${w.clock.toFixed(2)} ${ctl.actions.status.phase??'-'} shinTilt=${shin.toFixed(1)} footTilt=${foot.toFixed(1)} ankleDiff=${(foot-shin).toFixed(1)} knee=(${(kn.x*100).toFixed(1)},${(kn.y*100).toFixed(1)}) ankle=(${(an.x*100).toFixed(1)},${(an.y*100).toFixed(1)})`);} }
}
