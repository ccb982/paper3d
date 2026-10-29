/** _probe-hip-target: 由脚落点算左右髋目标位置（只读） */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
let done=false;
for(let s=0;s<Math.round(2.3/w.dt);s++){
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 if(!court.released||done)continue; done=true;
 const fb=(side:'l'|'r')=>w.body.bodies[w.body.indexByKey.get(`foot_${side}`)!]!.translation();
 const hip=(side:'l'|'r')=>w.body.dofs[w.body.dofByName(`hip_${side}`,0)]!.anchorWorld;
 const fl=fb('l'),fr=fb('r'),hl=hip('l'),hr=hip('r');
 const supportZ=(fl.z+fr.z)/2, supportX=(fl.x+fr.x)/2;
 const hipHalf=Math.abs(hl[2]!-hr[2]!)/2;
 const y=(hl[1]!+hr[1]!)/2, x=(hl[0]!+hr[0]!)/2;
 console.log(`support center: x=${(supportX*100).toFixed(2)} z=${(supportZ*100).toFixed(2)}cm`);
 console.log(`actual hip: L=(${(hl[0]!*100).toFixed(2)},${(hl[1]!*100).toFixed(2)},${(hl[2]!*100).toFixed(2)}) R=(${(hr[0]!*100).toFixed(2)},${(hr[1]!*100).toFixed(2)},${(hr[2]!*100).toFixed(2)})`);
 console.log(`hipHalf=${(hipHalf*100).toFixed(2)}cm pelvis=(${(x*100).toFixed(2)},${(y*100).toFixed(2)},${((hl[2]!+hr[2]!)/2*100).toFixed(2)})`);
 console.log(`target hip: L=(${(x*100).toFixed(2)},${(y*100).toFixed(2)},${((supportZ+hipHalf)*100).toFixed(2)}) R=(${(x*100).toFixed(2)},${(y*100).toFixed(2)},${((supportZ-hipHalf)*100).toFixed(2)})`);
 console.log(`delta: Lz=${((supportZ+hipHalf-hl[2]!)*100).toFixed(2)} Rz=${((supportZ-hipHalf-hr[2]!)*100).toFixed(2)} X=${((x-x)*100).toFixed(2)}`);
}
