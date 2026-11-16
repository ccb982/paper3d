/**
 * _probe-servo2.ts —— 伺服隔离：零重力纯伺服，分离弹簧/阻尼（找 76Hz 泵）
 */
import './_boot';
import { World } from '../src/core/world';

function run(label: string, kpScale: number, kdMode: 'default' | 'none' | number): void {
  const w = new World();
  w.setGravityZero();
  for (const d of w.body.dofs) {
    if (d.engineMotor) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = kpScale * 0.5 * d.tauMax / lim;
    if (kdMode === 'default') w.drive.setAngle(d.dofIndex, 0, kp);
    else if (kdMode === 'none') w.drive.setAngle(d.dofIndex, 0, kp, 0);
    else w.drive.setAngle(d.dofIndex, 0, kp, kdMode);
  }
  w.reset();
  // 小扰动
  for (const d of w.body.dofs) {
    if (!d.engineMotor) w.body.allBodies[d.b2]!.applyTorqueImpulse({ x: 0.002, y: 0.002, z: 0.002 }, true);
  }
  for (let s = 0; s < 480; s++) w.advance(1);
  let sum = 0;
  const top = w.body.dofs.map((d) => ({ n: `${d.name}/${d.axis}`, v: Math.abs(d.vel) }))
    .sort((a, b) => b.v - a.v);
  for (const d of w.body.dofs) sum += Math.abs(d.vel);
  console.log(`${label.padEnd(28)} Σ|ω|=${sum.toFixed(1).padStart(7)}  前3: ${top.slice(0, 3).map((r) => `${r.n}=${r.v.toFixed(1)}`).join(' ')}`);
}

console.log('════ 零重力纯伺服（2s 后，Σ|ω| 应收敛到 0）════');
run('弹簧 only（kd=0）', 1, 'none');
run('阻尼 only（kp=0,kd=2）', 0, 2);
run('全环 默认 kd', 1, 'default');
run('全环 kp×4', 4, 'default');
run('全环 kp×1 kd=2', 1, 2);
