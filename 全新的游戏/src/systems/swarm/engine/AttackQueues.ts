// ============================================================
// engine/AttackQueues.ts —— 攻击队列（重写 P3；用户定 2026-09-24）
// ============================================================
// 比逐单位索敌简单：维护"以玩家为半径""以舰船为半径"两个队列（后续可加祖宗/友军）。
//   · 入队：**敌人离哪个实体近就进哪个队列**（去重：一个敌人只在一个队列）
//   · 更新：**1Hz**（入队 / 去重 / 开火检验都在这一拍）
//   · 开火许可 = **闩锁态**：一旦允许 → 持续开火，直到许可被去除
// 开火条件（射程/视线/ROE）与闩锁存储（TimerManager）都由外部注入。
// 纯逻辑（零分配 Map 复用）→ 可独立自检。
// ============================================================

export type QueueOwner = 'player' | 'ship' | 'ancestor' | 'ally';

export interface QueueEntity {
  uid: number;
  x: number;
  z: number;
}

/** 闩锁存储（TimerManager 实现；本文件只置/撤） */
export interface FireLatch {
  allowFire(uid: number, on: boolean): void;
  canFire(uid: number): boolean;
}

interface Owner {
  kind: QueueOwner;
  x: number;
  z: number;
}

export class AttackQueues {
  private readonly owners: Owner[] = [];
  private readonly members = new Map<QueueOwner, number[]>();
  private readonly ownerOf = new Map<number, QueueOwner>();
  /** 探针契约（G9） */
  readonly dbg = { queues: 0, members: 0, moved: 0, allowed: 0, revoked: 0, last: '' };

  /** 设置/更新队列圆心（玩家/舰船；后续可加祖宗/友军） */
  setOwner(kind: QueueOwner, x: number, z: number): void {
    const cur = this.owners.find((o) => o.kind === kind);
    if (cur) {
      cur.x = x;
      cur.z = z;
      return;
    }
    this.owners.push({ kind, x, z });
    this.members.set(kind, []);
    this.dbg.queues = this.owners.length;
  }

  /** 1Hz 更新：最近实体入队（去重）+ 开火检验 → 许可闩锁 */
  update(entities: readonly QueueEntity[], canFire: (uid: number) => boolean, latch: FireLatch): void {
    const dbg = this.dbg;
    dbg.moved = 0;
    dbg.allowed = 0;
    dbg.revoked = 0;
    for (const arr of this.members.values()) arr.length = 0;
    const prev = new Map(this.ownerOf);
    this.ownerOf.clear();
    for (const e of entities) {
      // ① 最近实体 → 入队（去重：只记一个队列）
      let best: QueueOwner | null = null;
      let bd = Infinity;
      for (const o of this.owners) {
        const d = Math.hypot(e.x - o.x, e.z - o.z);
        if (d < bd) {
          bd = d;
          best = o.kind;
        }
      }
      if (best === null) continue;
      this.ownerOf.set(e.uid, best);
      this.members.get(best)?.push(e.uid);
      if (prev.get(e.uid) !== undefined && prev.get(e.uid) !== best) dbg.moved++;
      // ② 开火检验 → 闩锁（允许后持续，直到撤除）
      const ok = canFire(e.uid);
      const had = latch.canFire(e.uid);
      if (ok && !had) {
        latch.allowFire(e.uid, true);
        dbg.allowed++;
      } else if (!ok && had) {
        latch.allowFire(e.uid, false);
        dbg.revoked++;
      }
    }
    // ③ 离场者撤许可（不在本拍实体里）
    for (const uid of prev.keys()) {
      if (!this.ownerOf.has(uid)) latch.allowFire(uid, false);
    }
    dbg.members = entities.length;
    dbg.last = `q=${this.owners.length} n=${entities.length} allow+${dbg.allowed} -${dbg.revoked} move=${dbg.moved}`;
  }

  /** 调试查询：某敌人在哪个队列（去重结果；自检/探针只读） */
  ownerOfUid(uid: number): QueueOwner | null {
    return this.ownerOf.get(uid) ?? null;
  }

  /** 调试查询：队列成员（自检/探针只读） */
  membersOf(kind: QueueOwner): readonly number[] {
    return this.members.get(kind) ?? [];
  }

  clear(): void {
    this.owners.length = 0;
    this.members.clear();
    this.ownerOf.clear();
    this.dbg.queues = 0;
    this.dbg.members = 0;
  }
}
