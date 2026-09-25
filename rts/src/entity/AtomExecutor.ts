// ============================================================
// AtomExecutor —— 原子执行器（二级掷；《RTS架构.md》§5.13；步骤 9c/执行层）
// ★ 2026-09-19：下沉到实体层（载体执行契约的一部分）——实体与代理共用同一套表/掷。
// ============================================================
// 输入：个体指令（DirectiveKind）+ 小队命令（SquadOrderKind）+ 角色桶 + 局部态势
// 输出：承诺窗口内的移动原子（forward/back/strafeL/strafeR/hold）+ 开火决策
// 模型：**移动掷（五选一）+ 开火掷（二元，正交）**；命令只改概率偏置（软约束，
//       所有原子恒可执行——明确进攻下小概率游荡/后退也正常）。
// 数据：基准表/调制表全部集中在此（可调参不改逻辑）。
// ============================================================

import type { DirectiveKind, SquadOrderKind, DirectiveRoleBucket } from './SwarmUnit';
import { FIRE_HOLD, FIRE_MOVING } from './SwarmUnit';

export const MOVE_ATOMS = ['forward', 'back', 'strafeL', 'strafeR', 'hold'] as const;
export type MoveAtom = (typeof MOVE_ATOMS)[number];

/** 原子承诺窗口（秒；段边界才允许重掷，防每拍翻转）——1.0s：到位后不再"左右抽风" */
export const ATOM_SEGMENT_S = 1.0;

interface TableRow {
  /** forward / back / strafeL / strafeR / hold */
  move: [number, number, number, number, number];
  fire: number;
}

/** 基准表（按个体指令，15 条；《RTS架构.md》§5.13） */
const BASE: Record<DirectiveKind, TableRow> = {
  push:      { move: [0.55, 0.05, 0.15, 0.15, 0.10], fire: 0.85 },
  suppress:  { move: [0.10, 0.05, 0.10, 0.10, 0.65], fire: 0.95 },
  screen:    { move: [0.05, 0.40, 0.15, 0.15, 0.25], fire: 0.85 },
  fallback:  { move: [0.05, 0.50, 0.15, 0.15, 0.15], fire: 0.25 },
  boundBack: { move: [0.10, 0.45, 0.12, 0.12, 0.21], fire: 0.45 },
  guardWard: { move: [0.20, 0.10, 0.10, 0.10, 0.50], fire: 0.90 },
  block:     { move: [0.15, 0.10, 0.08, 0.08, 0.59], fire: 0.70 },
  intercept: { move: [0.55, 0.05, 0.15, 0.15, 0.10], fire: 0.90 },
  sneak:     { move: [0.70, 0.02, 0.10, 0.10, 0.08], fire: 0.05 },
  pin:       { move: [0.15, 0.10, 0.30, 0.30, 0.15], fire: 0.90 },
  strike:    { move: [0.60, 0.03, 0.15, 0.15, 0.07], fire: 0.85 },
  bound:     { move: [0.45, 0.05, 0.15, 0.15, 0.20], fire: 0.55 },
  cover:     { move: [0.05, 0.05, 0.20, 0.20, 0.50], fire: 0.90 },
  focusFire: { move: [0.05, 0.05, 0.15, 0.15, 0.60], fire: 0.95 },
  regroup:   { move: [0.60, 0.02, 0.12, 0.12, 0.14], fire: 0.30 },
};

/** 小队命令调制（叠加在基准上：Δforward/Δback/Δstrafe(双侧)/Δhold/Δfire） */
const ORDER_MOD: Record<SquadOrderKind, [number, number, number, number, number]> = {
  advance: [ 0.10, -0.05, -0.05,  0.00,  0.05],
  retreat: [-0.10,  0.15,  0.00, -0.05, -0.10],
  protect: [-0.05, -0.05,  0.05,  0.05,  0.05],
  flank:   [ 0.05, -0.05,  0.00,  0.00, -0.15],
  bound:   [ 0.05,  0.00, -0.05,  0.00,  0.00],
  focus:   [-0.05, -0.05,  0.00,  0.10,  0.05],
  regroup: [ 0.05, -0.05,  0.00,  0.00, -0.10],
  garrison:[ 0.00, -0.10,  0.05,  0.05,  0.15],
};

