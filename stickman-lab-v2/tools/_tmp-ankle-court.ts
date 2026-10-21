/** _tmp-ankle-court.ts —— 蹲姿法庭踝侧向力审计（复刻 main.ts 点击序列）
 *  env：PAD=0 / LIMITS_OFF=1 / SQC_NODRIVE=1 / SQC_PINREL=1 / DIAG=1
 *  用法：node tools/run.mjs _tmp-ankle-court
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { setRigidUpper, freezeUpperStep } from '../src/core/servo/rescue';

const DIAG = process.env.DIAG === '1';
const DIAG_ALL = process.env.DIAG_ALL === '1';
const MIRROR_OFF = process.env.MIRROR_OFF === '1';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = process.env.IDLE !== '0';
// ★ 与 main.ts:56 一致：预测/反射层默认关（否则 leanReflex 的 ext 力矩绕过 outputScale）
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = process.env.PRED !== '1';
w.controller = ctl;
w.reset();
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };

// —— 复刻 main.ts `case 'squatcourt'` ——
ctl.actions.abort();
ctl.manual.clear();
w.controller = ctl;
w.driveEnabled = true;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
if (process.env.RIGID_UPPER === '1') setRigidUpper(true);
if (MIRROR_OFF) { w.body.mirrorSymmetric = false; console.log('MIRROR_OFF: mirrorSymmetric=false'); }

const foot = (side: 'l' | 'r'): { x: number; y: number; z: number } => {
  const b = w.body.bodies[w.body.indexByKey.get(`foot_${side}`)!]!;
  const p = b.translation();
  return { x: p.x, y: p.y, z: p.z };
};
let base: { l: { x: number; y: number; z: number }; r: { x: number; y: number; z: number }; com: { x: number; y: number; z: number } } | null = null;
let maxDz035 = 0, maxDx035 = 0, maxDz05 = 0, maxDz10 = 0;
let at235: { l: number; r: number; com: number } | null = null;
let at250: { l: number; r: number; com: number } | null = null;
let at300: { l: number; r: number; com: number } | null = null;

const footVyPrev: Record<'l' | 'r', number> = { l: 0, r: 0 };
const footAY: Record<'l' | 'r', number> = { l: 0, r: 0 };
const loadDiag = (): void => {
  if (!court) return;
  const t = court.t;
  if (t < 1.95 || t > 2.60) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  for (const side of ['l', 'r'] as const) {
    const fz = w.body.footNormalForce(side, w.dt);
    const cop = new Float64Array(3);
    const ok = w.body.footCoP(side, w.dt, cop);
    const di = w.body.dofByName(`foot_${side}`, 2);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    const ax = d.axisWorld;
    const ankX = d.anchorWorld[0]!, ankZ = d.anchorWorld[2]!;
    let m = 0;
    for (const k of [`foot_${side}`, `arch_${side}`, `mfoot_${side}`]) {
      const bi = w.body.indexByKey.get(k);
      if (bi !== undefined) m += w.body.bodies[bi]!.mass();
    }
    const shin = fz - m * 9.81 - m * footAY[side];   // 踝竖向传递力（正=小腿向上托脚）
    const copX = ok ? cop[0]! : ankX, copZ = ok ? cop[1]! : ankZ;
    const Mx = -fz * (copZ - ankZ);
    const Mz = fz * (copX - ankX);
    const axisM = Mx * ax[0]! + Mz * ax[2]!;
    const app = w.executor.appliedOf(di);
    let Tx = 0, Ty = 0, Tz = 0;
    for (const axx of [0, 1, 2]) {
      const di2 = w.body.dofByName(`foot_${side}`, axx);
      if (di2 < 0) continue;
      const u2 = w.body.dofs[di2]!.axisWorld;
      const t2 = w.executor.appliedOf(di2);
      Tx += t2 * u2[0]!; Ty += t2 * u2[1]!; Tz += t2 * u2[2]!;
    }
    console.log(`LOAD t=${t.toFixed(2)} ${side} fz=${fz.toFixed(0)}N 踝竖载=${shin.toFixed(0)}N CoP=(${(copX * 1000).toFixed(0)},${(copZ * 1000).toFixed(0)})mm 踝=(${(ankX * 1000).toFixed(0)},${(ankZ * 1000).toFixed(0)})mm GRF_M=(${Mx.toFixed(0)},0,${Mz.toFixed(0)}) 踝T=(${Tx.toFixed(0)},${Ty.toFixed(0)},${Tz.toFixed(0)}) M·ax=${axisM.toFixed(0)} app2=${app.toFixed(0)} ok=${ok}`);
  }
};

const forceDiag = (): void => {
  if (process.env.FORCE_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 2.6) return;
  const stp = Math.round(t * 240);
  const dense = t >= 2.25 && t <= 2.45;
  if (!dense && stp % 12 !== 0) return;
  const ar = (globalThis as { __SQC_AR?: { l: number; r: number } }).__SQC_AR ?? { l: 0, r: 0 };
  for (const side of ['l', 'r'] as const) {
    const fi0 = w.body.dofByName(`foot_${side}`, 0);
    const fi2 = w.body.dofByName(`foot_${side}`, 2);
    if (fi0 < 0 || fi2 < 0) continue;
    const l0 = w.executor.ledger[fi0]!;
    const l2 = w.executor.ledger[fi2]!;
    const b0 = w.drive.lastBreakdown[fi0];
    const b2 = w.drive.lastBreakdown[fi2];
    const ch2 = w.executor.pairBank.channel(fi2);
    const fz = w.body.footNormalForce(side, w.dt);
    const cop = new Float64Array(3);
    const ok = w.body.footCoP(side, w.dt, cop);
    const ankZ = w.body.dofs[fi2]!.anchorWorld[2]!;
    const copZ = ok ? cop[1]! : ankZ;
    const err = (copZ - ankZ) * 1000;
    const right = l0.cmd - (b0?.damp ?? 0);
    console.log(`FD t=${t.toFixed(4)} ${side} fz=${fz.toFixed(0)} copZ=${(copZ * 1000).toFixed(0)} ankZ=${(ankZ * 1000).toFixed(0)} err=${err.toFixed(0)}mm | f0 right=${right.toFixed(1)} next=${(side === 'l' ? ar.l : ar.r).toFixed(1)} td=${(b0?.damp ?? 0).toFixed(1)} cmd=${l0.cmd.toFixed(1)} app=${l0.applied.toFixed(1)} | f2 c=${ch2.c.toFixed(2)} base=${ch2.base.toFixed(1)} pair=${(l2.pair ?? 0).toFixed(1)} pd=${((l2.pair ?? 0) - ch2.base).toFixed(1)} td=${(b2?.damp ?? 0).toFixed(1)} cmd=${l2.cmd.toFixed(1)} app=${l2.applied.toFixed(1)}`);
  }
};

const kneePrevZ = { l: 0, r: 0 };
let kneePrevInit = false;
const kneeDiag = (): void => {
  if (process.env.KNEE_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 3.2) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  for (const side of ['l', 'r'] as const) {
    const kd = w.body.dofByName(`knee_${side}`, 2);
    const hd = w.body.dofByName(`hip_${side}`, 2);
    const fd = w.body.dofByName(`foot_${side}`, 2);
    const k0 = w.body.dofByName(`knee_${side}`, 0);
    const h0 = w.body.dofByName(`hip_${side}`, 0);
    const f0 = w.body.dofByName(`foot_${side}`, 0);
    if (kd < 0 || hd < 0 || fd < 0) continue;
    const kz = w.body.dofs[kd]!.anchorWorld[2]!;
    const hz = w.body.dofs[hd]!.anchorWorld[2]!;
    const fz = w.body.dofs[fd]!.anchorWorld[2]!;
    const vz = kneePrevInit ? (kz - kneePrevZ[side]) / (12 * w.dt) : 0;
    kneePrevZ[side] = kz;
    const a0 = k0 >= 0 ? w.body.dofs[k0]! : null;
    const ah = h0 >= 0 ? w.body.dofs[h0]! : null;
    const af = f0 >= 0 ? w.body.dofs[f0]! : null;
    const h0led = h0 >= 0 ? w.executor.ledger[h0]! : null;
    const h0bd = h0 >= 0 ? w.drive.lastBreakdown[h0] : null;
    const comZ = ctl.sensors.com[2]!;
    const comVz = ctl.sensors.comVel[2]!;
    console.log(`KNEE t=${t.toFixed(2)} ${side} kneeZ=${(kz * 1000).toFixed(1)} vZ=${(vz * 1000).toFixed(1)}mm/s hipZ=${(hz * 1000).toFixed(1)} footZ=${(fz * 1000).toFixed(1)} | knee0=${a0 ? (a0.angle * 57.3).toFixed(1) : '-'}° v=${a0 ? a0.vel.toFixed(2) : '-'} | hip0=${ah ? (ah.angle * 57.3).toFixed(1) : '-'}° hv=${ah ? ah.vel.toFixed(2) : '-'} damp=${h0bd ? h0bd.damp.toFixed(1) : '-'} lim=${h0led ? h0led.limit.toFixed(1) : '-'} cmd=${h0led ? h0led.cmd.toFixed(1) : '-'} app=${h0led ? h0led.applied.toFixed(1) : '-'} | comZ=${(comZ * 1000).toFixed(1)}mm cv=${(comVz * 1000).toFixed(1)} | foot0=${af ? (af.angle * 57.3).toFixed(1) : '-'}°`);
  }
  kneePrevInit = true;
};

const chainPrev = {
  l: { hipVel: 0, vz: new Map<string, number>(), init: false },
  r: { hipVel: 0, vz: new Map<string, number>(), init: false },
};
const chainDiag = (): void => {
  if (process.env.CHAIN_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 2.5) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  for (const side of ['l', 'r'] as const) {
    const hi = w.body.dofByName(`hip_${side}`, 0);
    const ki = w.body.dofByName(`knee_${side}`, 0);
    const k2 = w.body.dofByName(`knee_${side}`, 2);
    if (hi < 0) continue;
    const d = w.body.dofs[hi]!;
    const u = d.axisWorld;
    const pv = chainPrev[side];
    const bodies = [`thigh_${side}`, `shin_${side}`, `foot_${side}`, `arch_${side}`, `mfoot_${side}`];
    let Flat = 0;
    for (const key of bodies) {
      const bi = w.body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = w.body.bodies[bi]!;
      const vz = rb.linvel().z;
      const prev = pv.vz.get(key) ?? vz;
      if (pv.init) {
        const az = (vz - prev) / (12 * w.dt);
        if (key.startsWith('shin_') || key.startsWith('foot_') || key.startsWith('arch_') || key.startsWith('mfoot_')) Flat += rb.mass() * az;
      }
      pv.vz.set(key, vz);
    }
    if (!pv.init) { pv.hipVel = d.vel; pv.init = true; continue; }
    const alpha = (d.vel - pv.hipVel) / (12 * w.dt);
    const Minertia = d.inertia * alpha;
    const l = w.executor.ledger[hi]!;
    const Mact = l.applied;
    const Mres = Minertia - Mact;
    const hb = w.body.dofs[w.body.dofByName(`hip_${side}`, 2)]!;
    const kb = k2 >= 0 ? w.body.dofs[k2]! : null;
    const k0 = ki >= 0 ? w.body.dofs[ki]! : null;
    const kA = w.body.dofs[w.body.dofByName(`knee_${side}`, 2)]!.anchorWorld;
    const hA = d.anchorWorld;
    const ry = kA[1]! - hA[1]!;
    const rx = kA[0]! - hA[0]!;
    const Mhip = u[0]! * (-ry * Flat);
    const MkTorque = (kb ? -(w.executor.appliedOf(k2) * (kb.axisWorld[0]! * u[0]! + kb.axisWorld[1]! * u[1]! + kb.axisWorld[2]! * u[2]!)) : 0)
      + (k0 ? -(w.executor.appliedOf(ki) * (k0.axisWorld[0]! * u[0]! + k0.axisWorld[1]! * u[1]! + k0.axisWorld[2]! * u[2]!)) : 0);
    let Mgrav = 0;
    for (const key of bodies) {
      const bi = w.body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = w.body.bodies[bi]!;
      const c = rb.worldCom();
      const rx2 = c.x - hA[0]!, ry2 = c.y - hA[1]!, rz2 = c.z - hA[2]!;
      const Fy = -rb.mass() * 9.81;
      Mgrav += u[0]! * (-rz2 * Fy) + u[2]! * (rx2 * Fy);
    }
    const MhipForce = Mres - MkTorque - Mgrav;
    const denom = u[0]! * ry - u[1]! * rx;
    const Fknee = Math.abs(denom) > 1e-6 ? MhipForce / denom : NaN;
    console.log(`CHAIN t=${t.toFixed(2)} ${side} hip0=${(d.angle * 57.3).toFixed(1)}° hv=${d.vel.toFixed(2)} alpha=${alpha.toFixed(2)} I=${d.inertia.toFixed(3)} Mact=${Mact.toFixed(1)} Minert=${Minertia.toFixed(1)} Mres=${Mres.toFixed(1)} | Mgrav=${Mgrav.toFixed(1)} MkTorque=${MkTorque.toFixed(1)} MhipForce=${MhipForce.toFixed(1)} Fknee=${Number.isFinite(Fknee) ? Fknee.toFixed(1) : '--'}N | Flat=${Flat.toFixed(1)}N Fground≈${Number.isFinite(Fknee) ? (Flat + Fknee).toFixed(1) : '--'}N | knee2=${kb ? (w.executor.appliedOf(k2)).toFixed(1) : '-'} knee0=${k0 ? (w.executor.appliedOf(ki)).toFixed(1) : '-'}`);
    pv.hipVel = d.vel;
  }
};

const contactDiag = (): void => {
  if (process.env.CONTACT_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 2.5) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  for (const side of ['l', 'r'] as const) {
    let impN = 0, tx = 0, ty = 0, cnt = 0, ny = 0;
    for (const key of [`foot_${side}`, `arch_${side}`, `mfoot_${side}`]) {
      const bi = w.body.indexByKey.get(key);
      if (bi === undefined) continue;
      for (const col of w.body.collidersByBody[bi] ?? []) {
        w.world.contactPairsWith(col, (other) => {
          w.world.contactPair(col, other, (manifold) => {
            const n = manifold.normal();
            ny += Math.abs(n.y);
            cnt++;
            for (let i = 0; i < manifold.numContacts(); i++) {
              impN += manifold.contactImpulse(i);
              tx += manifold.contactTangentImpulseX(i);
              ty += manifold.contactTangentImpulseY(i);
            }
          });
        });
      }
    }
    console.log(`CONTACT t=${t.toFixed(2)} ${side} N=${(impN / w.dt).toFixed(0)}N Ftan=${(Math.hypot(tx, ty) / w.dt).toFixed(0)}N tx=${(tx / w.dt).toFixed(0)} ty=${(ty / w.dt).toFixed(0)} nY=${(ny / Math.max(1, cnt)).toFixed(2)}`);
  }
};

const shakeDiag = (): void => {
  if (process.env.SHAKE_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 3.2) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  const get = (k: string): { w: number; y: number } | null => {
    const bi = w.body.indexByKey.get(k);
    if (bi === undefined) return null;
    const rb = w.body.bodies[bi]!;
    const av = rb.angvel();
    return { w: Math.hypot(av.x, av.y, av.z), y: rb.translation().y };
  };
  const h = get('head'), s4 = get('spine4'), tr = get('torso');
  if (!h || !s4 || !tr) return;
  const c = ctl.sensors.com, v = ctl.sensors.comVel;
  console.log(`SHAKE t=${t.toFixed(2)} headW=${h.w.toFixed(2)} s4W=${s4.w.toFixed(2)} torsoW=${tr.w.toFixed(2)} headY=${(h.y * 100).toFixed(1)}cm s4Y=${(s4.y * 100).toFixed(1)}cm comX=${(c[0]! * 1000).toFixed(1)}mm vX=${(v[0]! * 1000).toFixed(0)}mm/s comY=${(c[1]! * 100).toFixed(1)}cm`);
};

const upperDiag = (): void => {
  if (process.env.UPPER_DIAG !== '1' || !court) return;
  const t = court.t;
  if (t < 2.0 || t > 3.2) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  const wOf = (k: string): number => {
    const bi = w.body.indexByKey.get(k);
    if (bi === undefined) return NaN;
    const av = w.body.bodies[bi]!.angvel();
    return Math.hypot(av.x, av.y, av.z);
  };
  const dof = (n: string, ax: number): string => {
    const i = w.body.dofByName(n, ax);
    if (i < 0) return '--';
    const d = w.body.dofs[i]!;
    const l = w.executor.ledger[i]!;
    return `${(d.angle * 57.3).toFixed(0)}°/${d.vel.toFixed(1)}/a${l.applied.toFixed(0)}/p${(l.pair ?? 0).toFixed(0)}`;
  };
  console.log(`UPPER t=${t.toFixed(2)} W s1=${wOf('spine1').toFixed(2)} s2=${wOf('spine2').toFixed(2)} s3=${wOf('spine3').toFixed(2)} s4=${wOf('spine4').toFixed(2)} neck=${wOf('neck').toFixed(2)} head=${wOf('head').toFixed(2)} armL=${wOf('arm_l').toFixed(2)} armR=${wOf('arm_r').toFixed(2)} | s1=${dof('spine1', 2)} s2=${dof('spine2', 2)} s3=${dof('spine3', 2)} nk=${dof('neck', 2)}`);
};

const forceMirrorBodies = (): void => {
  const FULL = process.env.MIRROR_FORCE_FULL === '1';
  if (process.env.MIRROR_FORCE !== '1' && !FULL) return;
  const body = w.body;
  const pairs: Array<[string, string]> = [
    ['thigh_l', 'thigh_r'], ['shin_l', 'shin_r'],
    ['foot_l', 'foot_r'], ['arch_l', 'arch_r'], ['mfoot_l', 'mfoot_r'],
    ['arm_l', 'arm_r'], ['hand_l', 'hand_r'],
  ];
  for (const [lk, rk] of pairs) {
    const li = body.indexByKey.get(lk);
    const ri = body.indexByKey.get(rk);
    if (li === undefined || ri === undefined) continue;
    const lb = body.bodies[li]!;
    const rb = body.bodies[ri]!;
    const pl = lb.translation(), pr = rb.translation();
    const vl = lb.linvel(), vr = rb.linvel();
    const xa = (pl.x + pr.x) / 2, ya = (pl.y + pr.y) / 2, za = (pl.z - pr.z) / 2;
    const vxa = (vl.x + vr.x) / 2, vya = (vl.y + vr.y) / 2, vza = (vl.z - vr.z) / 2;
    lb.setTranslation({ x: xa, y: ya, z: za }, true);
    rb.setTranslation({ x: xa, y: ya, z: -za }, true);
    lb.setLinvel({ x: vxa, y: vya, z: vza }, true);
    rb.setLinvel({ x: vxa, y: vya, z: -vza }, true);
    if (FULL) {
      const ql = lb.rotation(), qr = rb.rotation();
      const al = lb.angvel(), ar = rb.angvel();
      lb.setRotation({ x: -qr.x, y: -qr.y, z: qr.z, w: qr.w }, true);
      rb.setRotation({ x: -ql.x, y: -ql.y, z: ql.z, w: ql.w }, true);
      lb.setAngvel({ x: -ar.x, y: -ar.y, z: ar.z }, true);
      rb.setAngvel({ x: -al.x, y: -al.y, z: al.z }, true);
    }
  }
};

const courtDiag = (): void => {
  if (!court) return;
  const t = court.t;
  if (t < 1.95 || t > 2.60) return;
  if (Math.round(t * 240) % 12 !== 0) return;
  const body = w.body;
  const ex = w.executor;
  const lines: string[] = [];
  for (const d of body.dofs) {
    const footLike = /^(foot|arch|mfoot|ankle)/.test(d.name);
    const hipKnee = DIAG_ALL && /^(hip|knee|spine)/.test(d.name) && (d.axis === 0 || d.axis === 2);
    if (!footLike && !hipKnee) continue;
    const l = ex.ledger[d.dofIndex]!;
    const ax = d.axisWorld;
    const ch = ex.pairBank.channel(d.dofIndex);
    const pair = (DIAG_ALL && hipKnee) || /^(foot|ankle)/.test(d.name) ? ` pairC=${ch.c.toFixed(2)} pairBase=${ch.base.toFixed(0)} pair=${(l.pair ?? 0).toFixed(0)}` : '';
    const bd = w.drive.lastBreakdown[d.dofIndex];
    const bdS = bd && /^(foot|ankle)/.test(d.name) ? ` bd(st=${bd.stiff.toFixed(0)} dp=${bd.damp.toFixed(0)} ac=${bd.act.toFixed(0)} sv=${bd.servo.toFixed(0)} ff=${bd.ff.toFixed(0)})` : '';
    lines.push(`${d.name}/${d.axis} cmd=${l.cmd.toFixed(0)} app=${l.applied.toFixed(0)} ang=${(d.angle * 57.3).toFixed(1)}° v=${d.vel.toFixed(2)} ax=(${ax[0]!.toFixed(2)},${ax[1]!.toFixed(2)},${ax[2]!.toFixed(2)})${pair}${bdS}`);
  }
  if (lines.length) console.log(`[court t=${t.toFixed(2)}] action=${ctl.actions.status.active ? ctl.actions.status.id : '-'}\n  ${lines.join('\n  ')}`);
};

for (let s = 0; s < 2400; s++) {
  freezeUpperStep(w.body, ctl.manual);
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  forceMirrorBodies();
  w.advance(1);
  squatFrame(w, ctl, court);
  courtDiag();
  for (const side of ['l', 'r'] as const) {
    const bi = w.body.indexByKey.get(`foot_${side}`);
    if (bi === undefined) { footAY[side] = 0; continue; }
    const vy = w.body.bodies[bi]!.linvel().y;
    footAY[side] = (vy - footVyPrev[side]) / w.dt;
    footVyPrev[side] = vy;
  }
  loadDiag();
  forceDiag();
  kneeDiag();
  chainDiag();
  contactDiag();
  shakeDiag();
  upperDiag();
  const t = court.t;
  {
    const g = globalThis as { __latProbeDone?: boolean };
    const J = Number(process.env.LAT_PROBE ?? 0);
    if (!g.__latProbeDone && J !== 0 && court.t >= 2.1) {
      g.__latProbeDone = true;
      const target = String(process.env.LAT_PROBE_TARGET ?? 'torso');
      const bi = w.body.indexByKey.get(target);
      if (bi !== undefined) {
        w.body.bodies[bi]!.applyImpulse({ x: 0, y: 0, z: J }, true);
        console.log(`LAT_PROBE t=${court.t.toFixed(3)} target=${target} Jz=${J}`);
      }
    }
  }
  const fL = foot('l'), fR = foot('r'), c = ctl.sensors.com;
  if (!base && t >= 2.0) {
    base = { l: { ...fL }, r: { ...fR }, com: { x: c[0]!, y: c[1]!, z: c[2]! } };
    console.log(`BASE t=${t.toFixed(3)} footL=(${(fL.x * 1000).toFixed(1)},${(fL.z * 1000).toFixed(1)})mm footR=(${(fR.x * 1000).toFixed(1)},${(fR.z * 1000).toFixed(1)})mm comZ=${(c[2]! * 1000).toFixed(1)}mm`);
    if (process.env.SYM === '1') {
      const zOf = (k: string): number => (w.body.bodies[w.body.indexByKey.get(k)!]!.translation().z * 1000);
      const xOf = (k: string): number => (w.body.bodies[w.body.indexByKey.get(k)!]!.translation().x * 1000);
      const row = (k: string): string => `${k}=(${xOf(k).toFixed(1)},${zOf(k).toFixed(1)})`;
      console.log(`SYM ${['torso', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r'].map(row).join(' ')}`);
    }
  }
  if (base) {
    const dzL = (fL.z - base.l.z) * 1000, dzR = (fR.z - base.r.z) * 1000;
    const dxL = (fL.x - base.l.x) * 1000, dxR = (fR.x - base.r.x) * 1000;
    const mz = Math.max(Math.abs(dzL), Math.abs(dzR));
    const mx = Math.max(Math.abs(dxL), Math.abs(dxR));
    if (t <= 2.35) { maxDz035 = Math.max(maxDz035, mz); maxDx035 = Math.max(maxDx035, mx); }
    if (t <= 2.50) maxDz05 = Math.max(maxDz05, mz);
    if (t <= 3.00) maxDz10 = Math.max(maxDz10, mz);
    if (!at235 && t >= 2.35) at235 = { l: dzL, r: dzR, com: (c[2]! - base.com.z) * 1000 };
    if (!at250 && t >= 2.50) at250 = { l: dzL, r: dzR, com: (c[2]! - base.com.z) * 1000 };
    if (!at300 && t >= 3.00) at300 = { l: dzL, r: dzR, com: (c[2]! - base.com.z) * 1000 };
  }
  if (court.fall >= 0 && t >= court.fall + 0.5) break;
  if (t > 3.2) break;
}
const fmt = (v: { l: number; r: number; com: number } | null): string => v ? `Lz=${v.l.toFixed(1)} Rz=${v.r.toFixed(1)} comZ=${v.com.toFixed(1)}mm` : '-';
console.log(`RESULT PAD=${process.env.PAD ?? '-'} LIMITS_OFF=${process.env.LIMITS_OFF ?? '-'} NODRIVE=${process.env.SQC_NODRIVE ?? '-'} PINREL=${process.env.SQC_PINREL ?? '-'}`);
console.log(`  max|dz| 2.00-2.35=${maxDz035.toFixed(1)}mm 2.00-2.50=${maxDz05.toFixed(1)}mm 2.00-3.00=${maxDz10.toFixed(1)}mm max|dx|2.00-2.35=${maxDx035.toFixed(1)}mm`);
console.log(`  @2.35 ${fmt(at235)} | @2.50 ${fmt(at250)} | @3.00 ${fmt(at300)}`);
console.log(`  fall=${court.fall < 0 ? 'none' : `${court.fall.toFixed(3)}s ${court.reason}`} released=${court.released}`);
