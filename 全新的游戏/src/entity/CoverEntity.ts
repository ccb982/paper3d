// ============================================================
// CoverEntity —— 掩体（StructureEntity 子类；《蜂群架构.md》§22.11）
// ============================================================
// 形态：高 3m / 宽 4m / 厚 0.8m；灰砖墙 + 正面竖向射击孔（宽 0.4 / 高 1.2~1.6）。
// 碰撞：复合长方体 = 下段 + 上段 + 左右立柱 —— 只有穿过孔带才能命中后方
//       （复用 BodyOptions.extraColliders，与舰船分段同一套基建）。
// 建造：buildProgress 0→1 插值长高（渲染器消费）；施工期可被打断（玩法层控制）。
// 摧毁：走 applyDamage（StructureEntity 覆写，不发 killed / 不计击杀）。
// 来源：敌方杂兵施工（owner='enemy'）/ 玩家遗物道具发射落地（owner='player'）。
// ============================================================

import type * as THREE from 'three';
import { StructureEntity, type StructureOptions } from './StructureEntity';
import type { EntityManager } from './EntityManager';
import { addStaticObstacleRect, removeStaticObstacle } from '../services/physics/StaticObstacleRegistry';
import { HealthBar } from '../services/fx/HealthBar';
import { RasterMap } from '../services/map/RasterMap';
import {
  CoverRenderer,
  COVER_W, COVER_H, COVER_T, COVER_SLIT_W, COVER_SLIT_Y0, COVER_SLIT_Y1,
} from '../services/render/CoverRenderer';

/** 掩体生命值（走 applyDamage 口径；可被拆） */
export const COVER_HP = 400;
/** 玩家部署的默认成型时长（秒；插值长高） */
export const COVER_DEPLOY_BUILD_TIME = 0.6;

export interface CoverOptions {
  x: number; y: number; z: number;
  /** 朝向（弧度；局部 +Z = 墙厚轴/正面法线） */
  heading?: number;
  /** 归属（决定 camp / 通行掩码） */
  owner?: 'player' | 'enemy';
  /** 生命值（缺省 COVER_HP） */
  hp?: number;
  /** 成型时长（秒；0 = 立即成型） */
  buildTime?: number;
}

export class CoverEntity extends StructureEntity {
  readonly owner: 'player' | 'enemy';
  private readonly buildTime: number;
  private buildElapsed = 0;
  /** ★ 角色阻挡索引 id（JS 静态障碍：掩体挡人走，不挡弹——弹走物理复合体） */
  private readonly blockId: number;
  /** 墙朝向（碰撞体/阻挡索引/渲染共用） */
  private readonly heading: number;

