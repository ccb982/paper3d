/** 蹲姿专属：膝对齐 + 踝辅助。
 *
 *  为什么单独一层：
 *  - 站立/行走的通用回正只关心 CoM/躯干/CoP；
 *  - “膝在踝正上方”是蹲姿的额外任务；
 *  - 踝既参与通用 CoP，也参与蹲姿膝对齐，这里只保留**膝对齐那部分**。
 */
import type { World } from '../world';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface KneeRef { l0: number; r0: number; }
export interface KneeAnkleState { kneeL: number; kneeR: number; loadL: number; loadR: number; }
export interface KneeAnkleCommand { hipL: number; hipR: number; ankleL: number; ankleR: number; }

function offset(w: World, side: 'l' | 'r'): number {
  const ki = w.body.dofByName(`knee_${side}`, 2);
  const fi = w.body.dofByName(`foot_${side}`, 0);
  if (ki < 0 || fi < 0) return 0;
  return w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!;
}

export function captureKneeRef(w: World): KneeRef {
  return { l0: offset(w, 'l'), r0: offset(w, 'r') };
}

export function estimateKneeAnkle(w: World, ref: KneeRef): KneeAnkleState {
  const fl = w.body.footNormalForce('l', w.dt);
  const fr = w.body.footNormalForce('r', w.dt);
  const tot = Math.max(1e-6, fl + fr);
  return { kneeL: offset(w, 'l') - ref.l0, kneeR: offset(w, 'r') - ref.r0, loadL: fl / tot, loadR: fr / tot };
}

export interface KneeAnkleOpts {
  hipKp?: number;
  hipCap?: number;
  ankleKp?: number;
  ankleCap?: number;
  dead?: number;
  loadScale?: boolean;
}

/** 标定（探针 5Nm）：
 *  +hip/0 → 同侧膝 +z
 *  +foot/0 → 同侧膝 -z
 */
export function planKneeAnkle(s: KneeAnkleState, gate: number, opts: KneeAnkleOpts = {}): KneeAnkleCommand {
  const hk = opts.hipKp ?? 50, hc = opts.hipCap ?? 1;
  const ak = opts.ankleKp ?? 50, ac = opts.ankleCap ?? 1;
  const dead = opts.dead ?? 0;
  const useLoad = opts.loadScale ?? true;
  const eL = Math.abs(s.kneeL) <= dead ? 0 : s.kneeL - Math.sign(s.kneeL) * dead;
  const eR = Math.abs(s.kneeR) <= dead ? 0 : s.kneeR - Math.sign(s.kneeR) * dead;
  // 对称基线 50/50；实际负载偏离时，承重腿获得更大膝对齐权限。
  const wL = useLoad ? clamp(s.loadL / 0.5, 0, 1) : 1;
  const wR = useLoad ? clamp(s.loadR / 0.5, 0, 1) : 1;
  const g = clamp(gate, 0, 1);
  return {
    hipL: clamp(-hk * eL, -hc, hc) * g * wL,
    hipR: clamp(-hk * eR, -hc, hc) * g * wR,
    ankleL: clamp(ak * eL, -ac, ac) * g,
    ankleR: clamp(ak * eR, -ac, ac) * g,
  };
}

export class SquatKneeAnkleController {
  private ref: KneeRef | null = null;
  constructor(private readonly opts: KneeAnkleOpts = {}) {}
  reset(): void { this.ref = null; }
  step(w: World, gate: number): { state: KneeAnkleState; cmd: KneeAnkleCommand } | null {
    if (!this.ref) this.ref = captureKneeRef(w);
    const state = estimateKneeAnkle(w, this.ref);
    return { state, cmd: planKneeAnkle(state, gate, this.opts) };
  }
}
