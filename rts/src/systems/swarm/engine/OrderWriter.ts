// ============================================================
// engine/OrderWriter.ts —— 唯一发令器（重写 P3；铁律 7/G1/G2；用户定）
// ============================================================
// 所有蜂群引擎命令的**唯一出口**：引擎各管理器只产决策，命令一律经这里下发。
// 职责（一处实现、不许旁路）：
//   · 稳定门：同签名重发豁免；**换令**需 现令进度 ≥50% 或 长时间静止（ORDER_STABLE）
//   · 旁路：干预令（扎堆/越位/磨蹭/散开）/ 玩家令 / 重伤（<0.5）直接过
//   · 唯一写口：SquadOrderStore（G2——只有本文件能写）
//   · 台账/探针：dbg（issued/kept/bypass）+ 最近令
// 纯逻辑（时间从参数传入）→ 可独立自检。
// ============================================================

import type { OrderState, SquadOrder } from './contracts';
import { ORDER_STABLE } from '../SwarmConfig';

/** 队令唯一写口（G2：只有 OrderWriter 能写） */
export class SquadOrderStore {
  private readonly m = new Map<number, OrderState>();

  get(id: number): OrderState | undefined {
    return this.m.get(id);
  }

  /** ★ 只许 OrderWriter 调（G2） */
  set(id: number, st: OrderState): void {
    this.m.set(id, st);
  }

  clear(id: number): void {
    this.m.delete(id);
  }

  all(): IterableIterator<[number, OrderState]> {
    return this.m.entries();
  }
}

export interface WriterCtx {
  /** 本拍（实秒） */
  now: number;
  /** 干预令旁路稳定门（扎堆/越位/磨蹭/散开） */
  intervention?: boolean;
  /** 玩家令（最高优先） */
  player?: boolean;
  /** 重伤（<0.5 血量） */
  wounded?: boolean;
}

export class OrderWriter {
  /** 探针契约（G9） */
  readonly dbg = { issued: 0, kept: 0, bypass: 0, last: '' };
  /** ★ 命令历史环（UI/探针只读；最近 256 条） */
  private readonly hist: { at: number; squadId: number; kind: string; source: string; tx: number; tz: number; mission?: string }[] = [];

  constructor(readonly store: SquadOrderStore) {}

  /** 发令：过稳定门 → 写唯一写口。返回 true = 已下发 */
  issue(id: number, order: SquadOrder, ctx: WriterCtx): boolean {
    const cur = this.store.get(id);
    if (cur) {
      const bypass = ctx.intervention || ctx.player || ctx.wounded;
      if (bypass) {
        this.dbg.bypass++;
      } else {
        const sameSig =
          cur.order.kind === order.kind &&
          cur.order.target.x === order.target.x &&
          cur.order.target.z === order.target.z;
        if (!sameSig) {
          const canSwitch =
            cur.progress >= ORDER_STABLE.PROGRESS || cur.stillS >= ORDER_STABLE.STUCK_S;
          if (!canSwitch) {
            this.dbg.kept++;
            this.dbg.last = `keep#${id} ${cur.order.kind}(p=${cur.progress.toFixed(2)},s=${cur.stillS.toFixed(1)})`;
            return false;
          }
        }
      }
    }
    this.store.set(id, {
      order,
      phase: 'executing',
      progress: 0,
      issuedAt: ctx.now,
      stillS: 0,
    });
    this.dbg.issued++;
    this.dbg.last = `issue#${id} ${order.kind} →${order.target.x.toFixed(0)},${order.target.z.toFixed(0)}`;
    this.hist.push({
      at: ctx.now, squadId: id, kind: order.kind, source: order.source,
      tx: order.target.x, tz: order.target.z, mission: order.mission,
    });
    if (this.hist.length > 256) this.hist.shift();
    return true;
  }

  /** 最近 n 条命令（UI/探针；新→旧序） */
  recent(n: number): readonly { at: number; squadId: number; kind: string; source: string; tx: number; tz: number; mission?: string }[] {
    return this.hist.slice(Math.max(0, this.hist.length - n)).reverse();
  }

  /** 每队最新一条（仅保留 windowS 秒内） */
  latestPerSquad(windowS: number): Map<number, { at: number; squadId: number; kind: string; source: string; tx: number; tz: number; mission?: string }> {
    const out = new Map<number, { at: number; squadId: number; kind: string; source: string; tx: number; tz: number; mission?: string }>();
    const last = this.hist[this.hist.length - 1];
    const now = last ? last.at : 0;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const e = this.hist[i];
      if (now - e.at > windowS) break;
      if (!out.has(e.squadId)) out.set(e.squadId, e);
    }
    return out;
  }

  /** 每拍推进（队长汇报进度/静止；由引擎调） */
  advance(id: number, progress: number, stillS: number): void {
    const cur = this.store.get(id);
    if (!cur) return;
    cur.progress = progress;
    cur.stillS = stillS;
  }

  release(id: number): void {
    this.store.clear(id);
  }
}
