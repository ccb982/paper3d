# -*- coding: utf-8 -*-
import io

def load(p): return io.open(p, encoding='utf-8').read()
def save(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)
def rep(s, old, new, tag, cnt=1):
    assert old in s, 'NOT FOUND: ' + tag
    return s.replace(old, new, cnt)

# ---------- 1. SquadTable：预留名册 ----------
p = 'src/systems/swarm/SquadTable.ts'
s = load(p)
old = """  /** ★ 施工小队（成员具备施工能力；与类型解耦（2026-09-20）） */
  builders: boolean;"""
new = """  /** ★ 施工小队（成员具备施工能力；与类型解耦（2026-09-20）） */
  builders: boolean;
  /** ★ P-L1 预留名册（用户定 2026-09-27）：远处只放队长，其余成员记**预留**（升档物化） */
  reserved?: number;
  /** 预留成员的单人血量（物化时用；0/缺省 = 用兵种满血） */
  reservedHp?: number;"""
assert old in s, 'squad fields'
s = s.replace(old, new, 1)

anchor = "  assign(uid: number, role: UnitRole, x: number, z: number, mobKind = -1, suicide = false, singleton = false, canBuild = false): Squad {"
i = s.find(anchor)
assert i >= 0, 'assign'
add = u'''  /** ★ P-L1：远处只放队长——其余成员记**预留名册**（物化时并入本队） */
  reserve(squadId: number, n: number, hp: number): void {
    const s = this.squads.get(squadId);
    if (!s || n <= 0) return;
    s.reserved = (s.reserved ?? 0) + n;
    if (hp > 0) s.reservedHp = hp;
  }

  /** 取走预留（物化）：返回数量与单人血量（取走即清零） */
  takeReserved(squadId: number): { n: number; hp: number } {
    const s = this.squads.get(squadId);
    if (!s || !s.reserved) return { n: 0, hp: 0 };
    const out = { n: s.reserved, hp: s.reservedHp ?? 0 };
    s.reserved = 0;
    return out;
  }

'''
s = s[:i] + add + s[i:]
save(p, s)
print('ok SquadTable')

# ---------- 2. WorldSpawner：队长单放 + 预留 + 物化 ----------
p = 'src/systems/spawn/WorldSpawner.ts'
s = load(p)

# 2a. lastAgentIdx 字段（挂在 tierStash 声明后）
old = """  readonly reuseDbg = { stash: 0, reuse: 0 };"""
new = """  readonly reuseDbg = { stash: 0, reuse: 0 };
  /** 最近一次 spawnSingle 落池下标（P-L1 预留名册归属用；-1 = 无） */
  private lastAgentIdx = -1;"""
assert old in s, 'lastAgentIdx'
s = s.replace(old, new, 1)

# 2b. spawnSingle：记录下标
old = """    const idx = this.deps.swarm.spawn({
      mobIndex,
      x, y: air ? sy + def.airAltitude : sy, z,"""
new = """    const idx = this.deps.swarm.spawn({
      mobIndex,
      x, y: air ? sy + def.airAltitude : sy, z,"""
assert old in s, 'spawnSingle anchor'
i = s.find(old)
j = s.find("    });", i)
assert j > i
s = s[:j] + "    });\n    this.lastAgentIdx = idx;" + s[j+len("    });"):]

# 2c. spawnOne：远处只放队长 + 记预留
old = """  spawnOne(
    def: MobDef,
    x: number, _y: number, z: number,
    assaultIndex = -1,
    /** ★ 手动放置接口（调试）：true = 忽略"水/坑不可站"与存活上限（可放水里） */
    force = false,
  ): boolean {
    let any = false;
    for (let k = 0; k < def.pack; k++) {"""
