// ============================================================
// engine/SquadCreation —— 统一创建接口（《战术侧架构.md》§3.D；用户定 2026-09-26）
// ============================================================
// 语法约束（硬）：
//   ① **只建本兵种**：构造时绑定 role，spawn 只会以该 role 调用生成口（禁越权）；
//   ② **只在对应防区**：仅对 `port.mainSectors()` 返回的防区创建，且该防区必须有部署锚点；
//   ③ 有队就不放、没有就放；**在途记账**（grace）→ 幂等，防连拍重复建队。
// ============================================================

import type { MobRole } from './contracts';

export interface CreationPort {
  /** 对应防区（主攻/认领）——创建的唯一合法范围 */
  mainSectors(): readonly number[];
  /** 该防区本兵种**现役人数**（按人头补到满编） */
  aliveInSector(role: MobRole, sec: number): number;
  /** ★ 该防区目标人头（按占比推导；接线层给；未接 = 用构造默认） */
  unitTarget?(role: MobRole): number;
  /** 防区部署锚点（无 = 该区不可创建） */
  anchorOf(sec: number): { x: number; z: number } | null;
  /** 原子生成口（只被管理器调用） */
  spawn(role: MobRole, x: number, z: number): boolean;
}

/** 一队成员数（生成时一次投放，交给 SquadTable 并队） */
const BURST = 3;

export class SquadCreation {
  private readonly grace = new Map<number, number>();
  /** 累计生成（探针） */
  spawned = 0;

  constructor(
    /** 本管理器兵种（创建只此一种） */
    private readonly role: MobRole,
    /** 每防区目标**人数**（按占比配置；补到满编） */
    private readonly unitTarget: number,
    /** 在途宽限（秒） */
    private readonly graceS = 25,
  ) {}

  /** 每拍检查全部对应防区：缺就补、有就不放（进图首建与阵亡补建同一条路） */
  tick(now: number, port: CreationPort): number {
    for (const sec of port.mainSectors()) {
      if ((this.grace.get(sec) ?? 0) > now) continue;          // 在途 → 幂等
      const target = port.unitTarget ? port.unitTarget(this.role) : this.unitTarget;
      const alive = port.aliveInSector(this.role, sec);
      if (alive >= target) continue;                           // 已满编 → 不放
      const a = port.anchorOf(sec);
      if (!a) continue;                                        // 无锚点（非对应防区）→ 拒建
      const need = Math.min(BURST, target - alive);
      let n = 0;
      for (let k = 0; k < need; k++) {
        if (!port.spawn(this.role, a.x + (k - 1) * 1.5, a.z)) break;
        n++;
      }
      if (n > 0) { this.grace.set(sec, now + this.graceS); this.spawned += n; }
    }
    return this.spawned;
  }

  clear(): void {
    this.grace.clear();
    this.spawned = 0;
  }
}
