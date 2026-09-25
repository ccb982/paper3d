// ============================================================
// EnemyCoverEntity —— 敌人施工的掩体/墙（独立实体类型；《RTS架构.md》§1.3 L2 工件）
// ============================================================
// 与玩家 `CoverEntity` 的区别（**存档不混、玩法不串**）：
//   · owner 固定 'enemy'、**无海报**（poster=false）；
//   · 存档走独立的 `enemyWalls` 记录（不占玩家墙上限、不参与玩家墙光环）；
//   · 玩家侧的"贴墙开枪无视自家墙"（wallNear）只认玩家墙。
// 碰撞/渲染/建造插值全部复用 CoverEntity 基类（owner='enemy' 分支）。
// ============================================================

import type * as THREE from 'three';
import { CoverEntity, type CoverOptions } from '../CoverEntity';
import type { EntityManager } from '../EntityManager';

export class EnemyCoverEntity extends CoverEntity {
  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    opts: Omit<CoverOptions, 'owner' | 'poster'>,
  ) {
    super(em, scene, { ...opts, owner: 'enemy', poster: false });
  }
}
