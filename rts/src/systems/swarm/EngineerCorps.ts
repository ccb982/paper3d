// ============================================================
// EngineerCorps —— 工兵施工链（唯一权威：《工兵架构.md》）
// ============================================================
// 职责：施工目标表（buildPieces）/ 阶段（S0-S2）/ 队级分派（环带作业）/
//       成员分块（MemberTaskBoard）/ 施工执行（挖战壕·造掩体）/ 总攻弃壕。
// 权力边界：只写成员任务与工事端口；**不下发小队命令**（指挥在 SwarmCommander）。
// 方向纪律：防线方向只在落地/换落点时由 DefensePlan 确定，不随玩家/危机度重排。
// 深度纪律：战壕坑底不得低于 -1.2m（不可走硬阈值）→ 到达即封顶（《工兵架构.md》§6）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import type { DefensePlan } from './LandingTerrain';
import type { MemberTaskBoard, TaskSquad } from './MemberTaskBoard';

/** 施工目标块；pri = 施工优先级（**越小越先**：《工兵架构.md》§4） */
export interface BuildPiece {
  kind: 'cover' | 'trench';
  x: number;
  z: number;
  ring: 0 | 1 | 2;
  /** 0 = 前线掩体（战壕前方 5m，先部署） / 1 = 战壕 / 2 = 环上掩体 */
  pri: number;
}

/** 宿主端口（由 SwarmCommander 注入；不反向依赖指挥器内部） */
export interface EngineerHost {
  /** 直线可达性检查（地形硬墙） */
  blockedAt(x: number, z: number): boolean;
  /** 地形脏标记（评分表 + 采样缓存局部重算） */
  markDirty(x: number, z: number, r: number): void;
  /** 造掩体端口（模式层注入；注册表即真源） */
  cover(): ((x: number, z: number, variant: 'cover' | 'wall') => void) | null;
  /** 挖战壕端口（模式层注入；一块 7×7、+1 层≈0.2m） */
  dig(): ((x: number, z: number) => void) | null;
}

/** 战壕挖满遍数 = 目标深度（每遍 ≈0.2m → 5 遍 ≈1.0m；再深受 §6 硬约束封顶） */
const TRENCH_PASSES = 5;
/** ★ 施工计时（用户定 2026-09-25）：到位（15m）就计时，计时满即建成 */
const COVER_TIME_S = 6;
const TRENCH_TIME_S = 10;
const WORK_R2 = 40 * 40;   // ★ 到位半径（40m：工兵抵近即可开工；避免'永远到不了 15m 内'）
/** 施工冷却（真秒；每帧递减） */
const COVER_CD = 0;   // ★ 去掉施工冷却（用户定 2026-09-25：RTS 未接每帧递减 → 冷却永不消，造完一次就再也造不了）
const TRENCH_CD = 0;   // ★ 同上：去掉冷却
/** 坑底硬阈值（低于此高度不可走 → 禁止再挖） */
const FLOOR_MIN = -1.2;
const LAYER = 0.2;

const keyOf = (p: { x: number; z: number }): string => `${p.x},${p.z}`;

export class EngineerCorps {
  /** 阶段：S0 勘察 → S1 施工 → S2 就绪（总攻不回退） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';
  /** 施工目标表（外环→内环；掩体+战壕+前线掩体） */
  pieces: BuildPiece[] = [];
  readonly built = new Set<string>();
  /** ★ 稳步推进闸门（事态函数给）：距此点 < minD 的工件未解锁（minD<=0 = 不限） */
  gate: { x: number; z: number; minD: number } = { x: 0, z: 0, minD: -1 };
  gated(q: { x: number; z: number; pri?: number }): boolean {
    // ★ pri≥3 = 要塞注入件（FortifyPlanner 位置函数输出；已在闸门外环带生成）→ 不受事态闸门锁
    if ((q.pri ?? 0) >= 3) return false;
    const g = this.gate;
    return g.minD > 0 && Math.hypot(q.x - g.x, q.z - g.z) < g.minD;
  }
  readonly passes = new Map<string, number>();
  /** ★ 施工计时（件 key → 秒；2s 拍累加） */
  private readonly workT = new Map<string, number>();
  /** 施工焦点（队伍 ↔ pieces 下标） */
  readonly focus = new Map<number, number>();
  /** 队级稳定分派（squadId → pieces 下标） */
  readonly assign = new Map<number, number>();
  /** 各队施工冷却（squadId → 剩余秒） */
  readonly cds = new Map<number, number>();
  accum = 0;
  /** ★ 施工分工（蜂群引擎指派）：cover = 修掩体班；trench = 挖战壕班；any = 兼顾（只有一个队时） */
  private readonly roles = new Map<number, 'cover' | 'trench' | 'any'>();
  /** ★ 战壕暂停开挖（总攻期等）：**只停派活，不删件**（用户定调：战壕件从不作废） */
  private trenchPaused = false;

