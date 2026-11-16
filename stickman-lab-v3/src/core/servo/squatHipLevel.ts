/** 髋水平检查（只读，不写执行器）。
 *
 *  pelvis roll：左右髋 anchor 的 y/z 连线。
 *  同时给出左右脚 Fz、foot/0 角度，用于判断下盘是否竖直承重。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';

export interface HipLevelState {
  hipRoll: number;     // rad
  hipDY: number;       // m
  hipDZ: number;       // m
  footRollL: number;   // rad
  footRollR: number;   // rad
  loadL: number;       // 0..1
  loadR: number;       // 0..1
}

const anchor = (w: World, name: string, ax: number): { y: number; z: number } => {
  const i = w.body.dofByName(name, ax);
  if (i < 0) return { y: 0, z: 0 };
  const a = w.body.dofs[i]!.anchorWorld;
  return { y: a[1] ?? 0, z: a[2] ?? 0 };
};

export function estimateHipLevel(w: World, st: CS): HipLevelState {
  const hl = anchor(w, 'hip_l', 0);
  const hr = anchor(w, 'hip_r', 0);
  const dy = hl.y - hr.y;
  const dz = hl.z - hr.z;
  const fl = w.body.footNormalForce('l', w.dt);
  const fr = w.body.footNormalForce('r', w.dt);
  const tot = Math.max(1e-6, fl + fr);
  const af = (n: string): number => { const i = w.body.dofByName(n, 0); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
  return {
    hipRoll: Math.atan2(dy, Math.abs(dz) > 1e-6 ? dz : 1e-6),
    hipDY: dy,
    hipDZ: dz,
    footRollL: af('foot_l'),
    footRollR: af('foot_r'),
    loadL: fl / tot,
    loadR: fr / tot,
  };
}

export function logHipLevel(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_LEVEL_DBG ?? '0') !== '1') return;
  if (!st.released || Math.floor(w.clock * 10) === Math.floor((w.clock - w.dt) * 10)) return;
  const s = estimateHipLevel(w, st);
  console.log(`HIPLEVEL t=${w.clock.toFixed(2)} roll=${(s.hipRoll * 57.3).toFixed(2)}° dy=${(s.hipDY * 1000).toFixed(1)}mm dz=${(s.hipDZ * 1000).toFixed(1)}mm foot0=${(s.footRollL * 57.3).toFixed(1)}/${(s.footRollR * 57.3).toFixed(1)}° load=${(s.loadL * 100).toFixed(0)}/${(s.loadR * 100).toFixed(0)}%`);
}
