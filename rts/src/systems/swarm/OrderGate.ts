// ============================================================
// OrderGate —— 命令保护（时间+距离）+ 命令记忆（2026-09-24 用户定）
// ============================================================
// 目的：不要每拍重下命令、不要来回拉扯。只有"走出足够距离"或"久无有效推进"
//   才接新目标；记忆上次目标/方向：反向拉扯拒绝；卡住时优先没下过的方向。
// 消费：SwarmSystem.applyOrders（key=成员 uid）、SquadTactics.tick（key=队 id）。

export interface GateCfg {
  /** 距离保护：自上次下令点位移 ≥ 此值 → 可接新目标 */
  minMove: number;
  /** 新目标与记忆目标差 < 此值 → 视为抖动，不换 */
  retarget: number;
  /** 时间保护：至少持此秒数才判"卡住" */
  holdS: number;
  /** 有效推进：净接近 ≥ 此值 = 有进展（不算卡住） */
  netMin: number;
  /** 硬上限：持此秒数无论是否有进展都接新目标（防死锁） */
  forceS: number;
  /** 到达半径：已到旧目标 → 新目标需稳定持续才认 */
  arriveR: number;
  /** 稳定确认时长（秒）：滤掉左右游弋的来回抖动 */
  persistS: number;
  /** 稳定判定半径（米） */
  stableM: number;
  /** 反向保护：候选方向与记忆方向点积 < 此值 → 拒绝（非卡住时） */
  reverseDot: number;
  /** 方向记忆条数 */
  histN: number;
  /** 卡住换向：与记忆方向重合时偏转角度（度） */
  biasDeg: number;
}

interface Memo {
  kind: string;
  tx: number;
  tz: number;
  px: number;
  pz: number;
  t: number;
  d0: number;
  dirX: number;
  dirZ: number;
  hist: number[];
  pendSince: number;
  pendX: number;
  pendZ: number;
}

export class OrderGate {
  private readonly m = new Map<number, Memo>();
  readonly dbg = {
    decide: 0, commit: 0, keep: 0,
    move: 0, stuck: 0, hard: 0, persist: 0,
    jitter: 0, reverse: 0, arriveWait: 0, idle: 0, bias: 0,
  };

  constructor(private readonly cfg: GateCfg) {}

  decide(
    key: number, kind: string, cx: number, cz: number, px: number, pz: number, now: number,
  ): { x: number; z: number } {
    const c = this.cfg;
    this.dbg.decide++;
    const memo = this.m.get(key);
    if (!memo || memo.kind !== kind) return this.commit(key, kind, cx, cz, px, pz, now, false);
    if (Math.hypot(cx - memo.tx, cz - memo.tz) < c.retarget) { this.dbg.jitter++; return this.keep(memo); }

    const dArrive = Math.hypot(px - memo.tx, pz - memo.tz);
    const dMove = Math.hypot(px - memo.px, pz - memo.pz);
    const netGain = memo.d0 - dArrive;
    const held = now - memo.t;
    const stuck = held >= c.holdS && dArrive > c.arriveR && netGain < c.netMin;
    const hard = held >= c.forceS;

    let allow = dMove >= c.minMove || stuck || hard;
    let via = dMove >= c.minMove ? 'move' : stuck ? 'stuck' : hard ? 'hard' : '';
    if (!allow && dArrive <= c.arriveR) {
      if (Math.hypot(cx - memo.pendX, cz - memo.pendZ) <= c.stableM) {
        if (memo.pendSince === 0) memo.pendSince = now;
      } else {
        memo.pendSince = now;
        memo.pendX = cx;
        memo.pendZ = cz;
      }
      if (now - memo.pendSince >= c.persistS) { allow = true; via = 'persist'; }
    } else if (allow) {
      memo.pendSince = 0;
    }
    if (!allow) {
      this.dbg[dArrive <= c.arriveR ? 'arriveWait' : 'idle']++;
      return this.keep(memo);
    }

    if (!stuck && !hard) {
      const nx = cx - px, nz = cz - pz;
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-3 && (nx / nl) * memo.dirX + (nz / nl) * memo.dirZ < c.reverseDot) {
        this.dbg.reverse++;
        return this.keep(memo);
      }
    }
    if (via === 'move' || via === 'stuck' || via === 'hard' || via === 'persist') {
      this.dbg[via]++;
    }
    return this.commit(key, kind, cx, cz, px, pz, now, stuck || hard, memo);
  }

  prune(seen: Set<number>): void {
    for (const k of this.m.keys()) if (!seen.has(k)) this.m.delete(k);
  }

  clear(): void {
    this.m.clear();
  }

  private keep(memo: Memo): { x: number; z: number } {
    this.dbg.keep++;
    return { x: memo.tx, z: memo.tz };
  }

  private commit(
    key: number, kind: string, cx: number, cz: number, px: number, pz: number, now: number,
    bias: boolean, prev?: Memo,
  ): { x: number; z: number } {
    this.dbg.commit++;
    let tx = cx, tz = cz;
    if (bias && prev && prev.hist.length > 0) {
      const b = this.biasDir(px, pz, cx, cz, prev.hist);
      if (b) { tx = b.x; tz = b.z; this.dbg.bias++; }
    }
    const dx = tx - px, dz = tz - pz;
    const dl = Math.hypot(dx, dz) || 1;
    const ang = Math.atan2(dz, dx);
    const hist = [...(prev?.hist ?? []), ang].slice(-this.cfg.histN);
    this.m.set(key, {
      kind, tx, tz, px, pz, t: now, d0: Math.hypot(dx, dz),
      dirX: dx / dl, dirZ: dz / dl, hist,
      pendSince: 0, pendX: tx, pendZ: tz,
    });
    return { x: tx, z: tz };
  }

  private biasDir(px: number, pz: number, cx: number, cz: number, hist: number[]): { x: number; z: number } | null {
    const rad = (this.cfg.biasDeg * Math.PI) / 180;
    const base = Math.atan2(cz - pz, cx - px);
    const near = (a: number, b: number): boolean => {
      const d = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < rad * 0.5;
    };
    if (!hist.some((h) => near(h, base))) return null;
    const r = Math.hypot(cx - px, cz - pz);
    for (const s of [1, -1]) {
      const a = base + s * rad;
      if (!hist.some((h) => near(h, a))) return { x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r };
    }
    return null;
  }
}
