// ============================================================
// AllyPlayback —— 友军播放注册表（战斗道具播放 · 友军类）
// ============================================================
// 播放 = 出实体跟随主角。注册表按 itemId 分发：
//   kaltsit_drone       → 空中跟随（DroneEntity：VAT 双翼 + follow/attack AI）
//   （后续地面跟随型 → 实体类 + 注册项，核心装配不变）
// WorldMode 进战场按 deployedAllies 遍历注册表生成（原 drone 特判下沉到注册项）。
// ============================================================

export interface AllyPlaybackContext {
  /** 部署槽位 itemId */
  itemId: string;
  /** 友军槽位索引（残骸槽位不再生成，由调用方过滤） */
  slotIndex: number;
  /** ★ 空中跟随：近玩家位置生成无人机（由 WorldMode 注入，避免注册表依赖模式层） */
  spawnDroneNearPlayer: (slotIndex?: number) => void;
}

export interface AllyPlayback {
  /** 友军类型（'drone' / 未来 'ground'） */
  kind: string;
  /** 部署播放（进入战场时调用） */
  spawn(ctx: AllyPlaybackContext): void;
}

/** ★ 友军播放注册表：itemId → 播放器（新增友军 = 注册一个条目） */
export const allyPlaybackRegistry = new Map<string, AllyPlayback>();