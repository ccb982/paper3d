/** _probe-squat-writers: 蹲姿法庭全身写手 + 侧向回正出力审计（默认用 main.ts 的网页参数） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);

type P = [number, string, number, string];
const g = globalThis as { __PROPLOG?: P[] };
const isLat = (di: number): boolean => {
  const d = w.body.dofs[di];
  return !!d && d.axis === 0 && /^(hip|knee|foot|ankle|spine|neck)_/.test(d.name);
};
const latName = (di: number): string => {
  const d = w.body.dofs[di];
  return d ? `${d.name}/${d.axis}` : `#${di}`;
};
const groups = (log: P[]): Map<string, { n: number; abs: number; sum: number; max: number }> => {
  const m = new Map<string, { n: number; abs: number; sum: number; max: number }>();
  for (const [di, kind, val, src] of log) {
    if (!isLat(di)) continue;
    const k = `${src}:${kind}`;
    let a = m.get(k);
    if (!a) { a = { n: 0, abs: 0, sum: 0, max: 0 }; m.set(k, a); }
    // pair 的日志值是目标角，不是力矩；只统计 torque/ext
    if (kind === 'torque' || kind === 'ext') { a.n++; a.abs += Math.abs(val); a.sum += val; a.max = Math.max(a.max, Math.abs(val)); }
    else { a.n++; }
  }
  return m;
};
const fmt = (m: Map<string, { n: number; abs: number; sum: number; max: number }>, keys: string[]): string =>
  keys.map((k) => {
    const a = m.get(k);
    return a ? `${a.n}/${a.abs.toFixed(1)}` : '0/0';
  }).join(' ');

const scLat = (m: Map<string, { n: number; abs: number; sum: number; max: number }>): number =>
  [...m.entries()].filter(([k]) => k.startsWith('supportClean:')).reduce((a, [, v]) => a + v.abs, 0);

const diHipL0 = w.body.dofByName('hip_l', 0);
const diHipR0 = w.body.dofByName('hip_r', 0);
const diKneeL0 = w.body.dofByName('knee_l', 0);
const diFootL0 = w.body.dofByName('foot_l', 0);
const diFootR0 = w.body.dofByName('foot_r', 0);
let traceNow = false;
{
  const origSet = w.drive.setTorque.bind(w.drive);
  (w.drive as unknown as { setTorque(di: number, tau: number): void }).setTorque = (di: number, tau: number) => {
    if (traceNow && di === diKneeL0) {
      const st = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 7).join('|');
      console.log(`[SETTQ] t=${w.clock.toFixed(3)} kneeL0 tau=${tau.toFixed(1)} ${st}`);
    }
    origSet(di, tau);
  };
  const origAdd = w.executor.addTorque.bind(w.executor);
  (w.executor as unknown as { addTorque(di: number, tau: number): void }).addTorque = (di: number, tau: number) => {
    if (traceNow && di === diKneeL0) {
      const st = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 7).join('|');
      console.log(`[ADD]   t=${w.clock.toFixed(3)} kneeL0 tau=${tau.toFixed(1)} ${st}`);
    }
    origAdd(di, tau);
  };
}
const roll = (): number => {
  const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (ti === undefined) return NaN;
  const q = w.body.bodies[ti]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy)) * 57.3;
};

const totals = new Map<string, { n: number; abs: number; max: number }>();
const dofSrc = new Map<string, { n: number; abs: number; max: number }>();
let snapAll: P[] | null = null;
let snapT = 0;
console.log('env SC_SQUAT_LEGS=', process.env.SC_SQUAT_LEGS, 'PASSIVE_ONLY=', process.env.SQC_PASSIVE_ONLY, 'RC2=', process.env.SQC_RC2, 'PAIR_LAT=', process.env.SQC_PAIR_LAT);
console.log('t    phase      comZ   roll   hipL0  hipR0  footZL footZR  SC_lat(n/abs)  SC_trunkLeg  RC2_lat  pairLat  ledHipL(cmd/pair/app)');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  const tNow = s * w.dt;
  traceNow = Math.abs(tNow - 3.0) < w.dt * 1.5;
  const log: P[] = [];
  g.__PROPLOG = log;
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (traceNow) {
    const lx = w.executor.ledger[diKneeL0]!;
    console.log(`[AFTER] t=${w.clock.toFixed(3)} di=${diKneeL0} ${w.body.dofs[diKneeL0]!.name}/${w.body.dofs[diKneeL0]!.axis} cmd=${lx.cmd.toFixed(1)} pair=${lx.pair.toFixed(1)} app=${lx.applied.toFixed(1)} ff=${(w.drive as unknown as { ffOf(di: number): number }).ffOf(diKneeL0).toFixed(1)}`);
  }
  const applied = log.slice();
  g.__PROPLOG = [];
  squatFrame(w, ctl, court);
  const queued = log.slice();
  g.__PROPLOG = [];
  const all = applied.concat(queued);
  const m = groups(all);
  for (const [di, kind, val, src] of all) {
    if (!isLat(di) || (kind !== 'torque' && kind !== 'ext')) continue;
    const key = `${latName(di)}|${src}`;
    const a = dofSrc.get(key) ?? { n: 0, abs: 0, max: 0 };
    a.n++; a.abs += Math.abs(val); a.max = Math.max(a.max, Math.abs(val));
    dofSrc.set(key, a);
  }
  for (const [k4, v] of m) {
    const key = k4.split(':')[0]!;
    const a = totals.get(key) ?? { n: 0, abs: 0, max: 0 };
    a.n += v.n; a.abs += v.abs; a.max = Math.max(a.max, v.max);
    totals.set(key, a);
  }
  if (court.fall >= 0 && court.fall < court.settle + 0.02) break;
  const t = s * w.dt;
  if (Math.abs(t - 3.0) < w.dt * 0.5) { snapAll = all; snapT = t; }
  if (t < 2.05 || t > 4.05) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const fzl = ctl.sensors.feet[0]!.fz, fzr = ctl.sensors.feet[1]!.fz;
  const fl = w.body.bodies[w.body.indexByKey.get('foot_l')!]!.translation();
  const fr = w.body.bodies[w.body.indexByKey.get('foot_r')!]!.translation();
  const lL = diHipL0 >= 0 ? w.executor.ledger[diHipL0]! : null;
  const lR = diHipR0 >= 0 ? w.executor.ledger[diHipR0]! : null;
  const sc = scLat(m);
  const scTrunk = (m.get('supportClean.trunk:torque')?.abs ?? 0) + (m.get('supportClean.arm:torque')?.abs ?? 0);
  const scTrunkLeg = (m.get('supportClean.trunkLeg:ext')?.abs ?? 0);
  const rc2 = (m.get('squat.rc2:ext')?.abs ?? 0);
  const pairLat = m.get('squat.pairBase.lat:pair')?.n ?? 0;
  console.log(
    `${t.toFixed(2)} ${(court.fall >= 0 ? 'FALL' : 'hold').padEnd(8)} ` +
    `${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${roll().toFixed(1).padStart(5)} ` +
    `${(w.body.dofs[diHipL0]!.angle * 57.3).toFixed(1).padStart(6)} ${(w.body.dofs[diHipR0]!.angle * 57.3).toFixed(1).padStart(6)} ` +
    `${((fl.z - fr.z) * 100).toFixed(1).padStart(6)} ${((fr.z - fl.z) * 100).toFixed(1).padStart(6)} ` +
    `${`${(m.get('supportClean:torque')?.n ?? 0)}/${sc.toFixed(0)}`.padStart(13)} ${scTrunkLeg.toFixed(0).padStart(12)} ${rc2.toFixed(0).padStart(8)} ${String(pairLat).padStart(7)} ` +
    `${lL ? `${lL.cmd.toFixed(0)}/${lL.pair.toFixed(0)}/${lL.applied.toFixed(0)}` : '-'}`,
  );
  if (court.fall >= 0) break;
  void fzl; void fzr; void diKneeL0; void diFootL0; void diFootR0;
}
// 单帧逐轴快照：侧向轴每个写手的提案 + 最终账本
if (snapAll) {
  console.log(`\n=== t≈${snapT.toFixed(2)} 侧向逐轴快照 ===`);
  {
    const W = w.sk.massTotal * 9.81;
    const Kz = Math.abs(Number(process.env.SQC_HIP_STRUT_LAT_K ?? 5000));
    const Bz = Math.abs(Number(process.env.SQC_HIP_STRUT_LAT_B ?? 300));
    const Fmax = Math.abs(Number(process.env.SQC_HIP_STRUT_FMAX_BW ?? 0.3)) * W;
    for (const sd of ['l', 'r'] as const) {
      const hi = w.body.dofByName(`hip_${sd}`, 0);
      if (hi < 0) continue;
      const hd = w.body.dofs[hi]!;
      const hb = w.body.bodies[hd.b1]!;
      const zref = sd === 'l' ? (court.hipRefL ?? hd.anchorWorld[2]!) : (court.hipRefR ?? hd.anchorWorld[2]!);
      const Fz = Math.max(-Fmax, Math.min(Fmax, Kz * (zref - hd.anchorWorld[2]!) - Bz * hb.linvel().z));
      console.log(`HIPSTRUT_LAT ${sd}  on=${process.env.SQC_HIP_STRUT_LAT ?? '0'} zref=${zref.toFixed(3)} z=${hd.anchorWorld[2]!.toFixed(3)} vz=${hb.linvel().z.toFixed(2)} Fz=${Fz.toFixed(0)}N`);
    }
  }
  const latDofs = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r', 'spine1', 'spine2', 'spine3', 'neck'];
  for (const nm of latDofs) {
    const di = w.body.dofByName(nm, 0);
    if (di < 0) continue;
    const props = snapAll.filter((q) => q[0] === di);
    const by = new Map<string, string[]>();
    for (const [, kind, val, src] of props) {
      const k = `${src}[${kind}]`;
      const arr = by.get(k) ?? [];
      arr.push((kind === 'pair' ? 'ref=' : 'tau=') + val.toFixed(1));
      by.set(k, arr);
    }
    const l = w.executor.ledger[di]!;
    const ff = (w.drive as unknown as { ffOf(di: number): number }).ffOf(di);
    const bd = w.drive.lastBreakdown[di] ?? { stiff: 0, act: 0, servo: 0, ff: 0, damp: 0 };
    const manT = (ctl.manual as unknown as { torqueOf(di: number): number }).torqueOf(di);
    const manA = (ctl.manual as unknown as { hasAngle(di: number): boolean }).hasAngle(di);
    const pairC = (w.drive as unknown as { pairC: Float64Array }).pairC[di] ?? 0;
    console.log(`${nm}/0 ang=${(w.body.dofs[di]!.angle * 57.3).toFixed(1).padStart(6)}  led cmd=${l.cmd.toFixed(0).padStart(5)} pair=${l.pair.toFixed(0).padStart(5)} app=${l.applied.toFixed(0).padStart(5)} ff=${ff.toFixed(0).padStart(5)} manT=${manT.toFixed(0).padStart(5)} manA=${manA?1:0} pairC=${pairC.toFixed(2)} bd[st=${bd.stiff.toFixed(0)} act=${bd.act.toFixed(0)} sv=${bd.servo.toFixed(0)} dp=${bd.damp.toFixed(0)}]  ${[...by.entries()].map(([k, v]) => `${k}:${v.join(',')}`).join(' | ')}`);
  }
}

console.log('\n=== 侧向轴写手汇总（整个窗口，tau 绝对值之和/最大）===');
const arr = [...totals.entries()].sort((a, b) => b[1].abs - a[1].abs);
for (const [src, v] of arr) console.log(`${src.padEnd(32)} n=${String(v.n).padStart(4)} sum|tau|=${v.abs.toFixed(0).padStart(7)} max=${v.max.toFixed(1).padStart(6)}`);
console.log('\n=== 逐轴×写手（侧向，按 sum|tau| 排序，前 30）===');
for (const [k, v] of [...dofSrc.entries()].sort((a, b) => b[1].abs - a[1].abs).slice(0, 30)) {
  console.log(`${k.padEnd(42)} n=${String(v.n).padStart(4)} sum|tau|=${v.abs.toFixed(0).padStart(7)} max=${v.max.toFixed(1).padStart(6)}`);
}
