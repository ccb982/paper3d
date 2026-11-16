/** _probe-target-pose: 释放瞬间比较目标腿姿态/脚和实际 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { baseAng } from '../src/core/servo/baseTable';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
let done=false;
for(let s=0;s<Math.round(2.2/w.dt);s++){
 supportClean(ctx,'r'); supportClean(ctx,'l'); w.advance(1); squatFrame(w,ctl,court);
 if(!done&&court.released){
  done=true;
  console.log('RELEASE t',court.t.toFixed(3));
  if(court.ang0) for(const [di,a0] of court.ang0){const d=w.body.dofs[di]!;console.log(`ang0 ${d.name}/${d.axis} target=${(a0*57.3).toFixed(2)}° actual=${(d.angle*57.3).toFixed(2)}° Δ=${((d.angle-a0)*57.3).toFixed(2)}°`);}
  for(const nm of ['knee_l','knee_r','foot_l','foot_r']) for(const ax of [0,1,2]){
    const di=w.body.dofByName(nm,ax); if(di<0) continue; const d=w.body.dofs[di]!;
    console.log(`joint ${nm}/${ax} actual=${(d.angle*57.3).toFixed(2)}° baseAng=${baseAng(nm,ax)===undefined?'-':(baseAng(nm,ax)!*57.3).toFixed(2)+'°'}`);
  }
  for(const side of ['l','r'] as const){
    const bi=w.body.indexByKey.get(`foot_${side}`); if(bi===undefined) continue; const b=w.body.bodies[bi]!; const p=b.translation(); const q=b.rotation();
    const up={x:2*(q.x*q.y-q.w*q.z),y:1-2*(q.x*q.x+q.z*q.z),z:2*(q.w*q.x+q.y*q.z)};
    console.log(`foot ${side} p=(${(p.x*100).toFixed(1)},${(p.y*100).toFixed(1)},${(p.z*100).toFixed(1)}) up=(${up.x.toFixed(3)},${up.y.toFixed(3)},${up.z.toFixed(3)})`);
  }
  const d=(globalThis as {__TP_DBG?:any}).__TP_DBG;
  console.log('TP',JSON.stringify(d));
 }
}
