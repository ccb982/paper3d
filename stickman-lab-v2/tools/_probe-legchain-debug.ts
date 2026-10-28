import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
for(let s=0;s<Math.round(2.8/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 const t=court.t-court.settle; if(t<0||t>0.5) continue; if(Math.abs((t*100)%5)>0.25) continue;
 const d=(globalThis as {__LC_DBG?:any}).__LC_DBG; const f=ctl.sensors.feet; const com=ctl.sensors.com; const cv=ctl.sensors.comVel;
 console.log(`t=${t.toFixed(2)} comZ=${(com[2]!*100).toFixed(1)} vZ=${(cv[2]!*100).toFixed(1)} fz=${f[0]!.fz.toFixed(0)}/${f[1]!.fz.toFixed(0)} lvl=${d?.level??'-'} pred=${(d?.pred??0)*100} N=${d?.N?.toFixed?.(0)} Ft=${d?.Ft?.toFixed?.(0)} cop=${(d?.cop??0)*100} tor=${JSON.stringify(d?.torques??[])}`);
}
