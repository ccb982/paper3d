// ============================================================
// squad/CommandLang —— 队长命令语言（语法 + 解释器；用户定 2026-09-25）
// ============================================================
// 队长收**引擎复合句**（`engine/CommandLang.ts`），按本文件语法**解释成原子句**；
// 再由 `Decompose` 把原子句 + 角色桶编译成**成员指令**。逐层一门语言，规则单源。
//
// EBNF（队长命令语法）：
//   sentence  := composite            // 输入：引擎复合句 protect / act / defend（patrol = 原子直令）
//   atom      := 'patrol' | 'garrison' | 'march' | 'act'
//   choice    := atom '(' point ')'   // 解释结果：原子 + 目标点（why = 依据，探针可读）
//
// 解释器 `interpretLeader(state, lx, lz, anchor)` 产生式（唯一实现，改规则只改这里）：
//
//   protect（G=被保护队长位，P=威胁位）——基类 `blockCheck(P,B,G,'block')`：
//     · 已挡住（ok）           → garrison（原地驻守，保持阻挡）
//     · 离 P 太远（dP > band） → march（长寻路到调整点 ax,az）
//     · 其余（偏了/不在带内）  → act（短跳到调整点 ax,az）
//     · 无 P（降级）           → 到 G 的距离三分（march / act / garrison）
//
//   act / defend / patrol（站位锚先过 resolveAnchor：驻守绕掩体/反斜/掩体复核）：
//     · d > MARCH_DIST(40)     → march（长寻路）
//     · ARRIVE_R < d ≤ 40      → act（短跳 LOS 贪心）
//     · d ≤ ARRIVE_R(1.5)      → garrison（到位驻守）
//
// 注：blockCheck 是**基类功能**（entity/base/Blocking）；本文件只做"条件→原子"解释，
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

/** 解释器：复合句 + 现场 → 原子句（唯一产生式；见文件头） */
export function interpretLeader(
  state: SquadOrderState,
  lx: number,
  lz: number,
  /** 站位锚（defend/act 由 resolveAnchor 解析；protect 不需要，传 null） */
  anchor: { x: number; z: number } | null,
): AtomicChoice {
  const o = state.order;
  // ---- protect：blockCheck（P=threat，B=自己，G=target=被保护点） ----
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
