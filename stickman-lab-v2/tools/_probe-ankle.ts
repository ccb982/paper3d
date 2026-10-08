/**
 * _probe-ankle.ts —— 踝策略内部量：com.x / 踝 x / Δp / Fz / τ（前 1.5s）
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';

const w = new World();
const bal = new BalanceController(w, {
  gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
  postureTone: 0.8, lateralControl: false,
});
w.controller = bal;
w.reset();
const flexL = w.body.dofByName('foot_l', 2);
const flexR = w.body.dofByName('foot_r', 2);

for (let s = 0; s < 360; s++) {
  w.advance(1);
  if (s % 24 === 0) {
    const d = w.body.dofs[flexL]!;
    const com = new Float64Array(3);
    w.body.com(com);
    const fL = w.body.footNormalForce('l', w.dt);
    const fR = w.body.footNormalForce('r', w.dt);
    const tL = w.executor.ledger[flexL]!.applied;
    const tR = w.executor.ledger[flexR]!.applied;
    const chest = w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
    console.log(`t=${(s * w.dt).toFixed(2)} com.x=${com[0]!.toFixed(4)} 踝x=${d.anchorWorld[0]!.toFixed(4)} FzL=${fL.toFixed(0)} FzR=${fR.toFixed(0)} τflexL=${tL.toFixed(1)} τflexR=${tR.toFixed(1)} 胸y=${chest.toFixed(3)}`);
  }
}
