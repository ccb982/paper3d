// ============================================================
// WorldMode —— 大世界模式（实体管线驱动的验证场景）
// ============================================================
// 组合职责（架构 2.2）：
//   - 地图（数据/查询/渲染）+ 相机（CameraController）
//   - 实体管线：Player（CharacterBase）实例 —— 模式只做组合，不碰实体内部
//   - 准星 + 交互（中心射线）
//
// 输入流：Binding(设备) → InputActions(语义) → 本模式 → 实体管线

import * as THREE from 'three';
import { FtxAsset } from '../vendor/player/FtxAsset';
import type { Asset } from '../vendor/player';
import { EntityManager } from '../entity/EntityManager';
import { Player } from '../entity/Player';
import { EnemyBase } from '../entity/EnemyBase';
import { CameraController } from '../services/camera/CameraController';
import { Crosshair } from '../services/ui/Crosshair';
import { MapQuery } from '../services/map/MapQuery';
import { MapRender } from '../services/map/MapRender';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import type { InputActions } from '../platform/input/InputActions';
import { drainInteractions } from '../platform/input/InputActions';

export class WorldMode {
  readonly entities: EntityManager;
  readonly player: Player;
  enemy: EnemyBase | null = null;
  private cameraCtrl: CameraController;
  private mapRender: MapRender;
  private map: MapQuery;
  private crosshair: Crosshair;
  private lastTapWorld: { x: number; y: number } | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    asset: FtxAsset,
    map: MapQuery,
    physics: PhysicsWorld,
    enemyAsset?: Asset,
  ) {
    this.map = map;
    // ---- 实体管线（管理 + 物理 + 基类实例） ----
    this.entities = new EntityManager(physics);

    // 地面实体（固定碰撞体，匹配 64×64 地图；纯数据实体，无行为）
    const b = map.getBounds();
    const center = (b.min + b.max) / 2;
    this.entities.create({
      kind: 'ground',
      x: center, y: 0, z: center,
      physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: 32, hy: 0.5, hz: 32 } } },
    });

    // ★ 主角（CharacterBase 实例：物理/动画/渲染全由基类联动）
    this.player = new Player(this.entities, scene, asset, {
      x: center, y: 0, z: center,
      animMap: {
        states: {
          idle: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          walk: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          attack: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
        },
        fps: { idle: 2, walk: 6, attack: 8 },
      },
      moveSpeed: 2.5,
      facing: '后',
    });

    // ---- 地图视觉（3D 地形网格，当前平地占位） ----
    this.mapRender = new MapRender(scene, map);

    // ---- ★ 测试敌人（普瑞赛斯：特效包，2 帧前/后 + 扭曲参数） ----
    if (enemyAsset) {
      this.enemy = new EnemyBase(this.entities, scene, enemyAsset, {
        x: center + 3,
        y: 0,
        z: center + 2,
        animMap: {
          states: {
            idle: { 前: ['前'], 后: ['后'] },
            walk: { 前: ['前'], 后: ['后'] },
            attack: { 前: ['前'], 后: ['后'] },
          },
          fps: { idle: 1, walk: 1, attack: 1 },
        },
        facing: '前',
        aggressive: true,
      }, camera);
      this.enemy.billboard = false;
      this.enemy.playFacing('前');
    }

    // ---- 相机（独立模块） ----
    this.cameraCtrl = new CameraController(camera);

    // ---- 准星（固定屏幕中心，瞄准/交互基准） ----
    this.crosshair = new Crosshair();
  }

  /** 每帧驱动（输入 → 相机 → 实体管线 → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }, zoom: number): void {
    const pp = this.player.controllerPosition;

    // 玩家 y = 地形高度（模式层同步，实体不依赖地图）
    this.player.entity.position.y = this.map.getHeight(pp.x, pp.y);

    // ---- 相机（聚焦点 = 角色 + 跳跃偏移（按人称增益）；平滑 lerp → 抖动过滤；
    //      第一人称移动 → 脚步随机晃动） ----
    this.cameraCtrl.update(dt, look, zoom, {
      x: pp.x,
      y: 0,
      z: pp.y,
      height: this.player.entity.position.y,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

    // ---- 实体管线驱动（攻击由模式层转发，输入/相机坐标系传入） ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- 地图边界钳制（经 MapQuery） ----
    const p2 = this.player.controllerPosition;
    const bounds = this.map.getBounds();
    this.player.controller.position.x = Math.max(bounds.min, Math.min(bounds.max, p2.x));
    this.player.controller.position.y = Math.max(bounds.min, Math.min(bounds.max, p2.y));

    // ---- 交互消费（★ 以准星为基准：中心射线，与设备解耦） ----
    const rayNdc = new THREE.Vector2(0, 0);
    const raycast = new THREE.Raycaster();
    for (const it of drainInteractions(input)) {
      if (it.type === 'tap') {
        raycast.setFromCamera(rayNdc, this.camera);
        const hit = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycast.ray.intersectPlane(plane, hit)) {
          this.lastTapWorld = { x: hit.x, y: hit.z };
          console.log('[WorldMode] 准星目标:', this.lastTapWorld);
        }
      }
    }
  }

  /** 渲染：实体管线遍历画 + 地图 + 场景 */
  render(renderer: THREE.WebGLRenderer): void {
    this.entities.renderAll(this.camera);
    renderer.render(this.scene, this.camera);
  }

  get playerPosition(): { x: number; y: number } {
    return this.player.controllerPosition;
  }

  get playerState(): string {
    return this.player.controller.state;
  }

  get playerFacing(): string {
    return this.player.anim!.state.facing;
  }

  get playerFlipX(): boolean {
    return this.player.anim!.state.flipX;
  }

  get frameIndex(): number {
    return this.player.anim!.state.frameIndex;
  }

  get lastTap(): { x: number; y: number } | null {
    return this.lastTapWorld;
  }

  dispose(): void {
    this.entities.clear();
    this.mapRender.dispose();
    this.crosshair.dispose();
  }
}
