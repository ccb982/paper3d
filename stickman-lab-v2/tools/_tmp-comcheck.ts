import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const bz = (n: string): number => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return 0; return body.bodies[ix].translation().z; } catch { return 0; } };
const bm = (n: string): number => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return 0; const b = body.bodies[ix]; return b.mass ?? b.m ?? 1; } catch { return 0; } };
console.log('t | 报告comZ | 盘骨(torso)Z | 独立CoM | 差 | 摆腿足Z | 支撑足Z | 摆腿质量');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.1 && s % 24 === 0) {
    const rep = ctl.sensors.com[2]!;
    const torsoZ = bz('torso');
    let mz = 0, m = 0, mzNoSwing = 0, mNoSwing = 0;
    const keys = Array.from(body.indexByKey.keys()) as string[];
    for (const k of keys) {
      const mk = bm(k); const zk = bz(k);
      mz += mk * zk; m += mk;
      const isSwing = /_l$/.test(k) || k.startsWith('arm_l') || k.startsWith('hand_l');
      if (!isSwing) { mzNoSwing += mk * zk; mNoSwing += mk; }
    }
    const trueCom = mz / Math.max(1e-9, m);
    const noSwing = mzNoSwing / Math.max(1e-9, mNoSwing);
    console.log(`${t.toFixed(2)} | ${(rep*100).toFixed(1).padStart(8)} | ${(torsoZ*100).toFixed(1).padStart(8)} | ${(trueCom*100).toFixed(1).padStart(8)} | ${((trueCom-rep)*100).toFixed(1).padStart(5)} | ${(bz('foot_l')*100).toFixed(1).padStart(6)} | ${(bz('foot_r')*100).toFixed(1).padStart(6)} | ${(m-mNoSwing).toFixed(1)}`);
  }
}
