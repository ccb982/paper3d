/** _tmp-signcal2: 干净的左右符号标定（每组独立 reset）
 *
 *  上一版标定是累加的（每组接着上一组跑）⇒ 状态被污染，数字不可用。
 *  本版每组独立 reset + 摆姿，然后施加 τ，观察：
 *    Δ读数 L/R（镜像强制后的读数）
 *    Δ膝z L/R（物理位置，绕开一切读数）
 *
 *  目标：确定「被动刚度要让左腿和右腿都回到中立位」时，
 *        左右膝额状轴该写**同号**还是**反号** τ。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup } from '../src/core/servo/squat';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

const az = (body: ReturnType<World['body']['dofs']> extends never ? never : any, nm: string): number =>
  body.dofs[body.dofByName(nm, 2)].anchorWorld[2];
const ang = (body: any, nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)].angle * D;

const trial = (tauL: number, tauR: number, label: string): void => {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  squatCourtSetup(w, ctl, 2.0);
  const body = w.body;
  const b = {
    aL: ang(body, 'knee_l', 1), aR: ang(body, 'knee_r', 1),
    zL: az(body, 'knee_l'), zR: az(body, 'knee_r'),
    fL: az(body, 'foot_l'), fR: az(body, 'foot_r'),
  };
  const steps = Math.round(0.4 / w.dt);
  for (let s = 0; s < steps; s++) {
    // ★ 必须走提案总线：executor.addTorque 会被下一次 beginStep 清零（实测所有组合结果相同）
    if (tauL !== 0) propose({ dof: body.dofByName('knee_l', 1), kind: 'ext', pri: PRI.direct, tau: tauL, src: 'cal', channel: 'active' });
    if (tauR !== 0) propose({ dof: body.dofByName('knee_r', 1), kind: 'ext', pri: PRI.direct, tau: tauR, src: 'cal', channel: 'active' });
    w.advance(1);
  }
  const dA = ang(body, 'knee_l', 1) - b.aL;
  const dB = ang(body, 'knee_r', 1) - b.aR;
  const dZ = (az(body, 'knee_l') - b.zL) * 100;
  const dZ2 = (az(body, 'knee_r') - b.zR) * 100;
  const dF = (az(body, 'foot_l') - b.fL) * 100;
  const dF2 = (az(body, 'foot_r') - b.fR) * 100;
  console.log(
    `  ${label.padEnd(22)} | Δ读数 L=${dA.toFixed(2).padStart(7)} R=${dB.toFixed(2).padStart(7)}` +
    ` | Δ膝z L=${dZ.toFixed(2).padStart(7)} R=${dZ2.toFixed(2).padStart(7)}` +
    ` | Δ踝z L=${dF.toFixed(2).padStart(7)} R=${dF2.toFixed(2).padStart(7)}`,
  );
};

console.log('\n════ 干净标定：膝额状轴 τ 的左右效果（0.4s）════');
trial(0, 0, '基线(无τ)');
trial(+8, 0, 'τL=+8');
trial(-8, 0, 'τL=−8');
trial(0, +8, 'τR=+8');
trial(0, -8, 'τR=−8');
trial(+8, +8, 'τL=+8 τR=+8（同号）');
trial(+8, -8, 'τL=+8 τR=−8（反号）');
trial(-8, -8, 'τL=−8 τR=−8（同号）');
trial(-8, +8, 'τL=−8 τR=+8（反号）');
