import './_env-main'; import './_boot';
import { World } from '../src/core/world'; import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatResetLimits } from '../src/core/servo/squat';
const w=new World(); const ctl=new ControlModule(w,{postureTone:8}); w.controller=ctl; w.reset(); ctl.actions.idleEnabled=false; squatResetLimits(w); squatCourtSetup(w,ctl,2.0);
for(const key of ['foot_l','foot_r','torso']) {
 const bi=w.body.indexByKey.get(key)!; const b=w.body.bodies[bi]!; const sb=w.sk.bodies[bi]!;
 console.log(key,'p',b.translation(),'colliders',sb.colliders?.map(c=>({hx:c.hx,hz:c.hz,hy:c.hy,ox:c.ox,oz:c.oz})));
}
const com=ctl.sensors.com; console.log('com',com);
