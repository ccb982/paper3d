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
import { CharacterBase } from '../entity/CharacterBase';
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
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { BulletBase } from '../entity/BulletBase';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';

export class WorldMode {
  readonly entities: EntityManager;
  readonly player: Player;
  enemy: EnemyBase | null = null;
  private cameraCtrl: CameraController;
  private mapRender: MapRender;
  private map: MapQuery;
  private crosshair: Crosshair;
  private lastTapWorld: { x: number; y: number } | null = null;
  /** 测试子弹资产（程序生成发光圆点；正式资产就绪后替换） */
  private bulletAsset = createSolidBulletAsset();
  private bulletCooldown = 0;
  /** ★ 准星射线落点调试标记（红点显示瞄准落点） */
  private aimMarker: THREE.Mesh;
  /** AI 上下文（索敌 = 玩家位置） */
  private aiCtx: BehaviorContext = {
    dt: 0,
    time: 0,
    target: null,
    findTarget: () => null,
  };

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
    // ★ 薄板顶面 = y0：角色脚底落在其上（重力站立支撑面）
    const b = map.getBounds();
    const center = (b.min + b.max) / 2;
    this.entities.create({
      kind: 'ground',
      x: center, y: -0.05, z: center,
      physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: 32, hy: 0.05, hz: 32 } } },
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

    // ---- ★ 测试敌人（普瑞赛斯：特效包 + AI 配置驱动） ----
    if (enemyAsset) {
      this.enemy = new EnemyBase(this.entities, scene, enemyAsset, {
        x: center + 12,
        y: 0,
        z: center + 8,
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
        aiConfig: PRESERVER_AI,
      }, camera);
      // ★ 贴片世界朝向（绕 Y 旋转跟随移动方向）；显示帧/转身由相机判定（EnemyBase.onUpdate）
      this.enemy.billboard = false;
    }

    // ---- 相机（独立模块） ----
    this.cameraCtrl = new CameraController(camera);

    // ---- 准星（固定屏幕中心，瞄准/交互基准） ----
    this.crosshair = new Crosshair();

    // ---- ★ 瞄准落点调试标记（红点：摄像机 → 准星射线的落点） ----
    this.aimMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.9 }),
    );
    scene.add(this.aimMarker);
  }

  /** 每帧驱动（输入 → 相机 → 实体管线 → AI → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }, zoom: number): void {
    const pp = this.player.controllerPosition;

    // AI 上下文（本帧 dt/累计时间 + 索敌 = 玩家位置）
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });

    // ★ 玩家 y 由物理读回（重力/被顶起真实可见）——模式层不再钉死
    // 相机高度 = 玩法高度（地形+跳跃），不跟随物理 y 浮动（否则撞人时相机猛跳"错位"）
    const groundY = this.map.getHeight(pp.x, pp.y);
    this.cameraCtrl.update(dt, look, zoom, {
      x: pp.x,
      y: 0,
      z: pp.y,
      height: groundY,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

    // ---- ★ 瞄准落点调试（红点跟随准星射线落点） ----
    const aim = this.aimRaycast();
    if (aim) {
      this.aimMarker.visible = true;
      this.aimMarker.position.set(aim.x, aim.y, aim.z);
    } else {
      this.aimMarker.visible = false;
    }

    // ---- AI 驱动（敌人自主行为；★ 在实体管线之前：本帧方向本帧生效，移动零滞后） ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- 实体管线驱动（攻击由模式层转发，输入/相机坐标系传入） ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- ★ 玩家发射（左键：单次按下立即一发；长按 = 间隔持续发射） ----
    this.bulletCooldown -= dt;
    if (this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = 0.15;
      this.firePlayerBullet();
    }

    // ---- ★ 角色钳制（模式层知道地形/地图）：贴地（防"顶飞"：抬升 >0.4 拉回地面+刚体）
    //         + 地图边界；实体与刚体同步 ----
    this.clampCharacter(this.player);
    if (this.enemy) this.clampCharacter(this.enemy);

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
        }
      }
    }
  }

  /** ★ 准星射线查询（摄像机沿准星方向 → 落点；排除玩家自身；null = 无命中） */
  private aimRaycast(): { x: number; y: number; z: number } | null {
    this.camera.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera.getWorldDirection(rayDir);
    const cam = this.camera.position;
    const rb = this.player.entity.rigidBody;
    const hit = this.entities.physics?.castRay(
      { x: cam.x, y: cam.y, z: cam.z },
      { x: rayDir.x, y: rayDir.y, z: rayDir.z },
      200,
      rb?.handle,
    );
    return hit ? hit.point : null;
  }

  /** ★ 玩家发射（TPS 标准）：
   *   ① 摄像机沿准星方向发一条射线 → 落点（命中目标实体/地面，排除玩家自身）
   *   ② 角色枪口 → 落点 = 发射方向（3D：带俯仰） */
  private firePlayerBullet(): void {
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z }; // 枪口
    // ① 准星射线 → 落点
    const aim = this.aimRaycast();
    let tx: number, ty: number, tz: number;
    if (aim) {
      tx = aim.x; ty = aim.y; tz = aim.z;
    } else {
      this.camera.updateMatrixWorld();
      const rayDir = new THREE.Vector3();
      this.camera.getWorldDirection(rayDir);
      const cam = this.camera.position;
      tx = cam.x + rayDir.x * 200; ty = cam.y + rayDir.y * 200; tz = cam.z + rayDir.z * 200;
    }
    // ② 枪口 → 落点（3D 方向）
    const dx = tx - muzzle.x, dy = ty - muzzle.y, dz = tz - muzzle.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    new BulletBase(this.entities, this.scene, this.bulletAsset, {
      x: muzzle.x + (dx / len) * 0.8,
      y: muzzle.y + (dy / len) * 0.8,
      z: muzzle.z + (dz / len) * 0.8,
      dirX: dx / len,
      dirY: dy / len,
      dirZ: dz / len,
      speed: 12,
      camp: 'player',
      lifetime: 2,
    });
  }

  /** 渲染：实体管线遍历画 + 地图 + 场景 */
  render(renderer: THREE.WebGLRenderer): void {
    this.entities.renderAll(this.camera);
    renderer.render(this.scene, this.camera);
  }

  /** ★ 角色钳制：贴地（防顶飞：抬升超 0.4 拉回，刚体同步）+ 地图边界。
   *   放模式层：只有它知道地形高度与地图范围（实体不依赖地图） */
  private clampCharacter(e: CharacterBase): void {
    const p = e.position;
    const g = this.map.getHeight(p.x, p.z);
    const b = this.map.getBounds();
    const nx = Math.max(b.min, Math.min(b.max, p.x));
    const nz = Math.max(b.min, Math.min(b.max, p.z));
    const ny = Math.min(g + 0.4, p.y);
    if (nx !== p.x || nz !== p.z || ny !== p.y) {
      p.x = nx; p.y = ny; p.z = nz;
      const rb = e.entity.rigidBody;
      if (rb) this.entities.physics?.setPosition(rb.handle, nx, ny + e.bodyOffsetY, nz);
    }
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
    // ★ 瞄准调试标记
    this.aimMarker.geometry.dispose();
    (this.aimMarker.material as THREE.Material).dispose();
    this.scene.remove(this.aimMarker);
  }
}
