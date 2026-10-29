/** _probe-taskpd-readback: 回读唯一 PD 是否真的出力 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
let last=-1;
for(let s=0;s<Math.round(3/w.dt);s++){
 supportClean(ctx,'r'); supportClean(ctx,'l'); w.advance(1); squatFrame(w,ctl,court);
 const d=(globalThis as {__TP_DBG?:any}).__TP_DBG;
 if(!court.released||!d||w.clock-last<0.04) continue; last=w.clock;
 console.log(`t=${d.t.toFixed(2)} ${d.side} eL=${(d.err*57.3).toFixed(1)} eS=${(d.errSag*57.3).toFixed(1)} k1=${d.kneeTau.toFixed(1)} f0=${d.footTau.toFixed(1)} k2=${d.kneeSagTau.toFixed(1)} f2=${d.footSagTau.toFixed(1)} sup=${d.supportTau.toFixed(1)} mZ=${(d.marginZ*100).toFixed(1)} mX=${(d.marginX*100).toFixed(1)} ct=${d.contact.toFixed(2)} capZ=${d.ankleCapZ.toFixed(1)} comY=${(d.comY*100).toFixed(1)}/${(d.targetComY*100).toFixed(1)} comZ=${(d.comZ*100).toFixed(1)} N=${d.fz.toFixed(0)} fall=${court.fall.toFixed(2)}`);
 if(court.fall>=0) break;
}
