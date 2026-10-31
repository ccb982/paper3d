/** _probe-righting-torque: 回正关节力矩 vs 需求 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World(); const ctl = new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
let mUp=0; for (const b of w.sk.bodies) if(/^(torso|spine|neck|head|arm|hand)/.test(b.key)) mUp+=b.mass;
const hipY=()=>w.body.dofs[w.body.dofByName('hip_l',0)]!.anchorWorld[1]!;
const torsoY=()=>w.body.bodies[w.body.indexByKey.get('spine3')!]!.translation().y;
for(let s=0;s<Math.round(4.0/w.dt);s++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 const t=court.t; if(t<2.0 || t>3.9) continue;
 if(Math.abs((t*10)%2)>0.25) continue;
 const r=ctl.lateral.parts['trunk']?.roll??0; const r0=court.trunkRoll0??0; const e=r-r0;
 const lev=Math.max(0.2,torsoY()-hipY());
 const req=mUp*9.81*lev*Math.sin(e);
 let s0=0,s1=0,s2=0;
 for(const [nm,acc] of [['spine1',(v:number)=>{s0+=v}],['spine2',(v:number)=>{s1+=v}],['spine3',(v:number)=>{s2+=v}]] as const){const di=w.body.dofByName(nm,0); if(di>=0) acc(w.executor.ledger[di]!.applied);}
 const fzL=w.body.footNormalForce('l',w.dt), fzR=w.body.footNormalForce('r',w.dt);
 const W=w.sk.massTotal*9.81;
 const dbg=(globalThis as { __URDBG?: {budget?:number;tau?:number;alpha?:number;pred?:number} }).__URDBG;
 const budget=dbg?.budget??0;
 const ridx=w.body.dofByName('spine1',0); const rled=ridx>=0?w.executor.ledger[ridx]!:null;
 const side=e<0?'r':'l';
 const h2=w.body.dofByName(`hip_${side}`,2), k2=w.body.dofByName(`knee_${side}`,2), f0=w.body.dofByName(`foot_${side}`,0);
 console.log(`t=${t.toFixed(1)} e=${(e*57.3).toFixed(2)}° req=${req.toFixed(1)} spine=${(s0+s1+s2).toFixed(1)} (${s0.toFixed(0)}/${s1.toFixed(0)}/${s2.toFixed(0)}) URtau=${(dbg?.tau??0).toFixed(1)} a=${(dbg?.alpha??0).toFixed(2)} budget=${budget.toFixed(1)} side=${side} fz=${fzL.toFixed(0)}/${fzR.toFixed(0)} hip2=${w.executor.ledger[h2]!.applied.toFixed(1)} knee2=${w.executor.ledger[k2]!.applied.toFixed(1)} foot0=${w.executor.ledger[f0]!.applied.toFixed(1)} led=${rled?`${rled.applied.toFixed(1)}/${rled.passive.toFixed(1)}/${rled.pair.toFixed(1)}/${rled.cmd.toFixed(1)}/${rled.limit.toFixed(1)}/${rled.writes}`:'-'}`);
}
