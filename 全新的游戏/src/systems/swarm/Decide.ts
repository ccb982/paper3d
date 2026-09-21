// ============================================================
// Decide —— 部署选点（部署树 + 读表投影；从 SwarmCommander 抽出）
// ============================================================
// 输入：小队属性（SquadDoctrine，已叠态势）+ 战场上下文（计划/表/玩家/工事/队列）
// 输出：一条命令的 kind/target/roe/ttl/urgency（**动作选择仍在执行层**，这里只选点）。
// 读表投影集中在此：
//   · 进攻推进/包抄 → bestNear(8m)：找坡面/近路/高地
//   · 驻守/集结     → bestCoverNear(14m) ?? bestTrenchNear(8m)：躲硬墙后/战壕后
//   · 目标校验      → 落点不可站（墙/坑水）→ 就近可站最高分格（12/24m）
// ============================================================

import type { SquadType } from '../../entity/SwarmUnit';
import type { SquadDoctrine } from './SquadDoctrine';
import type { DefensePlan } from './LandingTerrain';
import type { TerrainScore } from './TerrainScore';
import { canTake, guardPoint, UNIT_TACTICS } from './UnitTactics';

/** 命令字段（与 TacticalOrder 对齐；避免 Decide 依赖整个实体契约） */
export type DecideKind =
  | 'advance' | 'flank' | 'protect' | 'regroup' | 'retreat' | 'bound' | 'focus';
export type DecideRoe = 'engage' | 'holdFire' | 'fireOnArrival' | 'focusOnly';

/** 选点需要的全部输入（每拍构建一次，零分配复用） */
export interface DecideCtx {
  plan: DefensePlan;
  table: TerrainScore;
  playerX: number;
  playerZ: number;
  /** 玩家在落点 90m 内（近战追击开关的现场条件） */
  chase: boolean;
  /** 本队线位（仅"刚整队那一拍"+非追击队会给） */
  lineSlot: { x: number; z: number } | null;
  /** 正面基准（工事点/落点前方） */
  front: { x: number; z: number };
  /** 当前待建块（S1 施工优先；null = 不施工） */
  buildSlot: { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 } | null;
  /** ★ 本队已分派的施工块（稳定分派：不再每拍重挑 → 修复工程队来回跑） */
  buildTarget: { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 } | null;
  /** ★ 当前"工地"（第一个在建块；近战护卫用） */
  buildSite: { x: number; z: number } | null;
  /** ★ 战术阶段（S1 = 施工期 → 近战进入"保护"共用状态） */
  stage: string;
  /** ★ 驻守位锁定（squadId → 已选掩体/战壕位；靠近则不换 → 修复来回走） */
  hold: Map<number, { x: number; z: number }>;
  /** ★ 驻守/推进滞回状态（squadId → 上一拍是否 protect） */
  protectState: Map<number, boolean>;
  /** ★ 近 8s 被击的小队（"打了保护的士兵 → 该打还是打"的反击开关） */
  alert: Set<number>;
  /** ★ 每队稳定岗位（squadId → 岗哨/高地/掩体位/战壕；不随拍轮转 → 防左右摆） */
  post: Map<number, { x: number; z: number }>;
  /** ★ 本队当前"大任务"（引擎粘性分派；队长的动态调整不改变它） */
  mission: string;
  /** 无待建块时的兜底工事锚 */
  slot: { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 } | undefined;
  builders: readonly DecideSquad[];
  buildPieces: readonly { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 }[];
  builtSlots: Set<string>;
  highPick: { x: number; z: number; h: number } | null;
  covers: readonly { x: number; z: number }[];
}

export interface DecideSquad {
  id: number;
  type: SquadType;
  builders: boolean;
  members: Map<number, { x: number; z: number }>;
}

/** 轮转计数（跨队共享；每拍复位） */
export interface DecideState {
  coverIdx: number;
  assaultIdx: number;
  screenIdx: number;
  flyerIdx: number;
}

export interface DecideOut {
  kind: DecideKind;
  target: { x: number; z: number };
  roe: DecideRoe;
  ttl: number;
  urgency: number;
  /** ★ 任务名（引擎布置 → 队长读；见 UnitTactics.MISSION_EXEC） */
  mission: string;
}

/** 复用输出（零分配） */
const _out: DecideOut = { kind: 'advance', target: { x: 0, z: 0 }, roe: 'engage', ttl: 6, urgency: 0, mission: '' };
/** ★ ∇S̃ 梯度复用（微调用） */
const _grad = { x: 0, z: 0 };

