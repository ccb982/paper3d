/**
 * _probe-limits.ts —— 正交开关：引擎限位 / 引擎电机 / 中间体，谁在注入
 */
import './_boot';
import { World } from '../src/core/world';

const FRAMES = 240;

function run(label: string, opts: { noLimits?: boolean; noMotor?: boolean } = {}): void {
  const w = new World();
  w.driveEnabled = false;
  w.setGravityZero();
  w.reset();
  // 抬离地面，排除接触
  for (const b of w.body.allBodies) {
    const t = b.translation();
    b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
  }
  for (const d of w.body.dofs) {
    if (!d.engineJoint) continue;
    if (opts.noLimits) d.engineJoint.setLimits(-1e9, 1e9);
    if (opts.noMotor && d.engineMotor) d.engineJoint.configureMotorVelocity(0, 0);
  }
  // 记录前 10 拍速度爆炸
  const trace: number[] = [];
  for (let s = 0; s < FRAMES; s++) {
    w.advance(1);
    if (s < 10 || s === 59 || s === FRAMES - 1) {
      let sw = 0;
      for (const d of w.body.dofs) sw += Math.abs(d.vel);
      trace.push(sw);
    }
  }
  let sum = 0, sumW = 0;
  for (const d of w.body.dofs) { sum += Math.abs(d.angle) * 180 / Math.PI; sumW += Math.abs(d.vel); }
  const head = trace.slice(0, 10).map((v) => v.toFixed(1)).join(',');
  console.log(`${label.padEnd(26)} Σ|Δθ|=${sum.toFixed(1).padStart(6)}°  Σ|ω|=${sumW.toFixed(3).padStart(8)}`);
  console.log(`   前10拍 Σ|ω|: ${head}`);
}

console.log('════ 限位/电机/中间体 开关（零重力/抬离地面/240拍）════');
run('① 基线（限位+电机）');
run('② 关限位', { noLimits: true });
run('③ 关电机（柔性足）', { noMotor: true });
run('④ 关限位+关电机', { noLimits: true, noMotor: true });