  constructor(
    private readonly host: EngineerHost,
    private readonly board: MemberTaskBoard,
  ) {}

  /** 由 DefensePlan 重生成施工目标表（落地/换落点唯一入口） */
  regenerate(plan: DefensePlan): void {
    const ringOrder: (0 | 1 | 2)[] = [2, 1, 0];
    this.pieces = [];
    this.focus.clear();
    const ax = plan.approachX, az = plan.approachZ;
    const tx = -az, tz = ax;   // 切线方向
    // 工程兵优先在**有利位置**（扫描产物评分）施工：同环内按 post 分排序
    const postScore = new Map<string, number>();
    for (const p of plan.posts) postScore.set(`${p.x.toFixed(1)},${p.z.toFixed(1)}`, p.score);
    const scoreOf = (x: number, z: number): number => postScore.get(`${x.toFixed(1)},${z.toFixed(1)}`) ?? 0;
    const raster = RasterMap.current;
    for (const r of ringOrder) {
      const slots = plan.coverSlots.filter((s) => s.ring === r)
        .sort((a, b) => scoreOf(b.x, b.z) - scoreOf(a.x, a.z));
      for (const slot of slots) {
        for (const off of [-4, 0, 4]) {
          this.pieces.push({ kind: 'cover', x: slot.x + tx * off, z: slot.z + tz * off, ring: r, pri: 2 });
        }
      }
      const line = plan.trenchLines[r] ?? [];
      for (const p of line) {
        this.pieces.push({ kind: 'trench', x: p.x, z: p.z, ring: r, pri: 1 });
        // ★ 掩体朝**舰船（落点中心）**方向 5m；战壕留在原位（脚底下）——用户定调
        //   （掩体在前、战壕在后；威胁/玩家从舰船方向来）
        const cdx = plan.cx - p.x, cdz = plan.cz - p.z;
        const cdl = Math.hypot(cdx, cdz) || 1;
        const fx = p.x + (cdx / cdl) * 5, fz = p.z + (cdz / cdl) * 5;
        if (raster) {
          const role = raster.tileDefAt(fx, fz).genRole;
          if (role === 'pit' || role === 'liquid') continue;
          if (raster.surfaceHeightAt(fx, fz) < FLOOR_MIN) continue;
        }
        this.pieces.push({ kind: 'cover', x: fx, z: fz, ring: r, pri: 0 });   // ★ 前线掩体：最先部署
      }
    }
    // ★ 兜底 A：地形没给可用战壕线（某些地形全被拒）→ 用**外环掩位背后 5m** 自造短壕（保证有坑可挖）
    if (!this.pieces.some((q) => q.kind === 'trench')) {
      const slots = plan.coverSlots.filter((sl) => sl.ring === 2)
        .concat(plan.coverSlots.filter((sl) => sl.ring !== 2))
        .slice(0, 6);
      for (const sl of slots) {
        const dx = sl.x - plan.cx, dz = sl.z - plan.cz;
        const dl = Math.hypot(dx, dz) || 1;
        const tx2 = sl.x + (dx / dl) * 5, tz2 = sl.z + (dz / dl) * 5;   // 掩体外侧（背船）= 战壕位
        const role = raster?.tileDefAt(tx2, tz2).genRole;
        if (role === 'pit' || role === 'liquid') continue;
        if (raster && raster.surfaceHeightAt(tx2, tz2) < FLOOR_MIN) continue;
        this.pieces.push({ kind: 'trench', x: tx2, z: tz2, ring: sl.ring, pri: 1 });
      }
    }
    // 兜底 B：地形分析没给出可用点位（开阔地/全被拒）→ 沿来向弧线自造掩体位
    if (this.pieces.length === 0) {
      const a0 = Math.atan2(az, ax);
      for (const r of [2, 1, 0] as const) {
        for (const k of [-2, 0, 2]) {
          const a = a0 + k * 0.35;
          const x = plan.cx + Math.cos(a) * [40, 60, 80][r];
          const z = plan.cz + Math.sin(a) * [40, 60, 80][r];
          const role = raster?.tileDefAt(x, z).genRole;
          if (role === 'pit' || role === 'liquid') continue;
          if (raster && raster.surfaceHeightAt(x, z) < FLOOR_MIN) continue;
          this.pieces.push({ kind: 'cover', x, z, ring: r, pri: 2 });
        }
      }
    }
  }

