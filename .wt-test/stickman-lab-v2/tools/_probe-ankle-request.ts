/** _probe-ankle-request: 固定目标 request，验证 ankleWriter 的 CoP 跟踪 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_FALL_SUPPORT='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_LEG_SOFT='0'; env.SQC_HIP_LEVEL='0'; env.SQC_ANKLE_FF='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const di=w.body.dofByName('foot_l',0);
for(let s=0;s<Math.round(2.8/w.dt);s++){
 const t=s*w.dt;
 supportClean(ctx,'r');supportClean(ctx,'l');w.advance(1);squatFrame(w,ctl,court);
 if(t<2.0||t>2.7) continue;
 if(Math.abs((t*10)%2)>0.25) continue;
 const f=ctl.sensors.feet[0]!; const d=w.body.dofs[di]!;
 console.log(`${(t-2).toFixed(1)} cop=${(f.copZ*100).toFixed(2)} target=${((d.anchorWorld[2]!+Number(env.SQC_AW_TEST_REQ??0))*100).toFixed(2)} fz=${f.fz.toFixed(0)} foot0=${(d.angle*57.3).toFixed(1)} app=${w.executor.ledger[di]!.applied.toFixed(1)} comZ=${(ctl.sensors.com[2]!*100).toFixed(2)}`);
}
