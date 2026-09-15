// ============================================================
// MapMarkers —— 玩家在地图上放置的标记点（世界坐标，展示层数据）
// ============================================================
// 写入方：大地图 MapPanel 左键点击（点空处放置 / 点已有标记删除）；
//         颜色 = 面板色板里选中的那个（MARKER_PALETTE，避开蓝与灰白）。
// ★ 满员策略（2026-09-15 用户定调"上限改为 int max"）：**永不顶掉旧标记** → 不设实际限制。
// 消费方：小地图 Minimap（窗口内画图标；出窗贴边提示方位）、
//         场景提示 NavHints（方向 + 距离，与舰船同一套处理）。
//
// ★ 零每帧分配：持有稳定引用，消费方直接遍历 items（readonly 数组），
//   不复制、不 map、不建临时对象。

import { MARKER_COLOR } from './mapIcons';

export interface MapMarker {
  id: number;
  x: number;
  z: number;
  /** 显示名（"标记1"…；按放置序号递增，删除后不复用，避免标签跳号混淆） */
  label: string;
  /** ★ 该标记自选颜色（大地图色板；小地图/场景提示同色显示） */
  color: string;
}

export class MapMarkers {
  /**
   * 上限 = **int max（2^31−1）≈ 不限制**（2026-09-15 用户定调）。
   * 演变：原 8 且满了 `shift()` 顶掉最早的 → 用户反馈"标记太多之前的会直接消失"
   *      → 先改成"满了不删、提示"，用户再定调"上限改为 int max" → 等于不设限。
   * 说明：`add()` 满员返回 null 的分支保留为标准位（实际不可能到达；真到那一步
   *      内存早就爆了），调用方仍会给出提示而不是静默丢弃。
   */
  static readonly MAX = 2147483647;
  private list: MapMarker[] = [];
  private nextId = 1;

  get items(): readonly MapMarker[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  get isFull(): boolean {
    return this.list.length >= MapMarkers.MAX;
  }

  /** 放置标记（**永不顶掉旧标记**；正常情况必成功）；color 缺省 = 色板第一个 */
  add(x: number, z: number, color: string = MARKER_COLOR): MapMarker | null {
    if (this.list.length >= MapMarkers.MAX) return null;
    const m: MapMarker = { id: this.nextId, x, z, label: `标记${this.nextId}`, color };
    this.nextId++;
    this.list.push(m);
    return m;
  }

  /** 删除离 (x,z) 最近、且在 r 内的标记；返回是否删掉了 */
  removeNear(x: number, z: number, r: number): boolean {
    let best = -1;
    let bestD = r * r;
    for (let i = 0; i < this.list.length; i++) {
      const dx = this.list[i].x - x;
      const dz = this.list[i].z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best < 0) return false;
    this.list.splice(best, 1);
    return true;
  }

  clear(): void {
    this.list.length = 0;
  }
}
