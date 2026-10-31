import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); const court=squatCourtSetup(w,ctl,2.0);
let last=-1;
for(let s=0;s<Math.round(2.6/w.dt);s++){
 const log:(Array<[number,string,number,string]>)=[];
 (globalThis as {__PROPLOG?:any}).__PROPLOG=log;
 supportClean(ctx,'r'); supportClean(ctx,'l'); w.advance(1); squatFrame(w,ctl,court);
 if(!court.released||w.clock-last<0.1)continue; last=w.clock;
 const li=w.body.dofByName('hip_l',0),ri=w.body.dofByName('hip_r',0);
 const hits=log.filter(x=>x[0]===li||x[0]===ri);
 const ag=log.filter(x=>x[1]==='antiG');
 console.log(`t=${court.t.toFixed(2)} antiG=${ag.length} ${ag.slice(0,3).map(x=>`dof${x[0]}:${x[2].toFixed(1)}:${x[3]}`).join(',')} | ${hits.map(x=>`${x[0]===li?'L':'R'}:${x[1]}:${x[2].toFixed(1)}:${x[3]}`).join(' | ')}`);
}
