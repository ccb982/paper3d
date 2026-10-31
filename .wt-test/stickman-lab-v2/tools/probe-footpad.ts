/**
 * probe-footpad.ts —— C1 垫脚验收（功能版）
 * 四向轻推（前后左右，Δv=0.12 m/s）→ 垫脚反射自动模式的恢复 vs 关断（消融）
 * 判据：垫脚 ON 时四向都能回到 |CoM| < 4cm 且不摔；OFF 时漂走。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';
import { Sensors } from '../src/core/sensors';
import { FootPad } from '../src/core/footPad';

const DIRS: { name: string; x: number; z: number }[] = [
  { name: '前 +x', x: 1, z: 0 },
  { name: '后 −x', x: -1, z: 0 },
  { name: '左 +z', x: 0, z: 1 },
  { name: '右 −z', x: 0, z: -1 },
];

interface Result { peak: number; final: number; chestY: number; }

function recovery(dir: { x: number; z: number }, padOn: boolean): Result {
  const w = new World();
  const bal = new StabilityWarner(w, {
    gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: false,
    ankleStrategy: false,
    postureSkipAnkles: padOn,        // 垫脚开时才让位；OFF 时保留踝张力做公平对照
  });
  w.controller = bal;
  w.reset();
  const sn = new Sensors(w);
  const pad = new FootPad(w);
  pad.enabled = padOn;
  pad.auto = true;                 // 手动命令模拟"平衡系统"：目标 (0,0) 的 CoM PD
  pad.comTargetX = 0;
  pad.comTargetZ = 0;
  const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
  const dv = 0.12;
  let pushed = false, peak = 0;
  const N = Math.round(2.5 / w.dt);
  for (let s = 0; s < N; s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: dir.x * b.mass() * dv, y: 0, z: dir.z * b.mass() * dv }, true);
      pushed = true;
    }
    sn.update(w.dt);
    w.advance(1, () => pad.step(w.dt, sn));
    const e = Math.hypot(sn.com[0]!, sn.com[2]!);
    if (e > peak) peak = e;
  }
  return { peak, final: Math.hypot(sn.com[0]!, sn.com[2]!), chestY: w.body.bodies[chest]!.translation().y };
}

console.log('════ 四向轻推恢复（Δv=0.12 m/s；垫脚反射 ON vs OFF）════');
let pass = 0;
for (const d of DIRS) {
  const on = recovery(d, true);
  const off = recovery(d, false);
  const ok = on.final < 0.04 && on.chestY > 1.3;
  if (ok) pass++;
  console.log(
    `  ${d.name.padEnd(6)} 垫脚ON:  峰值=${(on.peak * 100).toFixed(1)}cm  末=${(on.final * 100).toFixed(1)}cm  胸y=${on.chestY.toFixed(3)}` +
    `   |  OFF: 峰值=${(off.peak * 100).toFixed(1)}cm  末=${(off.final * 100).toFixed(1)}cm  胸y=${off.chestY.toFixed(3)}  ${ok ? '✅' : '❌'}`,
  );
}
console.log(`\n结论：四向恢复 ${pass}/4（目标：垫脚做好 80% 不摔）`);
