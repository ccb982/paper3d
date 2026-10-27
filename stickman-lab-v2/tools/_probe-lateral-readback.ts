/** _probe-lateral-readback: 蹲姿伺服侧向回正写手回读（默认参数 + 小侧向扰动） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);

const names = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r', 'spine1', 'spine2', 'spine3', 'neck'] as const;
const di = new Map<string, number>();
for (const n of names) { const i = w.body.dofByName(n, 0); if (i >= 0) di.set(n, i); }
const one = (n: string): number => di.get(n) ?? -1;
const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };
const angle = (n: string): number => { const i = one(n); return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN; };
const led = (n: string): string => { const i = one(n); if (i < 0) return '-'; const l = w.executor.ledger[i]!; return `${l.applied.toFixed(0)}(${l.cmd.toFixed(0)}/${l.pair.toFixed(0)})`; };
const roll = (): number => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return NaN;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy)) * 57.3;
};
const copZ = (side: 'l' | 'r'): number => {
  const c = new Float64Array(3);
  return w.body.footCoP(side, w.dt, c) ? c[1]! * 100 : NaN;
};
const trunkZ = (): number => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  return i === undefined ? NaN : w.body.bodies[i]!.translation().z * 100;
};

let last = -1;
let impulseT = -1;
console.log(`env: PASSIVE_ONLY=${process.env.SQC_PASSIVE_ONLY} UPPER_UNIFIED=${process.env.SQC_UPPER_UNIFIED} SC_SQUAT_LEGS=${process.env.SC_SQUAT_LEGS ?? '(0)'} FOOT_DEG=${process.env.SQC_LAT_LOCK_FOOT_DEG ?? '(2)'} REACT=${process.env.SQC_FOOT_ROLL_REACT ?? '(default)'} REACT_MAX=${process.env.SQC_FOOT_ROLL_REACT_MAX ?? '(default)'}`);
console.log('t     comZ  trunkZ roll  hipL0 hipR0 footL0 footR0  copZL copZR  fzL/fzR   spine1/2/3 applied');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  const log: Array<[number, string, number, string]> = [];
  g.__PROPLOG = log;
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (court.released && impulseT < 0 && court.t >= court.settle + 0.10) {
    const bi = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
    if (bi !== undefined) {
      const F = Number(process.env.LAT_IMP ?? 2.0);
      w.body.bodies[bi]!.applyImpulse({ x: 0, y: 0, z: F }, true);
      impulseT = court.t;
      console.log(`[IMPULSE] Fz=${F}Ns at t=${court.t.toFixed(2)}`);
    }
  }
  squatFrame(w, ctl, court);
  const frameLog = log.slice();
  g.__PROPLOG = [];
  if (!court.released) continue;
  const rel = court.t - court.settle;
  if (rel < 0.10 || w.clock - last < 0.05) continue;
  last = w.clock;
  const fzl = w.body.footNormalForce('l', w.dt), fzr = w.body.footNormalForce('r', w.dt);
  const c = ctl.sensors.com;
  console.log(
    `${rel.toFixed(2).padStart(4)} ${(c[2]! * 100).toFixed(1).padStart(5)} ${trunkZ().toFixed(1).padStart(5)} ${roll().toFixed(1).padStart(5)} ` +
    `${angle('hip_l').toFixed(1).padStart(5)} ${angle('hip_r').toFixed(1).padStart(5)} ${angle('foot_l').toFixed(1).padStart(5)} ${angle('foot_r').toFixed(1).padStart(5)} ` +
    `${copZ('l').toFixed(1).padStart(5)} ${copZ('r').toFixed(1).padStart(5)} ${fzl.toFixed(0)}/${fzr.toFixed(0)}  ` +
    `${led('spine1')} ${led('spine2')} ${led('spine3')}  hip=${led('hip_l')}/${led('hip_r')} foot=${led('foot_l')}/${led('foot_r')}`,
  );
  if (Math.abs(rel - 0.50) < 0.026 || Math.abs(rel - 0.90) < 0.026) {
    const srcs = new Map<string, number>();
    for (const [d, kind, val, src] of frameLog) {
      const dd = w.body.dofs[d];
      if (!dd || dd.axis !== 0) continue;
      if (kind !== 'torque' && kind !== 'ext') continue;
      srcs.set(src, (srcs.get(src) ?? 0) + Math.abs(val));
    }
    console.log(`  lateral sources rel=${rel.toFixed(2)}: ` + [...srcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' | '));
  }
  if (rel > 1.0) break;
}
