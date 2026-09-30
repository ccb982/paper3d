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

  /** 已用配额 = 累计生成 − **回收退款**（回收/清场归还编制）。**击杀不消耗配额**（用户定 2026-09-29：
   *  按**在场兵力**卡上限——打死几个就补几个，非总攻也能补满到 cap）。 */
  get deployed(): number {
    return Math.max(0, this.spawned - this.recalled - this.removed);
  }

  /** ★ 已消耗配额 = 累计生成 − 累计回收/清场（**击杀不返还**；用户定 2026-09-30） */
  get committed(): number {
    return Math.max(0, this.spawned - this.recalled - this.removed);
  }

  /** 还能生成多少（两个变量取小：配额剩余 ∧ 并发上限剩余） */
  get remaining(): number {
    if (this.total <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(this.total - this.committed, this.releaseCap - this.alive));
  }

  /** ★ 生成闸门（唯一判据；**两个独立变量**，用户定 2026-09-30）：
   *  · **配额 total**（当日总量；HUD"击杀/上限"显示；**累计消耗 committed** 卡：
   *    击杀**不返还**；回收/清场 recalled/removed **归还编制**）；
   *  · **上限 releaseCap**（并发在场上限；**不展示**；随事态函数 p 增大 → 由指挥器写入
   *    `ceil(total × releaseAt(p))`；在场上限只卡 alive，不消耗配额）。
   *  生成 = 两者同时满足：committed < total ∧ alive < releaseCap。 */
  canSpawn(): boolean {
    if (this.total <= 0) return true;
    return this.committed < this.total && this.alive < this.releaseCap;
  }

  /** 换日 / 首次出击：按威胁预计算总数并清零（放行上限 = 0：落地后由指挥器按节律放开）。
   *  ★ aliveNow = 清零时已在场存活数（用户定 2026-09-27）：**重计入 spawned/alive**——
   *    否则开局初始布置的单位之后被回收时只加 recalled 不加 spawned → `recalled > spawned`（统计失真）。 */
  beginDay(threat: ThreatProfile, expectedMinutes = 12, aliveNow = 0): void {
    this.total = estimateDailyTotal(threat, expectedMinutes);
    this.spawned = Math.max(0, Math.round(aliveNow));
    this.alive = this.spawned;
    this.kills = 0;
    this.recalled = 0;
    this.removed = 0;
    this.releaseCap = 0;
    this.recallBy = { stuck: 0, recycled: 0, other: 0 };
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

  /** 回收（不算击杀；存活 −1）★ 按原因分桶（用户定 2026-09-27）：stuck=判官回收 / recycled=LOD清场 / other */
  recallBy: { stuck: number; recycled: number; other: number } = { stuck: 0, recycled: 0, other: 0 };
  noteRecall(count = 1, reason?: string): void {
    if (count <= 0) return;
    this.recalled += count;
    this.alive = Math.max(0, this.alive - count);
    if (reason === 'stuck') this.recallBy.stuck += count;
    else if (reason === 'recycled') this.recallBy.recycled += count;
    else this.recallBy.other += count;
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
