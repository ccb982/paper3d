import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) w.advance(1);
const body = w.body as any;
const drv = ctl.warner.drive;
const rows: Array<[string, number]> = [];
for (let i = 0; i < body.dofs.length; i++) {
  const c = drv.conflictByDof[i] ?? 0;
  if (c > 0) rows.push([`${body.dofs[i].name}/${body.dofs[i].axis}`, c]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('逐关节冲突排行（前12）：');
for (const [nm, c] of rows.slice(0, 12)) console.log(`${nm}: ${c}`);
