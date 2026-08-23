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
import { gameLights } from '../services/render/GameLights';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import { ItemArchetype } from '../core/ItemArchetype';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager } from '../services/combat/BulletManager';
import { executeAttack } from '../services/combat/Attack';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { WorldUIManager } from '../ui/world/WorldUIManager';
import { PickupGlowEffect } from '../services/fx/PickupGlowEffect';

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
  private chunkEdgeLines = new Map<number, THREE.LineSegments>();
  private chunkBodies = new Map<number, number>();
  private static chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  private aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  private readonly spawnPoint = { x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 };
  private acc = 0;
  private damageUnsub?: () => void;
  private pickupGlows: PickupGlowEffect[] = [];

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

    // ---- ★ 初始化业务逻辑层（共享模块） ----
    this.itemManager = new ItemManager(ctx.session);
    this.craftingManager = new CraftingManager(ctx.session, this.itemManager);
    this.interactionManager = new InteractionManager({
      session: ctx.session,
      itemManager: this.itemManager,
    });

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

    // ---- ★ UI 层（世界专属） ----
    this.worldUIManager = new WorldUIManager(
      ctx.session, this.itemManager, this.interactionManager, this.raster,
    );

    // ---- ★ 测试物品（UI 初始化后创建，避免碰撞回调时 worldUIManager 未就绪） ----
    const testArchetypes = [
      this.itemManager.getArchetype('healing_potion')!,
      this.itemManager.getArchetype('iron_ore')!,
      this.itemManager.getArchetype('originium_shard')!,
    ];
    for (let i = 0; i < testArchetypes.length; i++) {
      const arch = testArchetypes[i];
      const item = new ItemBase(this.entities, this.scene, arch,
        spawn.x + 6 + i * 2.5,
        this.raster.surfaceHeightAt(spawn.x + 6 + i * 2.5, spawn.z + 6),
        spawn.z + 6,
        this.itemManager,
        { physical: true },
      );
      item.onPickup = (it, picker) => {
        const success = this.itemManager.addItem('player', it.archetype.id, 1);
        if (success) {
          console.log(`[拾取] ${picker.constructor.name} 拾取了「${it.archetype.name}」(${it.archetype.id})`);
          // ★ 金色发光粒子
          const pos = it.position;
          this.pickupGlows.push(new PickupGlowEffect(this.scene!, pos.x, pos.y + 0.3, pos.z));
          // ★ HUD 浮动文字 + 格子闪烁
          this.worldUIManager.showPickupResult(it.archetype.id, true);
          this.worldUIManager.refreshIfOpen();
          return true;
        } else {
          this.worldUIManager.showPickupResult(it.archetype.id, false);
          return false;
        }
      };
    }

    // ---- 子弹池 ----
    this.bullets = new BulletManager(
      this.entities, this.scene,
      ctx.bulletAsset ?? createSolidBulletAsset(), 100,
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
    );
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);

    console.log(`[WorldMode] 进入战场，第 ${ctx.day} 天，HP ${ctx.combatStats.maxHp}`);

    // ---- ★ 订阅伤害事件，显示浮动数字 ----
    import('../core/EventBus').then(({ eventBus }) => {
      this.damageUnsub = eventBus.on('damage', (payload) => {
        const target = payload.target;
        const pos = target.position;
        // 将世界坐标投影到屏幕
        const vec = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
        vec.project(this.camera!);
        const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;
        // 只显示实际造成的伤害（大于0），并且没有被闪避/格挡免疫
        if (payload.damage > 0) {
          const type = payload.crit ? 'crit' : 'normal';
          this.worldUIManager.showFloatingText(x, y - 30, String(payload.damage), type);
        } else if (payload.dodged) {
          this.worldUIManager.showFloatingText(x, y - 30, 'Miss', 'miss');
        } else if (payload.blocked) {
          this.worldUIManager.showFloatingText(x, y - 30, 'Blocked', 'normal');
        }
      });
    });
  }

  /** 每帧驱动（自包含：输入 → 物理 → 相机 → 实体 → AI） */
  update(dt: number): void {
    if (!this.binding || !this.physics || !this.scene || !this.camera || !this.renderer) return;

    this.binding.update();
    const input = this.binding.input;
    const attackPressed = this.binding.consumeAttack();
    const look = this.binding.consumeLook();
    const zoom = this.binding.consumeZoom();

    // ★ 按 I 键打开/关闭背包
    if (this.binding.consumeInventory()) {
      this.worldUIManager.toggleInventory();
    }

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
      playerPosition: { x: pp.x, z: pp.y },
      cameraYaw: this.cameraCtrl.worldYaw,
      entities: this.entities.allBases(),
      playerStats: { hp: this.player.hp, maxHp: this.player.maxHp },
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

    // ---- 拾取发光粒子 ----
    for (let i = this.pickupGlows.length - 1; i >= 0; i--) {
      if (this.pickupGlows[i].update(dt)) {
        this.pickupGlows.splice(i, 1);
      }
    }

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
    // ★ 阴影相机锚定玩家（update 后、渲染前，位置已是本帧最终值）
    if (this.player) gameLights.follow(this.player.position);
    this.entities.renderAll(this.camera);
    this.bullets.syncHitEffects(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ---- 取消伤害事件订阅 ----
    this.damageUnsub?.();
    this.damageUnsub = undefined;

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

    // ---- 拾取发光粒子 ----
    for (const g of this.pickupGlows) g.dispose();
    this.pickupGlows = [];

    // ---- chunk 视觉网格 ----
    for (const m of this.chunkMeshes.values()) {
      this.scene?.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.clear();
    // ★ 清理棱边
    for (const el of this.chunkEdgeLines.values()) {
      this.scene?.remove(el);
      el.geometry.dispose();
      (el.material as THREE.Material).dispose();
    }
    this.chunkEdgeLines.clear();

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
      // ★ 顶点假 AO（烘焙式）：采样环形高度，凹处压暗。
      //   风格化地形真实感第一来源——墙角/坑沿/台阶根部的接触暗部全靠它。
      //   零运行时成本：烘焙进顶点色，随 chunk 重建自动更新。
      let occ = 0;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const dh = this.raster.heightAt(wx + Math.cos(ang) * 2.5, wz + Math.sin(ang) * 2.5) - h;
        if (dh > 0) occ += Math.min(dh, 2.5);
      }
      const ao = Math.max(0.55, 1 - (occ / 8) * 0.09);
      colors[i * 3] = (r / 255) * ao;
      colors[i * 3 + 1] = (g / 255) * ao;
      colors[i * 3 + 2] = (b / 255) * ao;
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

    // ---- ★ 发光棱边（高度突变处加亮线） ----
    this.buildChunkEdgeLines(cx, cz, key);
  }

  /** 生成发光棱边：在高度突变的网格棱边处绘制亮线 */
  private buildChunkEdgeLines(cx: number, cz: number, key: number): void {
    const lines: THREE.Vector3[] = [];
    const threshold = 0.08; // 高度差阈值
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const h = this.raster.heightAt(wx, wz);
        // 检查右侧（X+1）和下方（Z+1）的邻居
        if (x < CHUNK_SIZE - 1) {
          const hr = this.raster.heightAt(wx + 1, wz);
          if (Math.abs(h - hr) > threshold) {
            lines.push(new THREE.Vector3(wx + 0.5, Math.max(h, hr), wz + 0.5));
            lines.push(new THREE.Vector3(wx + 0.5, Math.min(h, hr), wz + 0.5));
          }
        }
        if (z < CHUNK_SIZE - 1) {
          const hd = this.raster.heightAt(wx, wz + 1);
          if (Math.abs(h - hd) > threshold) {
            lines.push(new THREE.Vector3(wx + 0.5, Math.max(h, hd), wz + 0.5));
            lines.push(new THREE.Vector3(wx + 0.5, Math.min(h, hd), wz + 0.5));
          }
        }
      }
    }
    if (lines.length === 0) return;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(lines.length * 3);
    for (let i = 0; i < lines.length; i++) {
      positions[i * 3] = lines[i].x;
      positions[i * 3 + 1] = lines[i].y;
      positions[i * 3 + 2] = lines[i].z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x66aaff,
      transparent: true,
      opacity: 0.25,
    });
    const edgeMesh = new THREE.LineSegments(geo, mat);
    this.scene!.add(edgeMesh);
    this.chunkEdgeLines.set(key, edgeMesh);
  }

  private rebuildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.scene!.remove(old);
      old.geometry.dispose();
      this.chunkMeshes.delete(key);
    }
    // ★ 清理旧棱边
    const oldEdge = this.chunkEdgeLines.get(key);
    if (oldEdge) {
      this.scene!.remove(oldEdge);
      oldEdge.geometry.dispose();
      (oldEdge.material as THREE.Material).dispose();
      this.chunkEdgeLines.delete(key);
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