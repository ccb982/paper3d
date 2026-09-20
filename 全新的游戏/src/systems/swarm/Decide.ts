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
}

/** 复用输出（零分配） */
const _out: DecideOut = { kind: 'advance', target: { x: 0, z: 0 }, roe: 'engage', ttl: 6, urgency: 0 };

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
  switch (d.mode) {
    case 'build': {
      if (ctx.buildSlot) {
        const bi = ctx.builders.indexOf(s);
        const t = ctx.buildPieces.find((q, idx) => idx >= bi && !ctx.builtSlots.has(`${q.x},${q.z}`))
          ?? ctx.buildSlot;
        _out.target = { x: t.x, z: t.z };
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
      const cov = d.preferCover && ctx.covers.length > 0 && !ctx.lineSlot
        ? ctx.covers[st.coverIdx++ % ctx.covers.length] : null;
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
      const far = n === 0 || Math.hypot(cx - hx, cz - hz) > 4;
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
      if (ctx.buildSlot && d.screenDist > 0) {
        const dx = ctx.playerX - ctx.buildSlot.x, dz = ctx.playerZ - ctx.buildSlot.z;
        const dl = Math.hypot(dx, dz) || 1;
        _out.target = {
          x: ctx.buildSlot.x + (dx / dl) * d.screenDist,
          z: ctx.buildSlot.z + (dz / dl) * d.screenDist,
        };
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
      _out.target = { x: ctx.front.x - plan.approachX * 8, z: ctx.front.z - plan.approachZ * 8 };
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

  // ---- ★ 读表投影（集中处） ----
  // 进攻选位：追击中的推进/包抄 → 8m 内最高分格（坡面/近路/高地）
  if (d.chase && (_out.kind === 'advance' || _out.kind === 'flank')) {
    const ap = ctx.table.bestNear(_out.target.x, _out.target.z, 8);
    if (ap) _out.target = { x: ap.x, z: ap.z };
  }
  // 防御选位（队长掩体判定）：驻守/集结 → 硬墙后 / 战壕后
  if (_out.kind === 'protect' || _out.kind === 'regroup') {
    const cov = ctx.table.bestCoverNear(_out.target.x, _out.target.z, 14, ctx.playerX, ctx.playerZ)
      ?? ctx.table.bestTrenchNear(_out.target.x, _out.target.z, 8);
    if (cov) _out.target = { x: cov.x, z: cov.z };
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
