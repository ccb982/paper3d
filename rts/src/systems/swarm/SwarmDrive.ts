// ============================================================
// SwarmDrive —— 代理移动执行（自 SwarmSystem 拆出；2026-09-26 瘦身）
// ============================================================
// 一句话：队长走走廊（格边步 + 路线修正）/ 成员追队长（格边贪心）/ 无指令 → 停；
//   格边步模式直推（canStep 同口径）；否则 16 向软转向（SteerPick）→ 代理池内核推进；
//   最后做一次人群分离外推（H2 位移闸门）。
// 依赖全部经 DriveHost 注入（SwarmSystem 构造时建一次，零分配引用）。
// ★ 纪律：不在此处写任何"独立移动实现"——行为只给目标，移动只走统一链（§2.10b）。
// ============================================================

import type { AgentPool } from './AgentPool';
import type { CrowdGrid } from './CrowdGrid';
import type { SquadTable } from './SquadTable';
import type { SquadNavigator } from './SquadNavigator';
import type { SquadOrderState } from './squad/State';
import type { SwarmData } from './data/SwarmData';
import { followDir, leaderDir, followStopR } from './squad/Follow';
import { pickSteer } from '../../entity/SteerPick';
import { dangerPointAt } from '../../entity/TerrainAssist';
import { RasterMap } from '../../services/map/RasterMap';
import { simNow } from '../../services/SimClock';
import { entityPerf } from '../../entity/EntityPerf';

export interface DriveHost {
  readonly pool: AgentPool;
  readonly squads: SquadTable;
  readonly nav: SquadNavigator;
  readonly data: SwarmData;
  readonly grid: CrowdGrid;
  squadStateOf(id: number): SquadOrderState | null;
  walkableLine(ax: number, az: number, bx: number, bz: number): boolean;
}

/** 人群分离 scratch（本模块独占；零分配） */
const _sep = { x: 0, z: 0 };