  constructor(em: EntityManager, scene: THREE.Scene, opts: CoverOptions) {
    const pillarW = (COVER_W - COVER_SLIT_W) / 2;
    const midY = (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2;
    const midH = (COVER_SLIT_Y1 - COVER_SLIT_Y0) / 2;
    const phys: StructureOptions['physics'] = {
      type: 'fixed',
      options: {
        // 主碰撞体 = 孔下段（全宽）
        shape: { type: 'cuboid', hx: COVER_W / 2, hy: COVER_SLIT_Y0 / 2, hz: COVER_T / 2 },
        shapeOffset: { x: 0, y: COVER_SLIT_Y0 / 2, z: 0 },
        extraColliders: [
          // 孔上段（全宽）
          {
            shape: { type: 'cuboid', hx: COVER_W / 2, hy: (COVER_H - COVER_SLIT_Y1) / 2, hz: COVER_T / 2 },
            offset: { x: 0, y: (COVER_SLIT_Y1 + COVER_H) / 2, z: 0 },
          },
          // 左右立柱（中间留射击孔）
          {
            shape: { type: 'cuboid', hx: pillarW / 2, hy: midH, hz: COVER_T / 2 },
            offset: { x: -(COVER_SLIT_W / 2 + pillarW / 2), y: midY, z: 0 },
          },
          {
            shape: { type: 'cuboid', hx: pillarW / 2, hy: midH, hz: COVER_T / 2 },
            offset: { x: COVER_SLIT_W / 2 + pillarW / 2, y: midY, z: 0 },
          },
        ],
      },
    };
    super(em, {
      x: opts.x, y: opts.y, z: opts.z,
      physics: phys,
      // ★ 中立实体：双方子弹都能打（sameTeam 只对 player/ally 互免）
      camp: 'neutral',
      hp: opts.hp ?? COVER_HP,
      defense: 2,
    });
    this.owner = opts.owner ?? 'enemy';
    this.heading = opts.heading ?? 0;
    this.buildTime = opts.buildTime ?? 0;
    // ★ 建造进度必须与渲染器同步（否则基类默认 1 → onUpdate 直接 return，永远停在起始缩放）
    this.buildProgress = this.buildTime > 0 ? 0 : 1;
    this.attachToScene(scene);
    const r = this.renderer as CoverRenderer | null;
    r?.setYaw(this.heading);
    if (this.buildTime > 0) r?.setBuildProgress(0);
    // ★ 血条（双方可见；跟随墙顶）
    this.attachEffect('health', new HealthBar(scene, this, {
      width: 1.2,
      offsetY: COVER_H + 0.4,
    }));
    // ★ 角色阻挡（所有 CharacterBase 的 separateFromStatics 消费）：
    //   半宽/半厚/半高；yaw = 墙朝向；walkableTop=false（薄墙不可站顶）
    this.blockId = -(this.entity.id * 16 + 1);
    addStaticObstacleRect(
      this.blockId, opts.x, opts.y + COVER_H / 2, opts.z,
      COVER_W / 2, COVER_T / 2, COVER_H / 2, opts.heading ?? 0, false,
    );
  }

  override dispose(): void {
    removeStaticObstacle(this.blockId);
    super.dispose();
  }

  protected createRenderer(scene: THREE.Scene): CoverRenderer {
    return new CoverRenderer(scene);
  }

  /** 建造插值推进（0→1 长高）+ ★ 随地面变化插值（挖坑/地形改动时平滑沉/升） */
  protected override onUpdate(dt: number): void {
    if (this.buildProgress < 1) {
      this.buildElapsed += dt;
      this.buildProgress = Math.min(1, this.buildTime > 0 ? this.buildElapsed / this.buildTime : 1);
      (this.renderer as CoverRenderer | null)?.setBuildProgress(this.buildProgress);
    }
    // ★ 地面跟随（插值）：采样脚下地表高，平滑逼近；变化超过阈值才同步刚体/阻挡索引
    const p = this.entity.position;
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? p.y;
    const dy = gy - p.y;
    if (Math.abs(dy) > 1e-3) {
      p.y += dy * Math.min(1, dt * 4);
      this.syncGround();
    }
  }

  /** 地面高度变化后：同步 fixed 刚体 + 重建角色阻挡索引（同 id remove→add） */
  private syncGround(): void {
    const p = this.entity.position;
    const rb = this.entity.rigidBody;
    const phys = this.em.physics;
    if (rb && phys) phys.setPosition(rb.handle, p.x, p.y, p.z);
    removeStaticObstacle(this.blockId);
    addStaticObstacleRect(
      this.blockId, p.x, p.y + COVER_H / 2, p.z,
      COVER_W / 2, COVER_T / 2, COVER_H / 2, this.heading, false,
    );
  }

  /** ★ 表现 LOD：几何体不参与 renderAll 的贴片 LOD，这里按距离直接隐藏（lod≥3） */
  override applyViewDistance(distance: number): void {
    super.applyViewDistance(distance);
    (this.renderer as CoverRenderer | null)?.setVisible(this.visible && this.viewLod < 3);
  }
}
