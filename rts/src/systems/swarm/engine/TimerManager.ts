// ============================================================
// engine/TimerManager —— 统一实体计时管理器（重写 P1；用户定 2026-09-24）
// ============================================================
// 用户口径：**计时销毁所有实体都做** → 提取专门管理器，一处管理全部实体计时：
//   · 卡死窗口（净活动范围包围盒；语义与 STUCK 完全一致——从严，不改口径）
//   · 计时销毁 / 寿命（deadline → onExpire；含 despawn 类）
//   · 开火许可闩锁（AttackQueues 置/撤；允许后持续开火直到许可去除）
// 实体只"上报/被查询"，不自己开表；本管理器是引擎侧（实体层不依赖 systems）。
// 探针契约：readonly dbg（G9）。
// ============================================================

import { STUCK } from '../SwarmConfig';

export interface TimerHost {
  /** 在册实体 uid 花名册（引擎/池提供；1Hz 迭代） */
  roster(): readonly number[];
  /** 实体当前位置（不在册 → null） */
  posOf(uid: number): { x: number; z: number } | null;
  /** 当前豁免卡死判定的原因（驻守 / 交战中 / 已到位…）；null = 不豁免 */
  exemptOf(uid: number): string | null;
  /** 到期回收（卡死 / 寿命） */
  onExpire(uid: number, why: string): void;
}

interface StuckWin {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  t: number;
}

export class TimerManager {
  private readonly stuck = new Map<number, StuckWin>();
  private readonly deadlines = new Map<number, { at: number; why: string }>();
  private readonly fireLatch = new Set<number>();
  /** 探针契约（G9）：每次 tick 重置计数；latched/expiredTotal/stuckTotal/lifeTotal = 累计 */
  readonly dbg = { tracked: 0, exempt: 0, window: 0, expired: 0, expiredTotal: 0, stuckTotal: 0, lifeTotal: 0, latched: 0, last: '' };

  constructor(private readonly h: TimerHost) {}

  /** 1Hz：寿命到期检查 + 卡死窗口推进（now = 实秒） */
  tick(now: number): void {
    const dbg = this.dbg;
    dbg.tracked = 0;
    dbg.exempt = 0;
    dbg.window = 0;
    dbg.expired = 0;

    // ---- 计时销毁 / 寿命 ----
    for (const [uid, d] of this.deadlines) {
      if (now < d.at) continue;
      this.deadlines.delete(uid);
      this.forget(uid);
      dbg.expired++;
      dbg.expiredTotal++;
      dbg.lifeTotal++;
      dbg.last = `despawn#${uid}:${d.why}`;
      this.h.onExpire(uid, d.why);
    }

    // ---- 卡死窗口（口径（卡死回收已并入本管理器）：包围盒 > BBOX_R 即逃逸重开；连续 HOLD_S → 回收） ----
    for (const uid of this.h.roster()) {
      const p = this.h.posOf(uid);
      if (!p) {
        this.stuck.delete(uid);
        continue;
      }
      const why = this.h.exemptOf(uid);
      if (why) {
        this.stuck.delete(uid);
        dbg.exempt++;
        continue;
      }
      const rec = this.stuck.get(uid);
      if (!rec) {
        this.stuck.set(uid, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z, t: 0 });
        continue;
      }
      if (p.x < rec.minX) rec.minX = p.x;
      else if (p.x > rec.maxX) rec.maxX = p.x;
      if (p.z < rec.minZ) rec.minZ = p.z;
      else if (p.z > rec.maxZ) rec.maxZ = p.z;
      rec.t += 1;
      dbg.tracked++;
      if (rec.maxX - rec.minX > STUCK.BBOX_R || rec.maxZ - rec.minZ > STUCK.BBOX_R) {
        rec.minX = rec.maxX = p.x;
        rec.minZ = rec.maxZ = p.z;
        rec.t = 0;
        dbg.window++;
        continue;
      }
      if (rec.t >= STUCK.HOLD_S) {
        dbg.last = `stuck#${uid} bbox=${(rec.maxX - rec.minX).toFixed(1)}x${(rec.maxZ - rec.minZ).toFixed(1)}`;
        this.forget(uid);
        dbg.expired++;
        dbg.expiredTotal++;
        dbg.stuckTotal++;
        this.h.onExpire(uid, 'stuck');
      }
    }
    if (this.stuck.size > 4096) this.stuck.clear();   // 防漏（同旧口径）
  }

  /** 计时销毁登记（at = 实秒时刻；重复登记覆盖） */
  setDeadline(uid: number, at: number, why: string): void {
    this.deadlines.set(uid, { at, why });
  }

  /** 开火许可闩锁：true=允许（持续开火，直到撤除）；false=撤除 */
  allowFire(uid: number, on: boolean): void {
    if (on) {
      if (!this.fireLatch.has(uid)) {
        this.fireLatch.add(uid);
        this.dbg.latched++;
      }
    } else {
      this.fireLatch.delete(uid);
    }
  }

  canFire(uid: number): boolean {
    return this.fireLatch.has(uid);
  }

  /** 卡死判定中（已连续 HOLD_S；探针/调试用） */
  stuckOf(uid: number): boolean {
    const rec = this.stuck.get(uid);
    return rec !== undefined && rec.t >= STUCK.HOLD_S;
  }

  /** 离场清理（卡死窗口 / 寿命 / 开火闩锁） */
  forget(uid: number): void {
    this.stuck.delete(uid);
    this.deadlines.delete(uid);
    this.fireLatch.delete(uid);
  }

  clear(): void {
    this.stuck.clear();
    this.deadlines.clear();
    this.fireLatch.clear();
  }
}