/** 移动积分（★ 方向只来自统一链：走廊格边步 / 路线修正 / 成员贪心；禁止向量合成） */
export function driveAgent(host: DriveHost, i: number, dt: number): void {
  const p = host.pool;
  // ---- 人群分离：本拍只算一次（方向决策里当"反向惩罚"，移动后做一次物理外推） ----
  const t0 = entityPerf.enabled ? performance.now() : 0;
  host.grid.separation(p, i, _sep);
  entityPerf.swarmSep += (entityPerf.enabled ? performance.now() : 0) - t0;
  let dx = p.dirX[i], dz = p.dirZ[i];
  let edgeMode = false;   // ★ 方案 A：格边步模式（轴对齐 + canStep；跳过软转向/坡混合）
  let climbIntent = false;   // ★ 显式爬坡令（路段★/本步跨坡边；代理/队长同一条）
  // ★ 指挥链闭合（用户定 2026-09-23）：代理只认"找队长"——朝队长走 + 局部 steer；
  //   队级复杂寻路（可行性走廊/贪心段）全在队长身上；成员一律追队长。
  const squad = host.squads.squadOf(p.swarmUid[i]);
  const isLeader = !!squad && squad.leaderUid === p.swarmUid[i];
  const lead = squad && !isLeader ? squad.members.get(squad.leaderUid) : undefined;
  if (isLeader) {
    // ★ 队长 → 指令锚点（唯一路线消费者）。方案 A：有走廊 → **格边步**（与规划同口径）
    const ld = leaderDir(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i],
      p.orderTargetX[i] - p.x[i], p.orderTargetZ[i] - p.z[i]);
    if (ld) {
      const st = squad ? host.squadStateOf(squad.id) : null;
      const e = host.nav.edgeFromCorridor(st, p.x[i], p.z[i], p.y[i]);
      if (e) { dx = e.dx; dz = e.dz; edgeMode = true; climbIntent = e.climb === true; }
      else {
        // ★ 路线修正（用户定 2026-09-26）：有走廊 → 朝**当前路点**走（绝不朝最终目标直线）
        const rd = host.nav.routeDir(st, p.x[i], p.z[i], p.y[i]);
        if (rd) { dx = rd.x; dz = rd.z; } else { dx = ld.x; dz = ld.z; }
      }
    } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
  } else if (lead) {
    // ★ 成员跟队长（滞回消抖；掉队沿走廊）；方案 A：目标距离>格 → 格边贪心步
    const stopR = followStopR(p.atomMove[i] === 255, lead.x, lead.z, p.orderTargetX[i], p.orderTargetZ[i]);
    const fd = followDir(host.squadStateOf(squad!.id), p.x[i], p.z[i], lead.x, lead.z,
      stopR, (a, b, c2, d2) => host.walkableLine(a, b, c2, d2));
    if (fd) {
      const e = host.nav.edgeGreedy(p.x[i], p.z[i], p.y[i], lead.x, lead.z);   // ★ 方案 A：成员跟队长=格边步
      if (e) {
        dx = e.dx; dz = e.dz; edgeMode = true;
        climbIntent = host.data.passTable.climbAt(p.x[i], p.z[i], e.dx, e.dz);   // 成员：本步跨可爬坡边
      } else { dx = fd.x; dz = fd.z; }
    } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
  }   // ★ 收敛（2026-09-25）：无队长/无指令 → 停（删除原子直推分支；移动只走统一链）
  // ★ 硬边界内（被推入/出生点）：即使本拍无期望方向也要逃离
  const inside = host.data.blockedAt(p.x[i], p.z[i]);
  if (dx !== 0 || dz !== 0 || inside) {
    if (edgeMode) {
      // ★ 方案 A：格边步直推（不再经 16 向软转向，避免把格边步掰成斜向/被禁分量）
      const step = p.stepAgent(i, dx, dz, p.curSpeed[i] * p.directiveSpeedMul[i], dt, performance.now() / 1000, climbIntent);
      p.x[i] += step.dx; p.z[i] += step.dz;
      if (step.dx !== 0 || step.dz !== 0) p.yaw[i] = Math.atan2(step.dx, step.dz);
    } else {
      p.hazardTimer[i] -= dt;
      const raster = RasterMap.current;
      const hint = p.y[i];
      const dangerAt = (hx: number, hz: number): boolean => {
        if (!raster) return false;
        if (p.isAir[i] === 1) return false;   // 空中层豁免地面危险
        if (host.data.blockedAt(hx, hz)) return true;   // 表：硬墙/坑水
        return dangerPointAt(raster, hx, hz, p.x[i], p.z[i], hint);   // 坑/过低/立面（共享内核）
      };
      const res = pickSteer(
        p.x[i], p.z[i], dx, dz, _sep.x, _sep.z,
        p.safeDirX[i], p.safeDirZ[i], p.hazardTimer[i], simNow(),   // ★ 模拟时钟（倍速同步）
        host.data.blockedAt(p.x[i], p.z[i]),
        dangerAt, host.data,
        p.isAir[i] !== 1,   // ★ 空中层（飞行）不吃地面表分/掩体折扣
        host.squads.squadOf(p.swarmUid[i])?.type,   // ★ L3 兵种分（重构 P1-2；mixed=兵种中立）
      );
      if (!res.hold) {
        p.safeDirX[i] = res.x; p.safeDirZ[i] = res.z; p.hazardTimer[i] = res.until;
        // ★ 重写 P1：两载体同内核——推进/爬坡/立面/贴地走代理池内核（与 L3 同口径）
        const step = p.stepAgent(i, res.x, res.z, p.curSpeed[i] * p.directiveSpeedMul[i], dt, performance.now() / 1000, climbIntent);
        p.x[i] += step.dx; p.z[i] += step.dz;
        if (step.dx !== 0 || step.dz !== 0) p.yaw[i] = Math.atan2(step.dx, step.dz);
      }
    }
  }
  // ---- 人群分离外推（复用本拍已算向量；只做物理推挤，不参与方向决策） ----
  // ★ H2：分离推挤过位移闸门（不得借推力跨层/越悬崖）
  if (_sep.x !== 0 || _sep.z !== 0) p.shiftAgent(i, _sep.x, _sep.z);
}
