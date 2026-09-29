# -*- coding: utf-8 -*-
import io

def load(p): return io.open(p, encoding='utf-8').read()
def save(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ============ EngineBridge：改用通用几何 + 落点修正（前部/威胁侧、取更暴露者） ============
p = 'src/systems/swarm/engine/EngineBridge.ts'
s = load(p)

old = "import { coverProtects } from '../FortifyPlanner';"
assert old in s, 'imp'
s = s.replace(old, "import { coverPoint, threePoint, type Pt } from '../CoverGeom';", 1)

old = """      if (w === undefined) { this.wardSpot.delete(r.id); continue; }
      const ward = byId.get(w) as LiveSquad;
      const built = this.wardBuilt.get(r.id);
      if (built && Math.hypot(ward.x - built.x, ward.z - built.z) <= 6) { this.wardSpot.delete(r.id); continue; }
      const p = this.wardBuildPoint(ward);
      if (p) this.wardSpot.set(r.id, p); else this.wardSpot.delete(r.id);"""
assert old in s, 'call'
s = s.replace(old, """      if (w === undefined) { this.wardSpot.delete(r.id); continue; }
      const ward = byId.get(w) as LiveSquad;
      const built = this.wardBuilt.get(r.id);
      if (built && Math.hypot(ward.x - built.x, ward.z - built.z) <= 6) { this.wardSpot.delete(r.id); continue; }
      const p = this.wardBuildPoint(r, ward);
      if (p) this.wardSpot.set(r.id, p); else this.wardSpot.delete(r.id);""", 1)

old = """  /** 建造点：保护对象前部（朝舰）1.6~3.2m，与舰共线（coverProtects 校验），取首个可站点 */
  private wardBuildPoint(ward: LiveSquad): { x: number; z: number } | null {
    const ship = this.pos.ship() ?? this.pos.player();
    if (!ship) return null;
    const vx = ward.x - ship.x, vz = ward.z - ship.z;
    const d = Math.hypot(vx, vz);
    if (d < 1e-3) return null;
    const ux = vx / d, uz = vz / d;
    for (const off of [1.6, 2.4, 3.2]) {
      const p = { x: ward.x - ux * off, z: ward.z - uz * off };
      if (!coverProtects(ship, ward, p)) continue;
      if (this.live.blockedAt?.(p.x, p.z) ?? false) continue;
      return p;
    }
    return null;
  }"""
assert old in s, 'wardBuildPoint'
s = s.replace(old, """  /** 威胁点：取离参照点更近的 玩家/舰（攻击来源单源=canFire 同口径） */
  private threatNear(near: Pt): Pt | null {
    const p = this.pos.player();
    const sh = this.pos.ship();
    if (!p) return sh;
    if (!sh) return p;
    return Math.hypot(p.x - near.x, p.z - near.z) <= Math.hypot(sh.x - near.x, sh.z - near.z) ? p : sh;
  }

  /** 建造点（用户定 2026-09-29）：受护点 = 工兵/保护对象中**更暴露者**；
   *  落点 = 受护点**前部（威胁侧）**1.6~3.2m，三点检测（通用几何）→ 取首个可站点。
   *  → 掩体永远在受护单位的前面（不再造到工兵后面）。 */
  private wardBuildPoint(eng: LiveSquad, ward: LiveSquad): Pt | null {
    const threat = this.threatNear(ward);
    if (!threat) return null;
    const dEng = Math.hypot(eng.x - threat.x, eng.z - threat.z);
    const dWard = Math.hypot(ward.x - threat.x, ward.z - threat.z);
    const unit: Pt = dEng < dWard ? { x: eng.x, z: eng.z } : { x: ward.x, z: ward.z };
    for (const off of [1.6, 2.4, 3.2]) {
      const p = coverPoint(threat, unit, off);
      if (!threePoint(threat, unit, p)) continue;
      if (this.live.blockedAt?.(p.x, p.z) ?? false) continue;
      return p;
    }
    return null;
  }""", 1)
save(p, s)
print('ok bridge')

# ============ selftest：改用 CoverGeom ============
p = 'scripts/engine-selftest.ts'
s = load(p)
old = "import { FortifyPlanner, FORTIFY_SECTORS, coverProtects } from '../src/systems/swarm/FortifyPlanner.ts';"
assert old in s, 'imp2'
s = s.replace(old, "import { FortifyPlanner, FORTIFY_SECTORS } from '../src/systems/swarm/FortifyPlanner.ts';\nimport { coverPoint, threePoint } from '../src/systems/swarm/CoverGeom.ts';", 1)

old = """console.log('[12n] coverProtects：与舰共线 + 保护对象前部');
{
  const ship = { x: 200, z: 0 };
  const u = { x: 100, z: 0 };
  ok(coverProtects(ship, u, { x: 101.6, z: 0 }), '舰侧正前 1.6m → 过（挡舰→单位弹道）');
  ok(!coverProtects(ship, u, { x: 98.4, z: 0 }), '保护对象背后 → 不过');
  ok(!coverProtects(ship, u, { x: 101.6, z: 3 }), '侧偏 3m（不与舰共线）→ 不过');
  ok(coverProtects(ship, u, { x: 101, z: 1 }), '共线容差内（垂距 1.0）→ 过');
  ok(!coverProtects(ship, u, { x: 130, z: 0 }), '离保护对象太远（>4.5m）→ 不过');
}"""
assert old in s, 'test12n'
s = s.replace(old, """console.log('[12n] CoverGeom：通用三点检测（任意 舰/敌人/掩体 点）');
{
  const threat = { x: 200, z: 0 };   // 可传舰，也可传敌人
  const u = { x: 100, z: 0 };
  const p = coverPoint(threat, u, 1.6);
  ok(Math.abs(p.x - 101.6) < 0.01 && Math.abs(p.z) < 0.01, '落点 = 受护点朝威胁 1.6m（在 威胁↔受护 之间）');
  ok(threePoint(threat, u, p), '三点检测：掩体在威胁侧、共线 → 过');
  ok(!threePoint(threat, u, { x: 98.4, z: 0 }), '掩体在受护点背后 → 不过（写反会在这里被抓）');
  ok(!threePoint(threat, u, { x: 101.6, z: 3 }), '侧偏 3m（不共线）→ 不过');
  ok(threePoint(threat, u, { x: 101, z: 1 }), '共线容差内（垂距 1.0）→ 过');
  ok(!threePoint(threat, u, { x: 130, z: 0 }), '离受护点太远（>4.5m）→ 不过');
}""", 1)
save(p, s)
print('ok test')

# ============ 文档口径 ============
p = '../战术侧架构.md'
s = load(p)
old = "> - **全阶段通用（用户定 2026-09-29）：所有坑洞/掩体建造都必须使用掩体检测**——"
assert old in s, 'doc'
new = ("> - **掩体检测 = 通用几何工具（用户定 2026-09-29）**：`CoverGeom`——任意传入**威胁点（舰/敌人）**、\n"
       ">   **受护点**、**掩体点**，自由做三点检测（`coverPoint` 落点 / `threePoint` 校验：掩体在受护点**威胁侧前部** ∧ 共线）。\n"
       "> - **全阶段通用：所有坑洞/掩体建造都必须使用掩体检测**——")
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok doc')
