/**
 * probe-authority.ts —— T2 逐自由度权限：每个关节轴的 ±τ 是否都被真实执行
 *
 * 判据：
 *   · |applied − τinj| / τinj < 1%（执行器账本 = 注入值）
 *   · +τ 与 −τ 引起的 Δθ **符号相反**（方向一致）
 *   · |Δθ+| 与 |Δθ−| 对称（< 10% 差异；左右镜像关节应几乎一致）
 *
 * 用法：node tools/run.mjs probe-authority [frames]
 */
import './_boot';
import { World } from '../src/core/world';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 12);

function sweep(dofIdx: number, sign: number): { dAngle: number; appliedRatio: number } {
  const w = new World();
  w.driveEnabled = false;
  w.setGravityZero();
  w.reset();
  for (const b of w.body.allBodies) {
    const t = b.translation();
    b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
  }
  const d = w.body.dofs[dofIdx]!;
  const tau = sign * 0.2 * d.tauMax;
  w.advance(FRAMES, () => w.executor.addTorque(dofIdx, tau));
  const dAngle = d.angle * 180 / Math.PI;
  const applied = w.executor.ledger[dofIdx]!.applied;
  return { dAngle, appliedRatio: tau !== 0 ? applied / tau : 1 };
}

console.log(`════ 逐自由度权限（零重力/零驱动/${FRAMES}拍/τ=0.2τmax）════`);
let bad = 0;
for (const d of new World().body.dofs) {
  if (d.engineMotor) continue;
  const plus = sweep(d.dofIndex, +1);
  const minus = sweep(d.dofIndex, -1);
  const sym = Math.abs(Math.abs(plus.dAngle) - Math.abs(minus.dAngle));
  const rel = sym / Math.max(1e-9, Math.abs(plus.dAngle));
  const signOk = plus.dAngle * minus.dAngle < 0;
  const ok = signOk && plus.appliedRatio > 0.99 && minus.appliedRatio > 0.99 && rel < 0.1;
  if (!ok) bad++;
  console.log(`  ${`${d.name}/${d.axis}`.padEnd(14)} +τ→${plus.dAngle.toFixed(3).padStart(8)}°  −τ→${minus.dAngle.toFixed(3).padStart(8)}°  对称性=${(rel * 100).toFixed(1)}%  下发比=${((plus.appliedRatio + minus.appliedRatio) / 2).toFixed(4)}  ${ok ? '' : '  ← 异常'}`);
}
console.log(`\n异常自由度：${bad === 0 ? '无（全部关节可双向驱动）' : bad}`);
