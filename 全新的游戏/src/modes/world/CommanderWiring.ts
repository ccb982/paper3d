// ============================================================
// CommanderWiring —— 蜂群指挥器端口接线（模式层注入；《蜂群架构.md》§16.8）
// ============================================================
// 兵力创建全权交给蜂群架构：本模块把"生成敌人 / 造掩体 / 挖战壕"三个端口
// 接到模式层实现（WorldSpawner / CoverEntity / ChunkManager），保持 WorldMode 行数收敛。
// ============================================================

import type * as THREE from 'three';
import type { EntityManager } from '../../entity/EntityManager';
import type { UnitRole } from '../../entity/SwarmUnit';
import type { RasterMap } from '../../services/map/RasterMap';
import type { ChunkManager } from '../../services/map/ChunkManager';
import type { MobDef, WorldSpawner } from '../../systems/spawn/WorldSpawner';
import type { SwarmCommander } from '../../systems/swarm/SwarmCommander';
import { INTENT_NONE } from '../../systems/swarm/Director';
import { buildEnemyCover } from './EnemyCoverBuild';

export interface CommanderWiringDeps {
  commander: SwarmCommander;
  spawner: WorldSpawner;
  raster: RasterMap;
  mobDefs: MobDef[];
  entities: EntityManager;
  scene: THREE.Scene;
  chunks: ChunkManager | null;
  /** 可站面高度（WorldMode.deploySurfaceAt 薄包装） */
  surfaceAt: (x: number, z: number) => number;
}

/** ★ 一次性接线（enter）：buildCover / digTrench / spawnMob */
export function wireCommanderPorts(d: CommanderWiringDeps): void {
  d.commander.buildCover = (x, z, v) =>
    buildEnemyCover(d.entities, d.scene, x, d.surfaceAt(x, z), z, v, d.commander.defensePlan);
  d.commander.digTrench = (x, z) => {
    d.chunks?.digRect(x, z, 2, 2);
  };
  // ★ 兵力创建（全权在蜂群架构）：按角色挑名册兵种 → 走唯一收口 spawnOne（配额/落点/代理池）
  d.commander.spawnMob = (x, z, role: UnitRole) => {
    const def = d.mobDefs.find((m) => m.role === role) ?? d.mobDefs[0];
    if (def) d.spawner.spawnOne(def, x, d.raster.surfaceHeightAt(x, z), z, INTENT_NONE, -1, true);
  };
}
