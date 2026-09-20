// ============================================================
// WorldPersistence —— 世界状态落盘 / 恢复（从 WorldMode 拆出）
// ============================================================
// 只做 IO 搬运：地形破坏/植被/墙（玩家+敌人）/召唤友军/小地图记忆。
// 调用方（WorldMode）在 exit / beforeunload / 换天时调用；恢复在 enter。
// ============================================================

import * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import type { RasterMap } from '../../services/map/RasterMap';
import type { EntityManager } from '../../entity/EntityManager';
import type { CoverEntity } from '../../entity/CoverEntity';
import type { WorldUIManager } from '../../ui/world/WorldUIManager';
import type { AllyBase } from '../../entity/ally/AllyBase';
import { SentinelAlly } from '../../entity/ally/SentinelAlly';
import { allySystem } from '../../systems/ally/AllySystem';
import { CoverEntity as CoverEntityValue, snapshotCovers } from '../../entity/CoverEntity';
import { saveWorldState, pruneWorldStates, type WorldStateData, type AllyRec } from '../../core/WorldStateCache';
import { restoreWalls } from './RestoreWalls';

/** ★ 世界状态落盘（exit / beforeunload） */
export function saveWorldStateNow(
  session: GameSession | null,
  raster: RasterMap | null,
  worldUI: WorldUIManager | null,
): void {
  if (!session || !raster) return;
  try {
    const rs = raster.exportPersistState();
    const allies: AllyRec[] = [];
    for (const a of allySystem.allies as AllyBase[]) {
      if (a.slotIndex >= 0) continue;            // 出击槽友军由配装重建，不入缓存
      if (!(a instanceof SentinelAlly)) continue; // ★ 无人机一直跟随玩家，不写入缓存
      allies.push({
        kind: 'sentinel', x: a.position.x, y: a.position.y, z: a.position.z,
        hp: a.hp, itemId: a.itemId,
        stationaryBaseY: a.stationaryBaseY,
      });
    }
    saveWorldState({
      seed: session.meta.seed,
      levels: rs.levels,              // ★ 只存坑洞；植被每天重建（不入缓存）
      mapRecords: rs.mapRecords,      // ★ 地形记录（大地图回放）
      walls: snapshotCovers('player'),
      enemyWalls: snapshotCovers('enemy'),
      allies,
      // ★ 小地图已探索记忆 + 地图标记（跨模式/跨天一直保留）
      explored: worldUI?.getMinimapExploredState() ?? null,
      markers: worldUI?.getMapMarkersState() ?? [],
    });
    pruneWorldStates();
  } catch (e) {
    console.warn('[WorldPersistence] 世界状态保存失败（忽略）:', e);
  }
}

/** ★ 世界状态恢复：墙（玩家 CoverEntity + 敌人墙）+ 召唤友军（祖宗） */
export function restoreWorldState(
  scene: THREE.Scene | null,
  entities: EntityManager,
  playerCovers: CoverEntityValue[],
  worldUI: WorldUIManager | null,
  data: WorldStateData,
  spawnSentinelAt: (x: number, z: number, dormant?: boolean) => void,
): void {
  if (!scene) return;
  if (data.markers.length > 0) worldUI?.loadMapMarkersState(data.markers);
  // ★ 玩家墙 + 敌人掩体恢复（分开建；旧档混存按 owner 分流）
  restoreWalls(entities, scene, data.walls, data.enemyWalls ?? [], playerCovers);
  for (const a of data.allies) {
    if (a.kind !== 'sentinel') continue;   // ★ 无人机不入缓存（旧档残留记录直接丢弃）
    spawnSentinelAt(a.x, a.z, true);       // ★ 休眠入场：回到原地接触才启用
    const s = allySystem.allies[allySystem.allies.length - 1];
    if (s instanceof SentinelAlly) {
      s.position.y = a.y;
      s.stationaryBaseY = a.stationaryBaseY ?? a.y;
      s.hp = Math.max(1, Math.round(a.hp));
    }
  }
}
