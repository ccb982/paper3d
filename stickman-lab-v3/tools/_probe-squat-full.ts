import './_boot';
import { writeFileSync, mkdirSync } from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';
import { sampleFootContact } from '../src/core/servo/footContact';
import { solveStaticLegTorques, solveStaticLegTorques3D } from '../src/core/servo/legInverseDynamics';
import { solveContactIdQp, solveContactIdWrenchQp } from '../src/core/servo/contactIdQp';
import { buildLegJacobian6, wrenchToJointTorques } from '../src/core/servo/contact6d';

const T_END = Number(process.env.T_END ?? 20);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
ctl.actions.play('squatDown');

let t0 = w.clock;
const contactCounts: Record<string, number> = {};
const moduleCounts: Record<string, number> = {};
const legRolls: number[] = [];
const captureFrames: Array<Record<string, unknown>> = [];
const legMins: number[] = [];
let handT = -1;
let hold: CourtState | null = null;
let comY0 = NaN;
let pitch0 = NaN;
let roll0 = NaN;
let lostContactT = 0;
let fallT = -1;
let reason = '';
let calDone = false;
const dbg = (s: 'l' | 'r'): Record<string, number> =>
  (globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, Record<string, number>> }).__SQC_KNEE_FOOT_DBG?.[s] ?? {};
