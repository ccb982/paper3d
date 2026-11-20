/**
 * KneeGuard —— 蹲姿膝横向约束（v3 虚拟接触层）。
 *
 * 目标：额状面 kneeZ = footZ；矢状面不约束。
 * 只在蹲下/蹲姿期间启用；不改关节 qRef，不抢命令层写手。
 */
import type { World } from '../world';

const num = (key: string, def: number): number => {
  const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {})[key]);
  return Number.isFinite(v) ? v : def;
};

export class KneeGuard {
  step(w: World, dt: number): void {
    if (String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_KNEE_GUARD ?? '1') === '0') return;
    const K = Math.abs(num('V3_KNEE_GUARD_K', 20000));
    const D = Math.abs(num('V3_KNEE_GUARD_D', 300));
    const CAP = Math.abs(num('V3_KNEE_GUARD_CAP', 300));
    for (const side of ['l', 'r'] as const) {
      const ki = w.body.dofByName(`knee_${side}`, 2);
      const fi = w.body.indexByKey.get(`foot_${side}`);
      const ti = w.body.indexByKey.get(`thigh_${side}`);
      const si = w.body.indexByKey.get(`shin_${side}`);
      if (ki < 0 || fi === undefined || ti === undefined || si === undefined) continue;
      const kn = w.body.dofs[ki]!.anchorWorld;
      const foot = w.body.bodies[fi]!;
      const thigh = w.body.bodies[ti]!;
      const shin = w.body.bodies[si]!;
      const err = kn[2]! - foot.translation().z;
      const v = 0.5 * (thigh.linvel().z + shin.linvel().z);
      const F = Math.max(-CAP, Math.min(CAP, -K * err - D * v));
      if (Math.abs(F) < 1e-6) continue;
      const imp = { x: 0, y: 0, z: F * dt * 0.5 };
      const p = { x: kn[0]!, y: kn[1]!, z: kn[2]! };
      thigh.applyImpulseAtPoint(imp, p, true);
      shin.applyImpulseAtPoint(imp, p, true);
    }
  }
}