  /** ★ 引擎指派施工分工（一个队修掩体、其余挖战壕；单队 = 兼顾） */
  setRole(squadId: number, role: 'cover' | 'trench' | 'any'): void {
    this.roles.set(squadId, role);
  }

  /** 战壕暂停/恢复（总攻停挖；件保留，可随时恢复） */
  setTrenchPaused(v: boolean): void {
    this.trenchPaused = v;
  }

  /** 该类工件当前是否可施工（暂停的类不可派、不可挖） */
  canWork(kind: 'cover' | 'trench'): boolean {
    return kind === 'cover' || !this.trenchPaused;
  }

  /** 该队是否可施工该类工件（分工过滤 + 暂停过滤）。
   *  ★ `pri >= 3`（fortify 注入的"补评分件"）**不受分工限制**——谁近谁做，防战壕班空转。 */
  private allows(squadId: number, kind: 'cover' | 'trench', pri?: number): boolean {
    if (!this.canWork(kind)) return false;
    if (pri !== undefined && pri >= 3) return true;
    const r = this.roles.get(squadId) ?? 'any';
    return r === 'any' || r === kind;
  }

  /** 队级分派：保持已派未建块；否则按 **pri 施工优先级** 挑最近未认领块（限本班工件类）。
   *  选择链：前线掩体（0）→ 战壕（1）→ 环掩体（2）；同 pri 取最近。
   *  ★ 2026-09-22 两段挑：先只看本队 50m 内（按 pri），空了才全局按 pri——
   *    防"全局最低 pri = 63m 外前线件"任务瞬移 → 成员半路折返转圈。 */
  assignBuild(squadId: number, cx: number, cz: number): number {
    const cur = this.assign.get(squadId);
    if (cur !== undefined && cur < this.pieces.length
      && !this.built.has(keyOf(this.pieces[cur]))
      && !this.gated(this.pieces[cur])
      && this.allows(squadId, this.pieces[cur].kind, this.pieces[cur].pri)) return cur;
    const claimed = new Set<number>(this.assign.values());
    const pick = (maxD2: number): number => {
      let best = -1, bPri = Infinity, bD = Infinity;
      for (let i = 0; i < this.pieces.length; i++) {
        const q = this.pieces[i];
        if (this.built.has(keyOf(q)) || claimed.has(i)) continue;
        if (this.gated(q)) continue;   // ★ 事态闸门：距舰 < 前沿 → 未解锁
        if (!this.allows(squadId, q.kind, q.pri)) continue;
        if (this.lineBlocked(cx, cz, q.x, q.z)) continue;   // ★ 直线被墙挡 → 不派（防绕障打转/傻站）
        const d = (q.x - cx) ** 2 + (q.z - cz) ** 2;
        if (d > maxD2) continue;
        if (q.pri < bPri) { bPri = q.pri; best = i; bD = d; }
        else if (q.pri === bPri && d < bD) { best = i; bD = d; }
      }
      return best;
    };
    let anyBest = pick(50 * 50);
    if (anyBest < 0) anyBest = pick(Infinity);   // 50m 内无件 → 全局按 pri 兜底
    if (anyBest < 0) return -1;
    this.assign.set(squadId, anyBest);
    return anyBest;
  }

