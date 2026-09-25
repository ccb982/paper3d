// ============================================================
// SquadTactics —— 小队黑板（★ 2026-09-25 起：**仅 UI/探针只读镜像**）
// ============================================================
// 执行真源已迁 `squad/SquadCore`（命令状态 + 寻路 + 成员调遣）。
// 本文件只保留：
//   · 镜像板：主线程 emit 的现令（kind/target/anchor/mission/until）+ 核心执行态（走廊/锚）
//   · 命令台账 CommandLedger（UI 显示"谁下的令"）
// 执行链**不再读这里**；分解矩阵/指令门已删除（见 squad/Decompose.ts）。
// ============================================================

import type { TacticalOrder } from '../../entity/SwarmUnit';
// 契约层再导出（兼容旧引用）
export { type DirectiveRoleBucket, roleBucket, squadBucket } from '../../entity/SwarmUnit';
import { CommandLedger } from './CommandLedger';
import {
  intentOfOrder, normalizeOrder, LONG_LIVED_MISSIONS, MISSION_TTL_FLOOR, ORDER_TTL_DEFAULT,
  type SquadOrderState,
} from './squad/State';

/** 两个目标点是否近似同点 */
function sameTarget(
  a: { x: number; z: number } | undefined,
  b: { x: number; z: number } | undefined,
  r: number,
): boolean {
  if (!a || !b) return !a && !b;
  return Math.hypot(a.x - b.x, a.z - b.z) <= r;
}

export class SquadBlackboard {
  private orders = new Map<number, SquadOrderState>();

  issue(state: SquadOrderState): void {
    this.orders.set(state.squadId, state);
  }

  get(squadId: number): SquadOrderState | null {
    return this.orders.get(squadId) ?? null;
  }

  /** ★ 镜像队长核执行态（走廊/锚点；UI 小地图/探针读） */
  mirror(squadId: number, src: SquadOrderState): void {
    const cur = this.orders.get(squadId);
    if (!cur) return;
    cur.corridor = src.corridor;
    cur.pathGoalX = src.pathGoalX;
    cur.pathGoalZ = src.pathGoalZ;
    cur.pathFromX = src.pathFromX;
    cur.pathFromZ = src.pathFromZ;
    cur.pathAt = src.pathAt;
    cur.anchorX = src.anchorX;
    cur.anchorZ = src.anchorZ;
    cur.anchorClimb = src.anchorClimb;
  }

  /** 小队注销（全灭）→ 镜像清 */
  dropSquad(squadId: number): void {
    this.orders.delete(squadId);
  }

  clear(): void {
    this.orders.clear();
  }
}

export class SquadTactics {
  readonly board = new SquadBlackboard();
  /** 命令台账（UI：每队最新令 + 历史） */
  readonly ledger = new CommandLedger();
  private seq = 1;

  /** 镜像发令（main emit → UI/探针；**不再驱动执行**） */
  issue(squadId: number, order: TacticalOrder, now: number, ttl = ORDER_TTL_DEFAULT, source: 'engine' | 'leader' | 'player' = 'engine'): void {
    const o: TacticalOrder = { ...order };
    if (!o.anchor) {
      const base = o.target ?? (o.path && o.path.length > 0 ? o.path[o.path.length - 1] : undefined);
      if (base) o.anchor = { x: base.x, z: base.z };
    }
    if (!o.intent) o.intent = intentOfOrder(o.kind, o.mission);
    const normalized = normalizeOrder(o);
    const prev = this.board.get(squadId);
    const longLived = normalized.kind === 'garrison'
      || (normalized.mission !== undefined && LONG_LIVED_MISSIONS.has(normalized.mission));
    const effTtl = longLived ? Math.max(ttl, MISSION_TTL_FLOOR) : ttl;
    // 同签名保活：只续命、不重登记（UI 少刷、台账不刷屏）
    if (prev && prev.source === source
      && prev.order.kind === normalized.kind
      && (prev.order.mission ?? '') === (normalized.mission ?? '')
      && sameTarget(prev.order.target, normalized.target, 2)
      && now < prev.until - 5) {
      prev.until = now + effTtl;
      return;
    }
    const state: SquadOrderState = {
      squadId, order: normalized, issuedAt: now, until: now + effTtl, source,
      notBefore: now, signal: normalized.signal,
      pathGoalX: 0, pathGoalZ: 0, pathAt: 0, pathFailedAt: 0,
    };
    if (prev && prev.order.kind === normalized.kind && sameTarget(prev.order.target, normalized.target, 12)) {
      state.pathGoalX = prev.pathGoalX;
      state.pathGoalZ = prev.pathGoalZ;
      state.pathAt = prev.pathAt;
      state.pathFailedAt = prev.pathFailedAt;
      state.corridor = prev.corridor;
      state.pathFromX = prev.pathFromX;
      state.pathFromZ = prev.pathFromZ;
    }
    this.board.issue(state);
    this.ledger.record(now, squadId, normalized.kind, source,
      o.target?.x ?? 0, o.target?.z ?? 0, normalized.mission, effTtl);
  }

  clear(): void {
    this.board.clear();
    this.seq = 1;
  }
}
