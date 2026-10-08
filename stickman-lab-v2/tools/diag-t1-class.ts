/**
 * diag-t1-class.ts —— T1 漂移按「关节类别」拆分贡献
 *
 * 上一轮结论：
 *   ⑤ 关掉所有引擎关节 ⇒ 0.0°（漂移 100% 来自关节约束）
 *   ② 关自研 enforceLimits ⇒ Σ|ω| 17.807 → 1.412，但 Σ|Δθ| 反而 248→388
 *      ⇒ 自研限位既在注入能量、又在压制慢漂
 *
 * 本轮要回答：**球铰（= 我的 2×revolute 替代）和真 revolute，谁注入得多？**
 * 做法：把两次测量拆开——分别统计「球铰关节的轴」和「revolute 关节的轴」。
 *
 * 用法：node tools/run.mjs diag-t1-class
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const FRAMES = 720;
const DEG = 180 / Math.PI;

function measure(label: string, skipLimits: boolean) {
  const w = new World({ ...DEFAULT_WORLD_OPTIONS });
  w.driveEnabled = false;
  w.setGravityZero();
  w.body.skipLimitsForDiag = skipLimits;
  w.body.reset();

  const nj = w.sk.joints.length;
  const rr = new Float64Array(3);
  const a0: number[] = [];
  for (let i = 0; i < nj; i++) { w.body.jointRot(i, rr); for (let k = 0; k < 3; k++) a0[i * 3 + k] = rr[k]!; }

  w.advance(FRAMES);

  let sumSph = 0, sumRev = 0, wSph = 0, wRev = 0;
  const perJoint: { name: string; type: string; d: number; w: number }[] = [];
  for (let i = 0; i < nj; i++) {
    const j = w.sk.joints[i]!;
    const isRev = !!j.revoluteAxis;
    w.body.jointRot(i, rr);
    const rv = new Float64Array(3);
    w.body.jointRelVel(i, rv);
    let d = 0, wsum = 0;
    for (let k = 0; k < 3; k++) {
      d += Math.abs((rr[k]! - a0[i * 3 + k]!) * DEG);
      wsum += Math.abs(rv[k]!);
    }
    if (isRev) { sumRev += d; wRev += wsum; } else { sumSph += d; wSph += wsum; }
    perJoint.push({ name: j.name, type: isRev ? 'revolute' : 'spherical', d, w: wsum });
  }
  perJoint.sort((a, b) => b.w - a.w);
  console.log(`\n── ${label} ──`);
  console.log(`  球铰侧  Σ|Δθ|=${sumSph.toFixed(1).padStart(7)}°  Σ|ω|=${wSph.toFixed(3).padStart(8)}`);
  console.log(`  revolute Σ|Δθ|=${sumRev.toFixed(1).padStart(7)}°  Σ|ω|=${wRev.toFixed(3).padStart(8)}`);
  console.log(`  Σ|ω| 前 6：`);
  for (const p of perJoint.slice(0, 6)) console.log(`    ${p.name.padEnd(11)} ${p.type.padEnd(9)} Δθ=${p.d.toFixed(1).padStart(6)}°  ω=${p.w.toFixed(3)}`);
}

console.log('════ T1 漂移按关节类别拆分（零重力/零驱动/720 拍）════');
measure('① 限位 ON（基线）', false);
measure('② 限位 OFF', true);
