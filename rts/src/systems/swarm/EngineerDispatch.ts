// ============================================================
// EngineerDispatch —— 队长层：工兵派件 + 成员任务（引擎只分区，非必要不管）
// ============================================================
// 用户定 2026-09-24：引擎给工兵小队**分区**（claims），之后不写成员任务、不派件；
//   · 派件（队长）：用**建造位置查询函数**（危险点优先 → 否则扇区内弧链随机可达点）
//     取工作点 → 本队未建件沿用 / 注入新件（掩体优先，已护转壕）→ assign/focus。
//   · 成员任务：taskX/Z（围块施工 / 护卫扇区 / 行军队列）由本层分派。
//   · 写口：MemberTaskBoard（成员）+ EngineerCorps（件表/assign/focus）+ 引擎端口（spot）。
//   · 参考点：build → 本队 spot（= 件点）；guard/patrol → 命令 anchor（保护对象）。
//   · 被击 8s / 非施工使命 / 非工兵 → 清任务（交动态反击/队长站位/编队槽）。

import type { Squad } from './SquadTable';
import type { SquadOrderState } from './SquadTactics';
import type { EngineerCorps } from './EngineerCorps';
import type { MemberTaskBoard } from './MemberTaskBoard';
import { FORTIFY_SECTORS, NEED_DONE, type FortifyPick, type FortifyPlanner } from './FortifyPlanner';

export interface FortifyPort {
  sectorOf(squadId: number): number | null;
  band(): { rLo: number; rHi: number };
  ship(): { x: number; z: number };
  needAt(x: number, z: number): number | null;
  canReach(squadId: number, x: number, z: number): boolean;
  sheltered(x: number, z: number): boolean;
  assault(): boolean;
  /** 第一波起（dayT01 ≥ 0.45）：停止新增施工（既有件收尾） */
  noNewBuild(): boolean;
  spotOf(squadId: number): (FortifyPick & { sector: number }) | null;
  setSpot(squadId: number, p: FortifyPick & { sector: number }): void;
  clearSpot(squadId: number): void;
}

export interface EngineerDispatchDeps {
  corps: EngineerCorps;
  board: MemberTaskBoard;
  alerted(squadId: number): boolean;
  /** 引擎给该队的粘性使命（订单 mission 会被兜底令覆盖，不能当使命读） */
  missionOf(squadId: number): string | null;
  fortify: FortifyPlanner;
  port: FortifyPort;
}

const keyOf = (q: { x: number; z: number }): string => `${q.x},${q.z}`;
const R2 = 90 * 90;
const NEAR2 = 40 * 40;

export class EngineerDispatch {
  /** 注入节流（每 0.5s ≤1 件，防刷） */
  private lastInjectAt = -1e9;

  constructor(private readonly deps: EngineerDispatchDeps) {}

  /** 队长调遣工兵：派件 + 成员任务（2Hz 由 SquadDispatch 驱动） */
  run(squad: Squad, state: SquadOrderState, now: number): void {
    const { board, alerted, missionOf, corps, port } = this.deps;
    if (!squad.builders) { board.clear(squad); port.clearSpot(squad.id); return; }
    const mission = missionOf(squad.id) ?? state.order.mission;
    if (alerted(squad.id) || (mission !== 'build' && mission !== 'guard' && mission !== 'patrol')) {
      board.clear(squad);
      return;
    }
    let ref: { x: number; z: number } | null;
    if (mission === 'build' && corps.stage === 'S1') {
      this.plan(squad, now);
      ref = port.spotOf(squad.id);
    } else {
      ref = state.order.anchor ?? state.order.target ?? null;
    }
    if (!ref) { board.clear(squad); return; }
    if (this.spread(squad, ref.x, ref.z)) return;
    if (mission !== 'build') { board.clear(squad); return; }
    let i = 0;
    for (const uid of squad.members.keys()) {
      const a = (i++ / squad.members.size) * Math.PI * 2;
      board.write(uid, ref.x + Math.cos(a) * 2, ref.z + Math.sin(a) * 2);
    }
    board.own(squad.id);
  }

