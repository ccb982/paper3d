/** _probe-target-compare: 闭链目标 / 法庭释放 / 实际蹲下交接姿态 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { captureSquatCourt } from '../src/core/court';
import { captureClosedChainTarget, closedChainAngleByName } from '../src/core/servo/closedChain';
import { supportClean } from '../src/core/servo/supportClean';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
const d=(n:string,ax:number)=>{const i=w.body.dofByName(n,ax);return i>=0?w.body.dofs[i]!.angle*57.3:NaN};
const fp=(s:string)=>{const i=w.body.indexByKey.get(`foot_${s}`);return i===undefined?'-':w.body.bodies[i]!.translation();};
function dump(label:string){ console.log(`\n[${label}] t=${w.clock.toFixed(2)} com=(${(ctl.sensors.com[0]!*100).toFixed(1)},${(ctl.sensors.com[1]!*100).toFixed(1)},${(ctl.sensors.com[2]!*100).toFixed(1)})`); for(const s of ['l','r']) console.log(`${s} hip2=${d(`hip_${s}`,2).toFixed(1)} knee2=${d(`knee_${s}`,2).toFixed(1)} foot2=${d(`foot_${s}`,2).toFixed(1)} knee1=${d(`knee_${s}`,1).toFixed(1)} foot0=${d(`foot_${s}`,0).toFixed(1)} foot=(${(fp(s) as any).x*100|0},${(fp(s) as any).y*100|0},${(fp(s) as any).z*100|0})`);}
function chain(label:string){ const c=captureClosedChainTarget(w.body); if(!c){console.log('chain null');return;} console.log(`[${label} chain]`); for(const s of ['l','r']) console.log(`${s} K1*=${((closedChainAngleByName(c,`knee_${s}`,1)??NaN)*57.3).toFixed(1)} F0*=${((closedChainAngleByName(c,`foot_${s}`,0)??NaN)*57.3).toFixed(1)} K2*=${((closedChainAngleByName(c,`knee_${s}`,2)??NaN)*57.3).toFixed(1)} foot=(${((s==='l'?c.l:c.r).ankle.x*100).toFixed(1)},${((s==='l'?c.l:c.r).ankle.y*100).toFixed(1)},${((s==='l'?c.l:c.r).ankle.z*100).toFixed(1)})`);}

// 1) court release
w.controller=ctl; ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w); w.reset();
let court=squatCourtSetup(w,ctl,2.0); let last=-1;
for(let i=0;i<Math.round(2.5/w.dt);i++){supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);if(court.released&&w.clock-last>1){last=w.clock;dump('court release');chain('court release');break;}}

// 2) actual squatDown handoff
w.reset(); w.switchPoseState('stand'); ctl.actions.idleEnabled=false; ctl.manual.clear(); ctl.actions.play('squatDown');
let hand=false;
for(let i=0;i<Math.round(12/w.dt);i++){
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);
 const knee=w.body.dofs[w.body.dofByName('knee_l',2)]!.angle;
 const forced=ctl.actions.status.phase==='交接'&&knee< -60/57.3;
 const idleEnd=!ctl.actions.status.active&&w.clock>4;
 const timed=w.clock>=7.27;
 if(forced||idleEnd||timed){
  ctl.actions.abort();ctl.manual.clear();captureSquatCourt(w,ctl);
  dump(`actual handoff forced=${forced} idle=${idleEnd} timed=${timed}`);chain('actual handoff');hand=true;break;
 }
}
if(!hand)console.log('no handoff');
