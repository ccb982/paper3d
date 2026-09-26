// ============================================================
// squad/CommandLang —— 队长命令语言（语法 + 解释器；用户定 2026-09-25）
// ★ 原子与行为（《RTS架构.md》§2.10b）：**原子只有两个——长寻路/短寻路**；
//   驻守/巡逻/保护 =「取目标函数 → 短/长寻路移动」的循环；禁止独立移动实现。
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
//   act / defend / patrol（**去哪就去哪**：队长目标 = 下一路点 / 队令目标）：
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

/** 掩体校正：目标点周围（8 向 ×3m/6m）找**真有掩体**的点（用户定 2026-09-25：
 *  保护=被保护目标真被挡；驻守=自己真被挡）。无 → null（保持原点）。 */
function coveredNear(
  px: number, pz: number, x: number, z: number,
  cover: (tx: number, tz: number, x: number, z: number) => boolean,
): { x: number; z: number } | null {
  if (cover(px, pz, x, z)) return { x, z };
  for (const r of [3, 6]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (cover(px, pz, cx, cz)) return { x: cx, z: cz };
    }
  }
  return null;
}

/** 解释器：复合句 + 现场 → 原子句（唯一产生式；见文件头） */
export function interpretLeader(
  state: SquadOrderState,
  lx: number,
  lz: number,
  /** 队长目标（defend/act = 下一路点/队令目标；protect 不需要，传 null） */
  anchor: { x: number; z: number } | null,
  /** ★ 掩体检测（可选；保护/驻守取目标用）：(x,z) 是否被 (tx,tz) 方向的掩体挡住 */
  cover?: (tx: number, tz: number, x: number, z: number) => boolean,
): AtomicChoice {
  const o = state.order;
  // ---- protect：blockCheck（P=threat，B=自己，G=target=被保护点） ----
  if (o.kind === 'protect') {
    const G = o.target;
    const P = o.threatX !== undefined ? { x: o.threatX, z: o.threatZ ?? 0 } : null;
    if (G && P) {
      const b = blockCheck(P.x, P.z, lx, lz, G.x, G.z, undefined, 'block');
      const base = b.ok ? { x: lx, z: lz } : { x: b.ax, z: b.az };
      // ★ 掩体校正（用户定）：保证被保护目标真被挡——底线挡住 + 有掩体
      if (cover) {
        const c = coveredNear(P.x, P.z, base.x, base.z, cover);
        if (c && (Math.abs(c.x - base.x) > 1e-3 || Math.abs(c.z - base.z) > 1e-3)) {
          return { atom: 'act', x: c.x, z: c.z, why: `block+cover off=${b.off.toFixed(1)}` };
        }
      }
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
  let t = anchor ?? o.target ?? { x: lx, z: lz };
  // ★ 驻守掩体校正（用户定）：有威胁点时，先找"自己有掩体"的点（真被挡住）
  if (cover && o.threatX !== undefined) {
    const c = coveredNear(o.threatX, o.threatZ ?? 0, t.x, t.z, cover);
    if (c) t = c;
  }
  const d = Math.hypot(t.x - lx, t.z - lz);
  if (d > MARCH_DIST) return { atom: 'march', x: t.x, z: t.z, why: `${o.kind} d=${d | 0}` };
  if (d > ARRIVE_R) return { atom: 'act', x: t.x, z: t.z, why: `${o.kind} d=${d | 0}` };
  return { atom: 'garrison', x: t.x, z: t.z, why: `${o.kind} arrived` };
}
