/** _probe-com-monitor: 蹲姿 CoM 监控器回读 + 可选侧向冲量 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env??{};
(globalThis as {__PRED_OFF_RT?:boolean}).__PRED_OFF_RT=true;
const w=new World(); const ctl=new ControlModule(w,{postureTone:8});
const ctx={sensors:ctl.sensors,bal:ctl.warner,body:w.body};
w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; ctl.manual.clear(); squatResetLimits(w);
const court=squatCourtSetup(w,ctl,2.0);
const impulse=Number(env.SQC_COM_IMPULSE??0);
const ti=w.body.indexByKey.get('torso');
let done=false;
for(let s=0;s<Math.round(3.8/w.dt);s++){
 const t=s*w.dt;
 w.advance(1,()=>{ if(!done&&impulse&&t>=2.35&&ti!==undefined){done=true;w.body.bodies[ti]!.applyImpulse({x:0,y:0,z:impulse},true);} });
 squatFrame(w,ctl,court);
 if(t<2.0||t>3.7) continue;
 if(Math.abs((t*10)%2)>0.25) continue;
 const m=(globalThis as {__COM_MON?:any}).__COM_MON;
 if(!m) continue;
 console.log(`t=${t.toFixed(1)} off=${(m.offset*100).toFixed(2)} pred=${(m.predicted*100).toFixed(2)} xcom=${(m.xcom*100).toFixed(2)} lvl=${m.level} cop=${(m.copTotal*100).toFixed(1)} fz=${m.feet[0].fz.toFixed(0)}/${m.feet[1].fz.toFixed(0)} req=${(m.feet[0].request*100).toFixed(1)}/${(m.feet[1].request*100).toFixed(1)} fall=${court.fall.toFixed(2)} copZ=${(m.feet[0].copZ*100).toFixed(1)}/${(m.feet[1].copZ*100).toFixed(1)} c=${(m.feet[0].center*100).toFixed(1)}/${(m.feet[1].center*100).toFixed(1)} rel=${(m.feet[0].rel*100).toFixed(1)}/${(m.feet[1].rel*100).toFixed(1)}`);
}
