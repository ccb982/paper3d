// ============================================================
// engine/Protect —— 保护命令（引擎侧；用户定 2026-09-24）
// ============================================================
// 引擎职责（信息单源）：为每个保护关系**同时提供**——
//   · 被保护队伍的队长位置（G）      · 玩家位置（P）
// 队长职责（自主）：拿双点后自行 `blockCheck`（基类 entity/base/Blocking）选原子
//   （行军/行动/驻守）——规则见 `squad/CommandLang.ts`。**引擎不逐拍指挥、不算锚**。
// 本文件只管"关系登记 + 双点下发 + 过期清理"。
// 铁律 G5：保护锚（anchor=G）只在本文件产生。
// ============================================================

export interface ProtectLink {
  /** 保护者（执行保护的小队） */
  protector: number;
  /** 被保护小队（锚点 = 其队长位置） */
  protected: number;
  /** 保护锚 = G（被保护队长位置；引擎下发时解析；队长只读） */
  anchor: { x: number; z: number };
  /** 引擎提供的双点（信息单源） */
  px: number;
  pz: number;
  gx: number;
  gz: number;
}

export class Protect {
  private readonly links = new Map<number, ProtectLink>();
  /** 探针契约（G9） */
  readonly dbg = { links: 0, stale: 0, last: '' };

  /** 登记/更新保护关系（引擎决策层调用；一个保护者只带一个被保护者） */
  assign(protector: number, protectedId: number, ax: number, az: number): void {
    const cur = this.links.get(protector);
    if (cur && cur.protected === protectedId) {
      cur.anchor.x = ax;
      cur.anchor.z = az;
      return;
    }
    this.links.set(protector, {
      protector, protected: protectedId,
      anchor: { x: ax, z: az },
      px: 0, pz: 0, gx: ax, gz: az,
    });
    this.dbg.links = this.links.size;
  }

  release(protector: number): void {
    this.links.delete(protector);
    this.dbg.links = this.links.size;
  }

  linkOf(protector: number): ProtectLink | undefined {
    return this.links.get(protector);
  }

  /** 引擎节拍（1Hz）：刷新双点（玩家 P / 被保护队长 G）；G 同步为保护锚。
   *  posOf 由引擎注入（信息单源：位置只从引擎出；本文件不直读世界）。 */
  refresh(posOf: (squadId: number) => { x: number; z: number } | null, px: number, pz: number): void {
    const dbg = this.dbg;
    dbg.stale = 0;
    for (const l of this.links.values()) {
      const g = posOf(l.protected);
      if (!g) {
        dbg.stale++;
        continue;
      }
      l.px = px;
      l.pz = pz;
      l.gx = g.x;
      l.gz = g.z;
      l.anchor.x = g.x;   // 保护锚 = G（引擎下发；队长自算阻挡）
      l.anchor.z = g.z;
      dbg.last = `${l.protector}→${l.protected} G=${g.x | 0},${g.z | 0} P=${px | 0},${pz | 0}`;
    }
  }

  /** 队长按需取用（信息单源；引擎不推给成员，只给队长） */
  infoFor(protector: number): ProtectLink | null {
    return this.links.get(protector) ?? null;
  }

  /** 保护令草案（引擎发令层消费；铁律 G5：锚只在此产生） */
  orderSpecOf(protector: number): { kind: 'protect'; anchor: { x: number; z: number }; target: { x: number; z: number } } | null {
    const l = this.links.get(protector);
    if (!l) return null;
    return { kind: 'protect', anchor: { x: l.anchor.x, z: l.anchor.z }, target: { x: l.anchor.x, z: l.anchor.z } };
  }

  clear(): void {
    this.links.clear();
    this.dbg.links = 0;
  }
}