  /** 成员分块（工程并行）：把本队成员分到附近未认领块 → 直写任务目标。
   *  @returns true = 已派/已持有工件任务；false = 附近无可用工件（调用方转站岗） */
  spreadBuilders(s: TaskSquad, cx: number, cz: number): boolean {
    // 战壕工组：已派块是**未建战壕** → 全员按静态环列围住挖到成（不散开抢掩体 → 战壕必成型）
    const aidx = this.assign.get(s.id);
    if (aidx !== undefined && aidx >= 0 && aidx < this.pieces.length) {
      const aq = this.pieces[aidx];
      if (aq.kind === 'trench' && this.allows(s.id, aq.kind, aq.pri) && !this.built.has(keyOf(aq))) {
        let k0 = 0;
        for (const uid of s.members.keys()) {
          const a = (k0++ / s.members.size) * Math.PI * 2;
          this.board.write(uid, aq.x + Math.cos(a), aq.z + Math.sin(a));
        }
        this.board.own(s.id);
        return true;
      }
    }
    // ★ 注入件（pri≥3 = 要塞位置函数输出）→ **直接作焦点**：队长任务（订单目标=件点）已足够，
    //   队友跟队长过来即可；**不写成员任务**（成员任务不驱动移动，construct 只认 5m 近身）
    if (aidx !== undefined && aidx >= 0 && aidx < this.pieces.length) {
      const aq = this.pieces[aidx];
      if (aq.pri >= 3 && this.allows(s.id, aq.kind, aq.pri)
        && !this.built.has(keyOf(aq)) && !this.gated(aq)) {
        this.focus.set(s.id, aidx);
        return true;
      }
    }
    // 焦点驻守：本队正在建的块 → 全员按**静态环列**围到焦点块（无随机抖动）→ 到点站定等挖
    const fidx = this.focus.get(s.id);
    if (fidx !== undefined && fidx >= 0 && fidx < this.pieces.length
      && this.allows(s.id, this.pieces[fidx].kind, this.pieces[fidx].pri)
      && !this.built.has(keyOf(this.pieces[fidx]))
      && !this.gated(this.pieces[fidx])) {
      const q = this.pieces[fidx];
      let i = 0;
      for (const uid of s.members.keys()) {
        const a = (i++ / s.members.size) * Math.PI * 2;
        this.board.write(uid, q.x + Math.cos(a), q.z + Math.sin(a));
      }
      this.board.own(s.id);
      return true;
    }
    let near: number[] = [];
    let nearest = -1, nearestD = Infinity;
    for (let i = 0; i < this.pieces.length; i++) {
      const q = this.pieces[i];
      if (this.built.has(keyOf(q))) continue;
      if (this.gated(q)) continue;   // ★ 事态闸门（未解锁不派）
      if (!this.allows(s.id, q.kind)) continue;
      const d2 = (q.x - cx) ** 2 + (q.z - cz) ** 2;
      if (d2 > 90 * 90) continue;
      if (this.lineBlocked(cx, cz, q.x, q.z)) continue;   // 直行遇墙 → 跳过（会原地磨蹭）
      if (d2 < nearestD) { nearestD = d2; nearest = i; }
      if (d2 <= 40 * 40 && near.length < 3) near.push(i);
    }
    // 40m 内无可达块 → 取**直线可达**的全局最近块（防止把目标派到墙对面）
    if (near.length === 0 && nearest >= 0) near = [nearest];
    if (near.length === 0) {
      // 兜底：直线全被墙挡 → 目标挂到本队已派块（工程队始终有"走向工件"的行军任务）
      const idx = this.assign.get(s.id);
      if (idx === undefined || idx < 0 || idx >= this.pieces.length) return false;
      if (this.built.has(keyOf(this.pieces[idx])) || this.gated(this.pieces[idx])
        || !this.allows(s.id, this.pieces[idx].kind, this.pieces[idx].pri)) return false;
      const q = this.pieces[idx];
      for (const uid of s.members.keys()) {
        this.board.write(uid, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10);
      }
      this.board.own(s.id);
      return true;
    }
    // 成员分块：目标仍为有效可达块就**不重写**（到点静立 → 修全天转圈）
    const claimed = new Set<number>();
    for (const uid of s.members.keys()) {
      const cur = this.board.taskOf(uid);
      if (cur && this.keepsTask(cur.x, cur.z, near)) continue;
      let bi = -1, bD = Infinity;
      for (let k2 = 0; k2 < near.length; k2++) {
        const qi = near[k2];
        if (claimed.has(qi)) continue;
        const q = this.pieces[qi];
        const d = (q.x - cx) ** 2 + (q.z - cz) ** 2;
        if (d < bD) { bD = d; bi = qi; }
      }
      if (bi < 0) bi = near[0];
      claimed.add(bi);
      const q = this.pieces[bi];
      this.board.write(uid, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10);
    }
    this.board.own(s.id);
    return true;
  }

