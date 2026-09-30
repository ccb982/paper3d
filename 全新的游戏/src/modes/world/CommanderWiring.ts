// ============================================================
// CommanderWiring —— 蜂群指挥器端口接线（模式层注入；《RTS架构.md》§3）
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
import type { SwarmData } from '../../systems/swarm/data/SwarmData';
import { pickDef } from '../../systems/spawn/MobPick';
import { buildEnemyCover } from './EnemyCoverBuild';

export interface CommanderWiringDeps {
  data: SwarmData;
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
  /** ★ 兵力闸门（账本 canSpawn；用户定 2026-09-30：HUD 的敌人总数/上限必须真的调控生成） */
  canSpawn?: () => boolean;
}

/** ★ 一次性接线（enter）：buildCover / digTrench / spawnMob */
export function wireCommanderPorts(d: CommanderWiringDeps): void {
  // ★ 掩体朝向修正（rts 口径）：正面朝**舰**（威胁来源）；件数据带 face（岗哨斜件/封口）优先
  d.data.buildCover = (x, z, v, face) =>
    buildEnemyCover(d.entities, d.scene, x, d.surfaceAt(x, z), z, v, d.data.defensePlan, face ?? d.playerPos());
  d.data.digTrench = (x, z) => {
    d.chunks?.digRect(x, z, 3, 3);   // ★ 7×7 宽面：逐级缩小约束下才能挖深
  };
  // ★ 所有地形破坏（子弹/战壕/任何挖坑）→ L1 战壕层（挖改格=战壕）
  if (d.chunks) d.chunks.onTerrainDig = (x, z, r) => d.data.noteTerrainDig(x, z, r);
  // ★ 兵力创建（全权在蜂群架构）：按角色挑名册兵种；精英按 elite 标签挑
  //   → 走唯一收口 spawnOne（落点闸门 / MAX_ALIVE / 记账；绕过旧每日配额）
  //   ★ **生成点必须距玩家 ≥80m**：不够就**沿来向向外推**（保持正面阵形，
  //   绝不从玩家径向外推——那会把阵形推成围着玩家的一圈）；到位靠行军
  const pickAcc: { [k: string]: number } = {};
  const spawnMobPort = (x: number, z: number, role: UnitRole, elite = false, near = false) => {
    // ★ 兵力闸门（唯一判据 = SwarmLedger.canSpawn）：**配额 total**（累计消耗，击杀不返还）
    //   与**上限 releaseCap**（并发在场，随事态增大）两个变量同时卡
    if (d.canSpawn && !d.canSpawn()) return;
    const p = d.playerPos();
    const plan = d.data.defensePlan;
    const ax = plan?.approachX ?? 1, az = plan?.approachZ ?? 0;
    let sx = x, sz = z;
    // ★ near（开局班底）：直接在锚点生成（工程队立刻开工）；否则按旧规则外推 ≥80m
    if (!near) {
      for (let i = 0; i < 10 && Math.hypot(sx - p.x, sz - p.z) < 80; i++) {
        sx += ax * 10; sz += az * 10;
      }
    }
    // ★ 兵种选取（用户定 2026-09-27）：同 role **按名册权重轮询全部非精英兵种**（不再只取第一个）；
    //   精英 → 精英；飞行兵包括自爆兵（用户定）。acc 常驻本接线作用域（确定性、均匀）。
    const def = pickDef<MobDef>(d.mobDefs, role, elite, pickAcc) ?? d.mobDefs[0];
    if (!def) return;
    // ★ 可站性微调：环位可能落在水里（此前直接失败 → 施工队只剩 1 只，永远开不了工）
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 6;
      const qx = sx + Math.cos(a) * r;
      const qz = sz + Math.sin(a) * r;
      if (d.spawner.spawnOne(def, qx, d.raster.surfaceHeightAt(qx, qz), qz, -1)) return;
    }
  };
  // ★ 施工兵生成（独有施工战术）：名册 canBuild 兵种优先；无 → 杂兵兜底
  const spawnBuilderPort = (x: number, z: number) => {
    const def = d.mobDefs.find((m) => m.canBuild)
      ?? d.mobDefs.find((m) => m.role === 'assault') ?? d.mobDefs[0];
    if (!def) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 2 + Math.random() * 6;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (d.spawner.spawnOne(def, sx, d.raster.surfaceHeightAt(sx, sz), sz, -1)) return;
    }
  };
  // ★ 统一装配原子生成口（此后创建只经四兵种管理器；旧名单/班底/大队创建已删）
  d.data.attachSpawnPorts({ mob: spawnMobPort, builder: spawnBuilderPort });
}
