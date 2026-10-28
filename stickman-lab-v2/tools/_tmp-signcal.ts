/** _tmp-signcal: 标定「镜像口径下的左右力矩符号」
 *
 *  问题：被动张力用 d.angle（镜像读数）算 dev，实测左右力矩**同号** ⇒ 左右物理效果不同
 *        （膝vs踝 L=+7.76 R=−2.99cm）
 *
 *  关键未知：左右同一物理平面的两个轴（镜像），**同号 τ** 与 **反号 τ** 分别产生
 *            镜像效果 还是 同向效果？mirrorSymmetric 把读数强制成镜像（左+3.5/右−3.5），
 *            但物理状态未必镜像 ⇒ 必须实测。
 *
 *  测量：静止姿态下，对 knee_l/1 和 knee_r/1 施加**已知 τ**，
 *        观察 (a) 读数怎么变 (b) 膝的物理 z 怎么变。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup } from '../src/core/servo/squat';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
squatCourtSetup(w, ctl, 2.0);
const body = w.body;

const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
const axw = (nm: string, ax: number): string => {
  const a = body.dofs[body.dofByName(nm, ax)]!.axisWorld;
  return `[${a[0]!.toFixed(3)},${a[1]!.toFixed(3)},${a[2]!.toFixed(3)}]`;
};

console.log('\n════ 左右轴的世界方向（决定同号/反号 τ 的物理效果）════');
for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r']) {
  for (const ax of [0, 1]) {
    const d = body.dofs[body.dofByName(nm, ax)]!;
    console.log(`  ${nm}/${ax}  世界轴=${axw(nm, ax)}  rest=${(d.rest * D).toFixed(2)}°  当前读数=${(d.angle * D).toFixed(2)}°`);
  }
}

console.log('\n════ 施加 τ 的效果标定（每组 0.5s，τ=±8 N·m）════');
const applyTq = (nm: string, ax: number, tau: number): void => {
  const i = body.dofByName(nm, ax);
  body.executor.addTorque(i, tau);
};
// 用 executor 直接施力：绕过 proposalBus，直接看物理效果
const run = (tauL: number, tauR: number): void => {
  const before = {
    aL: ang('knee_l', 1), aR: ang('knee_r', 1),
    zL: az('knee_l'), zR: az('knee_r'),
  };
  for (let s = 0; s < Math.round(0.5 / w.dt); s++) {
    applyTq('knee_l', 1, tauL);
    applyTq('knee_r', 1, tauR);
    w.advance(1);
  }
  const dA = ang('knee_l', 1) - before.aL;
  const dB = ang('knee_r', 1) - before.aR;
  const dZ = (az('knee_l') - before.zL) * 100;
  const dZ2 = (az('knee_r') - before.zR) * 100;
  console.log(
    `  τL=${tauL.toFixed(0).padStart(4)} τR=${tauR.toFixed(0).padStart(4)} |` +
    ` Δ读数 L=${dA.toFixed(2).padStart(7)} R=${dB.toFixed(2).padStart(7)} |` +
    ` Δ膝z L=${dZ.toFixed(3).padStart(7)} R=${dZ2.toFixed(3).padStart(7)}` +
    `   ⇒ ${Math.abs(dA) < 0.05 && Math.abs(dB) < 0.05 ? '（被限位/镜像挡住）' : (dA * dZ > 0 ? 'L:读数↑z↑' : 'L:读数↑z↓')}`,
  );
};

run(0, 0);
run(+8, 0);
run(-8, 0);
run(0, +8);
run(0, -8);
run(+8, +8);
run(-8, -8);
run(+8, -8);
run(-8, +8);
