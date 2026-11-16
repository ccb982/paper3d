/** _probe-knee-margin: 回读膝/1、膝/2 的 tauMax/实际 applied/剩余余量 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0); let last=-1;
for(let s=0;s<Math.round(4/w.dt);s++){
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 if(!court.released||w.clock-last<0.1)continue;last=w.clock;
 const out:string[]=[]; const W=w.sk.massTotal*9.81;
 for(const side of ['l','r'] as const) for(const ax of [0,1,2]){
  const di=w.body.dofByName(`knee_${side}`,ax); if(di<0)continue; const d=w.body.dofs[di]!; const l=w.executor.ledger[di]; const app=l?.applied??0; const cap=d.tauMax??0;
  out.push(`k${side}${ax}:${app.toFixed(0)}/${cap.toFixed(0)} r=${(cap-Math.abs(app)).toFixed(0)}`);
 }
 const fz=w.body.footNormalForce('l',w.dt)+w.body.footNormalForce('r',w.dt);
 console.log(`t=${court.t.toFixed(2)} W=${W.toFixed(0)} N=${fz.toFixed(0)} comY=${(ctl.sensors.com[1]!*100).toFixed(1)} comZ=${(ctl.sensors.com[2]!*100).toFixed(1)} ${out.join(' ')}`);
 if(court.fall>=0)break;
}
