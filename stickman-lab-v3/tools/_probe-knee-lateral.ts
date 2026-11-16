/** _probe-knee-lateral: 定位 knee_l/0 侧向大账本的写手（网页默认参数） */
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
const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };
const di = w.body.dofByName('knee_l', 0);
console.log(`knee_l/0 di=${di} tauMax=${w.body.dofs[di]!.tauMax}`);

const TARGET = Number(process.env.KNEE_T ?? 4.0);
let traceNow = false;
{
  const os = w.drive.setTorque.bind(w.drive);
  (w.drive as unknown as { setTorque(d: number, t: number): void }).setTorque = (d: number, t: number) => {
    if (traceNow && d === di) {
      const st = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 6).join('|');
      console.log(`[SETTQ] t=${w.clock.toFixed(3)} tau=${t.toFixed(1)} ${st}`);
    }
    os(d, t);
  };
  const oa = w.executor.addTorque.bind(w.executor);
  (w.executor as unknown as { addTorque(d: number, t: number): void }).addTorque = (d: number, t: number) => {
    if (traceNow && d === di) {
      const st = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 6).join('|');
      console.log(`[ADD]   t=${w.clock.toFixed(3)} tau=${t.toFixed(1)} ${st}`);
    }
    oa(d, t);
  };
}

for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  const tNow = s * w.dt;
  traceNow = Math.abs(tNow - TARGET) < w.dt * 1.5;
  const log: Array<[number, string, number, string]> = [];
  g.__PROPLOG = log;
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  const applied = log.slice();
  g.__PROPLOG = [];
  squatFrame(w, ctl, court);
  const queued = log.slice();
  g.__PROPLOG = [];

  const t = s * w.dt;
  if (Math.abs(t - TARGET) > w.dt * 0.5) continue;
  const l = w.executor.ledger[di]!;
  const bd = w.drive.lastBreakdown[di]!;
  const ff = (w.drive as unknown as { ffOf(d: number): number }).ffOf(di);
  const manT = (ctl.manual as unknown as { torqueOf(d: number): number }).torqueOf(di);
  const pairC = (w.drive as unknown as { pairC: Float64Array }).pairC[di]!;
  const pairBase = (w.drive as unknown as { pairBase: Float64Array }).pairBase[di]!;
  console.log(`\n=== t=${t.toFixed(3)} knee_l/0 ===`);
  console.log(`ang=${(w.body.dofs[di]!.angle * 57.3).toFixed(2)}° vel=${w.body.dofs[di]!.vel.toFixed(2)} cmd=${l.cmd.toFixed(1)} pair=${l.pair.toFixed(1)} applied=${l.applied.toFixed(1)} saturated=${l.saturated} ff=${ff.toFixed(1)} manT=${manT.toFixed(1)} pairC=${pairC.toFixed(3)} pairBase=${pairBase.toFixed(1)}`);
  console.log(`bd stiff=${bd.stiff.toFixed(1)} act=${bd.act.toFixed(1)} servo=${bd.servo.toFixed(1)} ff=${bd.ff.toFixed(1)} damp=${bd.damp.toFixed(1)}`);
  const props = applied.concat(queued).filter((p) => p[0] === di);
  console.log(`proposals=${props.length}`);
  for (const [d, kind, val, src] of props) console.log(`  ${src}[${kind}] ${kind === 'pair' ? 'ref' : 'tau'}=${val.toFixed(2)}`);
  console.log(`all sources on this step:`);
  const srcs = new Map<string, number>();
  for (const [d, kind, val, src] of applied) if (kind === 'torque' || kind === 'ext') srcs.set(`${src}[${kind}]`, (srcs.get(`${src}[${kind}]`) ?? 0) + val);
  for (const [k, v] of srcs) console.log(`  ${k} sum=${v.toFixed(1)}`);
  break;
}
