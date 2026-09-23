// ============================================================
// SwarmLedger —— 蜂群伤亡账本（引擎直管；唯一生成 / 存活 / 击杀口径）
// ============================================================
// 定调（2026-09-20 用户）：
//   · 「击杀」与「今日上限」由蜂群引擎直管，模式层 / 存档只做镜像
//   · 「当前存活」是引擎内部计数（**不上 HUD**，只用于引擎自身判断）
//   · 伤亡上报是**独立通道**：代理 / 队长 / 实体都只报"死了一个"，不需要兵种
//   · 生成也只有一个口：引擎 `spawn()` 自增；计划外直建实体（Boss，swarmUid=0）不入账
//
// 计数规则（唯一口径）：
//   alive    = 当前存活；引擎创建兵 +1；被击杀 −1；被 LOD 清除 −1；其他离场 −1
//   kills    = 击杀计数；只有"被击杀"才 +1（LOD 清除 / 回收**不算**）
//   total    = 当日兵力计划（beginDay 按威胁预计算一次后冻结，只作生成闸门）
//   spawned  = 累计生成（只增）
//   recalled = 回收/清除累计（存活 −1，不算击杀）
//   ★ 生成闸门 = (spawned − recalled − removed) < total：
//     回收的兵**归还编制**，换登陆点后可原样重新统一布置（回收数 ≈ 下次放置数）。
// ============================================================

import type { ThreatProfile } from './EnemyScaling';

export interface SwarmLedgerSnapshot {
  total: number;
  spawned: number;
  alive: number;
  kills: number;
  recalled: number;
  /** 非击杀离场（可省：seed 时按 spawned − alive − kills − recalled 推导） */
  removed?: number;
}

export class SwarmLedger {
  /** 当日敌人总数（计划值；冻结，只作生成闸门） */
  total = 0;
  /** 累计生成（只增） */
  spawned = 0;
  /** ★ 当前存活（引擎创建 +1 / 击杀 −1 / LOD 清除 −1 / 其他离场 −1） */
  alive = 0;
  /** ★ 击杀计数（只有"被击杀"才 +1） */
  kills = 0;
  /** 远距 LOD 清除累计（不算击杀） */
  recalled = 0;
  /** 其他非击杀离场累计（主动清场等；同样归还编制） */
  removed = 0;
  /** ★ M2：日节律放行上限（指挥器每拍按 releaseAt(t01) 写入；早间只放少量，波峰放宽） */
  releaseCap = 0;

  /** 已消耗的计划额度（场上 + 已击杀；回收/离场不算） */
  get deployed(): number {
    return Math.max(0, this.spawned - this.recalled - this.removed);
  }

  /** 有效放行上限 = min(当日计划, 日节律放行) */
  private cap(): number {
    if (this.total <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.min(this.total, Math.max(0, this.releaseCap));
  }

  /** 还能生成多少（total <= 0 = 未初始化 → 无限，交 beginDay 兜底） */
  get remaining(): number {
    return this.total <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, this.cap() - this.deployed);
  }

  /** 生成闸门（唯一判据；生成口在 SwarmSystem.spawn） */
  canSpawn(): boolean {
    return this.total <= 0 || this.deployed < this.cap();
  }

  /** 换日 / 首次出击：按威胁预计算总数并清零（放行上限 = 0：落地后由指挥器按节律放开） */
  beginDay(threat: ThreatProfile, expectedMinutes = 12): void {
    this.total = estimateDailyTotal(threat, expectedMinutes);
    this.spawned = 0;
    this.alive = 0;
    this.kills = 0;
    this.recalled = 0;
    this.removed = 0;
    this.releaseCap = 0;
  }

  /** 同日再出击：从存档镜像回灌（进度累计，总数不重算） */
  seed(s: SwarmLedgerSnapshot): void {
    this.total = s.total;
    this.spawned = s.spawned;
    this.kills = s.kills;
    this.recalled = s.recalled;
    // 旧档无 alive：按 生成 − 击杀 − 回收 兜底
    this.alive = typeof s.alive === 'number' && s.alive >= 0
      ? s.alive
      : Math.max(0, s.spawned - s.kills - s.recalled);
    // 旧档无 removed：按不变量推导
    this.removed = typeof s.removed === 'number' && s.removed >= 0
      ? s.removed
      : Math.max(0, this.spawned - this.alive - this.kills - this.recalled);
    // ★ M2：同日再出击 → 放行上限先给满（指挥器首拍会按当日节律重新收放）
    this.releaseCap = this.total;
  }

  /** 镜像导出（写档用；复用 out 零分配） */
  snapshot(out?: SwarmLedgerSnapshot): SwarmLedgerSnapshot {
    const o = out ?? { total: 0, spawned: 0, alive: 0, kills: 0, recalled: 0, removed: 0 };
    o.total = this.total;
    o.spawned = this.spawned;
    o.alive = this.alive;
    o.kills = this.kills;
    o.recalled = this.recalled;
    o.removed = this.removed;
    return o;
  }

  /** 唯一生成口：累计生成 +1、当前存活 +1 */
  noteSpawn(count = 1): void {
    if (count <= 0) return;
    this.spawned += count;
    this.alive += count;
  }

  /** ★ 唯一伤亡通道（代理 / 队长 / 实体共用；只报数量，不必知道兵种）
   *  被击杀：存活 −1、击杀 +1 */
  reportCasualty(count = 1): void {
    if (count <= 0) return;
    this.kills += count;
    this.alive = Math.max(0, this.alive - count);
  }

  /** 远距 LOD 清除：存活 −1（不算击杀） */
  noteRecall(count = 1): void {
    if (count <= 0) return;
    this.recalled += count;
    this.alive = Math.max(0, this.alive - count);
  }

  /** 其他非击杀离场（主动清场等）：存活 −1（不算击杀；同样归还编制） */
  noteRemoved(count = 1): void {
    if (count <= 0) return;
    this.removed += count;
    this.alive = Math.max(0, this.alive - count);
  }

  clear(): void {
    this.total = 0;
    this.spawned = 0;
    this.alive = 0;
    this.kills = 0;
    this.recalled = 0;
    this.removed = 0;
    this.releaseCap = 0;
  }
}

/** 按威胁档位预计算当日敌人总数（原 KillCounter 口径：袭击期望 + 环境补怪） */
export function estimateDailyTotal(threat: ThreatProfile, expectedMinutes = 12): number {
  const assaultsAvg = (threat.assaultsPerDay[0] + threat.assaultsPerDay[1]) / 2;
  const wavesAvg = (threat.assaultWaves[0] + threat.assaultWaves[1]) / 2;
  const countAvg = (threat.waveCount[0] + threat.waveCount[1]) / 2;
  // 成群兵种一窝多只 → 实际个体数约为名义的 1.35 倍
  const assaultTotal = assaultsAvg * wavesAvg * countAvg * 1.35;
  // 环境散兵：常驻目标随击杀补充 → 补怪总量 = 时长 / 补怪间隔
  const ambientSpawns = (expectedMinutes * 60) / Math.max(0.5, threat.ambientInterval);
  return Math.max(8, Math.round(assaultTotal + ambientSpawns));
}
