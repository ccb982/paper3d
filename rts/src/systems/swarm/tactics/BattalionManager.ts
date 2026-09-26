// ============================================================
// tactics/BattalionManager —— 大队管理器（《RTS架构.md》§2.12 ②；用户定 2026-09-26）
// ============================================================
// 大队编制（~30 人/大队）= 若干小队（近战/远程/工兵/飞行按配比）。
// · **小队情况表**（数据源只读单源）：SquadTable（成员/领队）+ SquadManager（位置/原子/阶段/
//   进度/静止/血比）+ Ledger（伤亡缺口）。
// · **按情况部署**：缺编先补员/补队；按主攻扇区缺口表配类型；**全局去重**（一小队只投一区、
//   同区同类小队不超配额）；满编优先。
// · 只做编制/部署计划；**不直接发令**（发令唯一出口仍是 engine/OrderWriter）。
// ============================================================

/** 大队编制（人） */
export const BATTALION_SIZE = 30;
/** 战斗小队满编（与 SquadTable.SQUAD_MAX 同口径） */
export const SQUAD_FULL_COMBAT = 12;
/** 工兵小队满编（与 SquadTable.BUILDER_SQUAD_MAX 同口径） */
export const SQUAD_FULL_BUILDER = 3;

export type Role4 = 'engineer' | 'melee' | 'ranged' | 'flyer';

/** 只读入参（结构最小面；便于自检注入） */
export interface SquadLite { id: number; role: Role4; alive: number; x: number; z: number; atom?: string; phase?: string; progress?: number; stillS?: number; }

export interface SquadSituation {
  id: number;
  role: Role4;
  alive: number;
  full: number;
  ratio: number;
  gap: number;
  x: number;
  z: number;
  atom: string;
  phase: string;
  progress: number;
  stillS: number;
  battalionId: number;
  sector: number;
}

export interface BattalionView {
  id: number;
  squadIds: number[];
  alive: number;
  full: number;
  sector: number;
}

const FULL_OF = (role: Role4): number => (role === 'engineer' ? SQUAD_FULL_BUILDER : SQUAD_FULL_COMBAT);

export class BattalionManager {
  /** 大队视图（regroup 重建） */
  battalions: BattalionView[] = [];
  /** 小队情况表（refresh 重建） */
  readonly situation = new Map<number, SquadSituation>();
  /** 部署计划：小队 → 主攻扇区（-1 = 未部署） */
  readonly deployPlan = new Map<number, number>();
  /** 每扇区兵种配额（缺口补齐的上限；用户可调） */
  quotaOf: (role: Role4) => number = (role) => (role === 'melee' ? 2 : role === 'ranged' ? 1 : role === 'engineer' ? 1 : 1);
  readonly dbg = { squads: 0, battalions: 0, deployed: 0, gapTotal: 0, last: '' };

  /** ① 花名册/情况表刷新（只读数据源；每拍/低频调用） */
  refresh(squads: Iterable<SquadLite>): void {
    this.situation.clear();
    const list = [...squads];
    for (const s of list) {
      const full = FULL_OF(s.role);
      const alive = Math.max(0, s.alive | 0);
      const sit: SquadSituation = {
        id: s.id, role: s.role, alive, full, ratio: full > 0 ? Math.min(1, alive / full) : 0,
        gap: Math.max(0, full - alive), x: s.x, z: s.z,
        atom: s.atom ?? '-', phase: s.phase ?? '-', progress: s.progress ?? 0, stillS: s.stillS ?? 0,
        battalionId: -1, sector: this.deployPlan.get(s.id) ?? -1,
      };
      this.situation.set(s.id, sit);
    }
    this.dbg.squads = this.situation.size;
  }

  /** ② 编队：按 ~BATTALION_SIZE 人装箱（**不拆小队**；同兵种优先聚团；稳序） */
  regroup(): void {
    const byRole = new Map<Role4, SquadSituation[]>();
    for (const sit of this.situation.values()) {
      let a = byRole.get(sit.role);
      if (!a) { a = []; byRole.set(sit.role, a); }
      a.push(sit);
    }
    const order: Role4[] = ['melee', 'ranged', 'engineer', 'flyer'];
    const out: BattalionView[] = [];
    let nextId = 1;
    for (const role of order) {
      const list = byRole.get(role) ?? [];
      for (const sit of list) {
        let placed = false;
        for (const b of out) {
          if (b.alive + sit.alive <= BATTALION_SIZE) {
            b.squadIds.push(sit.id); b.alive += sit.alive; b.full += sit.full;
            sit.battalionId = b.id;
            placed = true;
            break;
          }
        }
        if (!placed) {
          out.push({ id: nextId++, squadIds: [sit.id], alive: sit.alive, full: sit.full, sector: -1 });
          sit.battalionId = out[out.length - 1]!.id;
        }
      }
    }
    this.battalions = out;
    this.dbg.battalions = out.length;
  }

