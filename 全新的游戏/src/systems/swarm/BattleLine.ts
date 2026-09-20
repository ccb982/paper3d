// ============================================================
// BattleLine —— 进攻队列调控（近战进攻队的前/中排 + 横向车道；《蜂群架构.md》§13）
// ============================================================
// 常规进攻（态势 advance / mass / assault）时，**近战进攻队**（盾/突击/混编）分层展开：
//   前排 = 盾队（吃线） / 中排 = 突击。
// ★ 用户定调（2026-09-21）：**施工队、后勤、远程不整队**（各有工位/射界位）；
//   飞行走空中层不排队。
// 输出：每队一个"线位"目标点 = 攻击锚点 − 前进方向×层深 + 右向×车道。
// 整队节拍 REFORM_S（或锚点位移 > 15m / 态势切换 / 兵力变化）→ 按当前横向位置**重新排车道**
// （靠左的站左、靠右的站右 → 重新整队，但不会挤中线/来回穿越）；
// 线位是"刚整队那一拍"的短暂命令（TTL 3s），且只对非攻击（chase=false）队生效。
// ============================================================

import type { SquadType } from '../../entity/SwarmUnit';

export type BattleLayer = 'front' | 'mid' | 'back' | 'air';

export interface LineUnit {
  id: number;
  type: SquadType;
  builders: boolean;
  cx: number;
  cz: number;
}

/** 兵种属性 → 排（施工队并入中排；飞行不排队） */
const LAYER_OF: Record<SquadType, BattleLayer> = {
  defense: 'front',
  assault: 'mid',
  ranged: 'back',
  logistics: 'back',
  flyer: 'air',
  mixed: 'mid',
};

/** 同排车道间距（米；后排更宽，给远程留射界） */
const LANE_SPACING: Record<BattleLayer, number> = {
  front: 12, mid: 14, back: 18, air: 0,
};

/** 层深（米；从攻击锚点往我方一侧量）：常规 / 总攻（激进） */
const DEPTH = {
  normal:     { front: 12, mid: 26, back: 50, air: 0 },
  aggressive: { front: 5,  mid: 16, back: 45, air: 0 },
} as const;

/** 整队节拍（秒） */
const REFORM_S = 8;
/** 锚点位移超过此值 → 提前整队（米） */
const ANCHOR_MOVE = 15;

export class BattleLine {
  private readonly slots = new Map<number, { x: number; z: number }>();
  private reformAt = 0;
  private lastAnchorX = NaN;
  private lastAnchorZ = NaN;
  private lastEpoch = -1;
  private lastUnitCount = -1;

  /** 每拍调用一次（指挥器工程拍）：必要时整队并刷新线位
   *  @returns true = 本拍刚整队（线位是"新命令"，只在此时下发；其余时间不强制线位） */
  update(
    now: number, anchorX: number, anchorZ: number,
    fx: number, fz: number,
    units: LineUnit[], aggressive: boolean, epoch: number,
  ): boolean {
    const moved = Math.hypot(anchorX - this.lastAnchorX, anchorZ - this.lastAnchorZ) > ANCHOR_MOVE;
    // ★ 兵力变化（增援到场）也立即整队，不让新队漏排
    if (now < this.reformAt && !moved && epoch === this.lastEpoch
      && units.length === this.lastUnitCount) return false;
    this.reform(now, anchorX, anchorZ, fx, fz, units, aggressive, epoch);
    return true;
  }

  /** 取某队的线位目标（未分配 → null） */
  get(id: number): { x: number; z: number } | null {
    return this.slots.get(id) ?? null;
  }

  clear(): void {
    this.slots.clear();
    this.reformAt = 0;
    this.lastAnchorX = NaN;
    this.lastAnchorZ = NaN;
    this.lastEpoch = -1;
    this.lastUnitCount = -1;
  }

  private reform(
    now: number, anchorX: number, anchorZ: number,
    fx: number, fz: number,
    units: LineUnit[], aggressive: boolean, epoch: number,
  ): void {
    this.reformAt = now + REFORM_S;
    this.lastAnchorX = anchorX;
    this.lastAnchorZ = anchorZ;
    this.lastEpoch = epoch;
    this.lastUnitCount = units.length;
    this.slots.clear();
    const rx = -fz, rz = fx;   // 右向
    const byLayer = new Map<BattleLayer, LineUnit[]>();
    for (const u of units) {
      // ★ 用户定调：队列只管**近战进攻队**（盾/突击/混编）；施工队、后勤、远程不整队
      if (u.builders || u.type === 'logistics' || u.type === 'ranged') continue;
      const layer = LAYER_OF[u.type];
      if (layer === 'air') continue;
      let arr = byLayer.get(layer);
      if (!arr) { arr = []; byLayer.set(layer, arr); }
      arr.push(u);
    }
    const depth = aggressive ? DEPTH.aggressive : DEPTH.normal;
    for (const [layer, arr] of byLayer) {
      // ★ 整队：按当前横向位置排序（左→右），保证"靠左站左、靠右站右"不穿越
      arr.sort((a, b) =>
        ((a.cx - anchorX) * rx + (a.cz - anchorZ) * rz)
        - ((b.cx - anchorX) * rx + (b.cz - anchorZ) * rz));
      const n = arr.length;
      const sp = LANE_SPACING[layer];
      const d = depth[layer];
      for (let i = 0; i < n; i++) {
        const lane = (i - (n - 1) / 2) * sp;
        this.slots.set(arr[i].id, {
          x: anchorX - fx * d + rx * lane,
          z: anchorZ - fz * d + rz * lane,
        });
      }
    }
  }
}
