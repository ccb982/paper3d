/** _probe-spine-base: 释放前后 spine1 三轴 baseBuf/ref/applied */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { baseAng } from '../src/core/servo/baseTable';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World(); const ctl = new ControlModule(w,{postureTone:8});
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const report=(tag:string):void=>{
  const b=(ctl.warner as unknown as {squatBaseBuf():Float64Array|null}).squatBaseBuf();
  console.log(`--- ${tag} t=${court.t.toFixed(3)} rel=${court.released}`);
  for (const ax of [0,1,2] as const) {
    const i=w.body.dofByName('spine1',ax); if(i<0) continue; const d=w.body.dofs[i]!;
    console.log(`spine1/${ax} ang=${(d.angle*57.3).toFixed(2)} vel=${d.vel.toFixed(2)} baseBuf=${(b?b[i]??0:0).toFixed(2)} ref=${((baseAng('spine1',ax)??NaN)*57.3).toFixed(2)} app=${w.executor.ledger[i]!.applied.toFixed(2)} cap=${d.tauMax}`);
  }
};
for(let s=0;s<Math.round(2.3/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 if(s===Math.round(1.9/w.dt)) report('pre');
 if(s===Math.round(2.05/w.dt)) report('post');
 if(s===Math.round(2.2/w.dt)) report('post2');}
