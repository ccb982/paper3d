/**
 * WobblingMass —— 分布质量-弹簧-阻尼（绝对坐标，半隐式）。
 *
 * 每个大肢体带一个虚拟摆动质量：
 *   F = -k(p_w - p_b) - c(v_w - v_b)
 * 反作用力 -F 加回刚体 COM。
 * 静态时 p_w=p_b、v_w=v_b，不产生力。
 */
import type { World } from '../world';

interface Wobble {
  pw: { x: number; y: number; z: number };
  vw: { x: number; y: number; z: number };
  mw: number;
  k: number;
  c: number;
}
const _state = new WeakMap<World, Map<string, Wobble>>();
const KEYS = ['thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'torso'] as const;

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};

export function applyWobblingMass(w: World): void {
  if (num('SQC_WOBBLE_ON', 1) !== 1) return;
  const zeta = Math.max(0, num('SQC_WOBBLE_ZETA', 0.2));
  const hz = Math.max(0.1, num('SQC_WOBBLE_HZ', 16));
  const frac = Math.max(0, Math.min(0.8, num('SQC_WOBBLE_FRAC', 0.2)));
  const cap = Math.max(0, num('SQC_WOBBLE_FORCE_CAP', 120));
  const sub = Math.max(1, Math.min(16, Math.round(num('SQC_WOBBLE_SUBSTEPS', 4))));
  const omega = 2 * Math.PI * hz;
  const h = w.dt / sub;
  let map = _state.get(w);
  if (!map) { map = new Map(); _state.set(w, map); }
  const out: Array<{ key: string; force: number; r: number }> = [];
  for (const key of KEYS) {
    const bi = w.body.indexByKey.get(key);
    if (bi === undefined) continue;
    const rb = w.body.bodies[bi]!;
    const pb = rb.worldCom();
    const vb = rb.linvel();
    let s = map.get(key);
    if (!s) {
      const mw = Math.max(0, rb.mass() * frac);
      s = { pw: { x: pb.x, y: pb.y, z: pb.z }, vw: { x: vb.x, y: vb.y, z: vb.z }, mw, k: mw * omega * omega, c: 2 * zeta * mw * omega };
      map.set(key, s);
    }
    if (s.mw <= 0) continue;
    let fx = 0, fy = 0, fz = 0;
    for (let n = 0; n < sub; n++) {
      const rx = s.pw.x - pb.x, ry = s.pw.y - pb.y, rz = s.pw.z - pb.z;
      const vrx = s.vw.x - vb.x, vry = s.vw.y - vb.y, vrz = s.vw.z - vb.z;
      let ffx = -s.k * rx - s.c * vrx;
      let ffy = -s.k * ry - s.c * vry;
      let ffz = -s.k * rz - s.c * vrz;
      const fm = Math.hypot(ffx, ffy, ffz);
      const sc = fm > cap ? cap / fm : 1;
      ffx *= sc; ffy *= sc; ffz *= sc;
      s.vw.x += ffx / s.mw * h;
      s.vw.y += ffy / s.mw * h;
      s.vw.z += ffz / s.mw * h;
      s.pw.x += s.vw.x * h;
      s.pw.y += s.vw.y * h;
      s.pw.z += s.vw.z * h;
      const ix = Math.max(-cap * h, Math.min(cap * h, -ffx * h));
      const iy = Math.max(-cap * h, Math.min(cap * h, -ffy * h));
      const iz = Math.max(-cap * h, Math.min(cap * h, -ffz * h));
      if (Math.abs(ix) + Math.abs(iy) + Math.abs(iz) > 1e-9) rb.applyImpulse({ x: ix, y: iy, z: iz }, true);
      fx += ffx; fy += ffy; fz += ffz;
    }
    out.push({ key, force: Math.hypot(fx / sub, fy / sub, fz / sub), r: Math.hypot(s.pw.x - pb.x, s.pw.y - pb.y, s.pw.z - pb.z) });
  }
  (globalThis as { __WOBBLE?: typeof out }).__WOBBLE = out;
}
