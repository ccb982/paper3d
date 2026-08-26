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
import { renderManager } from '../services/render/RenderManager';
import {
  bakeChunkMaps, assembleChunkMaps,
  getCachedChunkMaps, cacheChunkMaps, releaseBakeCache,
  type ChunkMaps,
} from '../services/map/ChunkAppearance';
import { terrainBaker, type BakeResult } from '../services/map/TerrainBaker';
import { TerrainMaterial } from '../services/map/TerrainMaterial';
import { buildChunkSideWalls } from '../services/map/ChunkWalls';
import { buildBoss4DChunk } from '../services/map/Boss4DArena';
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
import { CombatDirector } from '../services/combat/CombatDirector';
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
  /** ★ 战斗导演（战斗手感编排：hitstop/镜头冲击；事件驱动，纯表现层） */
  private director!: CombatDirector;
  private raster!: RasterMap;

  // ★ 业务逻辑层（共享模块）
  private itemManager!: ItemManager;
  private craftingManager!: CraftingManager;
  private interactionManager!: InteractionManager;

  // ★ UI 层（世界专属）
  private worldUIManager!: WorldUIManager;

  private bullets!: BulletManager;
  private bulletCooldown = 0;
  private chunkMeshes = new Map<number, THREE.Object3D>();
  /** ★ 地图风格：false=标准外观 / true=四维空间（最终 Boss 战地图，Boss4DArena） */
  private boss4D = false;
  private chunkBodies = new Map<number, number>();
  // （chunk 材质已改为每 chunk 独立的 Canvas 外观材质，见 buildChunkMesh）
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

    // ★ 昼夜循环重置：每次出击从清晨出发（后续可按 Session.day 变化出发时刻）
    renderManager.resetDay();

    // 玩家出生 = 中心 chunk 中心
    const spawn = this.spawnPoint;

    // ---- ★ 初始 3×3 chunk 的地面刚体 + 视觉网格 ----
    this.syncChunks(spawn.x, spawn.z);
    // ★ 出生区 3×3 强制构建（不等队列调度）。
    //   2026-08-26 异步烘焙管线后标准风格不再阻塞主线程——角色 Y 由
    //   clampCharacter 按 raster 高度场驱动，不依赖地面刚体先存在；
    //   地面视觉/刚体在头几帧内由烘焙结果补齐。
    const scx = Math.floor(spawn.x / CHUNK_SIZE);
    const scz = Math.floor(spawn.z / CHUNK_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (this.boss4D) this.buildChunkMesh(scx + dx, scz + dz);
        else this.requestStandardBake(scx + dx, scz + dz);
      }
    }

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

    // ---- ★ 战斗导演（监听 damage/killed 事件编排打击反馈） ----
    this.director = new CombatDirector(this.cameraCtrl);

    // ---- ★ UI 层（世界专属） ----
    this.worldUIManager = new WorldUIManager(
      ctx.session, this.itemManager, this.interactionManager, this.raster,
    );
    // ★ 地图风格切换按钮（标准外观 ↔ 四维空间[最终 Boss 战地图]）
    this.worldUIManager.addMapStyleButton(
      () => (this.boss4D ? '地图：四维空间' : '地图：标准'),
      () => this.setMapStyle(!this.boss4D),
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
    // ★ 看门狗：自愈一切"数据在、网格丢"的状态（Worker 被杀/消息丢失/
    //   装配异常等任何原因造成的空洞，0.5s 内补请求）
    this.sweepChunks(pp.x, pp.y, dt);

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
    // ★ 光照锚定玩家（update 后、渲染前，位置已是本帧最终值）
    if (this.player) renderManager.follow(this.player.position);
    this.entities.renderAll(this.camera);
    this.bullets.syncHitEffects(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ---- 取消伤害事件订阅 ----
    this.damageUnsub?.();
    this.damageUnsub = undefined;
    // ---- 战斗导演退场（取消事件订阅） ----
    this.director?.dispose();

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
    this.chunkQueue.length = 0;   // ★ 清空构建队列    this.queuedKeys.clear();
    // ★ 在途烘焙全部作废（Worker 结果到达后因换代+scene 空被丢弃）
    this.bakeGen++;
    this.pendingBakes.clear();
    for (const v of this.chunkMeshes.values()) {
      this.scene?.remove(v);
      this.disposeChunkVisual(v);
    }
    this.chunkMeshes.clear();
    releaseBakeCache(); // ★ 缓存纹理统一销毁（唯一缓存侧 dispose 点）

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

  /** ★ chunk 构建预算队列：跨区爆发不再同帧全部构建（每帧限时，消卡顿）
   *  Worker 迁移备注：generateChunk 数据与外观像素计算均为纯数据函数，
   *  后续可移入 wx.createWorker/Worker；THREE 网格与 rapier 碰撞体必须留在主线程 */
  private chunkQueue: { cx: number; cz: number; rebuild: boolean }[] = [];
  private queuedKeys = new Set<number>();
  /** 每帧构建时间预算（毫秒）；单帧最多消耗这么多，剩余下帧继续 */
  private static readonly CHUNK_BUILD_BUDGET_MS = 8;

  // ---- ★ 异步烘焙管线（2026-08-26）：重计算在 Worker，主线程零尖峰 ----
  /** 在途烘焙（key→请求；t=发起时刻供看门狗超时判定） */
  private pendingBakes = new Map<number, { cx: number; cz: number; gen: number; t: number }>();
  /** 烘焙换代计数：dispose / 切地图风格时自增，使在途结果全部作废 */
  private bakeGen = 0;
  /** 看门狗节拍累加器 */
  private watchdogAccum = 0;

  /**
   * ★ 看门狗（每 0.5s 一拍）：
   *   ① 在途烘焙超时（>8s = Worker 被杀/消息丢失）→ 释放占位；
   *   ② 加载环内"有数据、无网格、不在途、不在队"的 chunk → 补请求。
   * 二者合流：任何原因造成的空洞都会在下一拍自动重建成完整 chunk。
   */
  private sweepChunks(px: number, pz: number, dt: number): void {
    this.watchdogAccum += dt;
    if (this.watchdogAccum < 0.5) return;
    this.watchdogAccum = 0;

    const now = performance.now();
    for (const [key, p] of [...this.pendingBakes]) {
      if (now - p.t > 8000) {
        console.warn(`[WorldMode] chunk(${p.cx},${p.cz}) 烘焙超时，释放占位待重试`);
        this.pendingBakes.delete(key);
      }
    }

    if (this.boss4D) return; // boss4D 同步构建，不存在异步空洞
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKeyOf(cx, cz);
        if (this.chunkMeshes.has(key)) continue;
        if (this.pendingBakes.has(key)) continue;
        if (this.queuedKeys.has(key)) continue;
        if (!this.raster.getChunkData(cx, cz)) continue; // 数据未生成=本来就没排
        this.requestStandardBake(cx, cz);
      }
    }
  }

  private syncChunks(px: number, pz: number): void {    const added = this.raster.updateChunks(px, pz);
    for (const { cx, cz } of added) {
      this.enqueueChunk(cx, cz, false);
    }
    // 相邻接缝重建也入队（排在新建之后），避免同帧叠加烘焙开销
    for (const { cx, cz } of added) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nkey = chunkKeyOf(cx + nx, cz + nz);
        if (this.chunkMeshes.has(nkey)) {
          this.enqueueChunk(cx + nx, cz + nz, true);
        }
      }
    }
    this.processChunkQueue();
  }

  private enqueueChunk(cx: number, cz: number, rebuild: boolean): void {
    const key = chunkKeyOf(cx, cz);
    if (this.queuedKeys.has(key)) return;
    if (!rebuild && this.chunkMeshes.has(key)) return; // 已建（如出生区强制构建）
    this.queuedKeys.add(key);
    this.chunkQueue.push({ cx, cz, rebuild });
  }

  /**
   * 每帧按时间预算消化构建队列。
   * ★ Boss4D 同步构建；标准风格走异步烘焙（本循环只做快照提取+投递，
   *   重计算在 Worker——单帧不再有"首项必建"的烘焙尖峰）。
   */
  private processChunkQueue(): void {
    if (this.chunkQueue.length === 0) return;
    const t0 = performance.now();
    do {
      const item = this.chunkQueue.shift()!;
      const key = chunkKeyOf(item.cx, item.cz);
      this.queuedKeys.delete(key);
      if (this.boss4D) {
        if (item.rebuild) {
          // 可能已不在视野/已被销毁：有 mesh 才重建
          if (this.chunkMeshes.has(key)) this.buildChunkMesh(item.cx, item.cz);
        } else {
          this.buildChunkMesh(item.cx, item.cz);
        }
      } else {
        // 标准风格：重建与新建同走异步烘焙（结果到达后 replaceChunk 换装）
        if (!item.rebuild || this.chunkMeshes.has(key)) {
          this.requestStandardBake(item.cx, item.cz);
        }
      }
    } while (
      this.chunkQueue.length > 0 &&
      performance.now() - t0 < WorldMode.CHUNK_BUILD_BUDGET_MS
    );
  }

  /**
   * ★ 标准风格构建①：缓存查询 → 快照投给 Worker（无 Worker 时同步回退直建）。
   * 同 key 已在途则跳过；缓存命中则跳过烘焙直接装配。
   */
  private requestStandardBake(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.pendingBakes.has(key)) return;
    const seed = this.raster.worldSeed;

    // ★ 烘焙缓存命中：接缝重建 / 风格切换往返零重烘（纹理复用）
    const cached = getCachedChunkMaps(seed, cx, cz);
    if (cached) {
      if (this.scene) this.finishStandardChunk(cx, cz, cached);
      return;
    }

    const gen = this.bakeGen;
    // ★ 快照前补齐覆盖区数据环（确定性纯生成，亚毫秒）：
    //   烘焙输出与加载顺序无关，射线永不见"未加载=0"的假邻域
    //   ——接缝重建从此只需重建几何，不再需要重烘焙
    const p = terrainBaker.request(
      (gcx, gcz) => {
        this.raster.ensureData(gcx, gcz);
        return this.raster.getChunkData(gcx, gcz);
      },
      seed, cx, cz,
    );
    if (!p) {
      // Worker 不可用（如微信端未适配）：主线程同步烘 + 入缓存 + 立即建
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
      const maps = bakeChunkMaps(this.raster, cx, cz);
      cacheChunkMaps(seed, cx, cz, maps);
      this.finishStandardChunk(cx, cz, maps);
      return;
    }
    this.pendingBakes.set(key, { cx, cz, gen, t: performance.now() });
    p.then((bufs) => {
      if (this.pendingBakes.get(key)?.gen !== gen) return; // 换代（切风格/dispose）已作废
      this.pendingBakes.delete(key);
      if (!this.scene) return;
      this.completeStandardBake(cx, cz, seed, bufs);
    });
  }

  /**
   * ★ 烘焙完成落地（组装+入缓存+建网格）。
   * 任何一步异常都回退主线程同步烘焙——绝不让 chunk 因单次失败而
   * 永久消失（"整片区域踩虚空"bug 的根因即此处的无兜底 rejection）。
   */
  private completeStandardBake(cx: number, cz: number, seed: number, bufs: BakeResult | null): void {
    try {
      const maps = bufs ? assembleChunkMaps(bufs.albedo, bufs.light) : null;
      if (maps) {
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps);
        return;
      }
      throw new Error('空结果');
    } catch (e) {
      console.error(`[WorldMode] chunk(${cx},${cz}) 异步装配失败，回退主线程同步烘焙`, e);
      try {
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
        const maps = bakeChunkMaps(this.raster, cx, cz);
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps);
      } catch (e2) {
        // 不入缓存：看门狗 sweep 会在下个周期重新走完整请求
        console.error(`[WorldMode] chunk(${cx},${cz}) 同步回退也失败，交由看门狗重试`, e2);
      }
    }
  }

  /** ★ 标准风格构建②：像素就绪 → 几何/材质/物理（原 buildStandardChunk 后半） */
  private finishStandardChunk(cx: number, cz: number, maps: ChunkMaps): void {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // ★ 外观 UV：与 ChunkAppearance 像素映射约定配套（文件头有推导），flipY=false
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + CHUNK_SIZE / 2;
      const lz = pos.getZ(i) + CHUNK_SIZE / 2;
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      pos.setY(i, this.raster.vertexHeightAt(wx, wz));
      uvs[i * 2] = lx / CHUNK_SIZE;
      uvs[i * 2 + 1] = lz / CHUNK_SIZE;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mat = new TerrainMaterial(maps.albedo, maps.lightmap);
    // lightmap 挂 userData 供 disposeChunkVisual 一并释放（.map 只登记 albedo）；
    // cached = 纹理归烘焙缓存所有，chunk 销毁时跳过纹理释放（releaseBakeCache 统一管）
    (mat as unknown as { userData: { lightMap?: THREE.Texture; cached?: boolean } }).userData =
      { lightMap: maps.lightmap, cached: true };

    const top = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(top);
    // ★ 断崖侧壁：独立几何 + 顶点色（避免地面贴图被拉伸成墙面的纵向渐变）
    const walls = buildChunkSideWalls(this.raster, cx, cz);
    if (walls) group.add(walls);
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);

    this.replaceChunk(
      chunkKeyOf(cx, cz), group, cx, cz,
      pos.array as Float32Array,
      new Uint32Array(geo.index!.array),
    );
  }

  /** Boss4D 风格 chunk 同步构建（标准风格走 requestStandardBake 异步管线） */
  private buildChunkMesh(cx: number, cz: number): void {
    const b = buildBoss4DChunk(this.raster, cx, cz);
    this.replaceChunk(chunkKeyOf(cx, cz), b.group, cx, cz, b.trimeshVertices, b.trimeshIndices);
  }

  /** ★ 地图风格切换（右上角按钮调用）：重建全部已加载 chunk 的物理+视觉 */
  setMapStyle(boss4D: boolean): void {
    if (this.boss4D === boss4D) return;
    this.boss4D = boss4D;
    // ★ 作废在途标准烘焙；未建成的 key 重新按当前风格构建
    this.bakeGen++;
    for (const p of this.pendingBakes.values()) this.enqueueChunk(p.cx, p.cz, false);
    this.pendingBakes.clear();
    for (const key of [...this.chunkMeshes.keys()]) {
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      if (boss4D) this.buildChunkMesh(cx, cz);          // boss4D 同步重建
      else this.requestStandardBake(cx, cz);            // 标准异步重建
    }
  }

  get isBoss4D(): boolean {
    return this.boss4D;
  }

  /** 拆旧视觉+旧物理 → 装新视觉 → 建配套新物理体（风格切换/流式构建共用） */
  private replaceChunk(
    key: number,
    visual: THREE.Object3D,
    cx: number,
    cz: number,
    trimeshVertices: Float32Array,
    trimeshIndices: Uint32Array,
  ): void {
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.scene?.remove(old);
      this.disposeChunkVisual(old);
    }
    const oldBody = this.chunkBodies.get(key);
    if (oldBody !== undefined) {
      this.entities.destroy(oldBody);
      this.chunkBodies.delete(key);
    }
    this.scene!.add(visual);
    this.chunkMeshes.set(key, visual);
    const body = this.entities.create({
      kind: 'ground',
      x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
      physics: {
        type: 'fixed',
        options: { shape: { type: 'trimesh', vertices: trimeshVertices, indices: trimeshIndices } },
      },
    });
    this.chunkBodies.set(key, body.id);
  }

  /** 释放 chunk 视觉资源（兼容 Mesh 与 Group 两种形态） */
  private disposeChunkVisual(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      m.geometry.dispose();
      const mm = m.material as THREE.MeshStandardMaterial | undefined;
      if (!mm) return;
      // ★ 双纹理方案：lightmap 挂在材质 userData 上；cached = 纹理归烘焙
      //   缓存所有（接缝重建/风格切换要复用），跳过纹理释放，材质照常销毁
      const extra = (mm as unknown as { userData?: { lightMap?: THREE.Texture; cached?: boolean } }).userData;
      if (!extra?.cached) {
        mm.map?.dispose();
        extra?.lightMap?.dispose();
      }
      mm.dispose();
    });
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