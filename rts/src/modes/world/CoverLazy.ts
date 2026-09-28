// ============================================================
// modes/world/CoverLazy —— 敌方工事"懒更新"（用户定 2026-09-27）
// ============================================================
// 口径（《移动执行重写.md》§7.4）：
//   · 远处工事（掩体/墙）**只写地图数据**（不进实体/网格/物理）；
//   · **玩家或相机走近**（≤ 半径）再**物化**（建实体）；
//   · 取二者更近者判定；每拍限预算，防走近瞬间批量建实体卡帧。
// 说明：物化前工事不在 StaticObstacleRegistry（路径不挡）；进入 L3 半径前必物化，
//   与外观/碰撞的可见时机一致。
// ============================================================

export type CoverLazyVariant = 'cover' | 'wall';

export class CoverLazy {
  /** 待物化（只存数据：位置+类型） */
  private readonly pending: { x: number; z: number; v: CoverLazyVariant }[] = [];
  /** 探针：queued = 只记数据次数 / realized = 物化次数 */
  readonly dbg = { queued: 0, realized: 0 };

  constructor(private readonly build: (x: number, z: number, v: CoverLazyVariant) => void) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /** 建造入口：近 → 立即物化；远 → 只记数据（懒更新） */
  queueOrBuild(x: number, z: number, v: CoverLazyVariant, px: number, pz: number, cx: number, cz: number, r: number): void {
    const d = Math.min(Math.hypot(x - px, z - pz), Math.hypot(x - cx, z - cz));
    if (d <= r) {
      this.build(x, z, v);
      this.dbg.realized++;
    } else {
      this.pending.push({ x, z, v });
      this.dbg.queued++;
    }
  }

  /** 探针：瞄一眼队首待物化（不改状态） */
  peek(): { x: number; z: number; v: CoverLazyVariant } | null {
    return this.pending[0] ?? null;
  }

  /** 每拍物化：玩家/相机更近者 ≤ r → 建实体（限预算，离屏也不丢） */
  realize(px: number, pz: number, cx: number, cz: number, r: number, budget = 4): void {
    if (this.pending.length === 0) return;
    for (let i = this.pending.length - 1; i >= 0 && budget > 0; i--) {
      const c = this.pending[i]!;
      const d = Math.min(Math.hypot(c.x - px, c.z - pz), Math.hypot(c.x - cx, c.z - cz));
      if (d > r) continue;
      this.pending.splice(i, 1);
      this.build(c.x, c.z, c.v);
      this.dbg.realized++;
      budget--;
    }
  }
}
