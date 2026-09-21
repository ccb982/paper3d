// ============================================================
// MemberTaskNav —— 成员任务走廊（基础寻路保证；从 SwarmSystem 抽出）
// ============================================================
// 任务目标直行可达 → null（快速直线）；直行撞墙 → A* 求走廊 waypoint 沿线滚动；
// 求解失败 → null（回落直线，steer 危险探测兜底，绝不停摆）。
// 走廊按目标格缓存（同块多成员复用一次求解）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { SquadPathFinder } from './SquadPath';

export class MemberTaskNav {
  private readonly finder = new SquadPathFinder();
  /** uid → 目标记忆（目标位移 >6m 重算直行探测） */
  private readonly goals = new Map<number, { gx: number; gz: number; blocked: boolean }>();
  private readonly idxs = new Map<number, number>();
  private readonly paths = new Map<string, { x: number; z: number }[]>();

  constructor(private readonly blockedAt: (x: number, z: number) => boolean) {}

  /** 取本拍走廊 waypoint；直行可达 / 求解失败 → null */
  waypoint(uid: number, gx: number, gz: number, px: number, pz: number): { x: number; z: number } | null {
    let g = this.goals.get(uid);
    if (!g || Math.hypot(g.gx - gx, g.gz - gz) > 6) {
      const blocked = this.lineBlocked(px, pz, gx, gz);
      g = { gx, gz, blocked };
      this.goals.set(uid, g);
      if (!blocked) this.paths.delete(this.key(gx, gz));
    }
    if (!g.blocked) return null;
    const key = this.key(gx, gz);
    let path = this.paths.get(key);
    if (!path) {
      if (this.paths.size > 96) this.paths.clear();
      const attempt: { x: number; z: number }[] = [];
      const raster = RasterMap.current;
      const ok = raster && this.finder.find(raster, px, pz, gx, gz, attempt);
      if (!ok) return null;   // 求解失败 → 直行（steer 危险探测兜底）
      path = attempt;
      this.paths.set(key, path);
    }
    let idx = this.idxs.get(uid) ?? 0;
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
    this.goals.clear(); this.idxs.clear(); this.paths.clear();
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
