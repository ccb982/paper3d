/** _probe-spine-bench: 冻结骨盆/腿，只给 spine1/0 力矩，测被动律 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const env = (globalThis as { process?: { env?: Record<string,string> } }).process?.env ?? {};
const w = new World(); w.reset(); w.controller = undefined; w.driveEnabled = false;
w.setGravity(0);
const lower = ['torso','thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r','arch_l','arch_r','mfoot_l','mfoot_r'];
const init = new Map<string,{p:any;q:any}>();
for (const k of lower) { const i=w.body.indexByKey.get(k); if(i!==undefined){const b=w.body.bodies[i]!; init.set(k,{p:{...b.translation()},q:{...b.rotation()}});} }
const di=w.body.dofByName('spine1',0);
const imp=Number(env.SQC_BENCH_TAU ?? 10);
const law=Number(env.SQC_BENCH_LAW ?? 0);
const K=Number(env.SQC_BENCH_K ?? 200), B=Number(env.SQC_BENCH_B ?? 6);
const slack=Math.abs(Number(env.SQC_BENCH_SLACK ?? 1.0))/57.3;
const sign=Number(env.SQC_BENCH_SIGN ?? 1)<0?-1:1;
let crosses=0,lastV=0,maxA=0,maxV=0;
console.log(`law=${law} K=${K} B=${B} slack=${(slack*57.3).toFixed(1)}° sign=${sign}`);
for(let s=0;s<Math.round(1.5/w.dt);s++){
  const t=s*w.dt;
  w.advance(1,()=>{
    for(const [k,f] of init){const i=w.body.indexByKey.get(k)!; const b=w.body.bodies[i]!; b.setTranslation(f.p,true); b.setRotation(f.q,true); b.setLinvel({x:0,y:0,z:0},true); b.setAngvel({x:0,y:0,z:0},true);}
    const d=w.body.dofs[di]!;
    let tau=0;
    if(t<0.1) tau=imp;
    else if(law===1) tau=-K*d.angle-B*d.vel;
    else if(law===2) {
      const away=d.angle*d.vel>0;
      const sg=d.angle>=0?1:-1;
      tau=(away && Math.abs(d.angle)>slack ? sign*-K*(d.angle-sg*slack):0)-B*d.vel;
    } else if(law===3) tau=-B*d.vel;
    if(di>=0) w.executor.addTorque(di,tau);
  });
  const d=w.body.dofs[di]!;
  if(t>0.1){maxA=Math.max(maxA,Math.abs(d.angle));maxV=Math.max(maxV,Math.abs(d.vel));if(d.vel*lastV<0&&Math.abs(d.vel)>0.05)crosses++;lastV=d.vel;}
  if(s%20===0&&t>0.05) console.log(`${t.toFixed(2)} a=${(d.angle*57.3).toFixed(2)}° v=${d.vel.toFixed(3)}`);
  if(s===Math.round(1.49/w.dt)) console.log(`END a=${(d.angle*57.3).toFixed(2)}° maxA=${(maxA*57.3).toFixed(1)}° maxV=${maxV.toFixed(2)} crosses=${crosses}`);
}
