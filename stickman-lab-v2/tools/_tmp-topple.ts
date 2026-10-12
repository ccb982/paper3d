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
const bd = (n: string, ax: number): any => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (drive?.lastBreakdown?.[di] ?? {}) : {};
};
const tau = (n: string, ax: number): number => {
  const b = bd(n, ax);
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
};
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? body.dofs[di]!.angle * 57.3 : NaN;
};
const pos = (key: string): { z: number } => {
  const ix = body.indexByKey.get(key);
  return ix === undefined ? { z: NaN } : body.bodies[ix].translation();
};
console.log('t 相位 | CoM_z cm  vZ cm/s | 支髋ang τ(act/itb/lum) | 支踝额 ang τ | 支踝跖 τ | 摆髋ang | 摆脚z | sp1 ang τ | fz撑/摆');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const b = bd('hip_r', 0);
  const f = (v: number | undefined): string => (v ?? 0).toFixed(0).padStart(4);
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 2)} | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(6)} | ${ang('hip_r', 0).toFixed(1).padStart(6)} ${f(tau('hip_r', 0))}(${f(b.act)}/${f(b.itb)}/${f(b.lum)}) | ${ang('foot_r', 0).toFixed(1).padStart(5)} ${f(tau('foot_r', 0))} | ${f(tau('foot_r', 2))} | ${ang('hip_l', 0).toFixed(1).padStart(6)} | ${(pos('mfoot_l').z * 100).toFixed(1).padStart(5)} | ${ang('spine1', 0).toFixed(1).padStart(5)} ${f(tau('spine1', 0))} | ${ctl.sensors.feet[1]!.fz.toFixed(0).padStart(4)}/${ctl.sensors.feet[0]!.fz.toFixed(0).padStart(4)}`);
}
