/** _probe-righting-05: 法庭释放后 0~0.5s 回正各通道 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const f=(sd:'l'|'r')=>ctl.sensors.feet[sd==='l'?0:1]!;
const app=(nm:string,ax:number)=>{const i=w.body.dofByName(nm,ax);return i>=0?w.executor.ledger[i]!.applied:0};
console.log('rel   comZ   vZ    aZ    fzL/R     copZ    hip2L/R    knee2L/R   foot0L/R   knee1L/R   URtau side s');
for(let s=0;s<Math.round(2.6/w.dt);s++){
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 const t=court.t-court.settle; if(t<0||t>0.5) continue;
 if(Math.abs((t*100)%2)>0.25) continue;
 const fl=f('l'),fr=f('r'); const fzL=fl.fz,fzR=fr.fz; const cop=(fzL*fl.copZ+fzR*fr.copZ)/Math.max(1,fzL+fzR);
 const dbg=(globalThis as {__URDBG?:{tau?:number}}).__URDBG; const fd=(globalThis as {__FALLDBG?:{side?:string;s?:number}}).__FALLDBG;
 console.log(`${t.toFixed(2)} ${(ctl.sensors.com[2]!*100).toFixed(1)} ${(ctl.sensors.comVel[2]!*100).toFixed(1)} ${(ctl.perception.comAcc[2]!).toFixed(1)} ${fzL.toFixed(0)}/${fzR.toFixed(0)} ${(cop*100).toFixed(1)} ${app('hip_l',2).toFixed(0)}/${app('hip_r',2).toFixed(0)} ${app('knee_l',2).toFixed(0)}/${app('knee_r',2).toFixed(0)} ${app('foot_l',0).toFixed(0)}/${app('foot_r',0).toFixed(0)} ${app('knee_l',1).toFixed(0)}/${app('knee_r',1).toFixed(0)} ${(dbg?.tau??0).toFixed(0)} ${fd?.side??'-'} ${(fd?.s??0).toFixed(2)}`);
}
