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
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { RasterMap, CHUNK_SIZE, chunkKeyOf } from '../services/map/RasterMap';
import { Minimap } from '../services/ui/Minimap';
import type { InputActions } from '../platform/input/InputActions';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import type { EntityBase } from '../entity/EntityBase';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager } from '../services/combat/BulletManager';
import { executeAttack } from '../services/combat/Attack';

export class WorldMode {
  readonly entities: EntityManager;
  readonly player: Player;
  enemy: EnemyBase | null = null;
  private cameraCtrl: CameraController;
  /** ★ 统一空间层（无限 chunk 地图：地形 + 实体索引 + 梯形剔除；架构 3.8/3.10） */
  private raster: RasterMap;
  private crosshair: Crosshair;
  /** ★ 小地图（左上角；RasterMap 地形 → Minimap 渲染） */
  private minimap: Minimap;
  /** 测试子弹资产（程序生成发光圆点；正式资产就绪后替换） */
  private bulletAsset = createSolidBulletAsset();
  /** ★ 子弹池（预创建 100 颗反复使用；超时回池，不销毁重建） */
  private bullets: BulletManager;
  private bulletCooldown = 0;
  /** chunk 视觉网格（chunkKey → Mesh；天内只增不删，天结束统一回收） */
  private chunkMeshes = new Map<number, THREE.Mesh>();
  /** chunk 地面刚体（chunkKey → 已建标记；防重复） */
  private chunkBodies = new Set<number>();
  /** chunk 共享网格/材质（占位平地；★ 旋转到 XZ 平面——PlaneGeometry 默认 XY 竖立） */
  private static chunkGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2);
  private static chunkMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.9, metalness: 0 });
  /** AI 上下文（索敌 = 玩家位置 + 攻击意图 = 统一攻击管线） */
  private aiCtx: BehaviorContext = {
    dt: 0,
    time: 0,
    target: null,
    findTarget: () => null,
    attack: () => undefined,
  };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    asset: FtxAsset,
    physics: PhysicsWorld,
    enemyAsset?: Asset,
  ) {
    // ---- ★ 统一空间层（初始 3×3 chunk，玩家驱动扩张；架构 3.8） ----
    this.raster = new RasterMap();
    // ---- 实体管线（管理 + 物理 + 基类实例） ----
    this.entities = new EntityManager(physics, this.raster);

    // 玩家出生 = 中心 chunk 中心（(30,30)，3×3 初始世界 [-60,120)² 正中央）
    const spawn = { x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 };

    // ---- ★ 初始 3×3 chunk 的地面刚体 + 视觉网格（后续 chunk 由 updateChunks 扩张） ----
    this.syncChunks(spawn.x, spawn.z);

    // ★ 主角（CharacterBase 实例：物理/动画/渲染全由基类联动）
    this.player = new Player(this.entities, scene, asset, {
      x: spawn.x, y: 0, z: spawn.z,
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

    // ---- ★ 测试物品（程序图标圆点；走近拾取验证，后续接配置表/背包） ----
    // 生成位置 = 地面高度（实体 y = 底部贴地）
    const itemIcons = [
      createSolidBulletAsset(64, 0.05, 0.85, 0.6), // 绿
      createSolidBulletAsset(64, 0.12, 0.9, 0.55), // 黄
      createSolidBulletAsset(64, 0.85, 0.8, 0.5),  // 紫
    ];
    for (let i = 0; i < itemIcons.length; i++) {
      const item = new ItemBase(this.entities, scene, itemIcons[i], {
        x: spawn.x + 6 + i * 2.5,
        y: this.raster.heightAt(spawn.x + 6 + i * 2.5, spawn.z + 6),
        z: spawn.z + 6,
        itemId: `test_item_${i + 1}`,
        displayName: `测试物品${i + 1}`,
        physical: true,
      });
      item.onPickup = (it, picker) => {
        console.log(`[拾取] ${picker.constructor.name} 拾取了「${it.displayName}」(${it.itemId})`);
        return true;
      };
    }

    // ---- ★ 测试敌人（普瑞赛斯：特效包 + AI 配置驱动） ----
    if (enemyAsset) {
      this.enemy = new EnemyBase(this.entities, scene, enemyAsset, {
        x: spawn.x + 12,
        y: 0,
        z: spawn.z + 8,
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

    // ---- ★ 小地图（RasterMap 光栅化地形 → Minimap 左上角绘制） ----
    this.minimap = new Minimap(this.raster);

    // ---- ★ 子弹池（100 颗常驻复用） ----
    this.bullets = new BulletManager(this.entities, scene, this.bulletAsset, 100);
    // ★ AI 攻击意图 = 统一攻击管线（近战/远程/范围分派 → 伤害管线）
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);
  }

  /** 每帧驱动（输入 → 相机 → 实体管线 → AI → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }, zoom: number): void {
    const pp = this.player.controllerPosition;

    // ★ 无限地图扩张（玩家跨 chunk → 新 chunk 加载：数据 + 地面刚体 + 视觉网格）
    this.syncChunks(pp.x, pp.y);

    // ★ 小地图每帧更新（三层：地面/实体/黑雾；玩家居中 + 箭头=摄像机朝向）
    this.minimap.update(pp.x, pp.y, this.cameraCtrl.worldYaw, this.entities.allBases());

    // AI 上下文（本帧 dt/累计时间 + 索敌 = 玩家位置 + 攻击发射 = 子弹管线）
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });

    // ★ 玩家 y 由地形高度（无限地图：raster 无界采样）——模式层钉
    // 相机高度 = 玩法高度（地形+跳跃），不跟随物理 y 浮动（否则撞人时相机猛跳"错位"）
    const groundY = this.raster.heightAt(pp.x, pp.y);
    this.cameraCtrl.update(dt, look, zoom, {
      x: pp.x,
      y: 0,
      z: pp.y,
      height: groundY,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

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

    // ---- ★ 角色位置控制（kinematic：位置 = 代码；y 地形 + xz 边界）
    //         纯数据操作，无刚体同步（刚体由 syncPhysics 驱动） ----
    this.clampCharacter(this.player);
    if (this.enemy) this.clampCharacter(this.enemy);
  }

  /** ★ 相机准星射线（公共：瞄准检测/发射兜底共用，避免重复计算） */
  private cameraRay(): { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } {
    this.camera.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera.getWorldDirection(rayDir);
    const cam = this.camera.position;
    return {
      origin: { x: cam.x, y: cam.y, z: cam.z },
      dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };
  }

  /** ★ 准星射线查询（公共瞄准服务：实体优先 → 物理兜底，见 services/combat/Targeting） */
  private aimRaycast(): { x: number; y: number; z: number } | null {
    const ray = this.cameraRay();
    const hit = aimRaycast(this.entities, {
      origin: ray.origin,
      dir: ray.dir,
      maxDist: 200,
      exclude: this.player,
    });
    return hit ? hit.point : null;
  }

  /** ★ 玩家发射（TPS 标准）：
   *   ① 摄像机沿准星方向发一条射线 → 落点（命中目标实体/地面，排除玩家自身）
   *   ② 角色枪口 → 落点 = 发射方向（3D：带俯仰） */
  private firePlayerBullet(): void {
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z }; // 枪口
    // ① 准星射线 → 落点（aimRaycast 内部已算相机射线，无命中 → 远处兜底）
    const aim = this.aimRaycast();
    let tx: number, ty: number, tz: number;
    if (aim) {
      tx = aim.x; ty = aim.y; tz = aim.z;
    } else {
      const ray = this.cameraRay();
      tx = ray.origin.x + ray.dir.x * 200;
      ty = ray.origin.y + ray.dir.y * 200;
      tz = ray.origin.z + ray.dir.z * 200;
    }
    // ② 枪口 → 落点（3D 方向）
    const dx = tx - muzzle.x, dy = ty - muzzle.y, dz = tz - muzzle.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // ★ 玩家射击 = 统一攻击管线（projectile 意图）
    executeAttack(this.entities, this.bullets, {
      type: 'projectile',
      source: this.player,
      x: muzzle.x + (dx / len) * 0.8,
      y: muzzle.y + (dy / len) * 0.8,
      z: muzzle.z + (dz / len) * 0.8,
      dirX: dx / len,
      dirY: dy / len,
      dirZ: dz / len,
      speed: 12,
      camp: 'player',
      lifetime: 2,
      damage: 10, // ★ 穿透伤害（敌人 30 血 → 3 发）
    });
  }

  /** 渲染：实体管线遍历画 + 地图 + 场景 */
  render(renderer: THREE.WebGLRenderer): void {
    this.entities.renderAll(this.camera);
    renderer.render(this.scene, this.camera);
  }

  /** ★ 无限地图 chunk 同步：数据（RasterMap）+ 地面刚体 + 视觉网格。
   *   天内只增不删；天结束（dispose/clearAll）统一回收 */
  private syncChunks(px: number, pz: number): void {
    const added = this.raster.updateChunks(px, pz);
    for (const { cx, cz } of added) {
      const key = chunkKeyOf(cx, cz);
      if (!this.chunkBodies.has(key)) {
        this.chunkBodies.add(key);
        // 地面刚体（60×60 薄板，物理支撑面）
        this.entities.create({
          kind: 'ground',
          x: cx * CHUNK_SIZE + CHUNK_SIZE / 2,
          y: -0.05,
          z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
          physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: CHUNK_SIZE / 2, hy: 0.05, hz: CHUNK_SIZE / 2 } } },
        });
      }
      if (!this.chunkMeshes.has(key)) {
        // 视觉网格（占位平地，共享几何/材质）
        const mesh = new THREE.Mesh(WorldMode.chunkGeo, WorldMode.chunkMat);
        mesh.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.chunkMeshes.set(key, mesh);
      }
    }
  }

  /** ★ 天结束统一回收（世界重建：raster 重置 3×3 + chunk 网格/刚体清理） */
  resetDay(): void {
    this.raster.clearAll();
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
    }
    this.chunkMeshes.clear();
    this.chunkBodies.clear();
    this.syncChunks(this.player.position.x, this.player.position.z);
  }

  /** ★ 角色位置控制（kinematic）：y = 地形高度；★ 世界无限，无 xz 边界 */
  private clampCharacter(e: CharacterBase): void {
    const p = e.position;
    p.y = this.raster.heightAt(p.x, p.z);
  }

  dispose(): void {
    this.entities.clear();
    this.crosshair.dispose();
    this.minimap.dispose();
    this.bullets.dispose();
    // chunk 视觉网格（天内统一回收）
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
    }
    this.chunkMeshes.clear();
    this.chunkBodies.clear();
  }
}
