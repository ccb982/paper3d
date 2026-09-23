# R21 patch: 发令冷却 + 磨蹭兜底/层级符合度（SwarmCommander）
import io
p = 'rts/src/systems/swarm/SwarmCommander.ts'
s = io.open(p, encoding='utf-8').read()

# ---- 1) 发令冷却：替换旧"少发令闸门"块 ----
a = """    // \u2605 \u5c11\u53d1\u4ee4\u95f8\u95e8\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a**\u53ea\u5728\u4e8b\u6001\u53d8\u52a8\u6216\u961f\u91cd\u4f24\u65f6\u91cd\u53d1**\uff1b\u5426\u5219\u53ea\u7eed\u547d\uff08\u4e0d\u91cd\u767b\u8bb0/\u4e0d\u8fdb\u53f0\u8d26\uff09
    {
      const cur0 = this.swarm.tactics.board.get(squadId);
      if (cur0 && cur0.source === 'engine' && order.target) {
        const nowS0 = performance.now() / 1000;
        const key = `${this.stage}|${this.battlePosture}|${Math.round(this.frontMinD / 10)}|${Math.round(this.frontMaxD / 10)}|${this.wave1Sent ? 1 : 0}|${this.finalSent ? 1 : 0}`;
        const sameKind = cur0.order.kind === order.kind && (cur0.order.mission ?? '') === (order.mission ?? '');
        const sameTgt = cur0.order.target && Math.hypot(cur0.order.target.x - order.target.x, cur0.order.target.z - order.target.z) < 3;
        const sameSituation = this.cmdKey.get(squadId) === key;
        // \u961f\u91cd\u4f24\uff08\u8840\u6bd4 <0.5\uff09\u2192 \u5141\u8bb8\u91cd\u53d1
        let ratio = 1;
        const sq = this.swarm.squads.get(squadId);
        if (sq && sq.members.size > 0) {
          let hp = 0, max = 0;
          for (const m of sq.members.values()) { hp += m.hp; max += m.maxHp; }
          ratio = max > 0 ? hp / max : 1;
        }
        const hurt = ratio < 0.5;
        if (sameKind && sameTgt && sameSituation && !hurt && nowS0 < cur0.until - 5) {
          cur0.until = nowS0 + (ttl ?? 30);   // \u53ea\u7eed\u547d
          return true;
        }
        this.cmdKey.set(squadId, key);
      }
    }"""
b = """    // \u2605 \u53d1\u4ee4\u51b7\u5374\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a**\u547d\u4ee4\u53d1\u51fa\u53bb\u4e00\u6b21\uff0c\u77ed\u65f6\u671f\u5185\u4e0d\u518d\u7ed9\u540c\u4e00\u961f\u53d1**\u2014\u2014
    //   \u4e0d\u9760\u547d\u4ee4\u65f6\u6548\uff08\u5f15\u64ce\u4ee4 TTL \u62c9\u957f\u5b58\u6d3b\uff09\uff1b\u51b7\u5374\u671f\u5185\u540c\u7b7e\u540d\u540c\u76ee\u6807 \u2192 \u76f4\u63a5\u4e0d\u53d1\u3002
    //   \u4f8b\u5916\uff1a\u4e8b\u6001\u53d8\u52a8\uff08stage/posture/\u73af/\u6ce2\u6b21\u7b7e\u540d\u53d8\uff09\u6216\u961f\u91cd\u4f24\uff08\u8840\u6bd4<0.5\uff09\u2192 \u5141\u8bb8\u7acb\u5373\u91cd\u53d1\u3002
    let ttlLong = Math.max(ttl ?? 30, 60);   // \u5f15\u64ce\u4ee4\u5bff\u547d\u62c9\u957f\uff08\u547d\u4ee4\u9760\u51b7\u5374\u7ba1\uff0c\u4e0d\u9760\u65f6\u6548\uff09
    {
      const cur0 = this.swarm.tactics.board.get(squadId);
      if (cur0 && cur0.source === 'engine' && order.target) {
        const nowS0 = performance.now() / 1000;
        const key = `${this.stage}|${this.battlePosture}|${Math.round(this.frontMinD / 10)}|${Math.round(this.frontMaxD / 10)}|${this.wave1Sent ? 1 : 0}|${this.finalSent ? 1 : 0}`;
        const sameKind = cur0.order.kind === order.kind && (cur0.order.mission ?? '') === (order.mission ?? '');
        const sameTgt = cur0.order.target && Math.hypot(cur0.order.target.x - order.target.x, cur0.order.target.z - order.target.z) < 3;
        const sameSituation = this.cmdKey.get(squadId) === key;
        let ratio = 1;
        const sq = this.swarm.squads.get(squadId);
        if (sq && sq.members.size > 0) {
          let hp = 0, max = 0;
          for (const m of sq.members.values()) { hp += m.hp; max += m.maxHp; }
          ratio = max > 0 ? hp / max : 1;
        }
        const hurt = ratio < 0.5;
        const lastAt = this.lastIssueAt.get(squadId) ?? -1e9;
        if (sameKind && sameTgt && sameSituation && !hurt
          && nowS0 - lastAt < SwarmCommander.ISSUE_COOLDOWN_S) {
          return true;   // \u2605 \u51b7\u5374\u671f\u5185\uff1a\u4e0d\u53d1\uff08\u547d\u4ee4\u6309\u957f TTL \u5b58\u6d3b\uff0c\u4e0d\u7528\u7eed\u547d\uff09
        }
        this.cmdKey.set(squadId, key);
        this.lastIssueAt.set(squadId, nowS0);
      }
    }"""
