// ============================================================
// WorldUIState.ts —— 世界 UI 状态接口
// 类型化 WorldUIManager.update 参数，防止"上帝上下文"膨胀。
// 所有字段由 WorldMode 每帧构造，WorldUIManager 只读消费。
// ============================================================

import type { EntityBase } from '../entity/EntityBase';
import type { AmmoEntryView } from '../services/ui/AmmoPanel';

export interface WorldUIState {
  /** 玩家世界坐标（小地图用） */
  playerPosition: { x: number; z: number };
  /** 相机偏航角（小地图用） */
  cameraYaw: number;
  /** 所有实体列表（小地图标记用） */
  entities: EntityBase[];
  /** 玩家血量状态 */
  playerStats: { hp: number; maxHp: number };
  /** ★ 弹药栏条目（左下角 AmmoPanel：背包弹药类型 + 数量 + 选中态） */
  ammoEntries: AmmoEntryView[];
  /** ★ 友军编队列表（AllyHud 左侧渲染：图标 + 血条；WorldMode 每帧构造） */
  allies: { id: string; itemId: string; hp: number; maxHp: number; slot?: number }[];
  /** 附近可交互物品（可选） */
  nearbyItem?: { itemId: string; distance: number } | null;
}