  /** ③ 部署（去重 + 缺口优先）：
   *  主攻扇区列表 + 各扇区到主攻的队选择（一轮贪婪）：
   *   · 满编（ratio 高）且 not 部署 → 优先填空缺；
   *   · 每扇区同类小队 ≤ quotaOf；
   *   · 一小队只投一区（deployPlan 唯一）。 */
  deploy(mainSectors: readonly number[]): void {
    const used = new Map<number, Map<Role4, number>>();   // sector → role → count
    for (const sec of mainSectors) used.set(sec, new Map());
    // 已部署的队：若扇区仍在主攻列表内则保留（粘性）；否则释放
    for (const [sid, sec] of [...this.deployPlan]) {
      const sit = this.situation.get(sid);
      if (!sit || !used.has(sec)) { this.deployPlan.delete(sid); continue; }
      const m = used.get(sec)!;
      m.set(sit.role, (m.get(sit.role) ?? 0) + 1);
    }
    // 待部署：满编优先、其次人数多（战斗力）
    const pending = [...this.situation.values()]
      .filter((s) => !this.deployPlan.has(s.id) && s.alive > 0)
      .sort((a, b) => (b.ratio - a.ratio) || (b.alive - a.alive) || (a.id - b.id));
    for (const sit of pending) {
      let best = -1, bestScore = -Infinity;
      for (const sec of mainSectors) {
        const m = used.get(sec)!;
        const cur = m.get(sit.role) ?? 0;
        const quota = this.quotaOf(sit.role);
        const gapPenalty = cur >= quota ? 1000 : cur;      // 超配额重罚
        const score = -gapPenalty - sec * 1e-3;   // 稳序：扇区序号小优先
        if (score > bestScore) { bestScore = score; best = sec; }
      }
      if (best < 0) break;
      this.deployPlan.set(sit.id, best);
      const m = used.get(best)!;
      m.set(sit.role, (m.get(sit.role) ?? 0) + 1);
      sit.sector = best;
    }
    for (const sit of this.situation.values()) sit.sector = this.deployPlan.get(sit.id) ?? -1;
    this.dbg.deployed = this.deployPlan.size;
  }

  /** ④ 缺口表（主攻扇区 × 兵种 → 还缺多少满编）：供 roster/spawn 补员/补队 */
  gaps(mainSectors: readonly number[]): Map<number, Map<Role4, number>> {
    const assigned = new Map<number, Map<Role4, { alive: number; full: number }>>();
    for (const sec of mainSectors) assigned.set(sec, new Map());
    for (const sit of this.situation.values()) {
      const sec = this.deployPlan.get(sit.id);
      if (sec === undefined || !assigned.has(sec)) continue;
      const m = assigned.get(sec)!;
      const cur = m.get(sit.role) ?? { alive: 0, full: 0 };
      cur.alive += sit.alive; cur.full += sit.full;
      m.set(sit.role, cur);
    }
    const out = new Map<number, Map<Role4, number>>();
    for (const [sec, m] of assigned) {
      const g = new Map<Role4, number>();
      for (const role of ['melee', 'ranged', 'engineer', 'flyer'] as Role4[]) {
        const quota = this.quotaOf(role) * FULL_OF(role);
        if (quota <= 0) continue;
        const cur = m.get(role)?.alive ?? 0;
        const need = Math.max(0, quota - cur);
        if (need > 0) g.set(role, need);
      }
      out.set(sec, g);
    }
    this.dbg.gapTotal = [...out.values()].reduce((n, g) => n + [...g.values()].reduce((a, b) => a + b, 0), 0);
    return out;
  }

  clear(): void {
    this.battalions = [];
    this.situation.clear();
    this.deployPlan.clear();
    this.dbg.squads = 0; this.dbg.battalions = 0; this.dbg.deployed = 0; this.dbg.gapTotal = 0; this.dbg.last = '';
  }
}