/** 局部态势（每决策拍由调用方给） */
export interface AtomSituation {
  /** 目标在攻击射程内（远程 = 射程；近战 = 挥击距离） */
  inRange: boolean;
  /** ★ 距离比（d / 攻击射程；>1 = 超程，<0.55 = 太近）——远程保持距离用 */
  rangeRatio: number;
  /** ★ 五轴「交战」ROE 编码（FIRE_FREE/HOLD/MOVING；影响开火掷偏置） */
  firePolicy: number;
  /** 低血（≤30%） */
  lowHp: boolean;
  /** 刚被击（本拍躲闪偏置） */
  justHit: boolean;
  /** 有目标（无目标 → 不开火，不打空气） */
  hasTarget: boolean;
}

export interface AtomWeights {
  move: number[];
  fire: number;
}

/** 合成概率：`P = normalize(基准[指令] ⊕ 调制[命令] ⊕ 调制[情境] ⊕ 角色覆写)` */
export function resolveWeights(
  directive: DirectiveKind,
  order: SquadOrderKind | 'none',
  bucket: DirectiveRoleBucket,
  sit: AtomSituation,
): AtomWeights {
  const b = BASE[directive];
  const move = [b.move[0], b.move[1], b.move[2], b.move[3], b.move[4]];
  let fire = b.fire;
  if (order !== 'none') {
    const m = ORDER_MOD[order];
    move[0] += m[0]; move[1] += m[1]; move[2] += m[2]; move[3] += m[2]; move[4] += m[3];
    fire += m[4];
  }
  if (!sit.inRange) { fire *= 0.1; move[0] += 0.10; }
  if (!sit.hasTarget) fire = 0;
  // ★ 五轴 ROE：holdFire → 极低开火偏置（软禁火：原子恒可执行）；moving → 略降
  if (sit.firePolicy === FIRE_HOLD) fire *= 0.05;
  else if (sit.firePolicy === FIRE_MOVING) fire *= 0.95;
  if (sit.lowHp) { move[1] += 0.15; fire -= 0.20; }
  if (sit.justHit) { move[2] += 0.20; move[3] += 0.20; }
  // 角色覆写
  if (bucket === 'logistics') { fire -= 0.15; move[0] -= 0.10; move[2] += 0.05; move[3] += 0.05; }
  if (bucket === 'ranged') {
    // ★ 远程保距档（用户定调）：合适距离 → 多停止/左右游荡；太近 → 多后退；超程 → 多前进
    const rr = sit.rangeRatio;
    if (rr < 0.55) {
      move[1] += 0.35; move[0] -= 0.10; move[4] -= 0.05;   // 太近：后退
    } else if (rr <= 1.0) {
      move[4] += 0.20; move[2] += 0.04; move[3] += 0.04; move[0] -= 0.10; // 合适：停止为主
    } else {
      move[0] += 0.25; move[4] -= 0.10;                     // 超程：前进
    }
    move[0] -= 0.05; move[2] += 0.03; move[3] += 0.03;
  }
  // 归一化 + clamp（软约束：原子恒可执行）
  for (let k = 0; k < 5; k++) move[k] = Math.max(0.01, move[k]);
  const sum = move[0] + move[1] + move[2] + move[3] + move[4];
  for (let k = 0; k < 5; k++) move[k] /= sum;
  fire = Math.max(0.02, Math.min(0.98, fire));
  return { move, fire };
}

/** 原子 → 世界方向（tx/tz = 指向目标的单位向量；无目标时传当前朝向） */
export function atomDirection(atom: MoveAtom, tx: number, tz: number, out: { x: number; z: number }): void {
  switch (atom) {
    case 'forward': out.x = tx; out.z = tz; break;
    case 'back': out.x = -tx; out.z = -tz; break;
    case 'strafeL': out.x = -tz; out.z = tx; break;
    case 'strafeR': out.x = tz; out.z = -tx; break;
    case 'hold': out.x = 0; out.z = 0; break;
  }
}

