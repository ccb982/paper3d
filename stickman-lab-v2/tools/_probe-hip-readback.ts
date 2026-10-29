import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); const court=squatCourtSetup(w,ctl,2.0);
let last=-1;
for(let s=0;s<Math.round(3/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);const d=(globalThis as {__HIP_DBG?:any}).__HIP_DBG;if(!court.released||!d||w.clock-last<0.1)continue;last=w.clock;console.log(`t=${d.t.toFixed(2)} tgt=${(d.tgtL*100).toFixed(1)}/${(d.tgtR*100).toFixed(1)} act=${(d.aL*100).toFixed(1)}/${(d.aR*100).toFixed(1)} e=${(d.eL*100).toFixed(2)}/${(d.eR*100).toFixed(2)} tau=${d.tauL.toFixed(1)}/${d.tauR.toFixed(1)} acc=${d.accZ.toFixed(2)} fz=${d.fzL.toFixed(0)}/${d.fzR.toFixed(0)} fall=${court.fall.toFixed(2)}`);if(court.fall>=0)break;}
