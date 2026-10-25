import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset(); w.switchPoseState('stand');
const body = w.body;
const di = (n: string, ax: number): number => body.dofByName(n, ax);
const ang = (n: string, ax: number): number => { const i = di(n, ax); return i >= 0 ? body.dofs[i]!.angle * 57.3 : NaN; };
const anchor = (n: string): { x: number; y: number; z: number } => {
  const i = di(n, 2);
  if (i < 0) return { x: NaN, y: NaN, z: NaN };
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
for (const s of ['l', 'r'] as const) {
  const h = anchor(`hip_${s}`, 2), k = anchor(`knee_${s}`, 2), a = anchor(`foot_${s}`, 2);
  const th = body.bodies[body.indexByKey.get(`thigh_${s}`)!]!.translation();
  const sh = body.bodies[body.indexByKey.get(`shin_${s}`)!]!.translation();
  const ft = body.bodies[body.indexByKey.get(`foot_${s}`)!]!.translation();
  console.log(`LEG ${s} hip=(${h.x.toFixed(4)},${h.y.toFixed(4)},${h.z.toFixed(4)}) knee=(${k.x.toFixed(4)},${k.y.toFixed(4)},${k.z.toFixed(4)}) ankle=(${a.x.toFixed(4)},${a.y.toFixed(4)},${a.z.toFixed(4)}) L1=${dist(h, k).toFixed(4)} L2=${dist(k, a).toFixed(4)} thighY=${th.y.toFixed(4)} shinY=${sh.y.toFixed(4)} footY=${ft.y.toFixed(4)} footZ=${ft.z.toFixed(4)}`);
}
console.log(`REST hip2L=${ang('hip_l', 2).toFixed(2)} hip2R=${ang('hip_r', 2).toFixed(2)} knee2L=${ang('knee_l', 2).toFixed(2)} knee2R=${ang('knee_r', 2).toFixed(2)} foot2L=${ang('foot_l', 2).toFixed(2)} foot2R=${ang('foot_r', 2).toFixed(2)}`);
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body };
const roll = (): number => {
  const i = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3');
  if (i === undefined) return NaN;
  const q = body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy)) * 57.3;
};
let last = -1;
for (let i = 0; i < Math.round(8 / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (w.clock - last >= 0.25) {
    last = w.clock;
    const fl = body.bodies[body.indexByKey.get('foot_l')!]!.translation();
    const fr = body.bodies[body.indexByKey.get('foot_r')!]!.translation();
    const fL = body.footNormalForce('l', w.dt), fR = body.footNormalForce('r', w.dt);
    const c = ctl.sensors.com;
    console.log(`LS t=${w.clock.toFixed(2)} ph=${(ctl.actions.status.phase ?? '-').padEnd(4)} comZ=${(c[2]! * 100).toFixed(1)} roll=${roll().toFixed(1)} hip2=${ang('hip_l', 2).toFixed(0)}/${ang('hip_r', 2).toFixed(0)} knee2=${ang('knee_l', 2).toFixed(0)}/${ang('knee_r', 2).toFixed(0)} foot2=${ang('foot_l', 2).toFixed(0)}/${ang('foot_r', 2).toFixed(0)} footX=${(fl.x * 100).toFixed(1)}/${(fr.x * 100).toFixed(1)} footY=${(fl.y * 100).toFixed(1)}/${(fr.y * 100).toFixed(1)} fz=${fL.toFixed(0)}/${fR.toFixed(0)}`);
  }
}
