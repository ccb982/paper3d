// ============================================================
// SwarmRecovery —— 卡死回收（自 SwarmSystem 拆出，控行数）
// ============================================================
//   ★ 口径从严（宁可错杀，不能放过）：**唯一命令豁免 = 驻守（garrison）**；交火期豁免。
//   代理/队长在窗口内**净活动范围**始终很小 → 自动回收（归还编制）。
//   施工/巡逻不豁免——窗口内有实际位移（包围盒 > BBOX_R）即逃逸；原地摇摆 → 清除。
//   ★ L3 实体同样回收（实体不在池里；uid ≤ 0 计划外单位不判，飞行不判）。
// ============================================================

import type { AgentPool } from './AgentPool';
import type { SquadTable } from './SquadTable';
import type { SquadTactics } from './SquadTactics';
import type { SwarmCarrier } from '../../entity/SwarmUnit';
import { AUTONOMY, STUCK } from './SwarmConfig';

export interface RecoveryHost {
  pool: AgentPool;
  squads: SquadTable;
  tactics: SquadTactics;
  recentHits: Map<number, number>;
  /** 非击杀离场（归还编制） */
  removeAgent: (i: number, killed: boolean, report: boolean) => void;
  /** 账本：归还编制 +1 */
  noteRecall: (n: number) => void;
}

export class SwarmRecovery {
  /** uid → 窗口包围盒 + 计时（豁免：驻守/到位/交战） */
  private readonly stuck = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; t: number }>();
  /** 调试计数（每次 tick 重置） */
  readonly dbg = { exempt: 0, window: 0, tracked: 0, recycled: 0, last: '' };

  constructor(private readonly h: RecoveryHost) {}

  /** 卡死回收（STUCK 参数；1Hz 调用） */
  tick(now: number, activeUnits?: () => readonly SwarmCarrier[]): void {
    const dbg = this.dbg;
    dbg.exempt = 0; dbg.window = 0; dbg.tracked = 0; dbg.recycled = 0;
    const pool = this.h.pool;
    for (let i = pool.count - 1; i >= 0; i--) {
      const uid = pool.swarmUid[i];
      const squadId = pool.squadId[i];
      const sq = this.h.squads.get(squadId);
      const st = sq ? this.h.tactics.board.get(squadId) : undefined;
      if (st?.order.kind === 'garrison') { this.stuck.delete(uid); dbg.exempt++; continue; }   // 驻守命令例外
      if (pool.noDemoteUntil[i] > now) { this.stuck.delete(uid); dbg.exempt++; continue; }     // 交战中
      const hitAt = this.h.recentHits.get(squadId);
      if (hitAt !== undefined && now - hitAt <= AUTONOMY.SQUAD_ALERT_S) { this.stuck.delete(uid); dbg.exempt++; continue; }
      const rec = this.stuck.get(uid);
      if (!rec) {
        this.stuck.set(uid, { minX: pool.x[i], maxX: pool.x[i], minZ: pool.z[i], maxZ: pool.z[i], t: 0 });
        continue;
      }
      if (pool.x[i] < rec.minX) rec.minX = pool.x[i]; else if (pool.x[i] > rec.maxX) rec.maxX = pool.x[i];
      if (pool.z[i] < rec.minZ) rec.minZ = pool.z[i]; else if (pool.z[i] > rec.maxZ) rec.maxZ = pool.z[i];
      rec.t += 1;
      // 有实际位移（包围盒扩到阈值外）→ 重开窗口（正常行军/换点）
      dbg.tracked++;
      if (rec.maxX - rec.minX > STUCK.BBOX_R || rec.maxZ - rec.minZ > STUCK.BBOX_R) {
        rec.minX = rec.maxX = pool.x[i]; rec.minZ = rec.maxZ = pool.z[i]; rec.t = 0;
        dbg.window++;
        continue;
      }
      if (rec.t >= STUCK.HOLD_S) {
        dbg.last = `${sq?.type ?? '?'}${sq?.builders ? '*' : ''}:${st?.order.kind ?? '-'}/${st?.order.mission ?? '-'}`
          + `@${pool.x[i].toFixed(0)},${pool.z[i].toFixed(0)}`
          + ` bbox=${(rec.maxX - rec.minX).toFixed(1)}x${(rec.maxZ - rec.minZ).toFixed(1)}`;
        this.h.removeAgent(i, true, false);   // 非击杀离场
        this.h.noteRecall(1);                 // 归还编制
        this.stuck.delete(uid);
        dbg.recycled++;
      }
    }
    // ★ L3 实体同样卡死回收（池循环只覆盖代理；实体不在池里 —— 用户 2026-09-21 指出的漏洞）
    const units = activeUnits?.();
    if (units) {
      for (let k = units.length - 1; k >= 0; k--) {
        const u = units[k];
        const uid = u.swarmUid;
        if (uid <= 0) { continue; }                                 // 计划外（Boss 等）
        if (u.isAir) { this.stuck.delete(uid); continue; }          // 飞行不判
        const squad = this.h.squads.squadOf(uid);
        const st = squad ? this.h.tactics.board.get(squad.id) : undefined;
        if (st?.order.kind === 'garrison') { this.stuck.delete(uid); dbg.exempt++; continue; }
        const hitAt = squad ? this.h.recentHits.get(squad.id) : undefined;
        if (hitAt !== undefined && now - hitAt <= AUTONOMY.SQUAD_ALERT_S) { this.stuck.delete(uid); dbg.exempt++; continue; }
        const x = u.position.x, z = u.position.z;
        const rec = this.stuck.get(uid);
        if (!rec) {
          this.stuck.set(uid, { minX: x, maxX: x, minZ: z, maxZ: z, t: 0 });
          continue;
        }
        if (x < rec.minX) rec.minX = x; else if (x > rec.maxX) rec.maxX = x;
        if (z < rec.minZ) rec.minZ = z; else if (z > rec.maxZ) rec.maxZ = z;
        rec.t += 1;
        if (rec.maxX - rec.minX > STUCK.BBOX_R || rec.maxZ - rec.minZ > STUCK.BBOX_R) {
          rec.minX = rec.maxX = x; rec.minZ = rec.maxZ = z; rec.t = 0;
          dbg.window++;
          continue;
        }
        dbg.tracked++;
        if (rec.t >= STUCK.HOLD_S) {
          u.retire('recycled');   // 实体退役 → enemy_removed(recycled) → 账本 noteRecall（订阅已接）
          this.stuck.delete(uid);
          dbg.recycled++;
        }
      }
    }
    if (this.stuck.size > pool.count + 256) this.stuck.clear();
  }

  clear(): void {
    this.stuck.clear();
  }
}
