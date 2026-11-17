import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World(); const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false; w.controller = ctl; w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const f = (v: number | undefined, n = 1): string => (Number.isFinite(v as number) ? (v as number).toFixed(n) : '-');
const di = (n: string, a: number): number => w.body.dofByName(n, a);
const k = di('knee_l',2), h = di('hip_l',2), fl = di('foot_l',2), f0 = di('foot_l',0);
for (let i = 0; i < Math.round(2.9 / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1);
  const t = w.clock; if (t < 2.0 || t > 2.75) continue;
  if (i % Math.round(0.05 / w.dt) !== 0) continue;
  const g = (globalThis as { __SQD_DBG?: any }).__SQD_DBG;
  const led = (j: number) => w.executor.ledger[j]?.applied ?? 0;
  console.log(`t=${t.toFixed(2)} ph=${ctl.actions.status.phase ?? '-'} cmdT=${f(g?.t,2)} p=${f(g?.p,3)} both=${g?.both ? '1':'0'} fz=${f(g?.fzL,0)}/${f(g?.fzR,0)} footY=${f(g?.footL?.y*100,1)}/${f(g?.footR?.y*100,1)} footZ=${f(g?.footL?.z*100,1)}/${f(g?.footR?.z*100,1)} qK=${f(g?.qKnee*57.3)} aK=${f(w.body.dofs[k]!.angle*57.3)} tauK=${f(g?.tauKnee,0)} ffK=${f(g?.ffKnee,0)} appK=${f(led(k),0)} qH=${f(g?.qRef?.[h]*57.3)} aH=${f(w.body.dofs[h]!.angle*57.3)} appH=${f(led(h),0)} qF=${f(g?.qRef?.[fl]*57.3)} aF=${f(w.body.dofs[fl]!.angle*57.3)} appF=${f(led(fl),0)} qF0=${f(g?.qRef?.[f0]*57.3)} aF0=${f(w.body.dofs[f0]!.angle*57.3)} appF0=${f(led(f0),0)} lat=${g?.lat?'L':'-'}`);
}
