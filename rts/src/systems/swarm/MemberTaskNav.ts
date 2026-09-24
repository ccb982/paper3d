// ============================================================
// MemberTaskNav —— 成员任务走廊（基础寻路保证；从 SwarmSystem 抽出）
// ============================================================
// 任务目标直行可达 → null（快速直线）；直行撞墙 → A* 求走廊 waypoint 沿线滚动；
// 求解失败 → null（回落直线，steer 危险探测兜底，绝不停摆）。
// 走廊按目标格缓存（同块多成员复用一次求解）。
// ★ 2026-09-22 寻路增强（治"80% 的兵转圈后销毁"）：
//   ① 直行判定定时复核（过时的"可达"会让兵直撞墙 → steer 否决 → 原地抽风）；
//   ② 偏离走廊恢复：成员离共享走廊 >12m（召回/重生/被挤远）→ 从**当前位置**
//      重解，不再被陈旧走廊拉回起点区域白转。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { SquadPathFinder } from './nav/Corridor';
import { FeasibilityPath } from './nav/LongPath';
import type { PassTable } from './nav/PassTable';

export class MemberTaskNav {
  private readonly finder = new SquadPathFinder();
  /** ★ N1 薄层化：可行性寻路（有表时替代自带 A*；恒权·有向） */
  private feas: FeasibilityPath | null = null;

  /** ★ N1：接可行性表（表就绪 → 任务走廊直接走可行性寻路） */
  setPathTable(t: PassTable | null): void {
    if (!t) { this.feas = null; return; }
    this.feas = new FeasibilityPath();
    this.feas.setTable(t);
  }
  /** uid → 目标记忆（目标位移 >6m 重算直行探测；blocked=timed 复核直行可达性；failUntil=失败冷却） */
  private readonly goals = new Map<number, { gx: number; gz: number; blocked: boolean; at: number; failUntil: number }>();
  private readonly idxs = new Map<number, number>();
  private readonly paths = new Map<string, { x: number; z: number }[]>();
  /** ★ 私有走廊（偏离共享走廊的成员 → 从当前位置重解，仅自用；不删共享防止多成员互相抖动） */
  private readonly own = new Map<number, { x: number; z: number }[]>();
  /** ★ P4 重规划计数（白名单探针：任务走廊重解次数/分钟口径） */
  readonly dbg = { solves: 0, fails: 0, rechecks: 0, deviations: 0 };
  /** ★ 求解失败冷却（ms；治"每拍重试必失败"A* 风暴——白名单纪律：白名单外零重规划） */
  private static readonly FAIL_COOLDOWN_MS = 2000;

  constructor(
    private readonly blockedAt: (x: number, z: number) => boolean,
    private readonly pathMul?: (x: number, z: number) => number,
  ) {}

