/** _tmp-couple: 盆骨侧移的来源分离
 *
 *  假设：髋的侧向回正力矩是**内力矩**——它转大腿，骨盆受反作用。
 *  若骨盆自由平移，力矩就会变成「推身体走」而不是「摆腿」→ 侧移。
 *
 *  三组对照（同样 τ=15N·m 施加 0.5s）：
 *    A: 只给 hip_l/0            （单侧，非对称）
 *    B: hip_l/0 + hip_r/0 反号  （左右对称 ⇒ 净力为零）
 *    C: hip_l/0 + spine1/0 反号 （与上身配对 ⇒ 净力矩为零的力偶）
 *
 *  看：Δ(膝z−踝z) = 腿有没有被纠正；ΔCoM_z = 身体有没有被推走
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;
const TAU = Number(E.TAU ?? 15);
const DUR = Number(E.DUR ?? 0.5);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const anch = (nm: string, ax: number): { x: number; y: number; z: number } => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return { x: NaN, y: NaN, z: NaN };
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};
const di = (n: string, a: number): number => body.dofByName(n, a);

const base = { k: anch('knee_l', 2), h: anch('hip_l', 2), a: anch('foot_l', 2) };
const com0 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };

// 三组方案
const plan = (): Array<[string, number, number]> => {
  const mode = String(E.MODE ?? 'A');
  if (mode === 'A') return [['hip_l', 0, TAU]];
  if (mode === 'B') return [['hip_l', 0, TAU], ['hip_r', 0, -TAU]];
  if (mode === 'C') return [['hip_l', 0, TAU], ['spine1', 0, -TAU]];
  return [];
};

for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const rel = court.t - court.settle;
  if (rel > 0 && rel < DUR) {
    for (const [nm, ax, tau] of plan()) {
      const i = di(nm, ax);
      if (i >= 0) propose({ dof: i, kind: 'ext', pri: PRI.direct, tau, src: 'coupleProbe', channel: 'probe' });
    }
  }
}

const k2 = anch('knee_l', 2), h2 = anch('hip_l', 2), a2 = anch('foot_l', 2);
const com2 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
const dKA = (k2.z - a2.z) - (base.k.z - base.a.z);
const dHK = (h2.z - k2.z) - (base.h.z - base.k.z);
const mode = String(E.MODE ?? 'A');
console.log(`\nMODE=${mode}  τ=${TAU}N·m ×${DUR}s`);
console.log(`  腿纠正: Δ(膝z−踝z)=${(dKA * 100).toFixed(2)}cm   Δ(髋z−膝z)=${(dHK * 100).toFixed(2)}cm`);
console.log(`  身体平移: ΔCoM_z=${((com2.z - com0.z) * 100).toFixed(2)}cm  ΔCoM_x=${((com2.x - com0.x) * 100).toFixed(2)}cm`);
console.log(`  脚: Δ踝z=${((a2.z - base.a.z) * 100).toFixed(3)}cm`);
console.log(`  ⇒ 效率（腿纠正/身体平移）= ${(Math.abs(dKA) > 1e-6 ? Math.abs(dKA / ((com2.z - com0.z) || 1e-9)) : 0).toFixed(2)}`);
console.log(`  fall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
