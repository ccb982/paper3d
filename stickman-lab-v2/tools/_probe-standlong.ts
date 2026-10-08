/**
 * _probe-standlong.ts —— 站立基线 10s：A 纯姿势(无重力补偿) B 重力补偿+姿势 C +矢状CoM
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';

function run(label: string, mode: 'posture' | 'grav' | 'com'): void {
  const w = new World();
  if (mode === 'posture') {
    for (const d of w.body.dofs) if (!d.engineMotor) w.drive.setAngle(d.dofIndex, 0);
  } else {
    const bal = new BalanceController(w, {
      gravityComp: true, comKp: mode === 'com' ? 12 : 0, comKd: mode === 'com' ? 5 : 0,
      maxForceFrac: 0.35, postureTone: mode === 'com' ? 8 : 8, lateralControl: true,
    });
    w.controller = bal;
  }
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  const trace: string[] = [];
  for (let s = 0; s < 2400; s++) {
    w.advance(1);
    if (s % 240 === 0) {
      const y = w.body.bodies[chest]!.translation().y;
      const fz = (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt));
      trace.push(`${(s * w.dt).toFixed(0)}s:y=${y.toFixed(3)},Fz=${fz.toFixed(0)}`);
    }
  }
  console.log(`${label.padEnd(22)} ${trace.join('  ')}`);
}

console.log('════ 站立基线 10s ════');
run('A 纯姿势(无重力补偿)', 'posture');
run('B 重力补偿+姿势', 'grav');
run('C +矢状CoM', 'com');