  /** 派件：位置查询（危险点优先 → 弧链随机可达点）→ 沿用本队未建件 / 注入新件 */
  private plan(squad: Squad, now: number): void {
    const { corps, fortify, port } = this.deps;
    const sec = port.sectorOf(squad.id);
    if (sec === null) { port.clearSpot(squad.id); return; }
    const prev = port.spotOf(squad.id);
    const lead = squad.members.get(squad.leaderUid);
    const still = !!prev && !!lead
      && corps.pieces.some((q) => !corps.built.has(keyOf(q)) && !corps.gated(q)
        && Math.hypot(q.x - prev.x, q.z - prev.z) < 8)
      && port.canReach(squad.id, prev.x, prev.z);
    if (!still) {
      const { rLo, rHi } = port.band();
      const ship = port.ship();
      const sp = fortify.targetOf(ship.x, ship.z, sec, rLo, rHi,
        (x, z) => port.needAt(x, z), NEED_DONE, (x, z) => port.canReach(squad.id, x, z));
      if (sp) port.setSpot(squad.id, { ...sp, sector: sec });
      else { port.clearSpot(squad.id); return; }
    }
    const p = port.spotOf(squad.id);
    if (!p || port.noNewBuild()) return;
    let own = -1;
    for (let i = 0; i < corps.pieces.length; i++) {
      const q = corps.pieces[i];
      if (corps.built.has(keyOf(q)) || corps.gated(q)) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 8) { own = i; break; }
    }
    if (own >= 0) {
      corps.assign.set(squad.id, own);
      corps.focus.set(squad.id, own);
      return;
    }
    if (now - this.lastInjectAt < 0.5 || fortify.dbg.injected >= 200) return;
    const wantKind: 'cover' | 'trench' | null = !port.sheltered(p.x, p.z) ? 'cover'
      : (port.assault() ? null : 'trench');
    if (wantKind === null) return;
    const dedupR = wantKind === 'cover' ? 12 : 8;
    let sx = p.x, sz = p.z;
    if (corps.pieces.some((q) => Math.hypot(q.x - sx, q.z - sz) < dedupR)) {
      const { rLo, rHi } = port.band();
      const ship = port.ship();
      const a0 = (p.sector / FORTIFY_SECTORS) * Math.PI * 2;
      const a1 = ((p.sector + 1) / FORTIFY_SECTORS) * Math.PI * 2;
      let found = false;
      for (let t = 0; t < 12 && !found; t++) {
        const a = a0 + Math.random() * (a1 - a0);
        const rr = rLo + Math.random() * (rHi - rLo);
        const cx2 = Math.round((ship.x + Math.cos(a) * rr) / 4) * 4;
        const cz2 = Math.round((ship.z + Math.sin(a) * rr) / 4) * 4;
        if (port.needAt(cx2, cz2) === null) continue;
        if (corps.pieces.some((q) => Math.hypot(q.x - cx2, q.z - cz2) < dedupR)) continue;
        sx = cx2; sz = cz2; found = true;
      }
      if (!found) return;
    }
    corps.pieces.push({ kind: wantKind, x: sx, z: sz, ring: 2, pri: 3 });
    const idx = corps.pieces.length - 1;
    corps.assign.set(squad.id, idx);
    corps.focus.set(squad.id, idx);
    port.setSpot(squad.id, { x: sx, z: sz, score: p.score, sector: p.sector });
    this.lastInjectAt = now;
    fortify.dbg.injected++;
  }

  /** 成员分块（工程并行）：把本队成员分到附近未认领块 → 直写任务目标。
   *  @returns true = 已派/已持有工件任务；false = 附近无可用工件（调用方转行军队列/清任务） */
  private spread(s: Squad, cx: number, cz: number): boolean {
    const { corps, board } = this.deps;
    const aidx = corps.assign.get(s.id);
    if (aidx !== undefined && aidx >= 0 && aidx < corps.pieces.length) {
      const aq = corps.pieces[aidx];
      if (aq.kind === 'trench' && corps.allows(s.id, aq.kind, aq.pri) && !corps.built.has(keyOf(aq))) {
        let k0 = 0;
        for (const uid of s.members.keys()) {
          const a = (k0++ / s.members.size) * Math.PI * 2;
          board.write(uid, aq.x + Math.cos(a), aq.z + Math.sin(a));
        }
        board.own(s.id);
        return true;
      }
    }
    if (aidx !== undefined && aidx >= 0 && aidx < corps.pieces.length) {
      const aq = corps.pieces[aidx];
      if (aq.pri >= 3 && corps.allows(s.id, aq.kind, aq.pri)
        && !corps.built.has(keyOf(aq)) && !corps.gated(aq)) {
        corps.focus.set(s.id, aidx);
        return true;
      }
    }
    const fidx = corps.focus.get(s.id);
    if (fidx !== undefined && fidx >= 0 && fidx < corps.pieces.length
      && corps.allows(s.id, corps.pieces[fidx].kind, corps.pieces[fidx].pri)
      && !corps.built.has(keyOf(corps.pieces[fidx]))
      && !corps.gated(corps.pieces[fidx])) {
      const q = corps.pieces[fidx];
      let i = 0;
      for (const uid of s.members.keys()) {
        const a = (i++ / s.members.size) * Math.PI * 2;
        board.write(uid, q.x + Math.cos(a), q.z + Math.sin(a));
      }
      board.own(s.id);
      return true;
    }
    let near: number[] = [];
    let nearest = -1, nearestD = Infinity;
    for (let i = 0; i < corps.pieces.length; i++) {
      const q = corps.pieces[i];
      if (corps.built.has(keyOf(q))) continue;
      if (corps.gated(q)) continue;
      if (!corps.allows(s.id, q.kind)) continue;
      const d2 = (q.x - cx) ** 2 + (q.z - cz) ** 2;
      if (d2 > R2) continue;
      if (corps.lineBlocked(cx, cz, q.x, q.z)) continue;
      if (d2 < nearestD) { nearestD = d2; nearest = i; }
      if (d2 <= NEAR2 && near.length < 3) near.push(i);
    }
    if (near.length === 0 && nearest >= 0) near = [nearest];
    if (near.length === 0) {
      const idx = corps.assign.get(s.id);
      if (idx === undefined || idx < 0 || idx >= corps.pieces.length) return false;
      if (corps.built.has(keyOf(corps.pieces[idx])) || corps.gated(corps.pieces[idx])
        || !corps.allows(s.id, corps.pieces[idx].kind, corps.pieces[idx].pri)) return false;
      const q = corps.pieces[idx];
      for (const uid of s.members.keys()) {
        board.write(uid, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10);
      }
      board.own(s.id);
      return true;
    }
    const claimed = new Set<number>();
    for (const uid of s.members.keys()) {
      const cur = board.taskOf(uid);
      if (cur && this.keepsTask(cur.x, cur.z, near)) continue;
      let bi = -1, bD = Infinity;
      for (let k2 = 0; k2 < near.length; k2++) {
        const qi = near[k2];
        if (claimed.has(qi)) continue;
        const q = corps.pieces[qi];
        const d = (q.x - cx) ** 2 + (q.z - cz) ** 2;
        if (d < bD) { bD = d; bi = qi; }
      }
      if (bi < 0) bi = near[0];
      claimed.add(bi);
      const q = corps.pieces[bi];
      board.write(uid, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10);
    }
    board.own(s.id);
    return true;
  }

  /** 当前任务仍是"候选可达未建块" → 保持（到达也不重写，建完才换下块 → 杜绝转圈） */
  private keepsTask(tx: number, tz: number, near: number[]): boolean {
    for (const qi of near) {
      const q = this.deps.corps.pieces[qi];
      if (Math.hypot(q.x - tx, q.z - tz) <= 0.6) return true;
    }
    return false;
  }
}
