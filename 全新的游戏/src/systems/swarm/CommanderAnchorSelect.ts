// ============================================================
// CommanderAnchorSelect —— 岗位 / 护工 / 掩体驻守锚点选择（自 SwarmCommander 拆出，控行数）
// ============================================================
//   · ensurePosts：新队 → 就近未认领岗（一次定终身，杜绝每拍轮转 → 左右摆）
//   · escortAnchor：非工兵队 → 粘性配对工程队（失效换最近）
//   · updateCoverHolders：远程队维护"选哪面掩体"（引擎只选保护对象；站位个体自算）
//   · pickHighGroundNear / garrisonCovers / rangedAnchor：有利位查询
// 依赖经 AnchorDeps 注入（plan/工事表/地形表/工兵链）——真源仍在 SwarmCommander。
// ============================================================

import type { DefensePlan } from './LandingTerrain';
import type { BuildPiece } from './EngineerCorps';

interface Pos { x: number; z: number }

export interface AnchorDeps {
  plan: () => DefensePlan | null;
  squadExists: (id: number) => boolean;
  holeCovers: () => readonly Pos[];
  bestTrenchNear: (x: number, z: number, r: number) => Pos | null;
  corpsPieces: () => readonly BuildPiece[];
}

export class AnchorSelect {
  /** ★ 每队稳定岗位（squadId → 岗哨/高地/掩体位/战壕；拆队前一直有效） */
  readonly post = new Map<number, Pos>();
  /** ★ S1 护工：非工兵队 → 被保护的工程队（粘性配对；squadId → builder squadId） */
  readonly escort = new Map<number, number>();
  /** ★ 掩体驻守（远程，每帧更新）：squadId → { 掩体中心, 战壕位（掩体外侧 5m） } */
  readonly coverHolders = new Map<number, { cx: number; cz: number; x: number; z: number }>();

  constructor(private readonly d: AnchorDeps) {}

  /** 换落点/退出清理 */
  reset(): void {
    this.post.clear();
    this.escort.clear();
    this.coverHolders.clear();
  }