  /** 取本拍走廊 waypoint；直行可达 / 求解失败 → null */
  waypoint(uid: number, gx: number, gz: number, px: number, pz: number): { x: number; z: number } | null {
    const now = performance.now();
    let g = this.goals.get(uid);
    if (!g || Math.hypot(g.gx - gx, g.gz - gz) > 6) {
      const blocked = this.lineBlocked(px, pz, gx, gz);
      g = { gx, gz, blocked, at: now, failUntil: 0 };
      this.goals.set(uid, g);
      this.own.delete(uid);
      if (!blocked) this.paths.delete(this.key(gx, gz));
    } else if (!g.blocked && now - g.at > 1500) {
      // ★ 直行判定定时复核（1.5s）：初判"可达"会过时（兵被挤开/工事落地）→
      //   变堵就转走廊，不再直撞墙被 steer 否决后原地抽风
      this.dbg.rechecks++;
      g.at = now;
      if (this.lineBlocked(px, pz, gx, gz)) g.blocked = true;
    }
    if (!g.blocked) return null;
    if (g.failUntil > now) return null;   // ★ 失败冷却：白名单外零重规划（防每拍重试风暴）
    const key = this.key(gx, gz);
    let path = this.own.get(uid) ?? this.paths.get(key);
    if (!path) {
      const attempt: { x: number; z: number }[] = [];
      if (this.feas) {
        // ★ N1 薄层化：可行性寻路出私有走廊（按成员位置；'outside' 回落旧 A*）
        const r = this.feas.find(px, pz, gx, gz, attempt);
        if (r === 'blocked') {
          g.failUntil = now + MemberTaskNav.FAIL_COOLDOWN_MS;
          this.dbg.fails++;
          return null;
        }
        if (r === 'ok') {
          this.dbg.solves++;
          if (this.own.size > 512) this.own.clear();
          this.own.set(uid, attempt);
          path = attempt;
        }
      }
      if (!path) {
        if (this.paths.size > 96) this.paths.clear();
        const raster = RasterMap.current;
        const ok = raster && this.finder.find(raster, px, pz, gx, gz, attempt, this.pathMul);
        if (!ok) {
          g.failUntil = now + MemberTaskNav.FAIL_COOLDOWN_MS;
          this.dbg.fails++;
          return null;   // 求解失败 → 直行（steer 危险探测兜底）
        }
        this.dbg.solves++;
        path = attempt;
        this.paths.set(key, path);
      }
    }
    let idx = this.idxs.get(uid) ?? 0;
    if (idx >= path.length) idx = 0;
    // ★ 偏离走廊恢复：成员离走廊**折线**（线段距离，不是节点距离——拉直段节点间距大）
    //   >12m（召回/重生/被挤远）→ 丢弃共享走廊，从当前位置重解
    let near2 = Infinity;
    for (const p of path) {
      const d2 = (p.x - px) ** 2 + (p.z - pz) ** 2;
      if (d2 < near2) near2 = d2;
    }
    for (let k = 0; k + 1 < path.length && near2 > 144; k++) {
      const d2 = segDist2(px, pz, path[k], path[k + 1]);
      if (d2 < near2) near2 = d2;
    }
    if (near2 > 144) {
      this.dbg.deviations++;
      this.idxs.delete(uid);
      const attempt: { x: number; z: number }[] = [];
      let ok = false;
      if (this.feas) {
        ok = this.feas.find(px, pz, gx, gz, attempt) === 'ok';
      } else {
        const raster = RasterMap.current;
        ok = !!(raster && this.finder.find(raster, px, pz, gx, gz, attempt, this.pathMul));
      }
      if (ok) {
        this.dbg.solves++;
        if (this.own.size > 512) this.own.clear();
        this.own.set(uid, attempt);   // ★ 私有走廊：不删共享（防多成员互相重解抖动）
        path = attempt;
        idx = 0;
      } else {
        g.failUntil = now + MemberTaskNav.FAIL_COOLDOWN_MS;
        this.dbg.fails++;
        return null;   // 重解失败 → 直行兜底
      }
    }
    while (idx + 1 < path.length) {
      const w = path[idx + 1];
      if ((w.x - px) ** 2 + (w.z - pz) ** 2 > 2.4 * 2.4) break;
      idx++;
    }
    if (idx >= path.length) {
      this.idxs.delete(uid);
      if (this.goals.size > 512) this.goals.clear();
      return null;
    }
    this.idxs.set(uid, idx);
    return path[idx];
  }

  /** 全清（换落点 / 清场） */
  clear(): void {
    this.goals.clear(); this.idxs.clear(); this.paths.clear(); this.own.clear();
  }

  /** 直行探测：目标到起点直线是否跨硬墙（每 2m 采样） */
  private lineBlocked(px: number, pz: number, gx: number, gz: number): boolean {
    const dx = gx - px, dz = gz - pz;
    const d = Math.hypot(dx, dz);
    const n = Math.ceil(d / 2);
    if (n < 2) return false;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this.blockedAt(px + dx * t, pz + dz * t)) return true;
    }
    return false;
  }

  private key(gx: number, gz: number): string {
    return `${Math.round(gx)},${Math.round(gz)}`;
  }
}

/** 点到线段距离平方（偏离走廊判定用） */
function segDist2(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-6 ? ((px - a.x) * dx + (pz - a.z) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = a.x + dx * t - px, qz = a.z + dz * t - pz;
  return qx * qx + qz * qz;
}
