import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); const court=squatCourtSetup(w,ctl,2.0);
let last=-1;
for(let s=0;s<Math.round(3/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);const d=(globalThis as {__HIP_DBG?:any}).__HIP_DBG;if(!court.released||!d||w.clock-last<0.1)continue;last=w.clock;console.log(`t=${d.t.toFixed(2)} e=${(d.xcom*100).toFixed(2)} F=${d.force.toFixed(0)} tau=${d.tauL.toFixed(1)}/${d.tauR.toFixed(1)} app=${d.appliedL.toFixed(1)}/${d.appliedR.toFixed(1)} cmd=${d.cmdL.toFixed(1)}/${d.cmdR.toFixed(1)} pas=${d.passiveL.toFixed(1)}/${d.passiveR.toFixed(1)} pair=${d.pairL.toFixed(1)}/${d.pairR.toFixed(1)} lim=${d.limitL.toFixed(1)}/${d.limitR.toFixed(1)} ff=${d.ffL.toFixed(1)} act=${d.actL.toFixed(1)} damp=${d.dampL.toFixed(1)} stiff=${d.stiffL.toFixed(1)} budget=${d.budgetL.toFixed(1)}/${d.budgetR.toFixed(1)} fz=${d.fzL.toFixed(0)}/${d.fzR.toFixed(0)} fall=${court.fall.toFixed(2)}`);if(court.fall>=0)break;}