  /** ★ 取离 (x,z) 最近的高地（半径内；无 = null）——远程队占顶用 */
  pickHighGroundNear(
    plan: DefensePlan, x: number, z: number, radius: number,
  ): { x: number; z: number; h: number } | null {
    let best: { x: number; z: number; h: number } | null = null;
    let bestD2 = radius * radius;
    for (const g of plan.highGround) {
      const d2 = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d2 <= bestD2) { bestD2 = d2; best = g; }
    }
    return best;
  }

  /** ★ 远程驻守点（掩体后侧）：已建掩体 > 规划掩体位；点在"掩体背向来向"一侧 1.2m。
   *  requireInRange = 只取距玩家 ≤48m 的（保证驻守点能射到玩家）；按距玩家近→远排序。 */
  garrisonCovers(
    plan: DefensePlan, playerX: number, playerZ: number, requireInRange: boolean,
  ): { x: number; z: number }[] {
    const out: { x: number; z: number; d2: number }[] = [];
    const add = (x: number, z: number): void => {
      const bx = x - plan.approachX * 1.2;
      const bz = z - plan.approachZ * 1.2;
      const d2 = (bx - playerX) ** 2 + (bz - playerZ) ** 2;
      if (requireInRange && d2 > 48 * 48) return;
      out.push({ x: bx, z: bz, d2 });
    };
    for (const c of this.d.holeCovers()) add(c.x, c.z);
    // ★ 扫描产物（有利位置）优先作为驻守点；coverSlots 兜底
    for (const p of plan.posts) add(p.x, p.z);
    for (const c of plan.coverSlots) add(c.x, c.z);
    // ★ 战壕也是驻守点（全兵种偏好；前线附近取一格）
    const tr = this.d.bestTrenchNear(
      plan.cx + plan.approachX * 45, plan.cz + plan.approachZ * 45, 35);
    if (tr) add(tr.x, tr.z);
    out.sort((a, b) => a.d2 - b.d2);
    return out.map((o) => ({ x: o.x, z: o.z }));
  }

  /** ★ 岗位分派：新队 → 就近未被认领的岗（一次定终身，杜绝每拍轮转 → 左右摆）
   *  ★ 兵种投影：盾队优先**隘口**（窄口吃线），其余按 高地/掩体位/战壕 */
  ensurePosts(
    squads: readonly { id: number; type: string; members: Map<number, { x: number; z: number }> }[],
  ): void {
    const plan = this.d.plan();
    if (!plan) return;
    const missing = squads.filter((s) => !this.post.has(s.id));
    if (missing.length === 0) return;
    const posts: Pos[] = [];
    for (const c of plan.chokepoints) posts.push({ x: c.x, z: c.z });
    const chokeN = posts.length;
    for (const g of plan.highGround) posts.push({ x: g.x, z: g.z });
    for (const p of plan.posts) posts.push({ x: p.x, z: p.z });
    for (const line of plan.trenchLines) for (const p of line) posts.push(p);
    if (posts.length === 0) return;
    const claimed = new Set<number>();
    for (const [, pos] of this.post) {
      for (let i = 0; i < posts.length; i++) {
        if (posts[i].x === pos.x && posts[i].z === pos.z) { claimed.add(i); break; }
      }
    }
    for (const s of missing) {
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n === 0) continue;
      cx /= n; cz /= n;
      let bi = -1, bd = Infinity;
      if (s.type === 'defense') {
        for (let i = 0; i < chokeN; i++) {
          if (claimed.has(i)) continue;
          const d = (posts[i].x - cx) ** 2 + (posts[i].z - cz) ** 2;
          if (d < bd && d < 80 * 80) { bd = d; bi = i; }
        }
      }
      if (bi < 0) {
        bd = Infinity;
        for (let i = 0; i < posts.length; i++) {
          if (claimed.has(i)) continue;
          const d = (posts[i].x - cx) ** 2 + (posts[i].z - cz) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
      }
      if (bi < 0) bi = 0;   // 岗全被认领 → 允许共用最近岗
      if (bi >= 0) { claimed.add(bi); this.post.set(s.id, { x: posts[bi].x, z: posts[bi].z }); }
    }
  }

  /** ★ S1 护工：给非工兵队粘性配对一只工程队（返回其质心作为护锚；失效则换最近） */
  escortAnchor(
    squadId: number, cx: number, cz: number, engCent: Map<number, Pos>,
  ): Pos | null {
    let pick = this.escort.get(squadId) ?? -1;
    if (pick < 0 || !engCent.has(pick)) {
      pick = -1;
      let bd = Infinity;
      for (const [id, c] of engCent) {
        const d = (c.x - cx) ** 2 + (c.z - cz) ** 2;
        if (d < bd) { bd = d; pick = id; }
      }
      if (pick < 0) return null;
      this.escort.set(squadId, pick);
    }
    return engCent.get(pick) ?? null;
  }

  /** ★ 掩体驻守（远程）：每帧维护"选哪面掩体"（引擎只选**保护对象**；站位由个体绕掩体自算）。
   *  选择判据：距玩家 8~75m（够近能打/够远不被贴脸）× 距本队 ≤70m；被击/无掩体则不驻。
   *  命令下发时附带玩家位置（threat），个体据此绕掩体保持遮挡（《敌人管线设计.md》§3.2.1）。 */
  updateCoverHolders(
    squads: readonly { id: number; type: string; builders: boolean; members: Map<number, Pos> }[],
    playerX: number, playerZ: number,
  ): void {
    for (const id of [...this.coverHolders.keys()]) {
      if (!this.d.squadExists(id)) this.coverHolders.delete(id);
    }
    let covers: Pos[] | null = null;
    for (const s of squads) {
      if (s.type !== 'ranged' || s.builders) continue;
      let scx = 0, scz = 0, n = 0;
      for (const m of s.members.values()) { scx += m.x; scz += m.z; n++; }
      if (n === 0) continue;
      scx /= n; scz /= n;
      // ★ 收口：AI 掩体选点统一读 **L2 工事表**（HoleTable.covers = 战壕掩体同一张表）
      if (!covers) covers = this.d.holeCovers().map((c) => ({ x: c.x, z: c.z }));
      if (covers.length === 0) { this.coverHolders.delete(s.id); continue; }
      const ok = (cx: number, cz: number): boolean => {
        const dp = Math.hypot(cx - playerX, cz - playerZ);
        const ds = Math.hypot(cx - scx, cz - scz);
        return dp >= 8 && dp <= 75 && ds <= 70;
      };
      // ★ 站位 = 掩体朝**外**（远离舰船/落点中心）5m = 掩体后方的战壕位（用户定调）
      const plan = this.d.plan();
      if (!plan) return;
      const standOf = (cx: number, cz: number): Pos => {
        const dx = cx - plan.cx, dz = cz - plan.cz;
        const dl = Math.hypot(dx, dz) || 1;
        return { x: cx + (dx / dl) * 5, z: cz + (dz / dl) * 5 };
      };
      // ★ 评分：近队 + 靠前（贴玩家方向推进，太近扣分）+ 配对掩体（后方有战壕）
      const scoreOf = (cx: number, cz: number): number => {
        const st = standOf(cx, cz);
        const paired = this.d.corpsPieces().some((q) => q.kind === 'trench'
          && (q.x - st.x) ** 2 + (q.z - st.z) ** 2 <= 20);
        const dSquad = Math.hypot(cx - scx, cz - scz);
        const dPlayer = Math.hypot(cx - playerX, cz - playerZ);
        return dSquad + Math.max(0, dPlayer - 45) * 3 + Math.max(0, 18 - dPlayer) * 2 + (paired ? 0 : 60);
      };
      let best: { cx: number; cz: number; x: number; z: number } | null = null;
      let bestScore = Infinity;
      for (const c of covers) {
        if (!ok(c.x, c.z)) continue;
        const sc = scoreOf(c.x, c.z);
        if (sc < bestScore) {
          bestScore = sc;
          const st = standOf(c.x, c.z);
          best = { cx: c.x, cz: c.z, x: st.x, z: st.z };
        }
      }
      const held = this.coverHolders.get(s.id);
      if (held && ok(held.cx, held.cz)) {
        const heldScore = scoreOf(held.cx, held.cz);
        // ★ 及时调整：现掩体仍够好（优 12 分内）→ 守；出现明显更优（更靠前/更配对）→ 换
        if (bestScore > heldScore - 6) continue;
      }
      if (best) this.coverHolders.set(s.id, best);
      else this.coverHolders.delete(s.id);
    }
  }

  /** ★ 总攻护栏锚：离正面最近的远程小队质心（工兵/护卫以此为"工地"→ 给射手打掩护） */
  rangedAnchor(
    squads: readonly { type: string; members: Map<number, Pos> }[],
    front: Pos,
  ): Pos | null {
    let bx = 0, bz = 0, bd = Infinity, found = false;
    for (const s of squads) {
      if (s.type !== 'ranged') continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n === 0) continue;
      cx /= n; cz /= n;
      const d = (cx - front.x) ** 2 + (cz - front.z) ** 2;
      if (d < bd) { bd = d; bx = cx; bz = cz; found = true; }
    }
    return found ? { x: bx, z: bz } : null;
  }
}
