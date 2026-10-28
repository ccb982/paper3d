/** _tmp-ka2: 踝被动刚度 KA 精细扫描（找不泄漏的最优增益） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;
const ORIG = { ...E };

const run = (cfg: Record<string, string>, until = 2.0): string => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const t0 = yaw('thigh_l');
  for (let s = 0; s < Math.round(until / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  const d = yaw('thigh_l') - t0;
  const kaL = (az('knee_l') - az('foot_l')) * 100;
  const kaR = (az('knee_r') - az('foot_r')) * 100;
  // 对称度 = |L+R|/2 越小越好
  const sym = Math.abs(kaL + kaR) / 2;
  return `Δ大腿yaw=${d.toFixed(1).padStart(7)} | 踝额状=${ang('foot_l', 0).toFixed(1).padStart(6)} 扭转=${ang('foot_l', 1).toFixed(1).padStart(6)}` +
    ` | 膝额状=${ang('knee_l', 1).toFixed(1).padStart(6)} | 膝vs踝 ${kaL.toFixed(1).padStart(5)}/${kaR.toFixed(1).padStart(5)} 不对称=${sym.toFixed(2)}` +
    ` | 判死 ${court.fall >= 0 ? court.fall.toFixed(2) : '无'}`;
};

console.log('\n════ 踝 KA 扫描（2s 冻结期）════');
for (const ka of ['0', '10', '20', '30', '40', '60', '80', '120']) {
  console.log(`  KA=${ka.padStart(3)}  ${run({ SQC_LT_K_ANKLE: ka })}`);
}
console.log('\n════ KA=60 时上限/死区扫描 ════');
for (const cap of ['40', '80', '150']) {
  console.log(`  KA=60 cap=${cap.padStart(3)}  ${run({ SQC_LT_K_ANKLE: '60', SQC_LT_CAP_ANKLE: cap })}`);
}
console.log('\n════ KA=60 + 踝限位放宽（±14 → ±20）════');
console.log(`  ${run({ SQC_LT_K_ANKLE: '60' })}`);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
