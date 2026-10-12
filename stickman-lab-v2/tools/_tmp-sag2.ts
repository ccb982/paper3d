import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const drive = (ctl as any).drive ?? (w as any).drive;
const tau = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
};
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? body.dofs[di]!.angle * 57.3 : NaN;
};
console.log('t 相 | comX(cm) comVX(cm/s) | 躯干pitch° | sp1/2 sp2/2 sp3/2 (角°) | sp1τ sp2τ sp3τ | 支髋sag τ | 支踝跖 τ');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const pitch = ctl.sensors.torsoTilt[0]! * 57.3;
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(ctl.sensors.com[0]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[0]! * 100).toFixed(1).padStart(6)} | ${pitch.toFixed(1).padStart(6)} | ${ang('spine1', 2).toFixed(1).padStart(5)} ${ang('spine2', 2).toFixed(1).padStart(5)} ${ang('spine3', 2).toFixed(1).padStart(5)} | ${tau('spine1', 2).toFixed(0).padStart(4)} ${tau('spine2', 2).toFixed(0).padStart(4)} ${tau('spine3', 2).toFixed(0).padStart(4)} | ${tau('hip_r', 2).toFixed(0).padStart(5)} | ${tau('foot_r', 2).toFixed(0).padStart(5)}`);
}
