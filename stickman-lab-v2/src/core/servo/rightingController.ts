/** 统一回正控制器 v2 —— 基础层。
 *  本文件先固定：StateEstimator / CourtRef / SafeSet 的接口与单位。
 *  QP 与低层 WBC 后续接入；默认不参与 squatFrame。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState } from '../court';
import type { Body } from '../body';

export interface RightingState {
  e: number;       // m
  v: number;       // m/s
  trunkZ: number;  // m
  trunkR: number;  // rad
  trunkRate: number; // rad/s
  headR: number;   // rad
  cop: number;     // m
  copMargin: number; // m
  contact: number; // 0..1
  slip: boolean;
  kneeL: number;   // m, 左膝相对踝侧向偏移（相对 release 基准）
  kneeR: number;   // m, 右膝相对踝侧向偏移（相对 release 基准）
  kneeZ: number;   // m, 左右平均
}

export interface CourtRef {
  c0z: number;
  r0: number;
  trunkZ0: number;
  kneeL0: number;
  kneeR0: number;
  ang0: Map<number, number>;
}

export interface SafeSetState {
  eSafe: number;
  vSafe: number;
  rSafe: number;
  radius: number;
  gate: number;
  inside: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function captureCourtRef(w: World, st: CourtState): CourtRef {
  const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  const q = ti !== undefined ? w.body.bodies[ti]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  const kneeOffset = (side: 'l' | 'r'): number => {
    const ki = w.body.dofByName(`knee_${side}`, 2);
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (ki < 0 || fi < 0) return 0;
    return w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!;
  };
  return {
    c0z: st.c0.z,
    r0: st.r0,
    trunkZ0: ti !== undefined ? w.body.bodies[ti]!.translation().z : 0,
    kneeL0: kneeOffset('l'),
    kneeR0: kneeOffset('r'),
    ang0: new Map(st.ang0 ?? []),
  };
}

export function estimateRightingState(w: World, ctl: ControlModule, ref: CourtRef): RightingState {
  const tr = ctl.lateral.parts['trunk'];
  const hd = ctl.lateral.parts['head'];
  const cop = new Float64Array(3);
  let copMargin = 0;
  for (const side of ['l', 'r'] as const) {
    if (!w.body.footCoP(side, w.dt, cop)) continue;
    const ai = w.body.dofByName(`foot_${side}`, 2);
    if (ai >= 0) copMargin = Math.max(copMargin, Math.abs(cop[1]! - w.body.dofs[ai]!.anchorWorld[2]!));
  }
  const slip = ctl.perception.feet.some((f) => f.slip);
  const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  const trunkRate = ti !== undefined ? w.body.bodies[ti]!.angvel().x : 0;
  const kneeOffset = (side: 'l' | 'r'): number => {
    const ki = w.body.dofByName(`knee_${side}`, 2);
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (ki < 0 || fi < 0) return 0;
    return w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!;
  };
  const kneeL = kneeOffset('l') - ref.kneeL0;
  const kneeR = kneeOffset('r') - ref.kneeR0;
  return {
    e: ctl.sensors.com[2]! - ref.c0z,
    v: ctl.sensors.comVel[2]!,
    trunkZ: (tr?.z ?? ref.trunkZ0) - ref.trunkZ0,
    trunkR: (tr?.roll ?? ref.r0) - ref.r0,
    trunkRate,
    headR: (hd?.roll ?? 0) - (tr?.roll ?? 0),
    cop: ctl.lateral.state.copZ,
    copMargin,
    contact: ctl.perception.support === 'both' ? 1 : 0.5,
    slip,
    kneeL,
    kneeR,
    kneeZ: (kneeL + kneeR) / 2,
  };
}

export function computeSafeSetV2(s: RightingState): SafeSetState {
  const copFactor = clamp(1 - s.copMargin / 0.04, 0.15, 1);
  const contactFactor = s.slip ? 0.3 : clamp(s.contact, 0, 1);
  const eSafe = Math.max(0.0005, 0.002 * copFactor * contactFactor);
  const vSafe = Math.max(0.003, 0.015 * copFactor * contactFactor);
  const rSafe = Math.max(0.0015, (0.5 / 57.3) * copFactor * contactFactor);
  const radius = Math.sqrt((s.e / eSafe) ** 2 + (s.v / vSafe) ** 2 + (s.trunkR / rSafe) ** 2);
  return { eSafe, vSafe, rSafe, radius, gate: radius <= 1 ? 0 : clamp((radius - 1) / 1, 0, 1), inside: radius <= 1 };
}

/** SafeSet 滞回：避免 gate 在边界抖动。 */
export class SafeSetLatch {
  private active = false;
  private gate = 0;
  update(s: RightingState): SafeSetState {
    const z = computeSafeSetV2(s);
    if (z.radius > 1) this.active = true;
    else if (z.radius < 0.6) this.active = false;
    const target = this.active ? clamp((z.radius - 0.6) / 0.4, 0, 1) : 0;
    this.gate += (target - this.gate) * 0.2;
    return { ...z, gate: this.gate, inside: !this.active };
  }
}

export interface RightingCommand { copOffset: number; hipTau: number; kneeTauL: number; kneeTauR: number; backTau: number; }

/** 任务级回正规划（v2 首版）：不是旧写手，输出统一命令。 */
export function planRightingV2(s: RightingState, gate: number, h = 0.8): RightingCommand {
  const g = 9.81;
  const kpE = 3.0, kdE = 0.6;
  const copRaw = s.e + (Math.max(0.3, h) / g) * (kpE * s.e + kdE * s.v);
  const copOffset = clamp(copRaw, -0.02, 0.02) * clamp(gate, 0, 1);
  const hipTau = clamp(80 * s.trunkR + 8 * s.trunkRate, -20, 20) * clamp(gate, 0, 1);
  const backTau = clamp(120 * s.trunkZ + 4 * s.v, -20, 20) * clamp(gate, 0, 1);
  // 膝对齐：+hip/0 使同侧膝 +z；误差为正时给负力矩。
  const kneeTauL = clamp(-200 * s.kneeL, -2, 2) * clamp(gate, 0, 1);
  const kneeTauR = clamp(-200 * s.kneeR, -2, 2) * clamp(gate, 0, 1);
  return { copOffset, hipTau, kneeTauL, kneeTauR, backTau };
}


/** 新架构控制器：状态 → safe set → 任务命令。
 *  只产出命令，不直接写执行器；接入由 squatFrame 的统一出口负责。
 */
export class RightingControllerV2 {
  private ref: CourtRef | null = null;
  private readonly latch = new SafeSetLatch();
  reset(): void { this.ref = null; }
  step(w: World, ctl: ControlModule, st: CourtState): { state: RightingState; safe: SafeSetState; cmd: RightingCommand } | null {
    if (!st.released) return null;
    if (!this.ref) this.ref = captureCourtRef(w, st);
    const state = estimateRightingState(w, ctl, this.ref);
    const safe = this.latch.update(state);
    const cmd = planRightingV2(state, safe.gate);
    return { state, safe, cmd };
  }
}
