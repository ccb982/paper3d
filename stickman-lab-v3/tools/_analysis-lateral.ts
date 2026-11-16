import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

interface Series {
  t: number[];
  comZ: number[];
  comVelZ: number[];
  dHatHPZ: number[];
  loadDiff: number[];
  copZ: number[];
  roll: number[];
  score: number[];
  onset: boolean[];
}

function run(J: number, tImp: number, tEnd = 3.0): Series {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.actions.idleEnabled = false;
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
  w.controller = ctl;
  w.reset();
  let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
  const torsoIdx = w.body.indexByKey.get('torso')!;
  const s: Series = { t: [], comZ: [], comVelZ: [], dHatHPZ: [], loadDiff: [], copZ: [], roll: [], score: [], onset: [] };
  let pushed = false;
  for (let i = 0; i < Math.round(tEnd / w.dt); i++) {
    w.advance(1);
    if (court) squatFrame(w, ctl, court);
    const t = court ? court.t : w.clock;
    if (!pushed && t >= tImp) {
      if (J !== 0) w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
      pushed = true;
    }
    const L = w.lateral.state;
    s.t.push(t);
    s.comZ.push(L.comZ);
    s.comVelZ.push(L.comVelZ);
    s.dHatHPZ.push(L.dHatHPZ);
    s.loadDiff.push(L.loadDiff);
    s.copZ.push(L.copZ);
    s.roll.push(L.roll);
    s.score.push(L.changeScore);
    s.onset.push(L.onset);
    if (court && court.fall >= 0 && t >= court.fall + 0.2) break;
  }
  return s;
}

function peakDelta(a: number[], b: number[], i0: number, i1: number): { peak: number; sign: number } {
  let peak = 0, sign = 0;
  for (let i = i0; i < Math.min(i1, a.length, b.length); i++) {
    const d = a[i]! - b[i]!;
    if (Math.abs(d) > peak) { peak = Math.abs(d); sign = Math.sign(d); }
  }
  return { peak, sign };
}

const tImp = Number(process.env.T_IMP ?? 2.3);
const Js = (process.env.JS ?? '0.05,0.1,0.2,0.5,1,2').split(',').map(Number);
const base = run(0, tImp);
const dt = base.t.length > 1 ? base.t[1]! - base.t[0]! : 1 / 480;
console.log(`analysis-lateral tImp=${tImp} dt=${(dt * 1000).toFixed(2)}ms`);
console.log('J(Ns)  lat(ms)  restFA  pk dComZ(mm) pk dVel(mm/s) pk dF(N) pk dLoad(N) pk dCoP(mm) pk dRoll(deg) sign');
for (const J of Js) {
  const r = run(J, tImp);
  const i0 = base.t.findIndex((t) => t >= tImp);
  const i1 = Math.min(base.t.length, r.t.length, i0 + Math.round(0.35 / dt));
  let first = -1;
  let restFa = 0;
  for (let i = 0; i < i0 && i < r.onset.length; i++) if (r.onset[i]) restFa++;
  for (let i = i0; i < i1; i++) if (r.onset[i]) { first = i; break; }
  const lat = first >= 0 ? (r.t[first]! - tImp) * 1000 : -1;
  const dCom = peakDelta(r.comZ, base.comZ, i0, i1);
  const dVel = peakDelta(r.comVelZ, base.comVelZ, i0, i1);
  const dF = peakDelta(r.dHatHPZ, base.dHatHPZ, i0, i1);
  const dLoad = peakDelta(r.loadDiff, base.loadDiff, i0, i1);
  const dCop = peakDelta(r.copZ, base.copZ, i0, i1);
  const dRoll = peakDelta(r.roll, base.roll, i0, i1);
  console.log(
    `${J.toFixed(2).padStart(5)} ${lat.toFixed(1).padStart(8)} ${String(restFa).padStart(7)} ` +
    `${(dCom.peak * 1000).toFixed(2).padStart(11)} ${(dVel.peak * 1000).toFixed(1).padStart(12)} ` +
    `${dF.peak.toFixed(0).padStart(7)} ${dLoad.peak.toFixed(0).padStart(10)} ${(dCop.peak * 1000).toFixed(1).padStart(11)} ` +
    `${(dRoll.peak * 57.3).toFixed(3).padStart(12)} ${dVel.sign >= 0 ? '+' : '-'}`,
  );
}
