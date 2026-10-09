/** _probe-loaddiff.ts —— 差动加载标定：髋力偶 → 负载差 u 与 CoM 的响应 */
import './_boot';
import { World } from '../src/core/world';
import { Sensors } from '../src/core/sensors';
import { StabilityWarner } from '../src/core/stability';

function run(label: string, tauL: number, tauR: number): void {
  const w = new World();
  const sn = new Sensors(w);
  const bal = new StabilityWarner(w, {
    gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
    postureTone: 8, ankleStrategy: false, postureSkipAnkles: true,
  } as never);
  w.reset();
  const hl = w.body.dofByName('hip_l', 0);
  const hr = w.body.dofByName('hip_r', 0);
  for (let s = 0; s < Math.round(1.0 / w.dt); s++) {
    w.advance(1, () => { sn.update(w.dt); bal.contributeBaseline(); });
  }
  const u0 = () => {
    const fl = sn.feet[0]!.fz, fr = sn.feet[1]!.fz;
    return (fr - fl) / Math.max(fl + fr, 1e-6);
  };
  const z0 = sn.com[2]!;
  // 施力偶 0.8s
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) {
    w.advance(1, () => {
      sn.update(w.dt); bal.contributeBaseline();
      w.executor.addTorque(hl, tauL);
      w.executor.addTorque(hr, tauR);
    });
  }
  console.log(`${label}：u ${u0().toFixed(3)}  comZ Δ=${(sn.com[2]! - z0).toFixed(3)}  Fz L=${(sn.feet[0]!.fz / (w.sk.massTotal * 9.81) * 100).toFixed(0)}% R=${(sn.feet[1]!.fz / (w.sk.massTotal * 9.81) * 100).toFixed(0)}%`);
}
run('零力偶       ', 0, 0);
run('同号 +20/+20 ', 20, 20);
run('同号 -20/-20 ', -20, -20);
run('反号 +20/-20 ', 20, -20);
run('反号 -20/+20 ', -20, 20);
