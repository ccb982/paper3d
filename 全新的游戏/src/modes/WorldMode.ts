// ============================================================
// WorldMode —— 大世界模式（完全自包含）
// ============================================================
// 组合职责（架构 2.2）：
//   - 拥有私有 PhysicsWorld、DesktopBinding、EntityManager
//   - 输入流：Binding(设备) → InputActions(语义) → 本模式 → 实体管线
//   - 进入战场时创建物理/输入，返回时完整清理
//
// 核心原则："谁创建，谁销毁；谁拥有，谁负责"
// ============================================================

import * as THREE from 'three';
import type { IGameMode, IGameModeContext } from '../core/IGameMode';
import type { GameSession } from '../core/Session';
import { FtxAsset } from '../vendor/player/FtxAsset';
import type { Asset } from '../vendor/player';
import { CharacterBase } from '../entity/CharacterBase';
import { EntityManager } from '../entity/EntityManager';
import { Player } from '../entity/Player';
import { EnemyBase } from '../entity/EnemyBase';
import { CameraController } from '../services/camera/CameraController';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager } from '../services/combat/BulletManager';
import { executeAttack } from '../services/combat/Attack';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { WorldUIManager } from '../ui/world/WorldUIManager';

// ============================================================
// WorldMode 进入上下文（扩展 IGameModeContext）
// ============================================================

export interface WorldModeEnterContext extends IGameModeContext {
  day: number;
  combatStats: import('../core/Session').PlayerCombatStats;
  protagonistAsset: FtxAsset;
  bulletAsset?: Asset | FtxAsset;
  enemyAsset?: Asset;
  hitEffectAsset?: Asset;
}

// ============================================================
// WorldMode 类
// ============================================================

export class WorldMode implements IGameMode {
  entities!: EntityManager;
  player!: Player;
  enemy: EnemyBase | null = null;

  // ★ 私有物理世界和输入绑定（外界不可见，exit 时完整清理）
  private physics: PhysicsWorld | null = null;
  private binding: DesktopBinding | null = null;

  // 共享资源引用
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private session: GameSession | null = null;
  private onReturn: (() => void) | null = null;

  private cameraCtrl!: CameraController;
  private raster!: RasterMap;

  // ★ 业务逻辑层（共享模块）
  private itemManager!: ItemManager;
  private craftingManager!: CraftingManager;
  private interactionManager!: InteractionManager;

  // ★ UI 层（世界专属）
  private worldUIManager!: WorldUIManager;

  private bullets!: BulletManager;
  private bulletCooldown = 0;
  private chunkMeshes = new Map<number, THREE.Mesh>();
  private chunkBodies = new Map<number, number>();
  private static chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  private aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  private readonly spawnPoint = { x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 };
  private acc = 0;

  // ============================================================
  // IGameMode 接口实现
  // ============================================================

