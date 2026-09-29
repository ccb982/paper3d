// ============================================================
// squad/HoldCover —— 驻守（队长状态）：自主掩体循环（用户定 2026-09-29）
// ============================================================
// 驻守**不再钉死在一个点**：引擎可给坐标（=搜索锚，先到锚再循环）或只给驻守（就地起循环）。
// 队长自主三阶段：
//   · seek：找**更靠近舰船**的掩体（搜索半径内、离舰更近者优先）→ 躲其**背舰侧**；
//   · hide：藏够 `ADVANCE_S` → 回到 seek（**过一段时间再向前**推进掩体）；
//   · retreat：藏身处掩体**被毁**（掩体表里消失）→ 找**更远（更安全）**的掩体；
//     找不到 → 沿背舰方向脱离 `RETREAT_D` 米，够时间再回 seek。
// 方向参照 = 舰（威胁来源）；"躲" = 掩体在 舰↔躲点 之间。
// ============================================================

import { THREAT_NEAR } from '../CoverGeom';

/** 驻守策略参数（集中可调） */
export const HOLD_COVER = {
  /** 掩体搜索半径（米） */
  SEARCH_R: 40,
  /** 躲点 = 掩体背舰侧偏移（米） */
  HIDE: 1.6,
  /** 藏够多久再向前（秒） */
  ADVANCE_S: 15,
  /** 掩体被毁后的脱离距离（米） */
  RETREAT_D: 15,
  /** "更安全" = 比当前离舰远 ≥ 此值（米） */
  RETREAT_MARGIN: 6,
  /** 掩体存活判定半径（米；表里 2m 内有件 = 还活着） */
  ALIVE_R: 2,
  /** 玩家进到该半径（米）→ 用玩家做"背身参照"+掩体检测（单源 CoverGeom.THREAT_NEAR） */
  PLAYER_NEAR: THREAT_NEAR,
};

export interface HoldCoverState {
  phase: 'seek' | 'hide' | 'retreat';
  cover: { x: number; z: number } | null;
  at: number;
  /** 脱离点缓存（retreat 无掩体时用；防目标随位置外漂） */
  back: { x: number; z: number } | null;
}

export function newHoldCoverState(now: number): HoldCoverState {
  return { phase: 'seek', cover: null, at: now, back: null };
}

/** 驻守一步：返回本拍位移目标（由队长核送长/短寻路） */
export function stepHoldCover(
  st: HoldCoverState,
  now: number,
  pos: { x: number; z: number },
  ship: { x: number; z: number },
  covers: readonly { x: number; z: number }[],
  /** ★ 玩家靠近时：玩家位 + 掩体检测（同源 coverFrom；确保真藏在掩体后） */
  opt?: { player?: { x: number; z: number } | null; coverFrom?: (tx: number, tz: number, x: number, z: number) => boolean },
): { x: number; z: number } {
  const dShip = (p: { x: number; z: number }): number => Math.hypot(p.x - ship.x, p.z - ship.z);
  // 掩体被毁：藏/撤阶段的掩体表里消失 → 转撤退
  if (st.cover && (st.phase === 'hide' || st.phase === 'retreat')) {
    const alive = covers.some((c) => Math.hypot(c.x - st.cover!.x, c.z - st.cover!.z) <= HOLD_COVER.ALIVE_R);
    if (!alive) { st.phase = 'retreat'; st.cover = null; st.at = now; st.back = null; }
  }
  // 藏够 → 再向前
  if (st.phase === 'hide' && now - st.at >= HOLD_COVER.ADVANCE_S) { st.phase = 'seek'; st.at = now; }
  if (st.phase === 'seek') {
    // 比当前更靠舰的掩体（搜索半径内），取离舰最近者
    let best: { x: number; z: number } | null = null;
    let bd = dShip(pos) - 0.5;
    for (const c of covers) {
      if (Math.hypot(c.x - pos.x, c.z - pos.z) > HOLD_COVER.SEARCH_R) continue;
      const d = dShip(c);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { st.cover = { x: best.x, z: best.z }; st.phase = 'hide'; st.at = now; st.back = null; }
  } else if (st.phase === 'retreat') {
    // 更安全的掩体 = 比当前离舰远 ≥ RETREAT_MARGIN；取最远者（1.5 倍搜索半径内）
    let best: { x: number; z: number } | null = null;
    const need = dShip(pos) + HOLD_COVER.RETREAT_MARGIN;
    for (const c of covers) {
      if (Math.hypot(c.x - pos.x, c.z - pos.z) > HOLD_COVER.SEARCH_R * 1.5) continue;
      const d = dShip(c);
      if (d >= need && (!best || d > dShip(best))) best = c;
    }
    if (best) { st.cover = { x: best.x, z: best.z }; st.phase = 'hide'; st.at = now; st.back = null; }
    else if (!st.back) {
      const dx = pos.x - ship.x, dz = pos.z - ship.z;
      const d = Math.hypot(dx, dz) || 1;
      st.back = { x: pos.x + (dx / d) * HOLD_COVER.RETREAT_D, z: pos.z + (dz / d) * HOLD_COVER.RETREAT_D };
    }
    // 脱离够时间仍无掩体 → 再找机会向前
    if (st.back && now - st.at >= HOLD_COVER.ADVANCE_S) { st.phase = 'seek'; st.at = now; st.back = null; }
  }
  // 输出：躲点 = 掩体背离**参照**侧；无掩体 → 脱离点
  if (st.cover) {
    // 参照 = 近旁玩家（真威胁）或舰
    const player = opt?.player ?? null;
    const ref = player && Math.hypot(player.x - pos.x, player.z - pos.z) <= HOLD_COVER.PLAYER_NEAR ? player : ship;
    const dx = ref.x - st.cover.x, dz = ref.z - st.cover.z;
    const d = Math.hypot(dx, dz) || 1;
    const base = { x: st.cover.x - (dx / d) * HOLD_COVER.HIDE, z: st.cover.z - (dz / d) * HOLD_COVER.HIDE };
    // ★ 玩家靠近 → 用掩体检测校核/微调（确保真被掩体挡住；不过 → 绕掩体找真被挡点）
    if (opt?.coverFrom) {
      if (opt.coverFrom(ref.x, ref.z, base.x, base.z)) return base;
      for (const r of [HOLD_COVER.HIDE, HOLD_COVER.HIDE + 0.8, HOLD_COVER.HIDE + 1.6]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const q = { x: st.cover.x + Math.cos(a) * r, z: st.cover.z + Math.sin(a) * r };
          if (opt.coverFrom(ref.x, ref.z, q.x, q.z)) return q;
        }
      }
    }
    return base;
  }
  if (st.back) return { x: st.back.x, z: st.back.z };
  return { x: pos.x, z: pos.z };   // 无掩体可动 → 原地（表现交给巡逻/兜底）
}
