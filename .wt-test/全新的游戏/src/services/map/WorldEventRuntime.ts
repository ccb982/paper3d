// ============================================================
// WorldEventRuntime —— 特殊 chunk 事件运行时（仅接口预留，2026-08-26）
// ============================================================
// 定位：特殊 chunk（registerSpecialLayout 命中的块）内部发生的事件，
//       其运行时状态登记在此。本期不实现任何事件内容，只立三个契约：
//
//   ① 布局接口：在 ChunkGenerator.registerSpecialLayout（地形自主设计）
//   ② 状态注册表：本文件（chunkKey → 事件状态，天级生命周期）
//   ③ 激活回调：ChunkManager 构造参数 onChunkActivated（玩家进入半径时）
//
// 铁律（设计定稿，实现时不得破坏）：
//   - 事件的【选择】是确定性的（种子派生）→ 同天重进同块必复现
//   - 事件的【过程/结果】是运行时状态 → 挂在 chunkKey 上，不随 chunk
//     视觉对象销毁陪葬（chunk 网格随时重建，状态必须独立存活）
//   - 跨天保留与否由事件类型决定（默认天级清理；一次性剧情需写 Session）
//   - 小地图图标 API 待事件内容立项时接入 Minimap（本期不做）
// ============================================================

import { chunkKeyOf } from './RasterMap';

export type WorldEventStatus = 'pending' | 'active' | 'completed' | 'failed';

/** 事件运行时状态（内容事件自定 data 结构） */
export interface WorldEventState {
  /** 事件实例（特殊布局 key 或事件定义 id） */
  eventId: string;
  /** 状态机 */
  status: WorldEventStatus;
  /** 事件自定义数据（刷怪进度/宝箱已开/祭坛次数…） */
  data: Record<string, unknown>;
}

/**
 * 天级事件状态注册表。
 * 生命周期：WorldMode enter 时 new 一个 → 地图重建/模式退出时整表丢弃；
 * 需要跨天保留的已完成标记由调用方自行写入 Session。
 */
export class WorldEventRegistry {
  private states = new Map<number, WorldEventState>();

  get(cx: number, cz: number): WorldEventState | undefined {
    return this.states.get(chunkKeyOf(cx, cz));
  }

  register(cx: number, cz: number, state: WorldEventState): WorldEventState {
    const key = chunkKeyOf(cx, cz);
    const existing = this.states.get(key);
    if (existing) return existing;
    this.states.set(key, state);
    return state;
  }

  /** 已注册的 chunkKey 集合（遍历/调试用） */
  keys(): number[] {
    return [...this.states.keys()];
  }

  clear(): void {
    this.states.clear();
  }
}