  enter(ctx: WorldModeEnterContext): void {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.session = ctx.session;
    this.onReturn = ctx.onReturn ?? null;

    // ---- ★ 创建私有物理世界 ----
    this.physics = new PhysicsWorld();

    // ---- ★ 创建私有输入绑定 ----
    this.binding = new DesktopBinding(window, document.querySelector('canvas')!);

    // ---- ★ 统一空间层（初始 3×3 chunk，玩家驱动扩张） ----
    this.raster = new RasterMap();
    this.entities = new EntityManager(this.physics, this.raster);

    // 玩家出生 = 中心 chunk 中心
    const spawn = this.spawnPoint;

    // ---- ★ 初始 3×3 chunk 的地面刚体 + 视觉网格 ----
    this.syncChunks(spawn.x, spawn.z);

    // ★ 主角
    this.player = new Player(this.entities, this.scene, ctx.protagonistAsset, {
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

    // ---- ★ 应用战斗属性 ----
    this.player.maxHp = ctx.combatStats.maxHp;
    this.player.hp = ctx.combatStats.hp;
    (this.player as any).attackPower = ctx.combatStats.attackPower;
    (this.player as any).defense = ctx.combatStats.defense;

    // ---- ★ 测试物品 ----
    const itemIcons = [
      createSolidBulletAsset(64, 0.05, 0.85, 0.6),
      createSolidBulletAsset(64, 0.12, 0.9, 0.55),
      createSolidBulletAsset(64, 0.85, 0.8, 0.5),
    ];
    for (let i = 0; i < itemIcons.length; i++) {
      const item = new ItemBase(this.entities, this.scene, itemIcons[i], {
        x: spawn.x + 6 + i * 2.5,
        y: this.raster.surfaceHeightAt(spawn.x + 6 + i * 2.5, spawn.z + 6),
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

    // ---- ★ 死亡动画管线初始化 ----
    CharacterFxManager.init(this.scene, this.renderer);

    // ---- ★ 测试敌人 ----
    const enemyAsset = ctx.enemyAsset;
    if (enemyAsset) {
      this.enemy = new EnemyBase(this.entities, this.scene, enemyAsset, {
        x: spawn.x + 12, y: 0, z: spawn.z + 8,
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
      }, this.camera);
      this.enemy.billboard = false;
    }

    // ---- 相机 ----
    this.cameraCtrl = new CameraController(this.camera);

    // ---- ★ 初始化业务逻辑层（共享模块） ----
    this.itemManager = new ItemManager(ctx.session);
    this.craftingManager = new CraftingManager(ctx.session, this.itemManager);
    this.interactionManager = new InteractionManager({
      session: ctx.session,
      itemManager: this.itemManager,
    });

    // ---- ★ UI 层（世界专属） ----
    this.worldUIManager = new WorldUIManager(
      ctx.session, this.itemManager, this.interactionManager, this.raster,
    );

    // ---- 子弹池 ----
    this.bullets = new BulletManager(
      this.entities, this.scene,
      ctx.bulletAsset ?? createSolidBulletAsset(), 100,
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
    );
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);

    console.log(`[WorldMode] 进入战场，第 ${ctx.day} 天，HP ${ctx.combatStats.maxHp}`);
  }

  /** 每帧驱动（自包含：输入 → 物理 → 相机 → 实体 → AI） */
  update(dt: number): void {
    if (!this.binding || !this.physics || !this.scene || !this.camera || !this.renderer) return;

    this.binding.update();
    const input = this.binding.input;
    const attackPressed = this.binding.consumeAttack();
    const look = this.binding.consumeLook();
    const zoom = this.binding.consumeZoom();

    // ★ 按 E 键返回舰船（held 状态，每帧检查）
    if (input.held.interact) {
      this.onReturn?.();
      return;
    }

    const pp = this.player.controllerPosition;

    // ★ 无限地图扩张
    this.syncChunks(pp.x, pp.y);

    // ★ 小地图更新
    this.worldUIManager.update(dt, {
      px: pp.x, pz: pp.y,
      yaw: this.cameraCtrl.worldYaw,
      entities: this.entities.allBases(),
      hp: this.player.hp, maxHp: this.player.maxHp,
    });

    // AI 上下文
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });

    // ---- AI 驱动 ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- 实体管线驱动 ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- 角色地形跟随 ----
    this.clampCharacter(this.player, dt);
    if (this.enemy) this.clampCharacter(this.enemy, dt);

    // ---- 相机 ----
    this.cameraCtrl.update(dt, look, zoom, {
      x: this.player.position.x, y: 0, z: this.player.position.z,
      height: this.player.position.y,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

    // ---- 玩家发射 ----
    this.bulletCooldown -= dt;
    if (this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = 0.45;
      this.firePlayerBullet();
    }

    // ---- 子弹效果/死亡动画 ----
    this.bullets.update(dt, this.camera);
    CharacterFxManager.update(dt, this.camera);

    // ---- 物理固定步长 ----
    this.acc += dt;
    const FIXED = 1 / 60;
    let steps = 0;
    while (this.acc >= FIXED && steps < 5) {
      this.physics.step();
      this.acc -= FIXED;
      steps++;
    }
    if (steps >= 5) this.acc = 0;
  }

  /** 渲染：实体管线 + 场景 */
  render(): void {
    if (!this.scene || !this.camera || !this.renderer) return;
    this.entities.renderAll(this.camera);
    this.bullets.syncHitEffects(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ---- 回写玩家血量到 Session ----
    if (this.session && this.player) {
      this.session.player.hp = this.player.hp;
      this.session.player.maxHp = this.player.maxHp;
    }

    // ---- 地形碰撞体移出物理世界 ----
    for (const id of this.chunkBodies.values()) {
      this.entities.destroy(id);
    }
    this.chunkBodies.clear();

    // ---- 实体清理 ----
    this.entities.clear();

    // ---- 准星 / UI / 子弹 ----
    this.worldUIManager?.dispose();
    this.bullets?.dispose();
    CharacterFxManager.dispose();

    // ---- chunk 视觉网格 ----
    for (const m of this.chunkMeshes.values()) {
      this.scene?.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.clear();

    // ---- ★ 销毁私有输入绑定 ----
    this.binding?.dispose();
    this.binding = null;

    // ---- ★ 销毁私有物理世界 ----
    this.physics = null;

    // ---- 清空引用 ----
    this.enemy = null;
    this.session = null;
    this.onReturn = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    console.log('[WorldMode] 战场已清理，返回舰船');
  }

  // ============================================================
  // 以下为内部方法，与重构前保持一致
  // ============================================================

  private cameraRay(): { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } {
    this.camera!.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera!.getWorldDirection(rayDir);
    const cam = this.camera!.position;
    return {
      origin: { x: cam.x, y: cam.y, z: cam.z },
      dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };
  }

  private aimRaycast(): { x: number; y: number; z: number } | null {
    const ray = this.cameraRay();
    const hit = aimRaycast(this.entities, {
      origin: ray.origin, dir: ray.dir, maxDist: 200, exclude: this.player,
    });
    return hit ? hit.point : null;
  }

  private firePlayerBullet(): void {
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
    const ray = this.cameraRay();
    let dx = ray.dir.x, dy = ray.dir.y, dz = ray.dir.z;
    try {
      const aim = this.aimRaycast();
      if (aim && isFinite(aim.x) && isFinite(aim.y) && isFinite(aim.z)) {
        const ax = aim.x - muzzle.x, ay = aim.y - muzzle.y, az = aim.z - muzzle.z;
        const alen2 = ax * ax + ay * ay + az * az;
        if (alen2 >= 1) {
          const alen = Math.sqrt(alen2);
          dx = ax / alen; dy = ay / alen; dz = az / alen;
        }
      }
    } catch { /* 忽略 */ }
    executeAttack(this.entities, this.bullets, {
      type: 'projectile', source: this.player,
      x: muzzle.x + dx * 1.5, y: muzzle.y + dy * 1.5, z: muzzle.z + dz * 1.5,
      dirX: dx, dirY: dy, dirZ: dz,
      speed: 20, camp: 'player', lifetime: 2, damage: 10,
    });
  }

  private syncChunks(px: number, pz: number): void {
    const added = this.raster.updateChunks(px, pz);
    for (const { cx, cz } of added) {
      this.buildChunkMesh(cx, cz);
    }
    for (const { cx, cz } of added) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nkey = chunkKeyOf(cx + nx, cz + nz);
        if (this.chunkMeshes.has(nkey)) {
          this.rebuildChunkMesh(cx + nx, cz + nz);
        }
      }
    }
  }

  private buildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.chunkMeshes.has(key)) return;
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const normals = new Float32Array(pos.count * 3);
    const tmpN = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + CHUNK_SIZE / 2;
      const lz = pos.getZ(i) + CHUNK_SIZE / 2;
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      const h = this.raster.vertexHeightAt(wx, wz);
      pos.setY(i, h);
      const [r, g, b] = this.raster.terrainColorAt(wx, wz);
      colors[i * 3] = r / 255;
      colors[i * 3 + 1] = g / 255;
      colors[i * 3 + 2] = b / 255;
      const hL = this.raster.heightAt(wx - 1, wz);
      const hR = this.raster.heightAt(wx + 1, wz);
      const hD = this.raster.heightAt(wx, wz - 1);
      const hU = this.raster.heightAt(wx, wz + 1);
      tmpN.set(hL - hR, 2, hD - hU).normalize();
      normals[i * 3] = tmpN.x;
      normals[i * 3 + 1] = tmpN.y;
      normals[i * 3 + 2] = tmpN.z;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, WorldMode.chunkMat);
    mesh.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
    mesh.receiveShadow = true;
    this.scene!.add(mesh);
    this.chunkMeshes.set(key, mesh);

    if (!this.chunkBodies.has(key)) {
      const verts = pos.array as Float32Array;
      const idx = new Uint32Array(geo.index!.array);
      const body = this.entities.create({
        kind: 'ground', x: mesh.position.x, y: 0, z: mesh.position.z,
        physics: { type: 'fixed', options: { shape: { type: 'trimesh', vertices: verts, indices: idx } } },
      });
      this.chunkBodies.set(key, body.id);
    }
  }

  private rebuildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.scene!.remove(old);
      old.geometry.dispose();
      this.chunkMeshes.delete(key);
    }
    const oldBody = this.chunkBodies.get(key);
    if (oldBody !== undefined) {
      this.entities.destroy(oldBody);
      this.chunkBodies.delete(key);
    }
    this.buildChunkMesh(cx, cz);
  }

  private clampCharacter(e: CharacterBase, dt: number): void {
    const p = e.position;
    const targetY = this.raster.surfaceHeightAt(p.x, p.z);
    if (targetY >= -1.5) {
      const dy = targetY - p.y;
      if (dy > 0) p.y += Math.min(dy, 7.5 * dt);
      else p.y += Math.max(dy, -25 * dt);
      return;
    }
    p.y += Math.max(targetY - p.y, -25 * dt);
    if (p.y <= targetY + 0.05) {
      e.onDeath(null);
      if (e === this.player) {
        p.x = this.spawnPoint.x;
        p.z = this.spawnPoint.z;
        p.y = this.raster.surfaceHeightAt(p.x, p.z);
        this.cameraCtrl.snapTo(p.x, p.y, p.z);
      } else {
        this.enemy = null;
      }
    }
  }
}