new = """  spawnOne(
    def: MobDef,
    x: number, _y: number, z: number,
    assaultIndex = -1,
    /** ★ 手动放置接口（调试）：true = 忽略"水/坑不可站"与存活上限（可放水里） */
    force = false,
  ): boolean {
    // ★ P-L1（用户定 2026-09-27）：**L1 档只放队长**——落点在 L2 半径外时，
    //   其余成员记**预留名册**（不物化、不占算力）；走近（≤L2_RADIUS）由 tickReserved 物化。
    const pp = this.deps.player?.position;
    const farL1 = !force && !!pp && Math.hypot(x - pp.x, z - pp.z) > SWARM.L2_RADIUS;
    let any = false;
    for (let k = 0; k < def.pack; k++) {"""
assert old in s, 'spawnOne head'
s = s.replace(old, new, 1)

old = """      if (this.spawnSingle(def, sx, _y, sz, assaultIndex, force)) any = true;
    }
    return any;
  }"""
new = """      if (this.spawnSingle(def, sx, _y, sz, assaultIndex, force)) {
        any = true;
        if (farL1 && k === 0 && this.lastAgentIdx >= 0) {
          const sid = this.deps.swarm.pool.squadId[this.lastAgentIdx];
          const hp = this.deps.swarm.pool.hp[this.lastAgentIdx];
          this.deps.swarm.squads.reserve(sid, def.pack - 1, hp);
          break;   // L1：只放队长
        }
      }
    }
    return any;
  }"""
assert old in s, 'spawnOne tail'
s = s.replace(old, new, 1)

# 2d. tickReserved：走近物化（1s 拍）
old = """  /** ★ 舰船遇围警示播报（**无条件开启**：探索期照常盯，航行期舰船活着也盯，
   *  跟大规模进攻节奏零耦合；舰内/舰毁才停）。"""
new = """  private reservedAccum = 0;

  /** ★ P-L1 预留物化（用户定 2026-09-27；1s 拍）：预留队**走近（≤L2_RADIUS）**→
   *  按名册在队长旁物化成员代理（就近并入本队）；未走近 → 维持队长单点。 */
  tickReserved(dt: number, px: number, pz: number): void {
    this.reservedAccum += dt;
    if (this.reservedAccum < 1) return;
    this.reservedAccum = 0;
    const pool = this.deps.swarm.pool;
    for (const s of this.deps.swarm.squads.all()) {
      const r = s.reserved ?? 0;
      if (r <= 0) continue;
      let lx = 0, lz = 0, found = false;
      for (let i = 0; i < pool.count; i++) {
        if (pool.swarmUid[i] !== s.leaderUid) continue;
        lx = pool.x[i]; lz = pool.z[i]; found = true; break;
      }
      if (!found) continue;                                    // 队长不在池（实体/已亡）：等下一拍
      if (Math.hypot(lx - px, lz - pz) > SWARM.L2_RADIUS) continue;   // 仍在 L1 → 保持预留
      const def = this.deps.mobDefs[s.mobKind] as MobDef | undefined;
      if (!def) continue;
      const { n, hp } = this.deps.swarm.squads.takeReserved(s.id);
      if (n <= 0) continue;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const mx = lx + Math.cos(a) * 2.5, mz = lz + Math.sin(a) * 2.5;
        const my = this.deps.raster.surfaceHeightAt(mx, mz);
        this.spawnSingle(def, mx, my, mz, -1, false, hp);   // 就近并入本队（≤2.5m 在并队半径内）
      }
    }
  }

""" + old
assert old in s, 'tickReserved anchor'
s = s.replace(old, new, 1)
save(p, s)
print('ok WorldSpawner')

# ---------- 3. main：每帧调 tickReserved ----------
p = 'src/main.ts'
s = load(p)
old = """    spawner.tickDemote(h, cam.tx, cam.tz);     // ★ 远距/出视野 L3 → 降格回池"""
new = """    spawner.tickDemote(h, cam.tx, cam.tz);     // ★ 远距/出视野 L3 → 降格回池
    spawner.tickReserved(h, cam.tx, cam.tz);   // ★ P-L1：预留名册走近物化（队长单点 → 队长+代理）"""
assert old in s, 'main tick'
s = s.replace(old, new, 1)
save(p, s)
print('ok main')
