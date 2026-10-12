/** 追链：lateralStab 的输出（spine1/0 目标）到底有没有进 Drive —— 对比 manual 目标 vs drive.target */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const manual = (ctl as any).bal?.manual ?? (ctl as any).manual;
const di = w.body.dofByName('spine1', 0);
console.log('t      manual目标°  drive.target°  drive.kp  实际°   pinned');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.4) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const ma = manual?.angle?.[di];
  const dt2 = drive?.target?.[di];
  const dk = drive?.kp?.[di];
  const act = w.body.dofs[di]!.angle * 57.3;
  const pin = manual?.isPinned ? manual.isPinned('spine1', 0) : '?';
  console.log(`${t.toFixed(1)} ${(Number.isNaN(ma) ? 'NaN' : (ma * 57.3).toFixed(1)).padStart(11)} ${(Number.isNaN(dt2) || dt2 === undefined ? 'NaN' : (dt2 * 57.3).toFixed(1)).padStart(13)} ${String(dk?.toFixed(0)).padStart(9)} ${act.toFixed(1).padStart(6)}  ${pin}`);
}
