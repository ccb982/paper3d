/**
 * _probe-drop-bounce.ts —— 落地"弹"诊断：整体抬升 H 后自由落体（双脚）
 * 对比消力开/关/布娃娃；重点看小落差（5/10cm，正常落脚）是否弹。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, H: number, mode: 'on' | 'off' | 'ragdoll'): void {
  const w = new World();
  let ctl: ControlModule | null = null;
  if (mode === 'ragdoll') {
    w.driveEnabled = false;
  } else {
    ctl = new ControlModule(w, { postureTone: 8 });
    if (mode === 'off') ctl.landing.opt.enabled = false;
    w.controller = ctl;
  }
  w.reset();
  const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  const W = w.sk.massTotal * 9.81;
  const footFz = () => w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
  let lifted = false, contactT = -1;
  let minAfter = Infinity, maxAfter = -Infinity, tMax = 0;
  const trace: string[] = [];
  for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
    const t = s * w.dt;
    if (!lifted && t >= 0.5) {
      for (const b of w.body.bodies) {
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y + H, z: p.z }, true);
      }
      lifted = true;
    }
    w.advance(1);
    const cy = chest();
    if (lifted && contactT < 0 && footFz() > 0.3 * W) contactT = t;
    if (lifted && contactT > 0 && t >= contactT) {
      if (cy < minAfter) minAfter = cy;
      if (cy > maxAfter) { maxAfter = cy; tMax = t; }
      if (Math.round(t / 0.05) !== Math.round((t - w.dt) / 0.05)) trace.push(`${t.toFixed(2)}:${cy.toFixed(3)}`);
    }
  }
  const bounce = maxAfter - minAfter;
  console.log(`${label} H=${(H * 100).toFixed(0)}cm：${trace.slice(0, 26).join(' ')}`);
  console.log(`   触地后 最低=${minAfter.toFixed(3)} 最高=${maxAfter.toFixed(3)}(@${tMax.toFixed(2)}s) 回升=${(bounce * 100).toFixed(1)}cm 末胸=${chest().toFixed(3)}`);
}

for (const H of [0.05, 0.10]) {
  run('消力开 ', H, 'on');
  run('消力关 ', H, 'off');
  run('布娃娃 ', H, 'ragdoll');
  console.log('');
}
