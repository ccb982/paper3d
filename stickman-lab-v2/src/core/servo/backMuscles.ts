/** 背部肌肉被动层：竖脊肌/多裂肌按力线建模。
 *
 *  origin：骨盆/骶骨后方
 *  insertion：腰椎/胸椎后方
 *  肌肉力沿两点连线，等大反向施加；
 *  自动产生伸展/侧弯力矩 + 脊柱压缩。
 *  不做关节 PD，不写 CoP。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { baseState } from './baseTable';
import { qRotateVec } from '../quat';

const _ref = new WeakMap<CS, { l: number; r: number }>();
const _tlfRef = new WeakMap<CS, { l: number; r: number }>();
const _lenPrev = new WeakMap<CS, { l: number; r: number }>();

interface V3 { x: number; y: number; z: number }
interface Q4 { x: number; y: number; z: number; w: number }

function pointOn(w: World, key: string, off: V3): V3 | null {
  const bi = w.body.indexByKey.get(key);
  if (bi === undefined) return null;
  const rb = w.body.bodies[bi]!;
  const p = rb.translation();
  const q = rb.rotation() as Q4;
  const out = new Float64Array(3);
  qRotateVec(q, off.x, off.y, off.z, out);
  return { x: p.x + out[0]!, y: p.y + out[1]!, z: p.z + out[2]! };
}

function segLength(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) || 1;
}

function applyLine(w: World, a: V3, b: V3, force: number, keyA: string, keyB: string): void {
  const ia = w.body.indexByKey.get(keyA);
  const ib = w.body.indexByKey.get(keyB);
  if (ia === undefined || ib === undefined) return;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  // 收缩力：A 点拉向 B，B 点拉向 A
  const imp = force * w.dt;
  w.body.bodies[ia]!.applyImpulseAtPoint({ x: dx / L * imp, y: dy / L * imp, z: dz / L * imp }, a, true);
  w.body.bodies[ib]!.applyImpulseAtPoint({ x: -dx / L * imp, y: -dy / L * imp, z: -dz / L * imp }, b, true);
}

export function backMusclePassive(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_BACK_MUSCLE ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const F0 = Math.abs(Number(env.SQC_BM_F0 ?? 80));
  const K = Math.abs(Number(env.SQC_BM_K ?? 4000));
  const B = Math.abs(Number(env.SQC_BM_B ?? 80));
  const Fmax = Math.abs(Number(env.SQC_BM_FMAX ?? 250));
  const post = Number(env.SQC_BM_POST ?? -0.06);
  const lat = Math.abs(Number(env.SQC_BM_LAT ?? 0.035));
  let refs = _ref.get(st);
  const sides = ['l', 'r'] as const;
  const torsoI = w.body.indexByKey.get('torso');
  const torsoP = torsoI !== undefined ? w.body.bodies[torsoI]!.translation() : { x: 0, y: 0, z: 0 };
  const dbgTorque: number[] = [];
  for (const side of sides) {
    const s = side === 'l' ? 1 : -1;
    const origin = pointOn(w, 'torso', { x: post, y: 0, z: s * lat });
    const insert = pointOn(w, 'spine3', { x: post * 0.7, y: 0, z: s * lat * 0.8 });
    if (!origin || !insert) continue;
    const L = segLength(origin, insert);
    if (!refs) {
      refs = { l: L, r: L };
      _ref.set(st, refs);
    }
    const L0 = side === 'l' ? refs.l : refs.r;
    let prev = _lenPrev.get(st);
    if (!prev) { prev = { l: L, r: L }; _lenPrev.set(st, prev); }
    const Lprev = side === 'l' ? prev.l : prev.r;
    const dL = (L - Lprev) / Math.max(1e-6, w.dt);
    if (side === 'l') prev.l = L; else prev.r = L;
    const F = Math.max(0, Math.min(Fmax, F0 + K * (L - L0) - B * dL));
    if (F < 1e-6) continue;
    applyLine(w, origin, insert, F, 'torso', 'spine3');
    {
      const dx = origin.x - insert.x, dy = origin.y - insert.y, dz = origin.z - insert.z;
      const Lf = Math.hypot(dx, dy, dz) || 1;
      const fxi = dx / Lf * F, fyi = dy / Lf * F, fzi = dz / Lf * F;
      const rx = insert.x - torsoP.x, ry = insert.y - torsoP.y, rz = insert.z - torsoP.z;
      const mz = rx * fyi - ry * fxi;
      dbgTorque.push(mz);
    }
    if (String(env.SQC_BM_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`BACK ${side} L=${(L * 1000).toFixed(1)} L0=${(L0 * 1000).toFixed(1)} F=${F.toFixed(0)}`);
    }
  }
  if (String(env.SQC_BM_TQ ?? '0') === '1' && dbgTorque.length === 2) {
    console.log(`BACKTQ t=${w.clock.toFixed(2)} L=${(dbgTorque[0]!).toFixed(2)} R=${(dbgTorque[1]!).toFixed(2)} net=${((dbgTorque[0]! + dbgTorque[1]!)).toFixed(2)}`);
  }
  if (String(env.SQC_TLF ?? '0') === '1') {
    const F0t = Math.abs(Number(env.SQC_TLF_F0 ?? 60));
    const Kt = Math.abs(Number(env.SQC_TLF_K ?? 3000));
    const Bt = Math.abs(Number(env.SQC_TLF_B ?? 60));
    const FmaxT = Math.abs(Number(env.SQC_TLF_FMAX ?? 300));
    let tref = _tlfRef.get(st);
    for (const side of sides) {
      const sgn = side === 'l' ? 1 : -1;
      const a = pointOn(w, 'torso', { x: -0.08, y: 0, z: sgn * 0.05 });
      const b = pointOn(w, 'spine3', { x: -0.05, y: 0, z: sgn * 0.04 });
      if (!a || !b) continue;
      const L = segLength(a, b);
      if (!tref) { tref = { l: L, r: L }; _tlfRef.set(st, tref); }
      const L0 = side === 'l' ? tref.l : tref.r;
      const vi = w.body.indexByKey.get('spine3');
      const vz = vi !== undefined ? w.body.bodies[vi]!.linvel().z : 0;
      const F = Math.max(0, Math.min(FmaxT, F0t + Kt * (L - L0) - Bt * vz * sgn));
      if (F > 1e-6) applyLine(w, a, b, F, 'torso', 'spine3');
    }
  }
}
