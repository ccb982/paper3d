# R28 patch: 涉水（目标落水→岸上点 + 水中降分离） + 爬掩体（沿路才爬）
import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (path, a[:50])
        s = s.replace(a, b, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)

# ---------- 1) CharacterBase：沿路才爬 + 水中降分离 ----------
patch('rts/src/entity/CharacterBase.ts', [
 ("""          if (this.canClimbCovers && o.walkableTop && rise > 0.4 && rise <= CharacterBase.CLIMB_MAX) {
            const len = Math.hypot(push.dx, push.dz) || 1;
            this.climbCand = { top, ix: -push.dx / len, iz: -push.dz / len };
          }""",
  """          if (this.canClimbCovers && o.walkableTop && rise > 0.4 && rise <= CharacterBase.CLIMB_MAX) {
            const len = Math.hypot(push.dx, push.dz) || 1;
            const ix = -push.dx / len, iz = -push.dz / len;   // \u6307\u5411\u63a9\u4f53\uff08\u63a8\u6324\u53cd\u65b9\u5411\uff09
            // \u2605 \u6cbf\u8def\u624d\u722c\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a\u53ea\u6709\u671f\u671b\u65b9\u5411\u671d\u63a9\u4f53\uff08\u63a9\u4f53\u5728\u8def\u4e0a\uff09\u624d\u89e6\u53d1\u722c\uff0c\u9632\u884c\u519b\u8def\u8fc7\u53cd\u590d\u7ffb
            const md = this.controller.moveDir;
            const want = Math.hypot(md.x, md.y) || 1;
            const into = (md.x * ix + md.y * iz) / want;
            if (into > 0.6) this.climbCand = { top, ix, iz };
          }"""),
 ("""      p.x += sep.ax;
      p.z += sep.az;""",
  """      // \u2605 \u6c34\u4e2d\u964d\u4f4e\u5206\u79bb\u63a8\u6324\uff08\u7528\u6237\u5b9a 2026-09-25\uff1a\u9632\u88ab\u6324\u51fa\u5cb8\u7ebf\u632f\u8361\uff09
      const wet = RasterMap.current?.tileDefAt(p.x, p.z).genRole === 'liquid';
      const sepK = wet ? 0.3 : 1;
      p.x += sep.ax * sepK;
      p.z += sep.az * sepK;"""),
])

# ---------- 2) EnemyBase：重新开启爬掩体（有沿路门控） ----------
patch('rts/src/entity/EnemyBase.ts', [
 ("""    // \u2605 \u654c\u4eba\u5148\u4e0d\u722c\u63a9\u4f53\uff08RTS\uff1a\u884c\u519b\u8def\u8fc7\u63a9\u4f53\u53cd\u590d\u7ffb\u2192\u5361\uff1bTODO\uff1a\u540e\u7eed\u6539'\u6cbf\u8def\u624d\u722c'\uff09
    this.canClimbCovers = false;""",
  """    // \u2605 \u722c\u63a9\u4f53\u5f00\u542f\uff0c\u4f46\u6709'\u6cbf\u8def\u624d\u722c'\u95e8\u63a7\uff08CharacterBase\uff1a\u671f\u671b\u65b9\u5411\u671d\u63a9\u4f53\u624d\u89e6\u53d1\uff09"""),
])

# ---------- 3) SwarmCommander：fixWaterTarget + issueChecked 应用 ----------
patch('rts/src/systems/swarm/SwarmCommander.ts', [
 ("""  /** \u2605 \u73af\u5f62\u5939\u53d6\uff08\u516c\u5f00\u7ed9 SquadTactics/\u961f\u957f\u4ee4\u540c\u95e8\uff09\uff1a\u5f84\u5411\u5939\u8fdb [\u4e0b\u9650, \u4e0a\u9650]\uff1b""",
  """  /** \u2605 \u76ee\u6807\u843d\u6c34\u4fee\u6b63\uff08\u7528\u6237\u5b9a 2026-09-25\uff09\uff1a\u70b9\u5728\u6c34\u57df \u2192 \u627e\u6700\u8fd1**\u975e\u6c34\u4e14\u53ef\u7ad9**\u70b9\uff08r=4..24m, 16 \u5411\uff09 */
  fixWaterTarget(x: number, z: number): { x: number; z: number } {
    if (!this.terrainScore.isWaterAt(x, z)) return { x, z };
    for (let r = 4; r <= 24; r += 4) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const cx = Math.round((x + Math.cos(a) * r) / 2) * 2;
        const cz = Math.round((z + Math.sin(a) * r) / 2) * 2;
        if (this.terrainScore.isWaterAt(cx, cz)) continue;
        if (this.terrainScore.scoreAt(cx, cz) === null) continue;
        return { x: cx, z: cz };
      }
    }
    return { x, z };
  }

  /** \u2605 \u73af\u5f62\u5939\u53d6\uff08\u516c\u5f00\u7ed9 SquadTactics/\u961f\u957f\u4ee4\u540c\u95e8\uff09\uff1a\u5f84\u5411\u5939\u8fdb [\u4e0b\u9650, \u4e0a\u9650]\uff1b"""),
 ("""    if (!exempt && eff && this.frontMinD >= 0 && this.frontMaxD >= 0 && (this.lastShipX !== 0 || this.lastShipZ !== 0)) {
      const c = this.clampToRing(eff.x, eff.z);
      if (c.x !== eff.x || c.z !== eff.z) {
        eff = { ...eff, x: c.x, z: c.z };
        if (sub) order = { ...order, subTargets: order.subTargets!.map((t) => (t.squadId === squadId ? { ...t, x: c.x, z: c.z } : t)) };
        else order = { ...order, target: { ...order.target, x: c.x, z: c.z } };
      }
    }""",
  """    if (!exempt && eff && this.frontMinD >= 0 && this.frontMaxD >= 0 && (this.lastShipX !== 0 || this.lastShipZ !== 0)) {
      const c = this.clampToRing(eff.x, eff.z);
      if (c.x !== eff.x || c.z !== eff.z) {
        eff = { ...eff, x: c.x, z: c.z };
        if (sub) order = { ...order, subTargets: order.subTargets!.map((t) => (t.squadId === squadId ? { ...t, x: c.x, z: c.z } : t)) };
        else order = { ...order, target: { ...order.target, x: c.x, z: c.z } };
      }
    }
    // \u2605 \u76ee\u6807\u843d\u6c34 \u2192 \u6700\u8fd1\u5cb8\u4e0a\u53ef\u7ad9\u70b9\uff08\u7528\u6237\u5b9a 2026-09-25\uff1b\u64a4\u9000/rear \u8c41\u514d\uff09
    if (!exempt && eff) {
      const w = this.fixWaterTarget(eff.x, eff.z);
      if (w.x !== eff.x || w.z !== eff.z) {
        eff = { ...eff, x: w.x, z: w.z };
        if (sub) order = { ...order, subTargets: order.subTargets!.map((t) => (t.squadId === squadId ? { ...t, x: w.x, z: w.z } : t)) };
        else order = { ...order, target: { ...order.target, x: w.x, z: w.z } };
      }
    }"""),
])

