// ============================================================
// CommanderWiring —— 蜂群指挥器端口接线（模式层注入；《敌人管线设计.md》§3）
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
  /** 玩家位置（生成点距离门控） */
  playerPos: () => { x: number; z: number };
}

/** ★ 一次性接线（enter）：buildCover / digTrench / spawnMob */
export function wireCommanderPorts(d: CommanderWiringDeps): void {
  d.commander.buildCover = (x, z, v) =>
    buildEnemyCover(d.entities, d.scene, x, d.surfaceAt(x, z), z, v, d.commander.defensePlan);
  d.commander.digTrench = (x, z) => {
    d.chunks?.digRect(x, z, 3, 3);   // ★ 7×7 宽面：逐级缩小约束下才能挖深
  };
  // ★ 所有地形破坏（子弹/战壕/任何挖坑）→ L1 战壕层（挖改格=战壕）
  if (d.chunks) d.chunks.onTerrainDig = (x, z, r) => d.commander.noteTerrainDig(x, z, r);
  // ★ 兵力创建（全权在蜂群架构）：按角色挑名册兵种；精英按 elite 标签挑
  //   → 走唯一收口 spawnOne（落点闸门 / MAX_ALIVE / 记账；绕过旧每日配额）
  //   ★ **生成点必须距玩家 ≥80m**：不够就**沿来向向外推**（保持正面阵形，
  //   绝不从玩家径向外推——那会把阵形推成围着玩家的一圈）；到位靠行军
  d.commander.spawnMob = (x, z, role: UnitRole, elite = false, near = false) => {
    const p = d.playerPos();
    const plan = d.commander.defensePlan;
    const ax = plan?.approachX ?? 1, az = plan?.approachZ ?? 0;
    let sx = x, sz = z;
    // ★ near（开局班底）：直接在锚点生成（工程队立刻开工）；否则按旧规则外推 ≥80m
    if (!near) {
      for (let i = 0; i < 10 && Math.hypot(sx - p.x, sz - p.z) < 80; i++) {
        sx += ax * 10; sz += az * 10;
      }
    }
    const def = elite
      ? (d.mobDefs.find((m) => m.elite) ?? d.mobDefs[0])
      : (d.mobDefs.find((m) => m.role === role) ?? d.mobDefs[0]);
    if (!def) return;
    // ★ 可站性微调：环位可能落在水里（此前直接失败 → 施工队只剩 1 只，永远开不了工）
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 6;
      const qx = sx + Math.cos(a) * r;
      const qz = sz + Math.sin(a) * r;
      if (d.spawner.spawnOne(def, qx, d.raster.surfaceHeightAt(qx, qz), qz, INTENT_NONE, -1)) return;
    }
  };
  // ★ 起飞回收名单重放：引擎给锚点，这里只做**可站性微调**（水/坑里就近挪几米），
  //   保证"回收数 = 放置数"（布置决策仍在引擎）
  d.commander.spawnMobIndex = (x, z, mobIndex) => {
    const def = d.mobDefs[mobIndex];
    if (!def) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 6;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (d.spawner.spawnSingle(def, sx, d.raster.surfaceHeightAt(sx, sz), sz, INTENT_NONE, -1)) return;
    }
  };
  // ★ 施工兵生成（独有施工战术）：名册 canBuild 兵种优先；无 → 杂兵兜底
  d.commander.spawnBuilder = (x, z) => {
    const def = d.mobDefs.find((m) => m.canBuild)
      ?? d.mobDefs.find((m) => m.role === 'assault') ?? d.mobDefs[0];
    if (!def) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 6;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (d.spawner.spawnOne(def, sx, d.raster.surfaceHeightAt(sx, sz), sz, INTENT_NONE, -1)) return;
    }
  };
  // ★ 逐兵种战术表（名册 EnemySpec.tactics）
  d.commander.mobTactics = (mobIndex) => d.mobDefs[mobIndex]?.tactics ?? null;
}