/** 部署选点（读表投影全部在此；返回复用对象，调用方立即消费） */
export function decideTarget(d: SquadDoctrine, s: DecideSquad, ctx: DecideCtx, st: DecideState): DecideOut {
  const plan = ctx.plan;
  const meleeAt = (doctrineChase: boolean): { x: number; z: number } => (
    doctrineChase && ctx.chase
      ? { x: ctx.playerX, z: ctx.playerZ }
      : { x: ctx.front.x + plan.approachX * 10, z: ctx.front.z + plan.approachZ * 10 }
  );
  _out.kind = 'advance';
  _out.target = meleeAt(d.chase);
  _out.roe = 'engage';
  _out.ttl = 6;
  _out.urgency = 0;
  // ★ 大任务（引擎粘性）：默认驻守；施工/护卫/进攻等由 commander 分派后写入 ctx.mission
  _out.mission = ctx.mission || 'hold';
  // ★ 独有状态：施工（大任务 = build）
  if (ctx.mission === 'build') {
    const bt = ctx.buildTarget ?? ctx.buildSlot;
    if (bt) {
      _out.target = { x: bt.x, z: bt.z };
      _out.roe = 'holdFire';
    } else {
      const hold = ctx.slot ?? ctx.front;
      _out.kind = 'protect';
      _out.target = { x: hold.x, z: hold.z };
      _out.roe = 'holdFire';
      _out.ttl = 8;
    }
  } else if (ctx.mission === 'guard' && !d.chase) {
    // ★ 共用状态：保护——离工地远不主动进攻；被击(alert)/贴脸(engageDist) → 动态反击
    let cx = 0, cz = 0, n = 0;
    for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
    if (n > 0) { cx /= n; cz /= n; }
    const p = UNIT_TACTICS[s.type];
    const alert = ctx.alert.has(s.id);
    const nearSite = ctx.buildSite
      && Math.hypot(ctx.playerX - ctx.buildSite.x, ctx.playerZ - ctx.buildSite.z) <= 25;
    const close = n > 0 && Math.hypot(ctx.playerX - cx, ctx.playerZ - cz) <= p.engageDist;
    // ★ 工程队不因玩家停工：玩家踩到工地 → 守备队**申请支援**（上来打，工兵照挖）
    if (ctx.buildSite && (alert || close || nearSite)) {
      _out.kind = 'advance';
      _out.target = { x: ctx.playerX, z: ctx.playerZ };
      _out.ttl = 4;
    } else if (ctx.buildSite) {
      _out.kind = 'protect';
      _out.target = guardPoint(ctx.buildSite.x, ctx.buildSite.z, ctx.playerX, ctx.playerZ, p.guardDist);
    }
  } else {
  switch (d.mode) {
    case 'build': {
      const bt = ctx.buildTarget ?? ctx.buildSlot;
      if (bt) {
        _out.target = { x: bt.x, z: bt.z };
        _out.roe = 'holdFire';
      } else {
        const hold = ctx.slot ?? ctx.front;
        _out.kind = 'protect';
        _out.target = { x: hold.x, z: hold.z };
        _out.roe = 'holdFire';
        _out.ttl = 8;
      }
      break;
    }
    case 'garrison': {
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n > 0) { cx /= n; cz /= n; }
      const cov = d.preferCover && !ctx.lineSlot
        ? (ctx.post.get(s.id)
          ?? (ctx.covers.length > 0 ? ctx.covers[st.coverIdx++ % ctx.covers.length] : null))
        : null;
      let hx: number, hz: number;
      if (cov) {
        hx = cov.x; hz = cov.z;
      } else if (ctx.lineSlot) {
        hx = ctx.lineSlot.x; hz = ctx.lineSlot.z;   // 进攻队列：后排线位
      } else if (ctx.chase && n > 0) {
        const ax = cx - ctx.playerX, az = cz - ctx.playerZ;
        const al = Math.hypot(ax, az) || 1;
        const sd = d.standoff || 45;
        hx = ctx.playerX + (ax / al) * sd;
        hz = ctx.playerZ + (az / al) * sd;
      } else {
        const hold = ctx.highPick ?? ctx.front;
        hx = hold.x; hz = hold.z;
      }
      const wasProtect = ctx.protectState.get(s.id) === true;
      const far = n === 0 || Math.hypot(cx - hx, cz - hz) > (wasProtect ? 9 : 4);
      ctx.protectState.set(s.id, !far);
      _out.kind = far ? 'advance' : 'protect';
      _out.target = { x: hx, z: hz };
      _out.urgency = far ? 1 : 0;
      _out.ttl = far ? 8 : 6;
      break;
    }
    case 'flank': {
      const side = st.assaultIdx++ % 2 === 0 ? 1 : -1;
      const base = ctx.lineSlot ?? meleeAt(d.chase);
      _out.kind = 'flank';
      _out.target = { x: base.x - plan.approachZ * side * 6, z: base.z + plan.approachX * side * 6 };
      break;
    }
    case 'screen': {
      const si = st.screenIdx++;
      const sd = d.screenDist || 10;   // ★ 默认 10m 护航距离（前期保护工程队）
      if (ctx.buildSlot) {
        const dx = ctx.playerX - ctx.buildSlot.x, dz = ctx.playerZ - ctx.buildSlot.z;
        const dl = Math.hypot(dx, dz) || 1;
        _out.target = {
          x: ctx.buildSlot.x + (dx / dl) * sd,
          z: ctx.buildSlot.z + (dz / dl) * sd,
        };
      } else if (!ctx.chase && !ctx.lineSlot && ctx.post.has(s.id)) {
        // ★ 稳定岗位（岗哨/高地/掩体位）：不再按循环下标轮转（防左右摆）
        const c = ctx.post.get(s.id)!;
        _out.kind = 'protect';
        _out.target = { x: c.x, z: c.z };
        _out.ttl = 8;
      } else if (!ctx.chase && plan.chokepoints.length > 0 && !ctx.lineSlot) {
        const c = plan.chokepoints[si % plan.chokepoints.length];
        _out.kind = 'protect';
        _out.target = { x: c.x, z: c.z };
        _out.ttl = 8;
      } else {
        _out.target = ctx.lineSlot ?? meleeAt(d.chase);
      }
      break;
    }
    case 'regroup': {
      _out.kind = 'regroup';
      // ★ 后勤后置（读表代理位）：后场基准 = 正面 − 前进方向×14；若分到"靠近后场"的稳定岗 → 用岗
      const rear = ctx.post.get(s.id);
      const bx = ctx.front.x - plan.approachX * 14;
      const bz = ctx.front.z - plan.approachZ * 14;
      if (rear && (rear.x - bx) ** 2 + (rear.z - bz) ** 2 <= 40 * 40) {
        _out.target = { x: rear.x, z: rear.z };
      } else {
        _out.target = { x: bx, z: bz };
      }
      break;
    }
    case 'press':
    default: {
      if (s.type === 'flyer' && !ctx.lineSlot) {
        const side = st.flyerIdx++ % 2 === 0 ? 1 : -1;
        const base = meleeAt(d.chase);
        _out.target = { x: base.x - plan.approachZ * side * 9, z: base.z + plan.approachX * side * 9 };
      } else {
        _out.target = ctx.lineSlot ?? meleeAt(d.chase);
      }
      break;
    }
  }
  }

  // ---- ★ 读表投影（集中处） ----
  // 进攻选位：追击中的推进/包抄 → 8m 内最高分格（坡面/近路/高地）
  if (d.chase && (_out.kind === 'advance' || _out.kind === 'flank')) {
    const ap = ctx.table.bestNear(_out.target.x, _out.target.z, 8);
    if (ap) _out.target = { x: ap.x, z: ap.z };
  }
  // 防御选位（队长掩体判定）：驻守/集结 → 硬墙后 / 战壕后；**锁定已选位**（靠近则不换，防来回走）
  if (_out.kind === 'protect' || _out.kind === 'regroup') {
    const held = ctx.hold.get(s.id);
    if (held && Math.hypot(_out.target.x - held.x, _out.target.z - held.z) < 8) {
      _out.target = { x: held.x, z: held.z };
    } else {
      const cov = ctx.table.bestCoverNear(_out.target.x, _out.target.z, 14, ctx.playerX, ctx.playerZ)
        ?? ctx.table.bestTrenchNear(_out.target.x, _out.target.z, 8);
      if (cov) {
        _out.target = { x: cov.x, z: cov.z };
        ctx.hold.set(s.id, { x: cov.x, z: cov.z });
      } else {
        ctx.hold.delete(s.id);
      }
    }
  }
  // ★ ∇S̃ 微调（≤2m）：驻守/集结点沿平滑梯度上坡（避开格边缘/掩体边缘的跳变带）
  if ((_out.kind === 'protect' || _out.kind === 'regroup')
    && ctx.table.gradientInto(_out.target.x, _out.target.z, _grad)) {
    _out.target = { x: _out.target.x + _grad.x * 2, z: _out.target.z + _grad.z * 2 };
  }
  // 目标校验：落点不可站（墙/坑水）→ 就近可站最高分格
  const tsc = ctx.table.scoreAt(_out.target.x, _out.target.z);
  if (tsc === null || tsc <= -1e8) {
    const fix = ctx.table.bestNear(_out.target.x, _out.target.z, 12)
      ?? ctx.table.bestNear(_out.target.x, _out.target.z, 24);
    if (fix) _out.target = { x: fix.x, z: fix.z };
  }
  if (ctx.lineSlot) _out.ttl = Math.min(_out.ttl, 3);   // 队形调整 = 短暂命令
  return _out;
}
