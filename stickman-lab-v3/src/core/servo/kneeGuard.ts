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
  /** 每次蹲下重抽：外侧偏移可正可负（内收/外展），不影响蹲姿。 */
  private target: { l: number; r: number } | null = null;

  reset(): void {
    this.target = null;
  }

  step(w: World, dt: number): void {
    if (String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_KNEE_GUARD ?? '1') === '0') return;
    const K = Math.abs(num('V3_KNEE_GUARD_K', 6000));
    const D = Math.abs(num('V3_KNEE_GUARD_D', 120));
    const CAP = Math.abs(num('V3_KNEE_GUARD_CAP', 120));
    if (!this.target) {
      const fixed = Math.abs(num('V3_KNEE_GUARD_OUT', 0.02));
      const random = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_KNEE_GUARD_RANDOM ?? '1') !== '0';
      if (random) {
        const lo = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_KNEE_GUARD_OUT_MIN ?? -0.03);
        const hi = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_KNEE_GUARD_OUT_MAX ?? 0.03);
        const a = Number.isFinite(lo) ? lo : -0.03;
        const b = Number.isFinite(hi) ? hi : 0.03;
        const out = a + Math.random() * Math.max(0, b - a);
        this.target = { l: out, r: out };
      } else {
        this.target = { l: fixed, r: fixed };
      }
    }
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
      const sign = side === 'l' ? 1 : -1;
      const out = side === 'l' ? this.target.l : this.target.r;
      const err = kn[2]! - (foot.translation().z + sign * out);
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
