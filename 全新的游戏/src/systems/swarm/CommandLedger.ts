// ============================================================
// CommandLedger —— 蜂群引擎命令台账（2026-09-21）
// ============================================================
// 目的：回答「是不是所有大规模操作都是蜂群引擎下的命令」。
//   唯一写口 = SquadTactics.issue()（引擎 source）+ 队长 source；
//   本台账在唯一写口记录每条命令（kind/队/目标/任务名/来源）。
//   结论支撑：
//     · SquadsBlackboard.orders 只有 issue() 一个写点 → 无旁路；
//     · Director 只做 UI 播报，不再发命令；
//     · 刷怪/生成走账本（spawned）不叫命令。
//   去重：同队同 kind 同目标 4m 内的连续重发（指挥层周期重刷）只记一次计数。
// ============================================================

import type { SquadOrderKind } from '../../entity/SwarmUnit';

export interface CommandLogEntry {
  /** 引擎秒（performance.now()/1000） */
  t: number;
  squadId: number;
  kind: SquadOrderKind;
  source: 'engine' | 'leader';
  tx: number;
  tz: number;
  /** 任务名（mission；build/guard/hold/assault/flank/rear…） */
  mission?: string;
  ttl: number;
  /** 同签名重发次数（含本拍；1 = 新命令） */
  n: number;
}

const TARGET_SNAP = 4;

export class CommandLedger {
  /** 环形缓冲（只保留最近命令，诊断用） */
  private ring: CommandLogEntry[] = [];
  /** 同签名去重（队+kind+mission+源+目标 4m） */
  private last = new Map<number, { kind: SquadOrderKind; tx: number; tz: number; mission: string; source: 'engine' | 'leader'; t: number; n: number }>();
  /** 累计命令数（含重发） */
  total = 0;
  /** 累计唯一命令数 */
  unique = 0;
  /** 各 kind 累计（含重发） */
  byKind = new Map<SquadOrderKind, number>();
  /** 各源累计 */
  bySource = { engine: 0, leader: 0 } as Record<'engine' | 'leader', number>;
  /** ★ P2：发令核验不可达 → 缩近/换目标的调账次数（总纲验收"adjusted_unreachable 有账"） */
  adjustedUnreachable = 0;

  /** P2 核验调账：不可达目标被缩近/换目标后才放行 */
  noteAdjustedUnreachable(): void {
    this.adjustedUnreachable++;
  }

  record(
    t: number, squadId: number, kind: SquadOrderKind, source: 'engine' | 'leader',
    tx: number, tz: number, mission: string | undefined, ttl: number,
  ): void {
    this.total++;
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1);
    this.bySource[source]++;
    const m = mission ?? '';
    const prev = this.last.get(squadId);
    if (prev && prev.kind === kind && prev.source === source && prev.mission === m
      && Math.hypot(prev.tx - tx, prev.tz - tz) <= TARGET_SNAP) {
      prev.n++;
      prev.t = t;
      return;   // 周期重发：只累计计数，不进环形台账
    }
    this.unique++;
    this.last.set(squadId, { kind, tx, tz, mission: m, source, t, n: 1 });
    this.ring.push({ t, squadId, kind, source, tx, tz, mission: m || undefined, ttl, n: 1 });
    if (this.ring.length > 2048) this.ring.shift();
  }

  /** ★ 定位"不是引擎下命令的大规模操作"：非引擎来源都在这里 */
  nonEngine(): CommandLogEntry[] {
    return this.ring.filter((e) => e.source !== 'engine');
  }

  /** 最近命令（先新后旧） */
  recent(limit = 48): CommandLogEntry[] {
    const out = this.ring.slice(-limit).reverse();
    return out;
  }

  /** 自 t 秒后的唯一命令（每队最新一条） */
  latestPerSquad(limit = 200): CommandLogEntry[] {
    const map = new Map<number, CommandLogEntry>();
    for (const e of this.ring) map.set(e.squadId, e);
    return [...map.values()].slice(-limit).reverse();
  }

  /** 汇总快照（输出/断言用） */
  snap(): {
    total: number; unique: number; engine: number; leader: number;
    kinds: Record<string, number>; adjusted: number;
  } {
    const kinds: Record<string, number> = {};
    for (const [k, v] of this.byKind) kinds[k] = v;
    return {
      total: this.total, unique: this.unique,
      engine: this.bySource.engine, leader: this.bySource.leader,
      kinds, adjusted: this.adjustedUnreachable,
    };
  }
}