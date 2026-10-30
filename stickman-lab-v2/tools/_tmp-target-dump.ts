import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0); let last=-1;
for(let s=0;s<Math.round(2.4/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);if(!court.released||w.clock-last<0.1)continue;last=w.clock;const t=(globalThis as {__PD_TARGET?:any}).__PD_TARGET;for(const sd of ['l','r'] as const){const d=t?.[sd];if(!d)continue;const ki=w.body.dofByName(`knee_${sd}`,2)!;const k=w.body.dofs[ki]!.anchorWorld;console.log(`t=${(court.t-court.settle).toFixed(2)} ${sd} A=(${d.a.map((v:number)=>(v*100).toFixed(1)).join(',')}) Kt=(${d.kTgt.map((v:number)=>(v*100).toFixed(1)).join(',')}) Kcur=(${[k[0],k[1],k[2]].map(v=>(v*100).toFixed(1)).join(',')})`);}break;}
