// ============================================================
// VisitorManager —— 访客系统（每日生成 / 世界侧管理 / 舰内名册）
// ============================================================
// 设计（2026-09-15 用户定）：
//   · 每天世界上生成 1~2 名访客，向舰船位置行进 → 抵达后进舰内房间；
//   · 进房提示"神秘访客已到访，快回舰船内看看吧！"（WorldMode 接线 UI）；
//   · 每名访客独立纹理 / 对话 / 事件（config/visitors.ts + dialogues.json）。
// 分工：本类只管"生成 + 名单 + 生命周期"；世界实体接线（E 对话 / 提示 /
//   舰内站位 / 落账）由 WorldMode 负责（与 NpcEntity 同一模式）。
// ============================================================

import type * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import type { EntityManager } from '../../entity/EntityManager';
import { VisitorNpcBase, type VisitorDef } from '../../entity/VisitorNpc';
import { loadFtxCached } from '../../services/fx/FtxAssetCache';
import { RasterMap } from '../../services/map/RasterMap';
import type { CameraFrame } from '../../services/camera/CameraController';
import { hash2 } from '../../services/map/TerrainNoise';
import { VISITORS } from '../../config/visitors';

/** 落地生成距离（米）：舰船附近环带 —— 刚落地就能看到访客走进来 */
const SPAWN_R_MIN = 16;
const SPAWN_R_MAX = 30;

export interface VisitorManagerOpts {
  session: GameSession;
  entities: EntityManager;
  scene: THREE.Scene;
  /** 舰船当前位置（每帧读取 → 舰船移动也能追） */
  getShipPosition: () => { x: number; z: number } | null;
  getCameraFrame: () => CameraFrame | null;
  /** ★ 抵达（世界侧已退场；上层：到访提示 + 舰内入住/刷新） */
  onArrive?: (visitor: VisitorNpcBase) => void;
  /** ★ 被打跑（上层：提示；随后由基类自行跑远退场） */
  onFlee?: (visitor: VisitorNpcBase) => void;
}

export class VisitorManager {
  private readonly opts: VisitorManagerOpts;
  /** 世界侧活跃访客（approaching / fleeing） */
  readonly visitors: VisitorNpcBase[] = [];
  /** 已到舰访客（世界侧已隐藏；舰内可交谈，谈完/离舰移出） */
  readonly insiders: VisitorNpcBase[] = [];
  private startedDay = -1;
  private alive = true;

  constructor(opts: VisitorManagerOpts) {
    this.opts = opts;
  }

  /** ★ 当天首次探索帧调用：落地即生成**全部访客**（2026-09-15 用户定调；
   *  按天确定性落点在舰船附近 16~30m，纹理异步加载） */
  beginDay(day: number): void {
    if (this.startedDay === day) return;
    this.startedDay = day;
    const ship = this.opts.getShipPosition();
    if (!ship) return;
    VISITORS.forEach((def, i) => {
      void this.spawn(def, day, i, ship.x, ship.z);
    });
  }

  /** 世界侧就近可交谈访客（仅 approaching；WorldMode E 提示/对话用） */
  nearestTalkable(px: number, pz: number): VisitorNpcBase | null {
    let best: VisitorNpcBase | null = null;
    let bestD = Infinity;
    for (const v of this.visitors) {
      if (v.visitPhase !== 'approaching') continue;
      const d2 = (v.position.x - px) ** 2 + (v.position.z - pz) ** 2;
      if (d2 <= v.interactRadius * v.interactRadius && d2 < bestD) {
        bestD = d2;
        best = v;
      }
    }
    return best;
  }

  /** ★ 舰内访客谈完/离舰：移出名册并销毁世界实体 */
  removeInsider(v: VisitorNpcBase): void {
    const i = this.insiders.indexOf(v);
    if (i < 0) return;
    this.insiders.splice(i, 1);
    v.dispose();
  }

  /** 模式退出：全部销毁 */
  dispose(): void {
    this.alive = false;
    for (const v of this.visitors) v.dispose();
    for (const v of this.insiders) v.dispose();
    this.visitors.length = 0;
    this.insiders.length = 0;
  }

  // ---- 内部 ----

  private async spawn(def: VisitorDef, day: number, index: number, sx: number, sz: number): Promise<void> {
    try {
      const asset = await loadFtxCached(def.assetUrl);
      if (!this.alive) return;
      const spot = this.findSpawnSpot(sx, sz, day, index);
      if (!spot) return;
      const visitor = new VisitorNpcBase(this.opts.entities, this.opts.scene, asset, {
        def,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        getTarget: this.opts.getShipPosition,
        getCameraFrame: this.opts.getCameraFrame,
        onArrive: (v) => this.handleArrive(v),
        onFlee: (v) => this.opts.onFlee?.(v),
        onFleeEnd: (v) => this.removeWorld(v),
      });
      this.visitors.push(visitor);
    } catch (e) {
      console.warn(`[访客] ${def.id} 生成失败:`, e);
    }
  }

  /** 近舰环形确定性落点（避坑/深坑底；8 次采样都危险则放弃） */
  private findSpawnSpot(sx: number, sz: number, day: number, index: number): { x: number; y: number; z: number } | null {
    const seed = this.opts.session.meta.seed;
    const raster = RasterMap.current;
    for (let k = 0; k < 8; k++) {
      const a = hash2(day, 1000 + index * 37 + k, seed) * Math.PI * 2;
      const r = SPAWN_R_MIN + hash2(day, 2000 + index * 13 + k, seed) * (SPAWN_R_MAX - SPAWN_R_MIN);
      const x = sx + Math.cos(a) * r;
      const z = sz + Math.sin(a) * r;
      if (raster?.tileDefAt(x, z).genRole === 'pit') continue;
      const y = raster?.surfaceHeightAt(x, z) ?? 0;
      if (y < -1.2) continue;
      return { x, y, z };
    }
    return null;
  }

  /** 抵达：世界侧退场 → 记入舰内名册（实体保留，供舰内对话；谈完 removeInsider） */
  private handleArrive(v: VisitorNpcBase): void {
    v.markEntered();
    const i = this.visitors.indexOf(v);
    if (i >= 0) this.visitors.splice(i, 1);
    if (!this.insiders.includes(v)) this.insiders.push(v);
    this.opts.onArrive?.(v);
  }

  /** 逃逸结束（或异常路径）：销毁世界实体 */
  private removeWorld(v: VisitorNpcBase): void {
    const i = this.visitors.indexOf(v);
    if (i >= 0) this.visitors.splice(i, 1);
    v.dispose();
  }
}
