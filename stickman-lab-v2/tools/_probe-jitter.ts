/**
 * _probe-jitter.ts —— 初态站立抖动回读（新控制路径 ControlModule）
 * 每 ~25ms 打印：双脚 Fz/CoP、垫脚目标、踝应用力矩、脚刚体角速度
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const PAD = Number((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS?.[0] ?? '0.02');
const CHZ = Number((globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS?.[1] ?? '0');
const MODE = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS?.[2] ?? '';
const w = new World({
  ...DEFAULT_WORLD_OPTIONS,
  drive: { ...DEFAULT_WORLD_OPTIONS.drive, passiveDampingFrac: PAD },
  body: { ...DEFAULT_WORLD_OPTIONS.body, contactHz: CHZ },
});
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
if (MODE === 'nomotor') {
  for (const d of w.body.dofs) if (d.engineMotor && d.engineJoint) d.engineJoint.configureMotorVelocity(0, 0);
}
if (MODE === 'nograv') ctl.warner.opt.gravityComp = false;
if (MODE === 'notone') ctl.warner.opt.postureTone = 0;
if (MODE === 'lift') {
  for (const b of w.body.allBodies) {
    const t = b.translation();
    b.setTranslation({ x: t.x, y: t.y + 0.5, z: t.z }, true);
  }
}
console.log(`passiveDampingFrac=${PAD} contactHz=${CHZ} mode=${MODE || 'base'}`);

const flexL = w.body.dofByName('foot_l', 2);
const flexR = w.body.dofByName('foot_r', 2);
const invL = w.body.dofByName('foot_l', 0);
const footL = w.body.indexByKey.get('foot_l') ?? 0;

console.log('   t    FzL   FzR  CoPLx CoPLz | padL(dx,dz) | τflexL τinvL | ωfootL | Σ|ω|');
for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
  w.advance(1);
  if (s % 6 === 0) {
    const L = ctl.sensors.feet[0]!, R = ctl.sensors.feet[1]!;
    const gt = ctl.pad.getTarget('l');
    const wf = w.body.bodies[footL]!.angvel();
    const wfm = Math.hypot(wf.x, wf.y, wf.z);
    console.log(
      `${(s * w.dt).toFixed(3)}  ${L.fz.toFixed(0).padStart(4)}  ${R.fz.toFixed(0).padStart(4)}` +
      `  ${L.copX.toFixed(3)} ${L.copZ.toFixed(3)} | (${gt.dx.toFixed(3)},${gt.dz.toFixed(3)})` +
      ` | ${w.executor.ledger[flexL]!.applied.toFixed(1).padStart(6)} ${w.executor.ledger[invL]!.applied.toFixed(1).padStart(6)}` +
      ` | ${wfm.toFixed(2).padStart(6)} | ${w.totalRelVel().toFixed(1)}`,
    );
  }
}
// 结束时逐自由度 |ω| 排行
const rows = w.body.dofs.map((d) => ({ n: `${d.name}/${d.axis}`, v: Math.abs(d.vel) }))
  .sort((a, b) => b.v - a.v).slice(0, 8);
console.log('\n末态 Σ|ω| 排行：' + rows.map((r) => `${r.n}=${r.v.toFixed(2)}`).join('  '));
