/** _probe-waist.ts —— 腰部（脊柱）专项测量（用户定调）：
 *  A 极限力量：脊柱前弯/后弯（位置通道 ±0.10/段）→ ΔcomX、脊柱实际力矩（ledger）、稳定性
 *  B 后漂救回 A/B：对照(伺服现状) vs 腰前弯 vs 髋力矩 vs 组合
 *  C 单支撑下的腰：抬腿后弯腰对 CoM 的权限
 *  约定：spine/2 **负 = 前弯**（BOW 实测）；打印 CoM、胸、脊柱力矩。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const SEGS = ['spine1', 'spine2', 'spine3', 'spine4'] as const;
const chestY = (w: World) => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;

function baseWorld(): { w: World; ctl: ControlModule } {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  return { w, ctl };
}
function foldSpine(w: World, ctl: ControlModule, fold: number): void {
  for (const seg of SEGS) ctl.manual.setAngle(seg, 2, fold, 200, 30);
}
function spineTauPeak(w: World): number {
  let m = 0;
  for (const seg of SEGS) {
    const di = w.body.dofByName(seg, 2);
    if (di >= 0) m = Math.max(m, Math.abs(w.executor.ledger[di]!.applied));
  }
  return m;
}

console.log('══ A 腰部极限（双支撑，位置通道 ±0.10/段 ×4 节；1.5s）══');
for (const fold of [-0.10, 0.10]) {
  const { w, ctl } = baseWorld();
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) w.advance(1);
  const x0 = ctl.sensors.com[0]!;
  let maxDx = 0, tauPeak = 0, minChest = 9;
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
    foldSpine(w, ctl, fold);
    w.advance(1);
    maxDx = Math.max(maxDx, Math.abs(ctl.sensors.com[0]! - x0));
    tauPeak = Math.max(tauPeak, spineTauPeak(w));
    minChest = Math.min(minChest, chestY(w));
  }
  console.log(`A 脊柱${fold < 0 ? '前弯' : '后弯'} ${fold}/段：ΔcomX=${(ctl.sensors.com[0]! - x0 >= 0 ? '+' : '')}${(ctl.sensors.com[0]! - x0).toFixed(3)}` +
    ` 峰值变位=${maxDx.toFixed(3)} 脊柱τ峰=${tauPeak.toFixed(0)} N·m 最低胸=${minChest.toFixed(3)}`);
}

{
  const { w, ctl } = baseWorld();
  ctl.padEnabled = false;                       // 开环（关垫脚）：测腰对 CoM 的"裸权限"
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) w.advance(1);
  const x0 = ctl.sensors.com[0]!;
  const di2 = w.body.dofByName('spine2', 2);
  const tauMax = di2 >= 0 ? w.body.dofs[di2]!.tauMax : 0;
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) { foldSpine(w, ctl, 0.10); w.advance(1); }
  console.log(`A 脊柱正弯 +0.10/段（pad 关，开环；τmax=${tauMax.toFixed(0)}）：ΔcomX=${(ctl.sensors.com[0]! - x0 >= 0 ? '+' : '')}${(ctl.sensors.com[0]! - x0).toFixed(3)} 脊柱τ峰=${spineTauPeak(w).toFixed(0)} 胸=${chestY(w).toFixed(3)}`);
}

console.log('══ B 后漂救回（后推 0.18/0.24 m/s；2.0s）══');
type Strat = 'servo' | 'waist' | 'hip' | 'both';
for (const dv of [0.18, 0.24]) {
for (const strat of ['servo', 'waist', 'hip', 'both'] as Strat[]) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const hipL = w.body.dofByName('hip_l', 2), hipR = w.body.dofByName('hip_r', 2);
  let inject = 0;
  w.controller = {
    step: (dt: number) => {
      ctl.step(dt);
      if (inject !== 0) { w.executor.addTorque(hipL, inject); w.executor.addTorque(hipR, inject); }
    },
  };
  w.reset();
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) w.advance(1);
  for (const b of w.body.bodies) b.applyImpulse({ x: -b.mass() * dv, y: 0, z: 0 }, true);
  let minComX = 0, peakFold = 0, tauPeak = 0;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    const comX = ctl.sensors.com[0]!, vx = ctl.sensors.comVel[0]!;
    const want = (strat === 'waist' || strat === 'both');
    if (want) {
      const fold = Math.max(0, Math.min(0.12, 0.9 * -comX + 0.4 * -vx));
      peakFold = Math.max(peakFold, fold);
      if (fold > 0.005) foldSpine(w, ctl, fold);
    }
    inject = (strat === 'hip' || strat === 'both') ? -60 : 0;
    w.advance(1);
    minComX = Math.min(minComX, ctl.sensors.com[0]!);
    tauPeak = Math.max(tauPeak, spineTauPeak(w));
  }
  const ok = chestY(w) > 1.2 && ctl.sensors.com[0]! > -0.08 ? '恢复 ✓' : '倒 ✗';
  console.log(`B dv=${dv} ${strat.padEnd(5)}：${ok}  minComX=${minComX.toFixed(3)} 末comX=${ctl.sensors.com[0]!.toFixed(3)}` +
    ` 末胸=${chestY(w).toFixed(3)} 峰值腰弯=${peakFold.toFixed(3)} 脊柱τ峰=${tauPeak.toFixed(0)}`);
}
}

console.log('══ C 单支撑下的腰（抬左腿→转移→弯腰 ±0.10；1.5s）══');
for (const fold of [0, 0.10]) {
  const { w, ctl } = baseWorld();
  for (let s = 0; s < Math.round(12.0 / w.dt); s++) { ctl.warner.setComTarget(0, -0.16); w.advance(1); if (ctl.sensors.com[2]! < -0.12) break; }
  ctl.manual.setAngle('hip_l', 2, 0.45);
  ctl.manual.setAngle('knee_l', 2, -0.75);
  ctl.manual.setAngle('foot_l', 2, 0.08);
  for (let s = 0; s < Math.round(1.0 / w.dt); s++) { ctl.warner.setComTarget(0, -0.16); w.advance(1); }
  const x0 = ctl.sensors.com[0]!;
  let tauPeak = 0, minChest = 9;
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
    if (fold !== 0) foldSpine(w, ctl, fold);
    w.advance(1);
    tauPeak = Math.max(tauPeak, spineTauPeak(w));
    minChest = Math.min(minChest, chestY(w));
  }
  console.log(`C 单支撑 腰前弯=${fold}：ΔcomX=${(ctl.sensors.com[0]! - x0 >= 0 ? '+' : '')}${(ctl.sensors.com[0]! - x0).toFixed(3)}` +
    ` comZ=${ctl.sensors.com[2]!.toFixed(3)} 最低胸=${minChest.toFixed(3)} 脊柱τ峰=${tauPeak.toFixed(0)}`);
}