const tau = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.executor.ledger[i]?.applied ?? 0 : 0;
};
const f1 = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '-');
const pitchOf = (q: { x: number; y: number; z: number; w: number }): number => {
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(ux, uy) * 57.29578;
};
const rollOf = (q: { x: number; y: number; z: number; w: number }): number => {
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy)) * 57.29578;
};

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  if (!hold) {
    const phase = ctl.actions.status.phase;
    const knee = (() => {
      const i = w.body.dofByName('knee_l', 2);
      return i >= 0 ? w.body.dofs[i]!.angle : 0;
    })();
    if ((phase === '交接' && knee < -60) || (!ctl.actions.status.active && w.clock - t0 > 4)) {
      ctl.actions.abort();
      ctl.manual.clear();
      hold = captureSquatCourt(w, ctl);
      handT = w.clock;
      comY0 = ctl.sensors.com[1]!;
      {
        const ti0 = w.body.indexByKey.get('spine4');
        const q0 = ti0 !== undefined ? w.body.bodies[ti0]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
        pitch0 = pitchOf(q0);
        roll0 = rollOf(q0);
      }
      console.log(`HANDOFF t=${handT.toFixed(3)} comY=${comY0.toFixed(3)} pitch0=${pitch0.toFixed(1)} roll0=${roll0.toFixed(1)}`);
    }
  }
  if (hold) squatFrame(w, ctl, hold);
  if (hold) { const a = (globalThis as { __SQC_MODULE_AUDIT?: Record<string, unknown> }).__SQC_MODULE_AUDIT; if (a) { for (const k of ['supportQp','supportQpFeasible','floatingQp','floatingTauFinite']) { const key = `${k}:${String(a[k] ?? 'na')}`; moduleCounts[key] = (moduleCounts[key] ?? 0) + 1; } } }
  if (hold) {
    const fi = w.body.indexByKey.get('foot_l');
    if (fi !== undefined) legRolls.push(rollOf(w.body.bodies[fi]!.rotation() as { x: number; y: number; z: number; w: number }));
    legMins.push(w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt));
  }
  if (hold) { const c = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { phase?: string }> }).__SQC_CONTACT_STATE; for (const side of ['l','r'] as const) { const p = c?.[side]?.phase ?? 'none'; const k = `${side}:${p}`; contactCounts[k] = (contactCounts[k] ?? 0) + 1; } }
  if (hold && process.env.BENCH_QP === '1') {
    const f = (globalThis as { __SQC_FLOATING_ID?: { M?: number[][]; G?: number[]; jacobians?: number[][][]; qdd?: number[]; contacts?: Array<Record<string, number>>; wrench?: number[][] } }).__SQC_FLOATING_ID;
    if (f?.M && f.G && f.jacobians?.length) {
      const t0 = performance.now();
      const solver = process.env.WRENCH_ONLY === '1' ? solveContactIdWrenchQp : solveContactIdQp;
      const out = solver({
        massMatrix: f.M,
        gravity: f.G,
        qddTarget: f.qdd ?? new Array(f.M.length).fill(0),
        contacts: f.jacobians.map((jacobian, i) => ({
          jacobian,
          halfX: f.contacts?.[i]?.halfX ?? 0.12,
          halfZ: f.contacts?.[i]?.halfZ ?? 0.06,
          mu: f.contacts?.[i]?.mu ?? 0.7,
          fzMin: f.contacts?.[i]?.fzMin ?? 0,
          wrenchRef: f.wrench?.[i],
        })),
        torqueMax: w.body.dofs.map((d) => Math.abs(d.tauMax)),
        qddWeight: 100,
      });
      const ms = performance.now() - t0;
      const g = globalThis as { __QP_BENCH?: { n: number; max: number; total: number; fail: number } };
      const b = g.__QP_BENCH ?? (g.__QP_BENCH = { n: 0, max: 0, total: 0, fail: 0 });
      b.n++; b.total += ms; b.max = Math.max(b.max, ms); if (!out.feasible) b.fail++;
      if (b.n % 10 === 0 || b.n >= 100) console.log(`QP_BENCH n=${b.n} last=${ms.toFixed(2)}ms max=${b.max.toFixed(2)}ms mean=${(b.total / b.n).toFixed(2)}ms fail=${b.fail}`);
      if (b.n >= 100) ctl.actions.abort();
    }
  }
  if (hold && process.env.CAPTURE_FIXTURE === '1' && handT >= 0 && w.clock - handT > 0.1 && captureFrames.length < 100) {
    const f = (globalThis as { __SQC_FLOATING_ID?: Record<string, unknown> }).__SQC_FLOATING_ID;
    if (f) {
      mkdirSync('.tmp', { recursive: true });
      const footData = (['l', 'r'] as const).map((side) => {
        const bi = w.body.indexByKey.get(`foot_${side}`);
        if (bi === undefined) return null;
        const rb = w.body.bodies[bi]!;
        const target = ctl.footAnkle.world.pose.get(side);
        const ci = (f.contacts ?? []).findIndex((c) => (c as { body?: number }).body === bi);
        return { side, actualQ: rb.rotation(), angVel: rb.angvel(), targetQ: target?.q ?? null, jacobian: ci >= 0 ? (f.jacobians?.[ci] ?? null) : null };
      }).filter((x) => x !== null);
      captureFrames.push({ ...f, footData, legId: { l: dbg('l'), r: dbg('r') }, dofNames: w.body.dofs.map((d) => `${d.name}/${d.axis}`), torqueMax: w.body.dofs.map((d) => Math.abs(d.tauMax)) });
      writeFileSync('.tmp/contact-id-fixture.json', JSON.stringify(captureFrames[0], null, 2));
      console.log('FIXTURE_WRITTEN');
    }
  }
  if (hold && !calDone && handT >= 0 && w.clock - handT > 0.05) {
    calDone = true;
    for (const side of ['l', 'r'] as const) {
      const d = dbg(side);
      const fc = sampleFootContact(w, side);
      const fz = d.fzUse ?? 0;
      const copX = d.copXUse ?? fc.footX;
      const use = { ...fc, copX };
      const id = solveStaticLegTorques(w, side, use, fz, {}, {}, []);
      const legDbg = (globalThis as { __LEG_ID?: Record<string, Record<string, number>> }).__LEG_ID?.[side] ?? {};
      const idG = solveStaticLegTorques(w, side, use, 0, {}, {}, []);
      const id3 = solveStaticLegTorques3D(w, side, use, fz, {}, {}, []);
      const idG3 = solveStaticLegTorques3D(w, side, use, 0, {}, {}, []);
      const j = buildLegJacobian6(w, side, copX, fc.footY, fc.footZ);
      const tau = wrenchToJointTorques(j, { fx: 0, fy: 0, fz, tx: 0, ty: 0, tz: 0 });
      const k = (n: string): number => j.names.indexOf(`${n}_${side}/2`);
      const statContact = (n: string): { tau: number; jz: number; ax: number; an: number; rx: number } => {
        const ni = w.body.dofByName(`${n}_${side}`, 2);
        if (ni < 0) return { tau: 0, jz: 0, ax: 0, an: 0, rx: 0 };
        const dd = w.body.dofs[ni]!;
        const sgn = /^(hip|knee)_/.test(`${n}_${side}`) ? -1 : 1;
        const rx = copX - dd.anchorWorld[0]!;
        const tau = rx * fz * dd.axisWorld[2]! * sgn;
        const kk = j.names.indexOf(`${n}_${side}/2`);
        const jz = kk >= 0 ? (j.J[2]?.[kk] ?? 0) * fz : 0;
        return { tau, jz, ax: dd.axisWorld[0]!, an: dd.anchorWorld[0]!, rx, ay: dd.axisWorld[1]!, az: dd.axisWorld[2]! };
      };
      const cH = statContact('hip'), cK = statContact('knee'), cF = statContact('foot');
      console.log(`RAW ${side} hip tau=${f1(cH.tau,1)} jz=${f1(cH.jz,1)} ax=${f1(cH.ax,3)} ay=${f1(cH.ay,3)} az=${f1(cH.az,3)} an=${f1(cH.an,3)} rx=${f1(cH.rx,3)} | knee tau=${f1(cK.tau,1)} jz=${f1(cK.jz,1)} | foot tau=${f1(cF.tau,1)} jz=${f1(cF.jz,1)}`);
      console.log(`CAL ${side} fz=${f1(fz,0)} copX=${f1(copX,3)} ` +
        `id=${f1(id.hip,1)}/${f1(id.knee,1)}/${f1(id.ankle,1)} ` +
        `idG=${f1(idG.hip,1)}/${f1(idG.knee,1)}/${f1(idG.ankle,1)} ` +
        `J=${f1(tau[k('hip')] ?? 0,1)}/${f1(tau[k('knee')] ?? 0,1)}/${f1(tau[k('foot')] ?? 0,1)} ` +
        `plus=${f1(idG.hip + (tau[k('hip')] ?? 0),1)}/${f1(idG.knee + (tau[k('knee')] ?? 0),1)}/${f1(idG.ankle + (tau[k('foot')] ?? 0),1)} ` +
        `minus=${f1(idG.hip - (tau[k('hip')] ?? 0),1)}/${f1(idG.knee - (tau[k('knee')] ?? 0),1)}/${f1(idG.ankle - (tau[k('foot')] ?? 0),1)} ` +
        `id3=${f1(id3.hip,1)}/${f1(id3.knee,1)}/${f1(id3.ankle,1)} ` +
        `idG3=${f1(idG3.hip,1)}/${f1(idG3.knee,1)}/${f1(idG3.ankle,1)} ` +
        `idContact=${f1(legDbg.hipContact ?? 0,1)}/${f1(legDbg.kneeContact ?? 0,1)}/${f1(legDbg.footContact ?? 0,1)} ` +
        `Jz=${f1(j.J[2]?.[k('hip')] ?? 0,3)}/${f1(j.J[2]?.[k('knee')] ?? 0,3)}/${f1(j.J[2]?.[k('foot')] ?? 0,3)}`);
    }
  }
  if (hold && handT >= 0 && w.clock - handT <= 0.30) {
    const rel = w.clock - handT;
    for (const side of ['l', 'r'] as const) {
      const fc = sampleFootContact(w, side);
      const d = dbg(side);
      const bi = w.body.indexByKey.get(`foot_${side}`);
      const footY = bi !== undefined ? w.body.bodies[bi]!.translation().y : NaN;
      const pitch = bi !== undefined ? pitchOf(w.body.bodies[bi]!.rotation()) : NaN;
      console.log(
        `F ${rel.toFixed(3)} ${side} footY=${f1(footY, 4)} pitch=${f1(pitch)} contact=${fc.contact ? 1 : 0} fz=${f1(fc.fz, 0)} ` +
        `fzUse=${f1(d.fzUse ?? 0, 0)} fzTot=${f1(d.fzTotalDesired ?? 0, 0)} fzDes=${f1(d.fzDesired ?? 0, 0)} fzCmd=${f1(d.fzCmd ?? 0, 0)} share=${f1(d.fzShare ?? 0, 2)} ` +
        `idH=${f1(d.idHip ?? 0, 0)} idK=${f1(d.idKnee ?? 0, 0)} hipFf=${f1(d.hipFf ?? 0, 0)} kneeFf=${f1(d.kneeFf ?? 0, 0)} ` +
        `apH=${f1(tau(`hip_${side}`, 2), 0)} apK=${f1(tau(`knee_${side}`, 2), 0)} apA=${f1(tau(`foot_${side}`, 2), 0)} ` +
        `handH=${f1(d.handHip ?? 0, 0)} handK=${f1(d.handKnee ?? 0, 0)}`,
      );
    }
    const hi = w.body.dofByName('hip_l', 2);
    const hipY = hi >= 0 ? w.body.dofs[hi]!.anchorWorld[1]! : NaN;
    console.log(`F ${rel.toFixed(3)} center hipY=${f1(hipY, 4)} comY=${f1(ctl.sensors.com[1]!, 4)} comVY=${f1(ctl.sensors.comVel[1]!, 2)}`);
  }
  if (hold && fallT < 0) {
    const comY = ctl.sensors.com[1]!;
    const ti = w.body.indexByKey.get('spine4');
    const q = ti !== undefined ? w.body.bodies[ti]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const pitch = pitchOf(q);
    const roll = rollOf(q);
    const fzL = w.body.footNormalForce('l', w.dt);
    const fzR = w.body.footNormalForce('r', w.dt);
    const bothLost = fzL < 5 && fzR < 5;
    lostContactT = bothLost ? lostContactT + w.dt : 0;
    if (comY < comY0 - 0.08) { fallT = w.clock; reason = `comY-8cm (${(comY * 100).toFixed(1)} vs ${(comY0 * 100).toFixed(1)})`; }
    else if (Math.abs(pitch - pitch0) > 60) { fallT = w.clock; reason = `torsoPitchΔ=${(pitch - pitch0).toFixed(1)}°`; }
    else if (Math.abs(roll - roll0) > 30) { fallT = w.clock; reason = `torsoRollΔ=${(roll - roll0).toFixed(1)}°`; }
    else if (lostContactT > 0.15) { fallT = w.clock; reason = 'both feet lost >0.15s'; }
  }
  if (fallT >= 0) break;
}
const total = (fallT >= 0 ? fallT : w.clock) - t0;
const descent = handT >= 0 ? handT - t0 : NaN;
const holdTime = fallT >= 0 && handT >= 0 ? fallT - handT : w.clock - handT;
if (process.env.CAPTURE_FIXTURE === '1') writeFileSync('.tmp/contact-id-fixture-frames.json', JSON.stringify(captureFrames, null, 0));
console.log('CONTACT_COUNTS', JSON.stringify(contactCounts));
console.log('MODULE_COUNTS', JSON.stringify(moduleCounts));
console.log('LEG_STATS', JSON.stringify({ n: legRolls.length, rollMean: legRolls.reduce((a,b)=>a+b,0)/Math.max(1,legRolls.length), rollStd: Math.sqrt(legRolls.reduce((a,b)=>a+(b-(legRolls.reduce((x,y)=>x+y,0)/Math.max(1,legRolls.length)))**2,0)/Math.max(1,legRolls.length)), minFz: Math.min(...legMins) }));
console.log(`RESULT total=${total.toFixed(3)}s descent=${descent.toFixed(3)}s hold=${holdTime.toFixed(3)}s fall=${fallT >= 0 ? 'yes' : 'no'} reason=${reason || '-'}`);
