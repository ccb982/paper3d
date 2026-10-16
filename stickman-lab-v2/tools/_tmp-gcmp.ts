/** _tmp-gcmp.ts —— 法庭场景：gcomp 互补修正是否生效（supSide 取支撑态） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { courtSetup, courtInject } from '../src/core/court';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 0 });
w.controller = ctl;
w.reset();
const st = courtSetup(w, ctl, 2.0);
const body = w.body;
const excl = new Set(['thigh_r', 'shin_r', 'foot_r', 'arch_r', 'mfoot_r']);
for (let s = 0; s < 480; s++) {
  courtInject(w, ctl);
  w.advance(1);
  if (s % 120 === 0) {
    const out = new Float64Array(body.dofs.length);
    body.gravityComp(out, w.world.gravity.y, 'r');
    const di = body.dofByName('hip_r', 0);
    const d0 = body.dofs[di]!;
    const u = d0.axisWorld, a = d0.anchorWorld;
    let tauComp = 0;
    for (const [kk, bi] of body.indexByKey.entries()) {
      if (excl.has(kk)) continue;
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * w.world.gravity.y;
      tauComp += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
    }
    console.log(`t=${(s * w.dt).toFixed(1)}s 模式=${ctl.warner.supportState.mode} hip0: gcomp=${out[di]!.toFixed(1)} 互补need=${(-tauComp).toFixed(1)} 实际=${w.executor.appliedOf(di).toFixed(1)}`);
  }
}
void st;