# ---------- 4) SquadTactics：waterFix 钩子（队长令同门） ----------
patch('rts/src/systems/swarm/SquadTactics.ts', [
 ("""  /** \u2605 \u4e8b\u6001\u73af\u5f62\u5939\u53d6\uff08\u6a21\u5f0f\u5c42\u6ce8\u5165\uff1b\u5f15\u64ce\u4ee4\u4e0e\u961f\u957f\u4ee4\u540c\u95e8\uff09\u2014\u2014\u64a4\u9000/rear \u7531\u6ce8\u5165\u65b9\u8c41\u514d */
  ringClamp: ((x: number, z: number) => { x: number; z: number }) | null = null;""",
  """  /** \u2605 \u4e8b\u6001\u73af\u5f62\u5939\u53d6\uff08\u6a21\u5f0f\u5c42\u6ce8\u5165\uff1b\u5f15\u64ce\u4ee4\u4e0e\u961f\u957f\u4ee4\u540c\u95e8\uff09\u2014\u2014\u64a4\u9000/rear \u7531\u6ce8\u5165\u65b9\u8c41\u514d */
  ringClamp: ((x: number, z: number) => { x: number; z: number }) | null = null;
  /** \u2605 \u76ee\u6807\u843d\u6c34\u4fee\u6b63\uff08\u6a21\u5f0f\u5c42\u6ce8\u5165\uff1b\u4e0e\u5f15\u64ce\u540c\u95e8\uff09 */
  waterFix: ((x: number, z: number) => { x: number; z: number }) | null = null;"""),
 ("""    if (this.ringClamp && o.target && o.kind !== 'retreat' && o.mission !== 'rear') {
      const c = this.ringClamp(o.target.x, o.target.z);
      o.target = { x: c.x, z: c.z };
    }""",
  """    if (this.ringClamp && o.target && o.kind !== 'retreat' && o.mission !== 'rear') {
      const c = this.ringClamp(o.target.x, o.target.z);
      o.target = { x: c.x, z: c.z };
    }
    if (this.waterFix && o.target && o.kind !== 'retreat' && o.mission !== 'rear') {
      const w = this.waterFix(o.target.x, o.target.z);
      o.target = { x: w.x, z: w.z };
    }"""),
])

# ---------- 5) SwarmSystem.applyOrders：锚点也做落水修正 ----------
patch('rts/src/systems/swarm/SwarmSystem.ts', [
 ("""      {
        const c = this.commander.clampToRing(ax, az);
        ax = c.x; az = c.z;
      }""",
  """      {
        const c = this.commander.clampToRing(ax, az);
        ax = c.x; az = c.z;
        const w = this.commander.fixWaterTarget(ax, az);   // \u2605 \u951a\u70b9\u843d\u6c34 \u2192 \u5cb8\u4e0a\u53ef\u7ad9\u70b9
        ax = w.x; az = w.z;
      }"""),
])

# ---------- 6) main：接线 waterFix ----------
patch('rts/src/main.ts', [
 ("""  swarm.tactics.ringClamp = (x, z) => swarm.commander.clampToRing(x, z);""",
  """  swarm.tactics.ringClamp = (x, z) => swarm.commander.clampToRing(x, z);
  swarm.tactics.waterFix = (x, z) => swarm.commander.fixWaterTarget(x, z);   // \u2605 \u843d\u6c34\u76ee\u6807 \u2192 \u5cb8\u4e0a\u53ef\u7ad9\u70b9\uff08\u961f\u957f\u4ee4\u540c\u95e8\uff09"""),
])
print('ALL OK')
