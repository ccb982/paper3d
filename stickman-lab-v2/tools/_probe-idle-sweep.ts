/**
 * _probe-idle-sweep.ts —— 等离面：中间体质量/惯量 × 求解器迭代 × 是否接触
 */
import './_boot';
import { World } from '../src/core/world';

const FRAMES = 720;

function run(label: string, midMass: number, midI: number, iters: number, noContact: boolean): void {
  const w = new World({ body: { solverIterations: iters, gimbalMidMass: midMass, gimbalMidInertia: midI } });
  w.driveEnabled = false;
  w.setGravityZero();
  w.reset();
  if (noContact) {
    for (const b of w.body.allBodies) {
      const t = b.translation();
      b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
    }
  }
  w.advance(FRAMES);
  let sum = 0, sumW = 0, worst = '', worstD = 0;
  let gimbal = 0, rev = 0;
  for (const d of w.body.dofs) {
    const dd = Math.abs(d.angle) * 180 / Math.PI;
    sum += dd; sumW += Math.abs(d.vel);
    const isGimbal = w.sk.joints[d.joint]!.revoluteAxis === undefined;
    if (isGimbal) gimbal += dd; else rev += dd;
    if (dd > worstD) { worstD = dd; worst = `${d.name}/${d.axis}`; }
  }
  console.log(`${label.padEnd(34)} Σ|Δθ|=${sum.toFixed(1).padStart(6)}° (链=${gimbal.toFixed(0)} rev=${rev.toFixed(0)})  Σ|ω|=${sumW.toFixed(3).padStart(8)}  最差 ${worst} ${worstD.toFixed(1)}°`);
}

console.log('════ T1 扫描（零重力/零驱动/720 拍）════');
run('接触ON  mid 1e-3/I1e-6  it16', 1e-3, 1e-6, 16, false);
run('接触ON  mid 1e-2/I1e-5  it16', 1e-2, 1e-5, 16, false);
run('接触ON  mid 5e-2/I1e-4  it16', 5e-2, 1e-4, 16, false);
run('接触ON  mid 1e-3/I1e-6  it64', 1e-3, 1e-6, 64, false);
run('接触OFF mid 1e-3/I1e-6  it16', 1e-3, 1e-6, 16, true);
run('接触OFF mid 5e-2/I1e-4  it16', 5e-2, 1e-4, 16, true);
