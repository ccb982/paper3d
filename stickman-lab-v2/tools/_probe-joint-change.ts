/** 同时回读膝/脚/髋关节变化与预算 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); const court=squatCourtSetup(w,ctl,2.0);
let last=-1;
for(let s=0;s<Math.round(2.8/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);const t=(globalThis as {__TP_DBG?:any}).__TP_DBG;const h=(globalThis as {__HIP_DBG?:any}).__HIP_DBG;if(!court.released||!t||!h||w.clock-last<0.04)continue;last=w.clock;console.log(`t=${t.t.toFixed(2)} eL=${(t.err*57.3).toFixed(1)} eS=${(t.errSag*57.3).toFixed(1)} k1tau=${t.kneeTau.toFixed(1)} f0tau=${t.footTau.toFixed(1)} k1ang=${(t.knee1Angle*57.3).toFixed(1)} f0ang=${(t.foot0Angle*57.3).toFixed(1)} | hipF=${h.force.toFixed(0)} hipTau=${h.tauL.toFixed(1)}/${h.tauR.toFixed(1)} bgt=${h.budgetL.toFixed(1)}/${h.budgetR.toFixed(1)} hAng=${(h.hipL*57.3).toFixed(1)}/${(h.hipR*57.3).toFixed(1)} comZ=${(h.comZ*100).toFixed(1)} fz=${h.fzL.toFixed(0)}/${h.fzR.toFixed(0)} fall=${court.fall.toFixed(2)}`);if(court.fall>=0)break;}
