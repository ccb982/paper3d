# -*- coding: utf-8 -*-
import io

# ---------- 1. EntityBase：冻结/复活（不销毁） ----------
p = 'src/entity/EntityBase.ts'
s = io.open(p, encoding='utf-8').read()
anchor = "  /** 统一退役入口（幂等）：标记状态 → 子类业务钩子 → 资源释放。"
assert anchor in s
add = u'''  /** ★ 档位收纳（用户定 2026-09-27；《移动执行重写.md》§7.4）：**冻结不销毁**——
   *  移出模拟/渲染（EntityManager），纹理/血条等对象保留；`tierRestore` 反向复活复用。 */
  private _tierStashed = false;
  get tierStashed(): boolean { return this._tierStashed; }
  tierStash(): void {
    if (this._tierStashed || this._life !== 'active') return;
    this._tierStashed = true;
    this.visible = false;
    this.em.unregister(this);
  }
  tierRestore(): void {
    if (!this._tierStashed) return;
    this._tierStashed = false;
    this.em.register(this);
    this.visible = true;
  }

''' + anchor
s = s.replace(anchor, add, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok EntityBase')

# ---------- 2. WorldSpawner：demote 收纳 / promote 复用 / drop / 计数 ----------
p = 'src/systems/spawn/WorldSpawner.ts'
s = io.open(p, encoding='utf-8').read()

# 2a. demote 尾部：retire → 收纳
old = """    e.retire('demoted');
    if (idx >= 0) this.deps.enemies.splice(idx, 1);
  }"""
new = """    // ★ 懒加载（用户定 2026-09-27）：**不销毁**——冻结并收纳进对象仓（纹理/血条保留、停更）；
    //   回 L3 由 promoteAgent 直接取出复用（不重建）。
    e.tierStash();
    if (idx >= 0) this.deps.enemies.splice(idx, 1);
    if (e.swarmUid > 0) {
      this.tierStash.set(e.swarmUid, e);
      this.reuseDbg.stash++;
    }
  }"""
assert old in s, 'demote tail'
s = s.replace(old, new, 1)

# 2b. promoteAgent：对象仓优先复用
old = """  promoteAgent(snap: AgentSnapshot): void {
    if (!this.deps.scene || !this.deps.camera) return;
    const def = this.deps.mobDefs[snap.mobIndex];
    if (!def) return;
    const enemy = this.createEnemyEntity(def, snap.x, snap.y, snap.z, snap.hp, snap.maxHp);"""
new = """  promoteAgent(snap: AgentSnapshot): void {
    if (!this.deps.scene || !this.deps.camera) return;
    const def = this.deps.mobDefs[snap.mobIndex];
    if (!def) return;
    // ★ 懒加载（用户定 2026-09-27）：对象仓有 → **取出复用**（纹理/血条不重建），快照回灌后复活
    const uid0 = snap.uid ?? 0;
    const stashed = uid0 > 0 ? this.tierStash.get(uid0) : undefined;
    if (stashed && stashed.lifeState === 'active') {
      this.tierStash.delete(uid0);
      this.reuseDbg.reuse++;
      this.deps.enemies.push(stashed);
      stashed.position.set(snap.x, snap.y, snap.z);
      stashed.hp = Math.min(snap.hp, snap.maxHp);
      stashed.hydrate(snap);
      stashed.tierRestore();   // 显示 + 重新注册（模拟/渲染恢复）
      this.byUid.set(uid0, stashed);
      return;
    }
    const enemy = this.createEnemyEntity(def, snap.x, snap.y, snap.z, snap.hp, snap.maxHp);"""
assert old in s, 'promote head'
s = s.replace(old, new, 1)

# 2c. dropStashByUid + reuseDbg（挂在 tierStash 声明处）
old = """  private readonly tierStash = new Map<number, EnemyBase>();"""
new = """  private readonly tierStash = new Map<number, EnemyBase>();
  /** 懒加载探针：stash = 收纳次数 / reuse = 取出复用次数（应≈1:1，reuse 说明没重建） */
  readonly reuseDbg = { stash: 0, reuse: 0 };

  /** 彻底移除：对象仓同 uid 一并丢弃（真死/清场；防漏对象） */
  dropStashByUid(uid: number): void {
    const e = this.tierStash.get(uid);
    if (!e) return;
    this.tierStash.delete(uid);
    e.retire('recycled');
  }"""
assert old in s, 'tierStash decl'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok WorldSpawner')

# ---------- 3. main：真死/回收时清对象仓（retire 回池分支） ----------
p = 'src/main.ts'
s = io.open(p, encoding='utf-8').read()
old = """        return swarm.recycleByUid(uid, why);"""
assert old in s, 'main recycle branch'
s = s.replace(old, """        spawner.dropStashByUid(uid);
        return swarm.recycleByUid(uid, why);""", 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok main')
