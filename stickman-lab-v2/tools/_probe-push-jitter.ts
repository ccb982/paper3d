/** _probe-push-jitter.ts —— 挺腰腿部高频抖动：二阶差分能量（HF 专测） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { applyLumbar, DEFAULT_LUMBAR } from '../src/core/lumbarPolicy';
import * as fs from 'node:fs';

function run(label: string, act: boolean, wopt: object): void {
  const w = new World(wopt);
  const ctl = new ControlModule(w, { postureTone: 8 });
  if (process.env.BEND_SIGN !== undefined) ctl.warner.opt.bendSign = Number(process.env.BEND_SIGN);
  if (process.env.LUMBAR_JSON) {
    const j = JSON.parse(fs.readFileSync(process.env.LUMBAR_JSON, 'utf8')) as { p?: object } | object;
    const pp = (j as { p?: object }).p ?? j;
    applyLumbar(ctl.warner.opt, { ...DEFAULT_LUMBAR, ...(pp as object) });
  }
  if (process.env.STANDX !== undefined) {
    const sx = Number(process.env.STANDX);
    ctl.warner.opt.standX = sx;
    ctl.warner.setComTarget(sx, 0);
  }
  w.controller = ctl;
  w.reset();
  if (act) ctl.actions.play('pushRise');
  const knee = w.body.dofByName('knee_l', 2);
  let w0 = 0, w1 = 0, jit = 0, n = 0;
  const trace = process.env.TRACE === '1';
  for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
    w.advance(1);
    if (trace && s % 24 === 0) {
      console.log(`    t=${(s * w.dt).toFixed(2)} comX=${ctl.sensors.com[0]!.toFixed(4)} vx=${ctl.sensors.comVel[0]!.toFixed(3)} 膝θ=${w.body.dofs[knee]!.angle.toFixed(4)} 膝v=${w.body.dofs[knee]!.vel.toFixed(4)}`);
    }
    const t = s * w.dt;
    const v = w.body.dofs[knee]!.vel;
    const d2 = v - 2 * w1 + w0;
    if (t > 1.2 && t < 2.6) { jit += d2 * d2; n++; }
    w0 = w1; w1 = v;
  }
  console.log(`${label}：HF 能量=${(jit / n).toExponential(2)}`);
}
run('站立对照      ', false, {});
run('挺腰-默认     ', true, {});
run('挺腰-contact60', true, { body: { contactHz: 60, contactDamping: 1.0 } });
run('挺腰-solver16 ', true, { body: { solverIterations: 16 } });
