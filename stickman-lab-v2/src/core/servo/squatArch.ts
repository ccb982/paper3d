/** 蹲姿统一架构入口（legacy / unified 共存）。
 *
 *  - legacy：保留现有 squatFrame 旧链；
 *  - unified：SquatUnifiedController；
 *  - hybrid：预留给 legacy base + unified residual。
 *
 *  本文件只负责模式选择、任务状态和统一入口，不删除旧写手。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { SquatUnifiedController } from './squatUnified';

export type SquatArchMode = 'legacy' | 'unified' | 'hybrid';

export interface SquatTaskState {
  hipX: number;
  hipZ: number;
  kneeLx: number;
  kneeLz: number;
  kneeRx: number;
  kneeRz: number;
  footLx: number;
  footLz: number;
  footRx: number;
  footRz: number;
  loadL: number;
  loadR: number;
  hipErrX: number;
  hipErrZ: number;
  kneeErrL: number;
  kneeErrR: number;
}

const anchor = (w: World, name: string, ax: number): { x: number; z: number } => {
  const i = w.body.dofByName(name, ax);
  if (i < 0) return { x: 0, z: 0 };
  const a = w.body.dofs[i]!.anchorWorld;
  return { x: a[0] ?? 0, z: a[2] ?? 0 };
};

export function estimateSquatTaskState(w: World): SquatTaskState {
  const hl = anchor(w, 'hip_l', 0);
  const hr = anchor(w, 'hip_r', 0);
  const kl = anchor(w, 'knee_l', 2);
  const kr = anchor(w, 'knee_r', 2);
  const fl = anchor(w, 'foot_l', 0);
  const fr = anchor(w, 'foot_r', 0);
  const hipX = (hl.x + hr.x) / 2;
  const hipZ = (hl.z + hr.z) / 2;
  const footX = (fl.x + fr.x) / 2;
  const footZ = (fl.z + fr.z) / 2;
  const flz = w.body.footNormalForce('l', w.dt);
  const frz = w.body.footNormalForce('r', w.dt);
  const tot = Math.max(1e-6, flz + frz);
  return {
    hipX, hipZ,
    kneeLx: kl.x, kneeLz: kl.z, kneeRx: kr.x, kneeRz: kr.z,
    footLx: fl.x, footLz: fl.z, footRx: fr.x, footRz: fr.z,
    loadL: flz / tot, loadR: frz / tot,
    hipErrX: hipX - footX, hipErrZ: hipZ - footZ,
    kneeErrL: Math.hypot(kl.x - fl.x, kl.z - fl.z),
    kneeErrR: Math.hypot(kr.x - fr.x, kr.z - fr.z),
  };
}

export function squatArchMode(env: Record<string, string | undefined>): SquatArchMode {
  const m = String(env.SQC_ARCH ?? '');
  if (m === 'legacy' || m === 'unified' || m === 'hybrid') return m;
  return String(env.SQC_UNIFIED ?? '0') === '1' ? 'unified' : 'legacy';
}

export class SquatArchCoordinator {
  private readonly unified = new SquatUnifiedController();
  reset(): void { this.unified.reset(); }
  step(w: World, ctl: ControlModule, st: CS): void {
    this.unified.step(w, ctl, st);
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (String(env.SQC_ARCH_DBG ?? '0') === '1' && Math.floor(w.clock * 4) !== Math.floor((w.clock - w.dt) * 4)) {
      const s = estimateSquatTaskState(w);
      console.log(`ARCH t=${w.clock.toFixed(2)} hipErr=(${(s.hipErrX * 1000).toFixed(1)},${(s.hipErrZ * 1000).toFixed(1)})mm kneeErr=${(s.kneeErrL * 1000).toFixed(1)}/${(s.kneeErrR * 1000).toFixed(1)}mm load=${(s.loadL * 100).toFixed(0)}/${(s.loadR * 100).toFixed(0)}%`);
    }
  }
}
