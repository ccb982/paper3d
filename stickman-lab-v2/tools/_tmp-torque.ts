import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const axes: Array<[string, number, number]> = [
  ['hip_l', 2, 0], ['hip_l', 0, 0], ['knee_l', 2, 0], ['foot_l', 2, 0],
  ['hip_r', 2, 0], ['hip_r', 0, 0], ['knee_r', 2, 0], ['foot_r', 2, 0], ['foot_r', 0, 0],
];
let lastPh = '';
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) { console.log(`--- ${ph} @${(s * w.dt).toFixed(2)}s`); lastPh = ph; }
  if (ph === 'B\u62ac\u817f' && s % 12 === 0 && s * w.dt < 3.0) {
    const t = (s * w.dt).toFixed(2);
    const parts: string[] = [];
    for (const [nm, ax] of axes) {
      const di = body.dofByName(nm!, ax!);
      if (di < 0) continue;
      const bd = ctl.warner.drive.lastBreakdown[di];
      const d = body.dofs[di];
      parts.push(`${nm}/${ax}[θ=${(d.angle * 57.3).toFixed(0)} o=${(d.vel * 57.3).toFixed(0)}|弹${(bd?.stiff ?? 0).toFixed(0)} 活${(bd?.act ?? 0).toFixed(0)} 伺${(bd?.servo ?? 0).toFixed(0)} ff${(bd?.ff ?? 0).toFixed(0)} 阻${(bd?.damp ?? 0).toFixed(0)}]`);
    }
    console.log(t + ' ' + parts.join(' '));
  }
}
