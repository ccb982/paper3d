// ============================================================
// squad/AtomicSelect —— 复合命令 → 原子能力（队长层；**条件→原子 显式表**）
// ============================================================
// 复合（引擎→队长）：protect / act / defend（`engine/Composites.ts`）
// 原子（队长自选）：patrol / garrison / march / act
//
// 选择规则（唯一实现，一处可查；改规则只改这里）：
//
//   protect（保护：G=被保护队长位，P=玩家威胁位）——基类 `blockCheck(P,B,G,'block')`：
//     · 已挡住（ok）           → **garrison**（原地驻守，保持阻挡；不挪窝）
//     · 离 P 太远（dP > band） → **march**（长寻路到调整点 ax,az）
//     · 其余（偏了/不在带内）  → **act**（短跳到调整点 ax,az）
//     目标 = blockCheck 调整点（P→G 线上、离 P 为 STANDOFF）；**到点再校验**（收敛）。
//     （调整点即寻路目标——用户定 2026-09-24）
//
//   act（去某点；含 march 原子直令）——按到锚点距离：
//     · d > MARCH_DIST(40)     → **march**（长寻路）
//     · ARRIVE_R < d ≤ 40      → **act**（短跳 LOS 贪心）
//     · d ≤ ARRIVE_R(1.5)      → **garrison**（到位驻守；巡逻游弋归 resolveAnchor）
//
//   defend（守对象/守原地；站位锚先过 resolveAnchor：驻守绕掩体/反斜/掩体复核）：
//     · 同 act 的距离三分（march / act / garrison）
//     · 无对象（守原地）：锚 = 自身位 → 直接 garrison
//
//   patrol（原子直令，玩家/引擎罕见）：同 act（到位后由 `onArriveAtom` 定驻留口径）
//
// 注：blockCheck 是**基类功能**（entity/base/Blocking）；本文件只做"条件→原子"选择，
//     不写行为逻辑；寻路/执行分别由 SquadCore（端口 ensurePath）与执行层承担。
// ============================================================

import { blockCheck } from '../../../entity/base/Blocking';
import type { SquadOrderState } from './State';

export type Atom = 'patrol' | 'garrison' | 'march' | 'act';

/** 距离分流阈值（米；行军=长寻路，行动=短跳） */
export const MARCH_DIST = 40;
/** 到位半径（米） */
export const ARRIVE_R = 1.5;

export interface AtomicChoice {
  atom: Atom;
  /** 队长目标（调整点即寻路目标；garrison=驻留点） */
  x: number;
  z: number;
  /** 依据（探针/调试） */
  why: string;
}

/** 复合命令 + 现场 → 原子能力（唯一选择表；见文件头规则） */
export function selectAtomic(
  state: SquadOrderState,
  lx: number,
  lz: number,
  /** 站位锚（defend/act 由 resolveAnchor 解析；protect 不需要，传 null） */
  anchor: { x: number; z: number } | null,
): AtomicChoice {
  const o = state.order;
  // ---- protect：blockCheck（P=threat，B=自己，G=board 语义的 target=被保护点） ----
  if (o.kind === 'protect') {
    const G = o.target;
    const P = o.threatX !== undefined ? { x: o.threatX, z: o.threatZ ?? 0 } : null;
    if (G && P) {
      const b = blockCheck(P.x, P.z, lx, lz, G.x, G.z, undefined, 'block');
      if (b.ok) return { atom: 'garrison', x: lx, z: lz, why: `block OK off=${b.off.toFixed(1)}` };
      return { atom: b.atom, x: b.ax, z: b.az, why: `block off=${b.off.toFixed(1)}→${b.atom}` };
    }
    const t = G ?? anchor ?? { x: lx, z: lz };
    const d = Math.hypot(t.x - lx, t.z - lz);
    if (d > MARCH_DIST) return { atom: 'march', x: t.x, z: t.z, why: `protect(no P) d=${d | 0}` };
    if (d > ARRIVE_R) return { atom: 'act', x: t.x, z: t.z, why: `protect(no P) d=${d | 0}` };
    return { atom: 'garrison', x: t.x, z: t.z, why: 'protect(no P) arrived' };
  }
  // ---- act / defend / patrol：到锚点距离三分 ----
  const t = anchor ?? o.target ?? { x: lx, z: lz };
  const d = Math.hypot(t.x - lx, t.z - lz);
  if (d > MARCH_DIST) return { atom: 'march', x: t.x, z: t.z, why: `${o.kind} d=${d | 0}` };
  if (d > ARRIVE_R) return { atom: 'act', x: t.x, z: t.z, why: `${o.kind} d=${d | 0}` };
  return { atom: 'garrison', x: t.x, z: t.z, why: `${o.kind} arrived` };
}
