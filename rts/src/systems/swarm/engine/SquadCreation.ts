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
  /** ★ 事态进度 0~1（补兵节拏驱动；可选：未接 = 0） */
  posture?(): number;
  /** ★ 总攻阶段（用户定 2026-09-26：**在距舰 50m 处生成、补到上限、毁了再补、集体进攻**） */
  assault?(): boolean;
  /** ★ 总攻生成点（距舰 50m 环；可选） */
  assaultAnchor?(sec: number): { x: number; z: number } | null;
  /** ★ 补兵目标（用户定 2026-09-26）：该区**缺编队**的队长位置与缺口；
   *  新兵在队长身旁投放 → 并入该队（**队长指挥**）；null = 无可补之队 → 按锚点建新队。 */
  fillTarget?(role: MobRole, sec: number): { x: number; z: number; gap: number } | null;
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
  ) {}

  /** 每拍检查全部对应防区：缺就补、有就不放
   *  @param every 补兵间隔（秒；**策略在兵种管理器**，此处只执行） */
  tick(now: number, port: CreationPort, every: number): number {
    // ★ 总攻：提速补兵（用户定）——间隔 1s、每波最多 6 只，直到补满缺口
    const assault = port.assault?.() ?? false;
    const everySec = assault ? Math.min(every, 1) : every;
    for (const sec of port.mainSectors()) {
      if ((this.grace.get(sec) ?? 0) > now) continue;          // 节拍/在途 → 幂等
      const target = port.unitTarget ? port.unitTarget(this.role) : this.unitTarget;
      const alive = port.aliveInSector(this.role, sec);
      if (alive >= target) continue;                           // 已满编 → 不放
      // ★ 总攻（用户定 2026-09-26）：**新兵一律在 50m 环（主攻方向各防区中角）部署**，
      //   不并入现役队（不贴舰刷兵）。
      const fill = assault ? null : (port.fillTarget?.(this.role, sec) ?? null);
      const a = fill ? { x: fill.x, z: fill.z }
        : (assault ? (port.assaultAnchor?.(sec) ?? port.anchorOf(sec)) : port.anchorOf(sec));
      if (!a) continue;                                        // 无锚点（非对应防区）→ 拒建
      const need = Math.min((assault ? 6 : BURST), target - alive, fill ? fill.gap : Number.POSITIVE_INFINITY);
      let n = 0;
      for (let k = 0; k < need; k++) {
        if (!port.spawn(this.role, a.x + (k - 1) * 1.5, a.z)) break;
        n++;
      }
      if (n > 0) { this.grace.set(sec, now + everySec); this.spawned += n; }
    }
    return this.spawned;
  }

  clear(): void {
    this.grace.clear();
    this.spawned = 0;
  }
}