assert a in s, 'gate block not found'
s = s.replace(a, b)

# ---- 2) 引擎令 TTL 用 ttlLong ----
for old, new in [
  ("this.swarm.issueOrder(squadId, order, ttl);", "this.swarm.issueOrder(squadId, order, ttlLong);"),
  ("this.swarm.issueOrder(squadId, { ...order, coarse }, ttl);", "this.swarm.issueOrder(squadId, { ...order, coarse }, ttlLong);"),
  ("this.swarm.issueOrder(squadId, withTgt(ax, az, coarse), ttl);", "this.swarm.issueOrder(squadId, withTgt(ax, az, coarse), ttlLong);"),
  ("this.swarm.issueOrder(squadId, withTgt(alt.x, alt.z, coarse), ttl);", "this.swarm.issueOrder(squadId, withTgt(alt.x, alt.z, coarse), ttlLong);"),
]:
  s = s.replace(old, new)

# ---- 3) 字段 ----
a3 = "  /** \u2605 \u5c11\u53d1\u4ee4\u95f8\u95e8\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a\u961f \u2192 \u4e0a\u6b21\u53d1\u4ee4\u7684\u4e8b\u6001\u7b7e\u540d\uff1b\u7b7e\u540d\u4e0d\u53d8\u4e14\u961f\u672a\u91cd\u4f24 \u2192 \u53ea\u7eed\u547d\u4e0d\u91cd\u53d1 */\n  private readonly cmdKey = new Map<number, string>();"
b3 = """  /** \u2605 \u53d1\u4ee4\u51b7\u5374\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a\u961f \u2192 \u4e0a\u6b21\u53d1\u4ee4\u65f6\u523b\uff08\u79d2\uff09\uff1b\u77ed\u65f6\u671f\u5185\u4e0d\u518d\u7ed9\u540c\u4e00\u961f\u53d1 */
  private readonly lastIssueAt = new Map<number, number>();
  private static readonly ISSUE_COOLDOWN_S = 8;
  /** \u961f \u2192 \u4e0a\u6b21\u53d1\u4ee4\u7684\u4e8b\u6001\u7b7e\u540d\uff08\u7b7e\u540d\u53d8 = \u4e8b\u6001\u53d8\u52a8 \u2192 \u5141\u8bb8\u7acb\u5373\u91cd\u53d1\uff09 */
  private readonly cmdKey = new Map<number, string>();"""
assert a3 in s, 'field anchor not found'
s = s.replace(a3, b3)

