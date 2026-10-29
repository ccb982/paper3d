/** _probe-sag-target: 释放时矢状小腿角与目标 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
for(let i=0;i<Math.round(2.2/w.dt);i++){
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 if(!court.released) continue;
 const vals:number[]=[];
 for(const s of ['l','r'] as const){
   const ki=w.body.dofByName(`knee_${s}`,2), ai=w.body.dofByName(`foot_${s}`,2);
   const kd=w.body.dofs[ki]!, ad=w.body.dofs[ai]!;
   const dx=kd.anchorWorld[0]!-ad.anchorWorld[0]!;
   const dy=kd.anchorWorld[1]!-ad.anchorWorld[1]!;
   const sag=Math.atan2(dx,Math.max(0.05,dy));
   vals.push(sag);
   console.log(`${s} dx=${(dx*100).toFixed(2)}cm dy=${(dy*100).toFixed(2)}cm sag=${(sag*57.3).toFixed(2)}° ankle=(${(ad.anchorWorld[0]!*100).toFixed(1)},${(ad.anchorWorld[1]!*100).toFixed(1)},${(ad.anchorWorld[2]!*100).toFixed(1)})`);
 }
 console.log(`targetSag=${((vals[0]!+vals[1]!)/2*57.3).toFixed(2)}° diff=${((vals[0]!-vals[1]!)*57.3).toFixed(2)}°`);
 break;
}
