/**
 * diag-t1-bisect.ts —— T1 漂移源单变量定位（零重力、零驱动）
 *
 * 目的：找出「零输入下 Σ|Δθ| = 248°」的真凶。候选：
 *   A 球铰替代结构（2×revolute + 轻中间体）本身注入角速度
 *   B 引擎 revolute setLimits 打架
 *   C 自研 enforceLimits 冲量
 *   D BodyOptions 的 damping/摩擦/迭代
 *
 * 方法：每个变量只改一处，从全功能往下剥（rather than 往上加），
 *       因为"往上加"会漏掉交互项。
 *
 * 用法：node tools/run.mjs diag-t1-bisect
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const FRAMES = 720;
const DEG = 180 / Math.PI;

function run(label: string, mut: (w: World) => void): void {
  const w = new World({ ...DEFAULT_WORLD_OPTIONS });
  w.driveEnabled = false;
  w.setGravityZero();
  mut(w);
  w.body.reset();

  const nj = w.sk.joints.length;
  const rr = new Float64Array(3);
  const a0: number[] = [];
  for (let i = 0; i < nj; i++) { w.body.jointRot(i, rr); for (let k = 0; k < 3; k++) a0[i * 3 + k] = rr[k]!; }

  w.advance(FRAMES);

  let sum = 0, sumW = 0;
  let worst = '', worstD = 0;
  for (let i = 0; i < nj; i++) {
    w.body.jointRot(i, rr);
    const rv = new Float64Array(3);
    w.body.jointRelVel(i, rv);
    sumW += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
    for (let k = 0; k < 3; k++) {
      const d = Math.abs((rr[k]! - a0[i * 3 + k]!) * DEG);
      sum += d;
      if (d > worstD) { worstD = d; worst = `${w.sk.joints[i]!.name}/${k}`; }
    }
  }
  console.log(`${label.padEnd(38)} Σ|Δθ|=${sum.toFixed(1).padStart(7)}°  Σ|ω|=${sumW.toFixed(3).padStart(8)}  最差 ${worst} ${worstD.toFixed(1)}°`);
}

console.log('════ T1 漂移源单变量定位（零重力/零驱动/720 拍）════');
run('① 全功能（基线）', () => {});
run('② 关自研 enforceLimits', (w) => { w.body.skipLimitsForDiag = true; });
run('③ 关阻尼（全是 0）', (w) => {
  for (const b of w.body.bodies) { b.setLinearDamping(0); b.setAngularDamping(0); }
});
run('④ 求解器迭代 8→1', (w) => { w.world.numSolverIterations = 1; });
run('⑤ 关掉所有引擎 joint（等价"无关节"）', (w) => {
  for (const j of w.body.rapierJointsAll()) w.world.removeImpulseJoint(j, true);
});