# ---- 4) 兜底 + 层级（字段/方法/调用）----
a4 = "  /** \u2605 \u7b2c\u4e00\u6ce2\u62b5\u8230\u9a7b\u7559\u622a\u6b62\u65f6\u523b\uff08squadId \u2192 \u79d2\uff1b\u7528\u6237\u5b9a 2026-09-25\uff09 */"
method = """  /** \u2605 \u78e8\u8e6d\u515c\u5e95 + \u5c42\u7ea7\u7b26\u5408\u5ea6\uff08\u00a713.10\uff1b1Hz \u5185\u90e8\u8282\u6d41\uff1b\u7528\u6237\u5b9a 2026-09-25\uff09 */
  private fallbackAccum = 0;
  private readonly dawdle = new Map<number, { x: number; z: number; t: number; path: number; rev: number; lx: number; lz: number; last: number; cd: number }>();

  private fallbackTick(dt: number, shipX: number, shipZ: number): void {
    this.fallbackAccum += dt;
    if (this.fallbackAccum < 1) return;
    this.fallbackAccum = 0;
    const nowF = performance.now() / 1000;
    for (const s of this.swarm.squads.all()) {
      if (s.members.size === 0) continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      cx /= n; cz /= n;
      let rec = this.dawdle.get(s.id);
      if (!rec) { rec = { x: cx, z: cz, t: nowF, path: 0, rev: 0, lx: cx, lz: cz, last: 0, cd: 0 }; this.dawdle.set(s.id, rec); continue; }
      const d = Math.hypot(cx - rec.lx, cz - rec.lz);
      rec.path += d;
      if (d >= 0.3) {
        const sg = Math.sign(cx - rec.lx);
        if (rec.last !== 0 && sg !== rec.last) rec.rev++;
        rec.last = sg;
      }
      rec.lx = cx; rec.lz = cz;
      if (nowF - rec.t >= 30) {
        const net = Math.hypot(cx - rec.x, cz - rec.z);
        const dawdling = (net < 3 && rec.path > 15) || rec.rev >= 6;
        if (dawdling && nowF > rec.cd && !s.builders) {
          rec.cd = nowF + 30;
          const o = this.swarm.tactics.board.get(s.id)?.order;
          let tx: number, tz: number;
          if (o?.target) {
            const dxo = o.target.x - cx, dzo = o.target.z - cz;
            const dl = Math.hypot(dxo, dzo) || 1;
            tx = cx + (dxo / dl) * 20; tz = cz + (dzo / dl) * 20;
          } else {
            const spot = this.underStrengthSpot(cx, cz, 60);
            tx = spot ? spot.x : cx + 20; tz = spot ? spot.z : cz;
          }
          this.issueChecked(s.id, cx, cz, { kind: 'advance', target: { x: tx, z: tz }, mission: 'regroup', seq: 0 }, 20);
          this.lastDecision = { squad: s.id, kind: 'dawdle_push', at: nowF };
        }
        rec.x = cx; rec.z = cz; rec.t = nowF; rec.path = 0; rec.rev = 0;
      }
    }
    const rankOf = (t: string): number => (t === 'defense' || t === 'assault') ? 0 : (t === 'logistics' ? 1 : (t === 'ranged' ? 2 : 3));
    const list: { id: number; rank: number; d: number; x: number; z: number }[] = [];
    for (const s of this.swarm.squads.all()) {
      if (s.members.size === 0 || s.builders) continue;
      if (!this.swarm.tactics.board.get(s.id)?.order) continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      cx /= n; cz /= n;
      list.push({ id: s.id, rank: rankOf(s.type), d: Math.hypot(cx - shipX, cz - shipZ), x: cx, z: cz });
    }
    for (const back of list) {
      if (back.rank < 2) continue;
      for (const front of list) {
        if (front.rank !== 0) continue;
        if (back.d < front.d - 15) {
          const dxo = back.x - shipX, dzo = back.z - shipZ;
          const dl = Math.hypot(dxo, dzo) || 1;
          this.issueChecked(back.id, back.x, back.z,
            { kind: 'advance', target: { x: back.x + (dxo / dl) * 15, z: back.z + (dzo / dl) * 15 }, mission: 'regroup', seq: 0 }, 20);
          this.lastDecision = { squad: back.id, kind: 'rank_fix', at: nowF };
          break;
        }
      }
    }
  }

  /** \u2605 \u5175\u529b\u6700\u7a00\u5904\uff0820m \u683c\u8ba1\u6570\uff1b[20, r] \u5185\u3001\u53ef\u7ad9\u3001\u5df1\u65b9\u6700\u5c11\u7684\u683c\u4e2d\u5fc3\uff09 */
  private underStrengthSpot(cx: number, cz: number, r: number): { x: number; z: number } | null {
    const CELL = 20;
    const cnt = new Map<string, number>();
    for (const s of this.swarm.squads.all()) {
      for (const m of s.members.values()) {
        const k = `${Math.floor(m.x / CELL)},${Math.floor(m.z / CELL)}`;
        cnt.set(k, (cnt.get(k) ?? 0) + 1);
      }
    }
    let best: { x: number; z: number } | null = null;
    let bestV = Infinity;
    for (let dz = -r; dz <= r; dz += CELL) {
      for (let dx = -r; dx <= r; dx += CELL) {
        const x = cx + dx, z = cz + dz;
        const d = Math.hypot(dx, dz);
        if (d < 20 || d > r) continue;
        if (this.terrainScore.scoreAt(x, z) === null) continue;
        const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        const v = cnt.get(k) ?? 0;
        if (v < bestV) { bestV = v; best = { x, z }; }
      }
    }
    return best;
  }

  /** \u2605 \u7b2c\u4e00\u6ce2\u62b5\u8230\u9a7b\u7559\u622a\u6b62\u65f6\u523b\uff08squadId \u2192 \u79d2\uff1b\u7528\u6237\u5b9a 2026-09-25\uff09 */"""
assert a4 in s, 'method anchor not found'
s = s.replace(a4, method, 1)

a5 = """            this.holdUntil.delete(s.id);   // \u9a7b\u7559\u5230\u671f \u2192 \u4ea4\u56de\u6b63\u5e38\u51b3\u7b56
          }
        }
      }
    }
  }
"""
b5 = """            this.holdUntil.delete(s.id);   // \u9a7b\u7559\u5230\u671f \u2192 \u4ea4\u56de\u6b63\u5e38\u51b3\u7b56
          }
        }
      }
    }
    // \u2605 \u78e8\u8e6d\u515c\u5e95 + \u5c42\u7ea7\u7b26\u5408\u5ea6\uff08\u00a713.10\uff1b1Hz \u5185\u90e8\u8282\u6d41\uff09
    this.fallbackTick(dt, shipX, shipZ);
  }
"""
assert a5 in s, 'call anchor not found'
s = s.replace(a5, b5, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('all ok')
