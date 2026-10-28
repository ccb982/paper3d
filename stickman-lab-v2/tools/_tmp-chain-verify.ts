/** _tmp-chain-verify2: 闭链求解器最终验证
 *  ① 捕获 → 目标/残差/Δ角
 *  ② **物理级迭代收敛**：施加 Δ角（绕世界轴真实旋转子树）→ 重解 → 看残差是否收敛
 *  ③ 检查左右对称性
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup } from '../src/core/servo/squat';
import { captureClosedChainTarget, solveClosedChainAngles, type ClosedChainTarget } from '../src/core/servo/closedChain';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
squatCourtSetup(w, ctl, Number(E.SETTLE ?? '2.0'));
const body = w.body;

const anch = (nm: string, ax: number): { x: number; y: number; z: number } => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return { x: NaN, y: NaN, z: NaN };
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};

const rotSub = (nm: string, ax: number, deg: number): void => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return;
  const d = body.dofs[i]!;
  const pivot = { x: d.anchorWorld[0]!, y: d.anchorWorld[1]!, z: d.anchorWorld[2]! };
  const axv = { x: d.axisWorld[0]!, y: d.axisWorld[1]!, z: d.axisWorld[2]! };
  const ang = (deg * Math.PI) / 180;
  const c = Math.cos(ang), s = Math.sin(ang);
  const rot = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
    const dot = v.x * axv.x + v.y * axv.y + v.z * axv.z;
    const cr = { x: axv.y * v.z - axv.z * v.y, y: axv.z * v.x - axv.x * v.z, z: axv.x * v.y - axv.y * v.x };
    return {
      x: v.x * c + cr.x * s + axv.x * dot * (1 - c),
      y: v.y * c + cr.y * s + axv.y * dot * (1 - c),
      z: v.z * c + cr.z * s + axv.z * dot * (1 - c),
    };
  };
  const chainBodies = body.subtree[d.joint] ?? [];
  for (const bi of chainBodies) {
    const rb = body.bodies[bi]!;
    const t = rb.translation();
    const p = rot({ x: t.x - pivot.x, y: t.y - pivot.y, z: t.z - pivot.z });
    rb.setTranslation({ x: pivot.x + p.x, y: pivot.y + p.y, z: pivot.z + p.z }, true);
  }
  const set = new Set(chainBodies);
  for (const d2 of body.dofs) {
    if (!set.has(d2.b1) && !set.has(d2.b2)) continue;
    const ap = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
    const p = rot({ x: ap.x - pivot.x, y: ap.y - pivot.y, z: ap.z - pivot.z });
    d2.anchorWorld[0] = pivot.x + p.x; d2.anchorWorld[1] = pivot.y + p.y; d2.anchorWorld[2] = pivot.z + p.z;
    const av = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
    const q = rot(av);
    d2.axisWorld[0] = q.x; d2.axisWorld[1] = q.y; d2.axisWorld[2] = q.z;
  }
};

const tgt = captureClosedChainTarget(body)!;
console.log('════ ① 捕获 ════');
for (const sc of [tgt.l, tgt.r]) {
  console.log(`[${sc.side}] 残差(膝z,髋z,膝x)=${sc.residual.map((v) => (v * 100).toFixed(2)).join(', ')} cm`);
  console.log(`      Δ[hip0,hip1,knee0,knee1,knee2,hip2]=${sc.delta.map((v) => v.toFixed(2)).join(', ')}°`);
}

console.log('\n════ ② 物理级迭代收敛 ════');
for (let it = 0; it < 8; it++) {
  solveClosedChainAngles(body, tgt);
  const rl = tgt.l.residual, rr = tgt.r.residual;
  const kl = anch('knee_l', 2), al = anch('foot_l', 2), hl = anch('hip_l', 2);
  console.log(
    `  it${it}: L残[${rl.map((v) => (v * 100).toFixed(2)).join(',')}]  R残[${rr.map((v) => (v * 100).toFixed(2)).join(',')}] cm` +
    `  | 膝z=${(kl.z * 100).toFixed(2)} 踝z=${(al.z * 100).toFixed(2)} 髋z=${(hl.z * 100).toFixed(2)}` +
    `  ΔL=[${tgt.l.delta.map((v) => v.toFixed(1)).join(',')}]`,
  );
  // 施加 Δ（物理级旋转）
  for (const s of [tgt.l, tgt.r]) {
    const sd = s.side;
    const d = s.delta;
    const acts: Array<[string, number, number]> = [
      [`hip_${sd}`, 0, d[0]!], [`hip_${sd}`, 1, d[1]!], [`knee_${sd}`, 0, d[2]!],
      [`knee_${sd}`, 1, d[3]!], [`knee_${sd}`, 2, d[4]!], [`hip_${sd}`, 2, d[5]!],
    ];
    for (const [nm, ax, dq] of acts) if (Math.abs(dq) > 1e-9) rotSub(nm, ax, dq);
  }
}

console.log('\n════ ③ 最终几何 ════');
for (const sd of ['l', 'r'] as const) {
  const a = anch(`foot_${sd}`, 2), k = anch(`knee_${sd}`, 2), h = anch(`hip_${sd}`, 2);
  console.log(`[${sd}] 踝z=${(a.z * 100).toFixed(2)} 膝z=${(k.z * 100).toFixed(2)} 髋z=${(h.z * 100).toFixed(2)}  ` +
    `膝z−踝z=${((k.z - a.z) * 100).toFixed(2)}cm  髋z−膝z=${((h.z - k.z) * 100).toFixed(2)}cm  ` +
    `膝x−踝x=${((k.x - a.x) * 100).toFixed(2)}cm`);
}