interface ExecState {
  seq: number;
  moveIdx: number;
  fire: boolean;
  until: number;
}

/** 每单位承诺状态（uid → 当前原子 + 段截止） */
export class AtomExecutor {
  private states = new Map<number, ExecState>();

  /** 每决策拍：指令未变且未到段边界 → 沿用；否则重掷（seq 变更/被击立即重掷） */
  step(
    uid: number, now: number, directiveSeq: number, weights: AtomWeights, forceReroll: boolean,
  ): { move: MoveAtom; fire: boolean } {
    let st = this.states.get(uid);
    if (!st) {
      st = { seq: -1, moveIdx: 4, fire: false, until: 0 };
      this.states.set(uid, st);
    }
    if (directiveSeq !== st.seq || forceReroll || now >= st.until) {
      st.seq = directiveSeq;
      st.moveIdx = rollIndex(weights.move);
      st.fire = Math.random() < weights.fire;
      st.until = now + ATOM_SEGMENT_S * (0.7 + Math.random() * 0.6);
    }
    return { move: MOVE_ATOMS[st.moveIdx], fire: st.fire };
  }

  drop(uid: number): void {
    this.states.delete(uid);
  }

  clear(): void {
    this.states.clear();
  }
}

/** 掷移动原子下标（供实体侧自持承诺状态使用） */
export function rollMove(weights: number[]): number {
  return rollIndex(weights);
}

/** 掷开火（二元；供实体侧自持承诺状态使用） */
export function rollFire(p: number): boolean {
  return Math.random() < p;
}

// ============================================================
// ★ 统一决策内核（2026-09-21）：L3 实体与代理共用同一条
//    「指令 × 命令 × 角色 × 情境 → 两层掷 → 移动原子/开火」管线
// ============================================================

/** 指令执行情境（两种载体口径统一；dist 与 range 同单位） */
export interface DirectiveSituation {
  dist: number;
  range: number;
  hpRatio: number;
  /** 受击白闪（>0.5 = 刚被击） */
  flash: number;
  hasTarget: boolean;
  /** 五轴 ROE 编码（FIRE_*） */
  firePolicy: number;
}

/** 内核输出（复用对象，零分配） */
export interface DirectiveRun {
  moveIdx: number;
  move: MoveAtom;
  fire: boolean;
  /** 目标在攻击距离内（dist ≤ range） */
  inRange: boolean;
}

/** ★ 一次决策：合成权重（指令×命令×角色×情境）→ 承诺窗内沿用 / 到点重掷 */
export function runDirective(
  atoms: AtomExecutor,
  uid: number,
  now: number,
  directive: DirectiveKind,
  order: SquadOrderKind | 'none',
  bucket: DirectiveRoleBucket,
  seq: number,
  sit: DirectiveSituation,
  out: DirectiveRun,
): void {
  out.inRange = sit.dist <= sit.range;
  const w = resolveWeights(directive, order, bucket, {
    inRange: out.inRange,
    rangeRatio: sit.dist / Math.max(1e-3, sit.range),
    lowHp: sit.hpRatio < 0.3,
    justHit: sit.flash > 0.5,
    hasTarget: sit.hasTarget,
    firePolicy: sit.firePolicy,
  });
  const atom = atoms.step(uid, now, seq, w, sit.flash > 0.5);
  out.move = atom.move;
  out.moveIdx = MOVE_ATOMS.indexOf(atom.move);
  out.fire = atom.fire;
}

/** ★ 开火节拍与散布（远距掩护性零星散射 / 近距<20m 疯狂精准）——两种载体同源 */
export function fireProfile(dist: number): { near: boolean; cd: number; spread: number } {
  const near = dist < 20;
  return near
    ? { near, cd: 0.35 + Math.random() * 0.25, spread: 0.012 }
    : { near, cd: 1.1 + Math.random() * 1.0, spread: 0.15 };
}

function rollIndex(weights: number[]): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}
