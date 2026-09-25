// ============================================================
// SquadDispatch —— 队长层：队令 → 成员指令（成员分派唯一写口）
// ============================================================
// 用户定 2026-09-24：只有队长和蜂群引擎发命令；成员只执行队长的长寻路或听队长调遣。
//   · 长寻路：ensurePath（命令目标不可直达 → 走廊）
//   · 锚点：步令 > resolveAnchor（护卫/驻守站位）+ 夹环 + 落水修正
//   · 分派：decompose（角色桶 / 残血 fallback）+ 阵型槽位
//   · 保护：OrderGate（时间+距离+记忆）
//   · 写口：池列（L2）/ onDirective（L3）
// 引擎（SwarmSystem）只做命令轨（到期/isActive）后调用本层，不写成员指令。

import type { AgentPool } from './AgentPool';
import type { Squad, SquadTable } from './SquadTable';
import { SquadTactics, type SquadOrderState } from './SquadTactics';
import { resolveAnchor } from './squad/Anchor';
import type { SquadNavigator } from './SquadNavigator';
import { formationOffset } from './squad/Formation';
import { OrderGate } from './OrderGate';
import { DIRECTIVE_GATE } from './SwarmConfig';
import {
  squadBucket, orderCode, directiveCode, fireCode,
  type MobTactics, type TacticalOrder, type UnitDirective,
} from '../../entity/SwarmUnit';
import type { TerrainCover } from './UnitTactics';

export interface DispatchWorld {
  clampToRing(x: number, z: number): { x: number; z: number };

  terrain: TerrainCover | null;
}

export interface DispatchHooks {
  onDirective?: (uid: number, order: TacticalOrder, directive: UnitDirective, until: number) => void;
  mobTactics?: (mobIndex: number) => MobTactics | null;
}

export interface DispatchDeps {
  pool: AgentPool;
  squads: SquadTable;
  tactics: SquadTactics;
  nav: SquadNavigator;
  world: DispatchWorld;
  alerted(squadId: number): boolean;
  /** ★ 引擎开火闩锁（AttackQueues/TimerManager）：false → 本拍指令软禁火（fire=hold） */
  fireAllowed(uid: number): boolean;
}

const _uids: number[] = [];

export class SquadDispatch {
  private readonly gate = new OrderGate(DIRECTIVE_GATE);
  private readonly _centroid = { x: 0, z: 0 };
  readonly dbg = this.gate.dbg;

  constructor(private readonly deps: DispatchDeps) {}

  /** 队长调遣：一次队令 → 全队成员指令（2Hz 由系统驱动；seen 供记忆表清理） */
  run(squad: Squad, state: SquadOrderState, now: number, hooks: DispatchHooks, seen: Set<number>): void {
    const { pool, squads, tactics, nav, world } = this.deps;
    // ★ 命令纪元（成员指令记忆的作废键）：命令目标（8m 粗哈希）变 = 新命令 → 记忆作废
    const ot = state.order.target;
    const epoch = ot ? Math.round(ot.x / 8) * 100003 + Math.round(ot.z / 8) : 0;
    nav.ensurePath(squads, squad, state, now);
    const bucket = squadBucket(squad.type);
    // ★ 无质心（用户定 2026-09-24）：一切按**队长**——队长走走廊锚点，成员围队长跟。
    const leadInfo = squad.members.get(squad.leaderUid);
    let ax = state.order.target?.x ?? 0;
    let az = state.order.target?.z ?? 0;
    let fx = 1, fz = 0;
    const stepState = tactics.board.getPath(squad.id);
    const stepTgt = stepState && now < stepState.until ? stepState.order.target : null;
    if (stepTgt) {
      ax = stepTgt.x;
      az = stepTgt.z;
    } else if (leadInfo) {
      const tgt = resolveAnchor(state, leadInfo.x, leadInfo.z, squad.type, now, world.terrain);
      if (tgt) { ax = tgt.x; az = tgt.z; }
    }
    {
      const c = world.clampToRing(ax, az);
      ax = c.x; az = c.z;   // ★ 水=正常地块（用户定 2026-09-24）：去掉落水修正
    }
    if (leadInfo) {
      const adx = ax - leadInfo.x, adz = az - leadInfo.z;
      const al = Math.hypot(adx, adz);
      if (al > 1e-3) { fx = adx / al; fz = adz / al; }
    }
    const mx = leadInfo ? leadInfo.x : ax;   // 成员围绕队长（"只要跟随队长"）
    const mz = leadInfo ? leadInfo.z : az;
    _uids.length = 0;
    for (const uid of squad.members.keys()) _uids.push(uid);
    for (const [uid, info] of squad.members) {
      const hpRatio = info.maxHp > 0 ? info.hp / info.maxHp : 1;
      const directive = tactics.decompose(
        squad, bucket, now, hpRatio, hooks.mobTactics?.(squad.mobKind) ?? null, world.terrain,
      );
      // ★ 开火闩锁（新引擎）：许可未置/被撤 → 软禁火（fire=hold；原子仍可执行）
      if (!this.deps.fireAllowed(uid)) directive.fire = 'hold';
      if (!squad.singleton) {
        let rank = 0;
        for (const m of _uids) if (m < uid) rank++;
        const off = formationOffset(squad.type, rank);
        if (uid === squad.leaderUid) {
          directive.targetX = ax;   // 队长走走廊锚点（长寻路）
          directive.targetZ = az;
        } else {
          directive.targetX = mx + fx * off.fx - fz * off.fz;   // 成员围队长
          directive.targetZ = mz + fz * off.fx + fx * off.fz;
        }
      }
      seen.add(uid);
      let found = false;
      for (let i = 0; i < pool.count; i++) {
        if (pool.swarmUid[i] !== uid) continue;
        if (directive.targetX !== undefined && directive.targetZ !== undefined) {
          const g = this.gate.decide(uid, directive.kind, directive.targetX, directive.targetZ,
            pool.x[i], pool.z[i], now);
          directive.targetX = g.x;
          directive.targetZ = g.z;
        }
        pool.orderKind[i] = orderCode(state.order.kind);
        pool.orderTargetX[i] = ax;
        pool.orderTargetZ[i] = az;
        pool.orderUntil[i] = state.until;
        pool.orderSeq[i] = state.order.seq;
        pool.directiveKind[i] = directiveCode(directive.kind);
        pool.directiveTargetX[i] = directive.targetX ?? 0;
        pool.directiveTargetZ[i] = directive.targetZ ?? 0;
        pool.directiveWard[i] = directive.wardUid ?? 0;
        pool.directiveUntil[i] = directive.until;
        pool.directiveFire[i] = fireCode(directive.fire);
        pool.directiveSpeedMul[i] = directive.speedMul;
        pool.directiveSeq[i] = directive.seq;
        found = true;
        break;
      }
      if (!found) {
        if (directive.targetX !== undefined && directive.targetZ !== undefined) {
          const g = this.gate.decide(uid, directive.kind, directive.targetX, directive.targetZ,
            info.x, info.z, now);
          directive.targetX = g.x;
          directive.targetZ = g.z;
        }
        hooks.onDirective?.(uid, state.order, directive, state.until);
      }
    }
  }

  prune(seen: Set<number>): void {
    this.gate.prune(seen);
  }

  clear(): void {
    this.gate.clear();
  }
}


