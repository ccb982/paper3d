import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const warner: any = (ctl as any).warner;
if (warner?.opt) { warner.opt.bendSign = 0; warner.opt.leanSign = 0; }
ctl.actions.play('singleLegR');
console.log('t     相位        comX    vX     胸高    支撑髋°  支脚yaw°  脚fz');
let lastPh = '';
for (let s = 0; s < Math.round(6.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) { console.log(`--- 相位切换: ${ph} @${t.toFixed(2)}s`); lastPh = ph; }
  if (t < 3.0 || t > 5.5) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  const fi = (w.body as any).indexByKey.get('foot_r');
  const q = (w.body.bodies[fi] as any).rotation();
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
  console.log(`${t.toFixed(1)} ${ph.padEnd(6)} ${ctl.sensors.com[0]!.toFixed(3)} ${ctl.sensors.comVel[0]!.toFixed(2).padStart(6)} ${ctl.sensors.com[1]!.toFixed(3)}  ${g('hip_r', 2).toFixed(1).padStart(6)}  ${yaw.toFixed(1).padStart(7)}  ${ctl.sensors.feet[1]!.fz.toFixed(0)}N`);
}
