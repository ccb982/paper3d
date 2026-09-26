// ============================================================
// engine/SquadView —— UI/探针只读视图（重写 P4；替代旧镜像板）
// ============================================================
// 真相来源（只读，不写）：
//   · 引擎令：`OrderWriter.store`（kind/target/anchor/threat/ttl/progress）
//   · 状态汇报：`SquadManager`（位置/原子/阶段/进度/静止）
//   · 执行态：`squad/SquadCore.state`（走廊/锚点滞回）
// UI 面板/小地图/记录器/探针一律读这里；**不反向指挥**。
// ============================================================

import type { MobRole, OrderPhase } from './contracts';
import type { OrderWriter } from './OrderWriter';
import type { SquadManager } from './SquadManager';
import type { SquadOrderState } from '../squad/State';

export interface SquadViewOrder {
  kind: string;
  source: string;
  target: { x: number; z: number };
  anchor?: { x: number; z: number };
  threat?: { x: number; z: number };
  mission?: string;
  seq: number;
  ttl: number;
}

export interface SquadView {
  id: number;
  role: MobRole;
  alive: number;
  x: number;
  z: number;
  atom: string;
  phase: OrderPhase;
  progress: number;
  stillS: number;
  order: SquadViewOrder | null;
  /** 执行态截止（秒；0 = 不过期） */
  until: number;
  corridor?: { x: number; z: number; climb?: boolean }[];
  pathGoalX: number;
  pathGoalZ: number;
  pathFromX: number;
  pathFromZ: number;
  pathAt: number;
  pathFailedAt: number;
}

/** 命令历史条目（OrderWriter 环） */
export interface CommandEntry {
  at: number;
  squadId: number;
  kind: string;
  source: string;
  tx: number;
  tz: number;
  mission?: string;
}

/** UI/探针只读端口（main 接线；不反向指挥） */
export interface SquadViewPort {
  squads(): SquadView[];
  recentCommands(n: number): readonly CommandEntry[];
  latestCommandPerSquad(windowS: number): Map<number, CommandEntry>;
}

/** 组一份全新只读快照（UI/探针调用；零副作用） */
export function squadViews(
  writer: OrderWriter,
  squads: SquadManager,
  stateOf: (id: number) => SquadOrderState | null,
): SquadView[] {
  const out: SquadView[] = [];
  for (const rec of squads.all()) {
    const st = writer.store.get(rec.id);
    const core = stateOf(rec.id);
    const o = st?.order;
    out.push({
      id: rec.id, role: rec.role, alive: rec.alive,
      x: rec.x, z: rec.z,
      atom: rec.atom, phase: rec.phase, progress: rec.progress, stillS: rec.stillS,
      order: o
        ? {
          kind: o.kind, source: o.source, target: { x: o.target.x, z: o.target.z },
          anchor: o.anchor ? { x: o.anchor.x, z: o.anchor.z } : undefined,
          threat: o.threat ? { x: o.threat.x, z: o.threat.z } : undefined,
          mission: o.mission, seq: o.seq, ttl: o.ttl,
        }
        : null,
      until: st && st.order.ttl > 0 ? st.issuedAt + st.order.ttl : 0,
      corridor: core?.corridor,
      pathGoalX: core?.pathGoalX ?? 0,
      pathGoalZ: core?.pathGoalZ ?? 0,
      pathFromX: core?.pathFromX ?? 0,
      pathFromZ: core?.pathFromZ ?? 0,
      pathAt: core?.pathAt ?? 0,
      pathFailedAt: core?.pathFailedAt ?? 0,
    });
  }
  return out;
}
