/** _tmp-calib-hip2: 髋/膝额状-扭转轴的**开环**权限与泄漏标定
 *
 *  ★ 上一版有污染：hipStrategy 同时在出力，测的是闭环响应。
 *    本版关掉 hipStrategy（SQC_HIP_STRATEGY=0），纯开环。
 *
 *  测三个响应（释放后 0.4s 恒力矩）：
 *    ΔrK  = 膝z − 踝z        （膝盖竖直）
 *    ΔrH  = 髋z − 膝z        （大腿不外撇）
 *    Δpel = 骨盆z            （盆骨不侧移）
 *    Δsplay = yaw(大腿) − yaw(躯干)   （大腿外撇 = 「膝盖朝内」的视觉量）
 *    Δtwist = yaw(大腿) − yaw(小腿)   （大腿相对小腿的拧转）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const ORIG = { ...E };
const D = 180 / Math.PI;

interface Dos { joint: string; ax: number; side: 'l' | 'r'; tau: number }

const trial = (label: string, dos: Dos[]): void => {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;

  const z = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const yawOf = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const snap = () => ({
    rK: (z('knee_l') - z('foot_l')) * 100,
    rH: (z('hip_l') - z('knee_l')) * 100,
    pel: ctl.sensors.com[2]! * 100,
    splay: yawOf('thigh_l') - yawOf('torso'),
    twist: yawOf('thigh_l') - yawOf('shin_l'),
  });

  const relStep = Math.round(2.0 / w.dt);
  for (let s = 0; s < relStep; s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  const a = snap();
  const N = Math.round(0.4 / w.dt);
  for (let s = 0; s < N; s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    for (const d of dos) {
      const di = body.dofByName(`${d.joint}_${d.side}`, d.ax);
      if (di >= 0) propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: d.tau, src: 'calib' });
    }
  }
  const b = snap();
  const tot = dos.reduce((s, d) => s + Math.abs(d.tau), 0);
  console.log(
    `  ${label.padEnd(30)} | ΔrK ${(b.rK - a.rK).toFixed(1).padStart(6)} | ΔrH ${(b.rH - a.rH).toFixed(1).padStart(6)} |` +
    ` Δpel ${(b.pel - a.pel).toFixed(1).padStart(6)} | Δsplay ${(b.splay - a.splay).toFixed(1).padStart(6)}° |` +
    ` Δtwist ${(b.twist - a.twist).toFixed(1).padStart(6)}°`,
  );
  void tot;
};

console.log('\n════ 开环标定（hipStrategy 关，释放后 0.4s 恒力矩，左腿）════');
console.log('  施加                              | ΔrK(cm)  ΔrH(cm)  Δpel(cm)  Δsplay°   Δtwist°');
for (const [nm, j, ax] of [['hip/0 额状', 'hip', 0], ['hip/1 扭转', 'hip', 1], ['knee/1 额状', 'knee', 1], ['knee/0 扭转', 'knee', 0]] as Array<[string, string, number]>) {
  trial(`${nm} τ=+10`, [{ joint: j, ax, side: 'l', tau: 10 }]);
  trial(`${nm} τ=-10`, [{ joint: j, ax, side: 'l', tau: -10 }]);
}
console.log('  ── 解耦组合（τ1/τ0 = 0.437，净扭转=0）──');
trial('hip/0=+9.17 hip/1=+4.01', [{ joint: 'hip', ax: 0, side: 'l', tau: 9.17 }, { joint: 'hip', ax: 1, side: 'l', tau: 4.01 }]);
trial('hip/0=-9.17 hip/1=-4.01', [{ joint: 'hip', ax: 0, side: 'l', tau: -9.17 }, { joint: 'hip', ax: 1, side: 'l', tau: -4.01 }]);
trial('hip/0=+9.17 hip/1=-4.01', [{ joint: 'hip', ax: 0, side: 'l', tau: 9.17 }, { joint: 'hip', ax: 1, side: 'l', tau: -4.01 }]);
console.log('  ── 三轴组合（找零扭转解）──');
trial('hip/0=+8 hip/1=+3.5 knee/1=-2', [{ joint: 'hip', ax: 0, side: 'l', tau: 8 }, { joint: 'hip', ax: 1, side: 'l', tau: 3.5 }, { joint: 'knee', ax: 1, side: 'l', tau: -2 }]);

for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
