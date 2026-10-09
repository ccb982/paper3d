/** _probe-sag.ts —— 前后方向诊断 + 回读迭代（用户定调：多回读）：
 *  A 静立回读：comX/CoP/XCoM/TTB —— CoM 相对脚几何的位置（前后恢复余量）
 *  B 后推恢复门限：站姿目标 x=0（现状）vs x=+0.045（脚弓）——每个冲量看恢复与否
 *  C 挺腰机理（开环）：hip/2 力矩 ±40 N·m → CoP 往哪走 / 躯干往哪倾 / CoM 动多少
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const fmt = (v: number) => (!isFinite(v) ? '∞' : v.toFixed(2));

function makeStand(tx: number | null, tz = 0): { w: World; ctl: ControlModule } {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const settle = Number(process.env.SETTLE ?? 1.0);
  for (let s = 0; s < Math.round(settle / w.dt); s++) {
    if (tx !== null) ctl.warner.setComTarget(tx, tz);   // null = 不发言（伺服默认回脚弓）
    w.advance(1);
  }
  return { w, ctl };
}
const chestY = (w: World) => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;
const line = (w: World, ctl: ControlModule, tag: string): void => {
  const p = ctl.lastProposal!;
  const f0 = ctl.sensors.feet[0]!, f1 = ctl.sensors.feet[1]!;
  console.log(`${tag}: comX=${ctl.sensors.com[0]!.toFixed(3)} 胸=${chestY(w).toFixed(3)}` +
    ` CoP_l=${f0.copX.toFixed(3)} CoP_r=${f1.copX.toFixed(3)}` +
    ` XCoM=${p.est.xcomX.toFixed(3)} TTBx=${fmt(p.est.ttbX)}s risk=${p.est.risk}`);
};

console.log('══ A 静立回读（x 目标 0；脚踝锚点在 0，脚矢状 CoP 权限 +0.14/−0.05）══');
{
  const { w, ctl } = makeStand(0);
  line(w, ctl, 'A 站定(目标0)');
}
{
  const { w, ctl } = makeStand(null);
  line(w, ctl, 'A 伺服默认  ');
}

console.log('══ B 后推恢复门限（全身 −x 冲量；2.5s 观测）══');
for (const tx of [0, 0.045, null] as (number | null)[]) {
  for (const dv of [0.1, 0.2, 0.3, 0.4]) {
    const { w, ctl } = makeStand(tx);
    for (const b of w.body.bodies) b.applyImpulse({ x: -b.mass() * dv, y: 0, z: 0 }, true);
    let minComX = 0, peakRisk = 0, minTTB = Infinity, minChest = 9;
    for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
      if (tx !== null) ctl.warner.setComTarget(tx, 0);
      w.advance(1);
      minComX = Math.min(minComX, ctl.sensors.com[0]!);
      minChest = Math.min(minChest, chestY(w));
      const p = ctl.lastProposal!;
      if (p.est.risk > peakRisk) peakRisk = p.est.risk;
      if (p.est.ttbX < minTTB) minTTB = p.est.ttbX;
    }
    const endChest = chestY(w), endX = ctl.sensors.com[0]!;
    const ok = endChest > 1.2 ? '恢复 ✓' : '倒 ✗';
    console.log(`B x=${tx === null ? '停机(伺服默认)' : tx.toFixed(3)} dv=${dv.toFixed(2)}：${ok}  最低胸=${minChest.toFixed(2)} 峰risk=${peakRisk}` +
      ` 最小TTB=${fmt(minTTB)}s minComX=${minComX.toFixed(3)} 末comX=${endX.toFixed(3)}`);
  }
}

console.log('══ C 挺腰机理（开环：pad/lean/bend 全关，只加 hip/2 力矩；读 CoP/躯干/CoM）══');
for (const tau of [40, -40]) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.padEnabled = false;
  ctl.warner.opt.leanSign = 0;
  ctl.warner.opt.bendSign = 0;
  const hipL = w.body.dofByName('hip_l', 2), hipR = w.body.dofByName('hip_r', 2);
  let inject = 0;
  w.controller = {
    step: (dt: number) => {
      ctl.step(dt);
      if (inject !== 0) { w.executor.addTorque(hipL, inject); w.executor.addTorque(hipR, inject); }
    },
  };
  w.reset();
  for (let s = 0; s < Math.round(1.0 / w.dt); s++) w.advance(1);
  const x0 = ctl.sensors.com[0]!, tilt0 = ctl.sensors.torsoTilt[0]!;
  inject = tau;                                   // 施加 0.8s（控制器相位内注入）
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) w.advance(1);
  const dCom = ctl.sensors.com[0]! - x0;
  const dTilt = ctl.sensors.torsoTilt[0]! - tilt0;
  const cop = ctl.sensors.feet[0]!.copX;
  inject = 0;
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) w.advance(1);   // 释放 0.8s
  const dCom2 = ctl.sensors.com[0]! - x0;
  console.log(`C hipτ=${tau > 0 ? '+' : ''}${tau}：0.8s 后 ΔcomX=${(dCom >= 0 ? '+' : '') + dCom.toFixed(3)}` +
    ` Δ躯干pitch=${(dTilt >= 0 ? '+' : '') + dTilt.toFixed(3)} rad CoP_x≈${cop.toFixed(3)}` +
    ` 胸=${chestY(w).toFixed(3)}；释放后 ΔcomX=${(dCom2 >= 0 ? '+' : '') + dCom2.toFixed(3)} 胸=${chestY(w).toFixed(3)}`);
}
