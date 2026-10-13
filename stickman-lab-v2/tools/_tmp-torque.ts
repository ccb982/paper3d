import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const show = ['foot_r', 'knee_r', 'hip_r', 'spine1', 'spine3'];
let lastPh = '';
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) { console.log(`--- ${ph} @${(s * w.dt).toFixed(2)}s`); lastPh = ph; }
  if (ph === 'B\u62ac\u817f' && s % 12 === 0 && s * w.dt < 3.0) {
    const t = (s * w.dt).toFixed(2);
    const parts: string[] = [];
    for (const nm of show) {
      const di = body.dofByName(nm, 0);
      if (di < 0) continue;
      const bd = ctl.warner.drive.lastBreakdown[di];
      const d = body.dofs[di];
      parts.push(`${nm}[\u03b8=${(d.angle * 57.3).toFixed(0)} o=${(d.vel * 57.3).toFixed(0)} | \u5f39${(bd?.stiff ?? 0).toFixed(0)} \u6d3b${(bd?.act ?? 0).toFixed(0)} \u4f3a${(bd?.servo ?? 0).toFixed(0)} ff${(bd?.ff ?? 0).toFixed(0)} \u963b${(bd?.damp ?? 0).toFixed(0)}]`);
    }
    console.log(t + ' ' + parts.join(' '));
  }
}