  /** 施工（2s 拍调用；逐步拼装，仅 S1）：认准一块挖/建到成 → 战壕肉眼可见 */
  construct(builders: readonly TaskSquad[]): void {
    if (this.stage !== 'S1') return;
    const cover = this.host.cover();
    if (!cover) return;
    for (const s of builders) {
      // ① 焦点续挖（优先；不受冷却限）：本队正在建的块（成员 ≤15m 且未成）→ 必须继续
      let piece: BuildPiece | null = null;
      let fidx = this.focus.get(s.id) ?? this.assign.get(s.id);   // ★ focus 缺失回退 assign（派件即可开工）
      if (fidx !== undefined && fidx >= 0 && fidx < this.pieces.length
        && !this.built.has(keyOf(this.pieces[fidx]))
        && !this.gated(this.pieces[fidx])
        && this.allows(s.id, this.pieces[fidx].kind, this.pieces[fidx].pri)) {
        const q = this.pieces[fidx];
        for (const m of s.members.values()) {
          if ((m.x - q.x) ** 2 + (m.z - q.z) ** 2 <= WORK_R2) { piece = q; break; }   // ★ 15m 内即可计时
        }
      }
      // ② 就近动工（新焦点）：**pri 小者先**（前线掩体 > 战壕 > 环掩体）→ 挖痕多 → 近（成员 ≤5m）
      if (!piece) {
        const cd = this.cds.get(s.id) ?? 0;
        if (cd > 0) continue;   // 冷却中（仅限新焦点）
        let bi = -1, bD = 144, bPass = -1, bPri = Infinity;   // ★ 新焦点扫描 12m（原 5m）
        for (const m of s.members.values()) {
          for (let i = 0; i < this.pieces.length; i++) {
            const q = this.pieces[i];
            if (this.built.has(keyOf(q))) continue;
            if (this.gated(q)) continue;   // ★ 事态闸门（未解锁不挖）
            if (!this.allows(s.id, q.kind, q.pri)) continue;
            const d = (m.x - q.x) ** 2 + (m.z - q.z) ** 2;
            if (d > 144) continue;   // ★ 12m
            const pass = this.passes.get(keyOf(q)) ?? 0;
            if (q.pri < bPri || (q.pri === bPri && (pass > bPass || (pass === bPass && d < bD)))) {
              bPri = q.pri; bPass = pass; bi = i; bD = d;
            }
          }
        }
        if (bi < 0) continue;
        fidx = bi;
        piece = this.pieces[bi];
      }
      if (fidx !== undefined) this.focus.set(s.id, fidx);
      // ★ 施工计时（用户定 2026-09-25）：到位就计时（每拍 +2s），计时满即建成
      const k = keyOf(piece);
      const t = (this.workT.get(k) ?? 0) + 2;
      this.workT.set(k, t);
      if (piece.kind === 'cover') {
        if (t < COVER_TIME_S) continue;
        cover(piece.x, piece.z, 'cover');
        this.host.markDirty(piece.x, piece.z, 12);
        this.built.add(k);
        this.workT.delete(k);
        this.focus.delete(s.id);
        this.cds.set(s.id, COVER_CD);
      } else {
        const raster = RasterMap.current;
        if (raster && raster.surfaceHeightAt(piece.x, piece.z) - LAYER < FLOOR_MIN) {
          this.built.add(k);
          this.workT.delete(k);
          this.focus.delete(s.id);
          this.cds.set(s.id, TRENCH_CD);
          continue;
        }
        this.host.dig()?.(piece.x, piece.z);
        this.host.markDirty(piece.x, piece.z, 16);
        if (t >= TRENCH_TIME_S) { this.built.add(k); this.workT.delete(k); this.focus.delete(s.id); this.cds.set(s.id, TRENCH_CD); }
      }
    }
  }

  /** 直行可达性：从 (x0,z0) 直线到工件是否跨硬墙（每 1.5m 一采样）。
   *  任务目标是直线行走的；中途碰墙会被 steer-escape 抵消 → 原地磨蹭。 */
  private lineBlocked(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    const n = Math.ceil(d / 1.5);
    if (n < 2) return false;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this.host.blockedAt(x0 + dx * t, z0 + dz * t)) return true;
    }
    return false;
  }

  /** 当前任务仍是"候选可达未建块" → 保持（到达也不重写，建完才换下块 → 杜绝转圈） */
  private keepsTask(tx: number, tz: number, near: number[]): boolean {
    for (const qi of near) {
      const q = this.pieces[qi];
      if (Math.hypot(q.x - tx, q.z - tz) <= 0.6) return true;
    }
    return false;
  }
}
