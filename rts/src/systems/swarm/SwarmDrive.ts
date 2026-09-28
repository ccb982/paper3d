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
import { leaderDir } from './squad/Follow';
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
  memberStep(uid: number, x: number, z: number, lx: number, lz: number, now: number, state?: SquadOrderState | null): { dx: number; dz: number; done: boolean; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } } | null;
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
  let cred = false;       // ★ 爬坡凭证（挂在寻路上：state.climbCred）
  let credPt: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } | undefined;   // ★ 凭证点
  // ★ 指挥链闭合（用户定 2026-09-23）：代理只认"找队长"——朝队长走 + 局部 steer；
  //   队级复杂寻路（可行性走廊/贪心段）全在队长身上；成员一律追队长。
  const squad = host.squads.squadOf(p.swarmUid[i]);
  const isLeader = !!squad && squad.leaderUid === p.swarmUid[i];
  if (isLeader) {
    // ★ 队长 → 指令锚点（唯一路线消费者）。方案 A：有走廊 → **格边步**（与规划同口径）
    const ld = leaderDir(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i],
      p.orderTargetX[i] - p.x[i], p.orderTargetZ[i] - p.z[i]);
    if (ld) {
      // ★ 飞行直航（用户定 2026-09-27 /《移动执行重写.md》§0 例外）：空中单位**不消费地面走廊/
      //   格边步**——直接朝活动目标飞（同层机制已删；寻路只认 2D 格，高度由实体自己管）。
      if (p.isAir[i] === 1) {
        dx = ld.x; dz = ld.z;
      } else {
      const st = squad ? host.squadStateOf(squad.id) : null;
      if (st?.climbCred) { cred = true; credPt = st.climbCred; }

      // ★★ 短寻路一次发放（用户定 2026-09-27，L2/L3 同口径）：沿已发放的格边步走到点才重选
      const stc = host.nav.stepCommit(st, p.x[i], p.z[i], performance.now() / 1000, (goal) => {
        const c = host.nav.routeCursor(st, p.x[i], p.z[i]);
        if (!c) return null;
        const e0 = host.nav.edgeFromCorridor(st, p.x[i], p.z[i]);
        if (!e0) return null;
        goal.x = c.x; goal.z = c.z;
        return e0;
      });
      if (stc) { dx = stc.dx; dz = stc.dz; edgeMode = true; }
      else {
        const e = host.nav.edgeFromCorridor(st, p.x[i], p.z[i]);
        if (e) { dx = e.dx; dz = e.dz; edgeMode = true; }
        else {
          // ★ 路线修正（用户定 2026-09-26）：有走廊 → 朝**当前路点**走（绝不朝最终目标直线）
          const rd = host.nav.routeDir(st, p.x[i], p.z[i]);
          // ★ M0：无走廊/无路点 → **持令原地停**（硬边接触修正由 inside 分支处理）
          if (rd) { dx = rd.x; dz = rd.z; } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
        }
      }
      }
    } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
  } else if (squad) {
    // ★ 架构底线（用户定 2026-09-26）：**成员的移动同样来自长短寻路**——**定时对队长位置做一次
    //   长寻路**（每人一条缓存路线），沿其走格边步；无解/到位 → 停。
    const stM = host.squadStateOf(squad.id);
    // ★ 凭证口径（用户定）：**成员/代理无需凭证**——进爬坡区即上送；credPt 有则用于定位
    cred = true;
    if (stM?.climbCred) credPt = stM.climbCred;
    const lead = squad.members.get(squad.leaderUid);
    // ★ 飞行直航单源（空中层，用户定 2026-09-27）：成员直航队长——不走地面 memberStep/格边步
    if (lead && p.isAir[i] === 1) {
      const ax = lead.x - p.x[i], az = lead.z - p.z[i];
      const al = Math.hypot(ax, az) || 1;
      dx = ax / al; dz = az / al; edgeMode = false;
    } else {
    const ms = lead ? host.nav.memberStep(p.swarmUid[i], p.x[i], p.z[i], lead.x, lead.z, performance.now() / 1000, host.squadStateOf(squad.id)) : null;
    if (ms?.climbPt) credPt = ms.climbPt;   // ★ 成员路线带坡点则用其点位
    if (ms && !ms.done) {
      dx = ms.dx; dz = ms.dz; edgeMode = true;
    } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
    }
  }   // ★ 收敛（2026-09-25）：无队长/无指令 → 停（删除原子直推分支；移动只走统一链）
  // ★★ M0（用户定 2026-09-27）：方向**只来自命令链**（长寻路走廊/成员路线）；接触修正（硬边分量清零、
  //   可行性表斥力、坡面 weld、脱埋）全部由**内核 stepAgent** 负责——16 向软转向 pickSteer 退出移动链。
  const inside = host.data.blockedAt(p.x[i], p.z[i]);
  if (dx !== 0 || dz !== 0 || inside) {
    const spd = cred ? Math.max(p.curSpeed[i] * p.directiveSpeedMul[i], p.curSpeed[i]) : p.curSpeed[i] * p.directiveSpeedMul[i];
    const step = p.stepAgent(i, dx, dz, spd, dt, performance.now() / 1000, cred, credPt);
    if (step.landed) {   // ★ 代理爬完坡：强制重寻路（队长走廊 + 本代理路线）
      host.nav.dropMemberRoute(p.swarmUid[i]);
      if (isLeader && squad) host.nav.forceRepath(squad.id);
    }
    p.x[i] += step.dx; p.z[i] += step.dz;
    if (step.dx !== 0 || step.dz !== 0) p.yaw[i] = Math.atan2(step.dx, step.dz);
  }
  // ---- 人群分离外推（复用本拍已算向量；只做物理推挤，不参与方向决策） ----
  // ★ H2：分离推挤过位移闸门（不得借推力跨层/越悬崖）
  if (_sep.x !== 0 || _sep.z !== 0) p.shiftAgent(i, _sep.x, _sep.z);
}
