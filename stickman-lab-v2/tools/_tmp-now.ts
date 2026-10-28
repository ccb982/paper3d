/** _tmp-now: 冻结期/释放后的关键读数时间线（诊断用）
 *
 *  输出：t | 大腿vs小腿yaw | 膝额状L/R | 踝额状L/R | 踝矢状L/R | 髋扭转L/R | 膝扭转L/R | 判死
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;
const ORIG = { ...E };

const run = (name: string, cfg: Record<string, string>, until: number): void => {
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
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const pair = (base: string, ax: number): string =>
    `${ang(`${base}_l`, ax).toFixed(1).padStart(6)}/${ang(`${base}_r`, ax).toFixed(1).padStart(6)}`;
  console.log(`\n──── ${name} ────`);
  console.log('  t    | 大腿vs小腿 | 膝额状L/R   | 踝额状L/R   | 踝矢状L/R   | 髋扭转L/R  | 膝扭转L/R  | 判死');
  let next = 0;
  for (let s = 0; s < Math.round(until / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    const t = s * w.dt;
    if (t + 1e-9 < next) continue;
    next = t + 0.25;
    const p = pair;
    console.log(
      ` ${t.toFixed(2)} | ${(yaw('thigh_l') - yaw('shin_l')).toFixed(1).padStart(9)} |` +
      ` ${p('knee', 1)} | ${p('foot', 0)} | ${p('foot', 2)} | ${p('hip', 1)} | ${p('knee', 0)} |` +
      ` ${court.fall >= 0 ? `t=${court.fall.toFixed(2)} ${court.reason}` : ''}`,
    );
    if (court.fall >= 0) break;
  }
  console.log(` ★ ${court.fall >= 0 ? `判死 t=${court.fall.toFixed(2)} ${court.reason}` : '未判死'}`);
};

const cfgs: Array<[string, Record<string, string>]> = [
  ['当前默认', {}],
  ['关被动张力', { SQC_LEG_TENSION: '0' }],
  ['关踝矢状前馈', { SQC_ANKLE_FF: '0' }],
];
for (const [n, c] of cfgs) run(n, c, 3.2);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
