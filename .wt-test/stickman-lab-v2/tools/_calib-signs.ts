/** _calib-signs: 多次测 knee/1、foot/0 对 shank 侧向 tilt 的符号与斜率 */
import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
env.SQC_TASKPD='0'; env.SQC_ANKLE_FF='0'; env.SQC_UPPER_RIGHTING='0'; env.SQC_FP_FOOT_K='0';
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
function run(side:'l'|'r', axis:'knee'|'foot', tau:number):number{
 const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
 w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
 const court=squatCourtSetup(w,ctl,2.0);
 const di=w.body.dofByName(`${axis}_${side}`, axis==='knee'?1:0);
 const ki=w.body.dofByName(`knee_${side}`,2), ai=w.body.dofByName(`foot_${side}`,2);
 for(let s=0;s<Math.round(2.35/w.dt);s++){
   const t=s*w.dt;
   w.advance(1,()=>{if(t>=2.05&&t<2.15&&di>=0&&tau)w.executor.addTorque(di,tau);});
   supportClean(ctx,'r');supportClean(ctx,'l');squatFrame(w,ctl,court);
 }
 const kd=w.body.dofs[ki]!, ad=w.body.dofs[ai]!;
 return Math.atan2(kd.anchorWorld[2]!-ad.anchorWorld[2]!,Math.max(0.05,kd.anchorWorld[1]!-ad.anchorWorld[1]!));
}
for(const side of ['l','r'] as const) for(const axis of ['knee','foot'] as const){
 const z=run(side,axis,0), p=run(side,axis,10), n=run(side,axis,-10);
 const slope=(p-n)/20;
 console.log(`${side} ${axis}: zero=${(z*57.3).toFixed(2)}° plus=${(p*57.3).toFixed(2)}° minus=${(n*57.3).toFixed(2)}° dTilt/dTau=${(slope*57.3).toFixed(4)}°/Nm sign=${Math.sign(slope)}`);
}
