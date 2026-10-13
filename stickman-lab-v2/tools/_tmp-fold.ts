import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
const tq = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return NaN;
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  return b ? (b.act + b.servo + b.ff + b.damp) : 0;
};
console.log('t | 相位 | pitch | sp1/2(矩) | sp2/2(矩) | sp3/2(矩) | hip/2(矩) | 重力需求 | CoMy');
for (let s = 0; s < Math.round(7.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 36 === 0) {
    const ph = ctl.actions.status.phase ?? '?';
    const pitch = (ctl.sensors.torsoTilt[0] ?? 0) * 57.3;
    const mUp = 45;
    const demand = mUp * 9.81 * 0.25 * Math.sin(Math.abs(pitch) / 57.3);
    console.log(`${t.toFixed(2)} | ${ph.slice(0, 2)} | ${pitch.toFixed(0)} | ${ang('spine1', 2).toFixed(0)}(${tq('spine1', 2).toFixed(0)}) | ${ang('spine2', 2).toFixed(0)}(${tq('spine2', 2).toFixed(0)}) | ${ang('spine3', 2).toFixed(0)}(${tq('spine3', 2).toFixed(0)}) | ${ang('hip_r', 2).toFixed(0)}(${tq('hip_r', 2).toFixed(0)}) | ${demand.toFixed(0)} | ${(ctl.sensors.com[1]! * 100).toFixed(0)}`);
  }
}
