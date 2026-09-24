// ============================================================
// engine/SquadManager —— 小队管理器（重写 P3；用户定 2026-09-24）
// ============================================================
// **每队一条记录**（禁散 Map）：id / 兵种 / 存活 / 最近汇报（位置+原子+阶段）。
// 职责：
//   · 接收小队**自动状态汇报**（SquadReport）——引擎只记录，不逐拍指挥
//   · 为 防区 / 兵种管理器 / UI / 探针 提供查询（编成真源）
// 纯数据（无 three/无 services）→ 可独立自检。
// ============================================================

import type { AtomicKind, MobRole, OrderPhase, SquadReport } from './contracts';

export interface SquadRecord {
  id: number;
  role: MobRole;
  alive: number;
  /** 最近汇报（队长位置 / 当前原子 / 命令阶段 / 汇报时刻） */
  x: number;
  z: number;
  atom: AtomicKind;
  phase: OrderPhase;
  /** 队长自报：命令进度 0~1 / 静止时长（实秒） */
  progress: number;
  stillS: number;
  lastReport: number;
  /** 累计汇报数（探针/调试） */
  reports: number;
}

export class SquadManager {
  private readonly recs = new Map<number, SquadRecord>();
  /** 探针契约（G9） */
  readonly dbg = {
    count: 0,
    engineer: 0, melee: 0, ranged: 0, flyer: 0,
    stale: 0, last: '',
  };

  register(id: number, role: MobRole, alive: number, now: number): SquadRecord {
    const rec: SquadRecord = {
      id, role, alive,
      x: 0, z: 0, atom: 'act', phase: 'issued',
      progress: 0, stillS: 0,
      lastReport: now, reports: 0,
    };
    this.recs.set(id, rec);
    this.syncDbg();
    return rec;
  }

  remove(id: number): void {
    this.recs.delete(id);
    this.syncDbg();
  }

  /** 小队自动汇报入口（队长 → 引擎；位置同时进 Positions 由引擎接线） */
  report(r: SquadReport, now: number): void {
    const rec = this.recs.get(r.squadId);
    if (!rec) return;
    rec.x = r.x;
    rec.z = r.z;
    rec.alive = r.alive;
    rec.atom = r.atom;
    rec.phase = r.phase;
    if (r.progress !== undefined) rec.progress = r.progress;
    if (r.stillS !== undefined) rec.stillS = r.stillS;
    rec.lastReport = now;
    rec.reports++;
    this.dbg.last = `#${r.squadId} ${r.atom}/${r.phase} alive=${r.alive} @${r.x.toFixed(0)},${r.z.toFixed(0)}`;
  }

  get(id: number): SquadRecord | undefined {
    return this.recs.get(id);
  }

  all(): IterableIterator<SquadRecord> {
    return this.recs.values();
  }

  /** 存活总数（防区/引擎消费） */
  aliveOf(role?: MobRole): number {
    let n = 0;
    for (const r of this.recs.values()) {
      if (role && r.role !== role) continue;
      n += r.alive;
    }
    return n;
  }

  /** 兵种小队数（四兵种管理器消费） */
  countOf(role: MobRole): number {
    let n = 0;
    for (const r of this.recs.values()) if (r.role === role) n++;
    return n;
  }

  /** 过期检查（staleAfter 秒无汇报 → 计 stale；探针/引擎重派依据） */
  tick(now: number, staleAfter: number): void {
    this.dbg.stale = 0;
    for (const r of this.recs.values()) {
      if (r.reports > 0 && now - r.lastReport > staleAfter) this.dbg.stale++;
    }
  }

  private syncDbg(): void {
    const d = this.dbg;
    d.count = this.recs.size;
    d.engineer = 0;
    d.melee = 0;
    d.ranged = 0;
    d.flyer = 0;
    for (const r of this.recs.values()) d[r.role]++;
  }

  clear(): void {
    this.recs.clear();
    this.syncDbg();
  }
}
