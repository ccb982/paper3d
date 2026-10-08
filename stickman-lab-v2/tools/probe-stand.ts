/**
 * probe-stand.ts —— 重力 + 地面：被动下垂 / 姿态伺服 两种模式
 *
 * 判据：
 *   · 不能出现速度爆炸（Σ|ω| 有界，峰值 < ~50 rad/s；爆炸会到几百）
 *   · 姿态伺服模式：给全部自由度 setAngle(0)，看能撑多久、胸腔高度
 *
 * 用法：node tools/run.mjs probe-stand [seconds] [passive|posture]
 */
import './_boot';
import { World } from '../src/core/world';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECONDS = Number(ARGS[0] ?? 3);
const MODE = (ARGS[1] ?? 'posture') as 'passive' | 'posture';

const w = new World();
w.reset();

if (MODE === 'posture') {
  for (const d of w.body.dofs) {
    if (!d.engineMotor) w.drive.setAngle(d.dofIndex, 0);
  }
}

const FRAMES = Math.round(SECONDS / w.dt);
const y0 = w.body.torso().translation().y;
console.log('════ 重力/地面验收（新执行层）════');
console.log(`模式=${MODE}  ${SECONDS}s @${Math.round(1 / w.dt)}Hz  胸腔 y0=${y0.toFixed(4)} m`);
console.log(`自由度 = ${w.body.dofs.length}（其中引擎电机 ${w.body.dofs.filter((d) => d.engineMotor).length}）`);

let peakW = 0;
for (let s = 0; s < FRAMES; s++) {
  w.advance(1);
  if (s % 60 === 0) {
    const sw = w.totalRelVel();
    if (sw > peakW) peakW = sw;
    const t = w.body.torso().translation();
    if (s % 240 === 0) {
      console.log(`  t=${(s * w.dt).toFixed(2)}s  胸 y=${t.y.toFixed(3)}  x=${t.x.toFixed(3)}  z=${t.z.toFixed(3)}  Σ|ω|=${sw.toFixed(2)}`);
    }
  }
}
const t1 = w.body.torso().translation();
const bad = w.executor.checkInvariants();
console.log('');
console.log(`末态：胸 y=${t1.y.toFixed(4)} (Δ=${((t1.y - y0) * 1000).toFixed(0)} mm)  x=${t1.x.toFixed(3)}  z=${t1.z.toFixed(3)}`);
console.log(`Σ|ω| 峰值 = ${peakW.toFixed(2)} rad/s  末值 = ${w.totalRelVel().toFixed(4)}`);
console.log(`执行器不变量：${bad.length === 0 ? '通过' : bad.join('; ')}`);
