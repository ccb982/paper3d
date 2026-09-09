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
import { DroneEntity } from '../entity/DroneEntity';
import { CameraController } from '../services/camera/CameraController';
import { renderManager } from '../services/render/RenderManager';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { ChunkManager, type ImpactReport } from '../services/map/ChunkManager';
import type { ChunkGroundHost } from '../services/map/decor/MapEntityDecorBase';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { ROCK_BUG_AI, REUNION_AI, LAOJIE_AI } from '../systems/ai/aiconfig';
import type { AIConfig } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import { ItemArchetype } from '../core/ItemArchetype';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager, type BulletHitPayload } from '../services/combat/BulletManager';
import { applyDamage } from '../services/combat/DamagePipeline';
import { eventBus } from '../core/EventBus';
import { sharedWaterMaterial } from '../services/map/WaterMaterial';
import { CombatDirector } from '../services/combat/CombatDirector';
import { executeAttack } from '../services/combat/Attack';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { WorldUIManager } from '../ui/world/WorldUIManager';
import { PickupGlowEffect } from '../services/fx/PickupGlowEffect';
import { rollDrops } from '../services/item/ItemDropPipeline';

// ============================================================
// WorldMode 进入上下文（扩展 IGameModeContext）
// ============================================================

export interface WorldModeEnterContext extends IGameModeContext {
  day: number;
  combatStats: import('../core/Session').PlayerCombatStats;
  protagonistAsset: FtxAsset;
  bulletAsset?: Asset | FtxAsset;
  /** ★ 三个杂兵素材（纯纹理包；地图大量随机生成用） */
  enemyAssets?: FtxAsset[];
  hitEffectAsset?: Asset;
  /** ★ 可露希尔的无人机素材（特效包优先，回退纯纹理包） */
  droneAsset?: Asset | FtxAsset;
  /** ★ 调试开关（main.ts 从 URL 参数解析；素材填充测试用） */
  debug?: { testChunk?: boolean };
}

/** ★ 杂兵配置条目（素材 + AI + 属性 + 体型 + 集群；生成时随机取一条） */
interface MobDef {
  asset: FtxAsset;
  ai: AIConfig;
  hp: number;
  /** 防御（减法减伤） */
  defense: number;
  /** 攻击力加成（叠加在 AI 近战伤害上） */
  attackPower: number;
  scale: number;
  collisionScale: number;
  /** 集群规模（一次落点生成几只；原石虫成群用） */
  pack: number;
  /** 随机抽取权重（原石虫权重大 → 成队出现） */
  weight: number;
  /** ★ 击杀掉落规则（每项独立掷概率） */
  drops: { itemId: string; chance: number; min: number; max: number }[];
}

// ============================================================
// WorldMode 类
// ============================================================

export class WorldMode implements IGameMode {
  entities!: EntityManager;
  player!: Player;
  /** ★ 地图上所有杂兵（按 chunk 波次生成，逐个独立 AI） */
  enemies: EnemyBase[] = [];

  /** ★ 杂兵配置条目（由 enemyAssets 派生：素材+AI+HP+体型；生成时随机取一条） */
  private mobDefs: MobDef[] = [];
  /** ★ 已生成过的 chunk key（每 chunk 一波，不重复生成） */
  private spawnedChunks = new Set<number>();
  /** ★ 敌人实例 → 其 MobDef（击杀掉落结算用；WeakMap 不阻回收） */
  private enemyDefs = new WeakMap<EnemyBase, MobDef>();
  /** ★ 出生 chunk key（玩家安全区：自己不刷怪；敌人从他处生成） */
  private spawnChunkKey = -1;
  /** ★ 波次节奏（秒）：距下次"LOD 外环"刷怪的倒计时 */
  private respawnTimer = 0;
  /** ★ 全图杂兵上限（弱化档：总量克制，死亡后周期波次慢慢补） */
  private static readonly MAX_ENEMIES = 60;
  /** ★ 敌人远距回收半径（米）：玩家离开后该区敌人销毁，名额让给新 frontier */
  private static readonly ENEMY_CULL_RADIUS = 200;
  /** 远距回收节拍（每 1s 扫一次，避免每帧 O(n)） */
  private cullAccum = 0;

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
  /** ★ 地图流式管理器（chunk 扩张队列/异步烘焙/看门狗/风格切换，services/map） */
  private chunks!: ChunkManager;

  // ★ 业务逻辑层（共享模块）
  private itemManager!: ItemManager;
  private craftingManager!: CraftingManager;
  private interactionManager!: InteractionManager;

  // ★ UI 层（世界专属）
  private worldUIManager!: WorldUIManager;

  private bullets!: BulletManager;
  private bulletCooldown = 0;
  // （chunk 流式构建已下沉 services/map/ChunkManager；材质为每 chunk 独立 Canvas 外观）
  private aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  // ★ 调试：出生点临时改到侧壁缺口报告位（seed 12345, chunk(0,1)）
  private readonly spawnPoint = { x: 50.6, z: 101.6 };
  private acc = 0;
  private damageUnsub?: () => void;
  /** ★ killed 事件订阅：杂兵死亡 → 从 enemies 列表移除 */
  private killedUnsub?: () => void;
  private pickupGlows: PickupGlowEffect[] = [];
  /** ★ 可露希尔的无人机召唤物（无刚体悬浮体；使用道具触发，退出时销毁） */
  private drone: DroneEntity | null = null;
  /** ★ 无人机素材（特效包/纯纹理包；enter 存入上下文引用） */
  private droneAsset: Asset | FtxAsset | null = null;
  /** ★ 无人机召唤事件订阅（enter 注册 / exit 移除） */
  private droneSummonUnsub?: () => void;
  /** ★ 角色入水检测（每角色上一帧：是否水面 + 高度/位置 + 上次溅波时刻） */
  private waterPrev = new Map<
    CharacterBase,
    { liquid: boolean; y: number; rippleMs: number }
  >();
  /** ★ 测试地图（单 chunk 陈列馆；ctx.debug.testChunk） */
  private testChunk = false;
  /** ★ 调试：F9 颜色回读监听器（exit 时移除） */
  private _f9Handler: ((e: KeyboardEvent) => void) | null = null;
  /** ★ 调试：置位后本帧 render() 末尾立即回读（默认帧缓冲 swap 后读返回 0） */
  private _pendingReadback = false;

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

    // ---- ★ 地图流式管理器（地面刚体经 ChunkGroundHost 适配进实体系统） ----
    const groundHost: ChunkGroundHost = {
      createGround: (cx, cz, vertices, indices) => this.entities.create({
        kind: 'ground',
        x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
        physics: {
          type: 'fixed',
          options: { shape: { type: 'trimesh', vertices, indices } },
        },
      }).id,
      destroyGround: (id) => this.entities.destroy(id),
      // ★ 分区地面：首 cell 随实体创建（tileSlot 登记），其余分区挂同刚体（全同步）
      createGroundCells: (cx, cz, cells) => {
        if (cells.length === 0) return null;
        const first = cells[0];
        const e = this.entities.create({
          kind: 'ground',
          x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
          physics: {
            type: 'fixed',
            options: {
              shape: { type: 'trimesh', vertices: first.vertices, indices: first.indices },
              tileSlot: first.slot,
            },
          },
        });
        const rb = e.rigidBody;
        if (rb) {
          for (let i = 1; i < cells.length; i++) {
            this.physics?.setTileCollider(rb.handle, cells[i].slot, cells[i].vertices, cells[i].indices);
          }
        }
        return e.id;
      },
      updateGroundCell: (id, slot, vertices, indices) => {
        const rb = this.entities.get(id)?.rigidBody;
        if (rb) this.physics?.setTileCollider(rb.handle, slot, vertices, indices);
      },
      // ★ 装饰物碰撞体：fixed cuboid（挡住玩家/子弹；y 为体积中心）
      createPropBody: (x, y, z, r, h) => this.entities.create({
        kind: 'decoration',
        x, y, z,
        physics: {
          type: 'fixed',
          options: { shape: { type: 'cuboid', hx: r, hy: h / 2, hz: r } },
        },
      }).id,
    };
    this.chunks = new ChunkManager(this.scene, this.raster, groundHost, {
      testChunk: ctx.debug?.testChunk ?? false,
    });
    this.testChunk = ctx.debug?.testChunk ?? false;

    // ★ 昼夜循环重置：每次出击从晚上出发（后续可按 Session.day 变化出发时刻）
    renderManager.resetDay();

    // 玩家出生 = 中心 chunk 中心
    const spawn = this.spawnPoint;

    // ---- ★ 初始 chunk 数据环 + 出生区 3×3 强制构建（不等队列调度） ----
    this.chunks.bootstrap(spawn.x, spawn.z);

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
      moveSpeed: 5.0,
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

    // ---- ★ 杂兵配置条目（三种特色：原石虫=慢/脆/成群；整合=高防高血；
    //       牢杰/杰斯顿=高速高攻脆皮）----
    const MOB_BLUEPRINTS: Omit<MobDef, 'asset'>[] = [
      {
        ai: ROCK_BUG_AI, hp: 22, defense: 0, attackPower: 0,
        scale: 1.6, collisionScale: 1.1, pack: 4, weight: 1, // ★ 成群（慢速炮灰；2026-09-09 权重 3→1：单次仍一次生 4 只）
        drops: [{ itemId: 'polyester', chance: 0.35, min: 1, max: 1 }],
      },
      {
        ai: REUNION_AI, hp: 75, defense: 3, attackPower: 2,
        scale: 2, collisionScale: 1.25, pack: 1, weight: 1, // ★ 中高防中血（2026-09-09 削：130/6 → 75/3；权重 2→1 平衡牢杰）
        drops: [
          { itemId: 'polyester', chance: 0.3, min: 1, max: 1 },
          { itemId: 'device', chance: 0.8, min: 1, max: 2 },
        ],
      },
      {
        ai: LAOJIE_AI, hp: 45, defense: 0, attackPower: 12,
        scale: 2, collisionScale: 1.25, pack: 1, weight: 2, // ★ 高速高攻脆皮（2026-09-09 权重 1→2：提高出现率）
        drops: [{ itemId: 'device', chance: 0.95, min: 1, max: 3 }],
      },
    ];
    this.mobDefs = (ctx.enemyAssets ?? []).map((asset, i) => ({
      asset,
      ...(MOB_BLUEPRINTS[i % MOB_BLUEPRINTS.length] ?? MOB_BLUEPRINTS[1]),
    }));
    // ★ 出生 chunk 不刷怪（自己的 chunk 留给玩家出生/回城安全区）
    this.spawnChunkKey = chunkKeyOf(
      Math.floor(spawn.x / CHUNK_SIZE),
      Math.floor(spawn.z / CHUNK_SIZE),
    );
    // ★ 首波节奏：1.5s 后先来第一波（出生圈附近的安全巡逻）
    this.respawnTimer = 1.5;
    if (this.mobDefs.length > 0) {
      console.log(`[WorldMode] 杂兵配置 ${this.mobDefs.length} 类，chunk 激活式波次生成`);
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
    // ★ boss4D 玩家专属：真实落地模式（每次跳跃必须踩实地面，禁止悬空穿/悬浮连跳）
    this.player.controller.requireRealLanding = this.chunks.isBoss4D;
    this.worldUIManager.addMapStyleButton(
      () => (this.chunks.isBoss4D ? '地图：四维空间' : '地图：标准'),
      () => {
        this.chunks.setStyle(!this.chunks.isBoss4D);
        // 仅玩家生效（敌人维持旧连跳行为）
        this.player.controller.requireRealLanding = this.chunks.isBoss4D;
      },
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
      // ★ 命中解析层入口：每次碰撞开始，所有命中（敌人 / 装饰物 / 地块）都进这里分类结算
      (payload) => this.resolveBulletHit(payload),
    );
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);

    // ---- ★ 无人机素材（特效包优先；道具召唤用） ----
    this.droneAsset = ctx.droneAsset ?? null;
    // ★ 玩家出生位置自动放一个无人机跟随（道具召唤保留，可再放）
    if (this.droneAsset) this.spawnDroneNearPlayer();

    console.log(`[WorldMode] 进入战场，第 ${ctx.day} 天，HP ${ctx.combatStats.maxHp}`);

    // ---- ★ 调试：F9 回读最终绘制颜色（游标指向像素 + 中心网格；诊断警示贴画偏色用） ----
    const onF9 = (e: KeyboardEvent) => {
      if (e.key !== 'F9' || !this.renderer || !this.renderer.domElement) return;
      // ★ 不在 keydown 里直接 readPixels——three 默认缓冲已 swap，会读到全 0；
      //   置位后由本帧 render() 末尾在 render 紧后同步读。
      this._pendingReadback = true;
    };
    window.addEventListener('keydown', onF9);
    this._f9Handler = onF9;

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
      // ★ 杂兵死亡 → 结算击杀掉落 + 从 enemies 列表移除（含坠坑外的伤害致死）
      this.killedUnsub = eventBus.on('killed', (payload) => {
        const enemy = payload.target as EnemyBase;
        this.rollEnemyDrops(enemy);
        const idx = this.enemies.indexOf(enemy);
        if (idx !== -1) this.enemies.splice(idx, 1);
      });
      // ★ 无人机召唤：使用「可露希尔的无人机」道具 → 近玩家位置放出
      this.droneSummonUnsub = eventBus.on('drone_summon', () => {
        this.spawnDroneNearPlayer();
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
    // ★ 指针锁定唯一事实来源 = 是否有非战斗 UI 打开：
    //   任一面板打开 → 解锁；全部关闭（回到战场）→ 恢复锁定。
    //   setPointerLock 内含冷却重试，且只在状态变化时真正请求/释放。
    this.binding.setPointerLock(!this.worldUIManager.hasModalOpen);

    // ★ 按 E 键返回舰船（held 状态，每帧检查）
    if (input.held.interact) {
      this.onReturn?.();
      return;
    }

    const pp = this.player.controllerPosition;

    // ★ 无限地图扩张 + 看门狗自愈（chunk 流式管线在 ChunkManager 内）
    this.chunks.update(pp.x, pp.y, dt);

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
    this.aiCtx.focusX = pp.x;
    this.aiCtx.focusZ = pp.y;

    // ---- AI 驱动 ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- ★ 敌人波次节奏：定时在玩家 LOD 外环周围补一波 ----
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      // 下一波随机 15~30s（弱化档：补怪更稀疏）
      this.respawnTimer = 15 + Math.random() * 15;
      this.spawnAmbientWave(pp.x, pp.y);
    }
    // ---- ★ 扫描式波次：周围 ±2 已加载但未刷过的 chunk 逐帧补怪（预算减半） ----
    this.scanAndSpawnWaves(pp.x, pp.y, 4);
    // ---- ★ 远距敌人回收（1s 一拍；玩家走过的旧区清场） ----
    this.cullAccum += dt;
    if (this.cullAccum >= 1) {
      this.cullAccum = 0;
      this.cullFarEnemies(pp.x, pp.y);
    }

    // --------------------------------------------------
    // ★ 无人机召唤 AI：喂跟随目标（玩家侧上方，沿相机 right 偏移防挡视野）与
    //   玩家位置 → updateAI（跟随→锁定最近敌人→贴脸攻击→目标死/离太远返回重锁）
    //   先于实体管线，保证本帧 syncRender 使用新位置。
    if (this.drone) {
      const dp = this.player.position;
      const frame = this.cameraCtrl.getFrame();
      const sideOff = 1.1;
      this.drone.followTarget.x = dp.x + frame.right.x * sideOff;
      this.drone.followTarget.z = dp.z + frame.right.z * sideOff;
      this.drone.followTarget.y = dp.y + 2.2;
      this.drone.playerPos.x = dp.x;
      this.drone.playerPos.y = dp.y;
      this.drone.playerPos.z = dp.z;
      this.drone.updateAI(dt, this.camera);
    }

    // ---- 实体管线驱动 ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- ★ 角色入水 → 水面剧烈波动（只加波动表现，不动角色位置/手感） ----
    this.updateWaterEntry(this.player, dt);
    for (const e of this.enemies) this.updateWaterEntry(e, dt);

    // ---- 角色地形跟随 ----
    this.clampCharacter(this.player, dt);
    for (const e of this.enemies) this.clampCharacter(e, dt);

    // ---- ★ 测试地图：玩家钳在出生 chunk 内（世界只有这一块，无邻可走） ----
    if (this.testChunk) {
      const wp = this.player.position;
      wp.x = Math.min(CHUNK_SIZE - 1, Math.max(1, wp.x));
      wp.z = Math.min(CHUNK_SIZE - 1, Math.max(1, wp.z));
    }

    // ---- 相机 ----
    // ★ position.y 现在空中含真实跳高 → height = 贴地/起跳站立面（减回跳高），
    //   jump = 跳高偏移，二者语义与 CameraController 契约一致（不重复记账）。
    const jumpOff = this.player.jumpHeight;
    this.cameraCtrl.update(dt, look, zoom, {
      x: this.player.position.x, y: 0, z: this.player.position.z,
      height: this.player.position.y - jumpOff,
      jump: jumpOff,
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

    // ★ 调试：F9 置位后本帧末同步回读（渲染刚完成、缓冲未 swap，读数有效）
    if (this._pendingReadback) {
      this._pendingReadback = false;
      this.finalColorReadback();
    }
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ---- 取消伤害事件订阅 ----
    this.damageUnsub?.();
    this.damageUnsub = undefined;
    // ---- 取消 killed 事件订阅 ----
    this.killedUnsub?.();
    this.killedUnsub = undefined;
    // ---- 取消无人机召唤事件订阅 + 销毁无人机 ----
    this.droneSummonUnsub?.();
    this.droneSummonUnsub = undefined;
    this.drone?.dispose();
    this.drone = null;
    this.droneAsset = null;
    // ---- 战斗导演退场（取消事件订阅） ----
    this.director?.dispose();

    // ---- 回写玩家血量到 Session ----
    if (this.session && this.player) {
      this.session.player.hp = this.player.hp;
      this.session.player.maxHp = this.player.maxHp;
    }

    // ---- 地图流式管理器（chunk 刚体移出物理世界 + 视觉销毁 + 烘焙缓存释放） ----
    this.chunks?.dispose();

    // ---- 实体清理 ----
    this.entities.clear();

    // ---- 准星 / UI / 子弹 ----
    this.worldUIManager?.dispose();
    this.bullets?.dispose();
    CharacterFxManager.dispose();

    // ---- 拾取发光粒子 ----
    for (const g of this.pickupGlows) g.dispose();
    this.pickupGlows = [];

    // ---- ★ 角色入水检测状态 ----
    this.waterPrev.clear();

    // ---- ★ 销毁私有输入绑定 ----
    this.binding?.dispose();
    this.binding = null;

    // ---- ★ 移除 F9 调试回读监听 ----
    if (this._f9Handler) {
      window.removeEventListener('keydown', this._f9Handler);
      this._f9Handler = null;
    }

    // ---- ★ 销毁私有物理世界 ----
    this.physics = null;

    // ---- 清空引用 ----
    this.enemies = [];
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

  /**
   * ★ 调试：F9 回读最终绘制颜色（诊断沙土警示贴画偏色）。
   * 采样屏幕中心 5×5 网格 + 游标世界坐标射到屏幕的像素，
   * 打印 RGBA 与对应游标世界坐标（可配合 tileDefAt 对照)。
   */
  private finalColorReadback(): void {
    const r = this.renderer!;
    const gl = r.getContext();
    const canvas = r.domElement;
    const cw = canvas.width;
    const ch = canvas.height;
    const lines: string[] = ['[WorldMode] 最终颜色回读:'];

    // ★ 光照状态（判读亮度/是否夜间——夜间读数近黑无法判色相）
    const sun = renderManager.querySun();
    lines.push(`  光照 hour=${sun.hour.toFixed(1)} daylight=${sun.daylight.toFixed(3)} intensityScale=${sun.intensityScale.toFixed(3)} color=#${sun.color.toString(16).padStart(6,'0')}`);

    // 游标位置（射线方向投影到屏幕中心附近）
    const ray = this.cameraRay();
    let sx = Math.round(cw / 2), sy = Math.round(ch / 2);
    const aim = this.aimRaycast();
    if (aim && this.camera) {
      const v = new THREE.Vector3(aim.x, aim.y, aim.z).project(this.camera);
      sx = Math.round((v.x * 0.5 + 0.5) * cw);
      sy = Math.round((-v.y * 0.5 + 0.5) * ch);
    }

    // 游标指向的地块信息（判定位块/材质，对照 RGBA 定位偏色源）
    let tileInfo = '?';
    if (aim && this.raster) {
      const td = this.raster.tileDefAt(aim.x, aim.z);
      tileInfo = `id=${td.id} key=${td.key} mat=${td.visual.material?.fnId ?? 'none'} baseHsl=${td.visual.baseHsl.h.toFixed(3)},${td.visual.baseHsl.s.toFixed(3)},${td.visual.baseHsl.l.toFixed(3)}`;
    }

    // 游标 1×1 精确像素
    const one = new Uint8Array(4);
    gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
    lines.push(`  aim@(${aim ? aim.x.toFixed(1) + ',' + aim.z.toFixed(1) : '?'}) ${tileInfo}`);
    lines.push(`  aim 像素(${sx},${sy}): rgba(${one[0]},${one[1]},${one[2]},${one[3]})`);

    // 中心 5×5 网格
    const N = 2;
    const grid = new Uint8Array((2 * N + 1) * (2 * N + 1) * 4);
    gl.readPixels(cw / 2 - N, ch / 2 - N, 2 * N + 1, 2 * N + 1, gl.RGBA, gl.UNSIGNED_BYTE, grid);
    lines.push('  中心 5×5 (行从底部起):');
    for (let row = 2 * N; row >= 0; row--) {
      const cols: string[] = [];
      for (let c = 0; c <= 2 * N; c++) {
        const i = (row * (2 * N + 1) + c) * 4;
        cols.push(`${grid[i]},${grid[i + 1]},${grid[i + 2]}`);
      }
      lines.push(`    [${cols.join(' | ')}]`);
    }
    console.log(lines.join('\n'));
  }

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
      speed: 25, camp: 'player', lifetime: 2, damage: 10,
    });
  }

  /**
   * ★ 扫描式波次生成：沿玩家所在 chunk 周围 ±2 已加载地块扫描，
   *   每个尚未生成过的 chunk 生成一波敌人（新加载的地块也会自然被扫到）。
   *   ★ 出生 chunk（玩家所在 chunk 锚点）不刷怪 → spawnChunkKey 排除。
   *   ★ 每帧只放 budget 个（防单帧卡顿），未放满的 chunk 不标记完成 → 后续帧续铺。
   */
  private scanAndSpawnWaves(px: number, pz: number, budget: number): void {
    if (this.testChunk || this.mobDefs.length === 0) return;
    if (this.chunks.isBoss4D) return; // 四维空间（最终 Boss 战地图）不刷杂兵
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    let placedTotal = 0;
    // ★ 从内环到外环扫（保证离玩家近的 chunk 优先铺满）
    for (let ring = 1; ring <= 2 && placedTotal < budget; ring++) {
      for (let dz = -ring; dz <= ring && placedTotal < budget; dz++) {
        for (let dx = -ring; dx <= ring && placedTotal < budget; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue; // 只在环上
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKeyOf(cx, cz);
          if (key === this.spawnChunkKey) continue;  // 出生 chunk 不刷
          if (this.spawnedChunks.has(key)) continue; // 已完成波次的 chunk 跳过
          // ★ chunk 地形已就绪（有数据环）才可落点
          if (!this.raster.getChunkData(cx, cz)) continue;
          // ★ 每 chunk 一波 2~4 个（比全铺档减半：有怪但不会过密）
          const want = 2 + Math.floor(Math.random() * 3);
          let placed = 0;
          let attempts = 0;
          for (; attempts < want * 10 && placed < want && placedTotal < budget; attempts++) {
            if (this.spawnAtRandomPointInChunk(cx, cz)) placed++;
          }
          placedTotal += placed;
          // ★ 放满 / 尝试耗尽（地形基本没位置）才算完成；预算截断 → 下帧继续
          if (placed >= want || attempts >= want * 10) {
            this.spawnedChunks.add(key);
          }
          if (placed > 0) {
            console.log(`[WorldMode] chunk(${cx},${cz}) 补波 → ${placed} 个`);
          }
        }
      }
    }
  }

  /** ★ 随机在 chunk 内找一个可站立点并生成一个杂兵（不可站立点返回 false） */
  private spawnAtRandomPointInChunk(cx: number, cz: number): boolean {
    if (this.mobDefs.length === 0 || !this.scene || !this.camera) return false;
    // ★ 敌人上限（防无限世界累积过多实体）
    if (this.enemies.length >= WorldMode.MAX_ENEMIES) return false;
    const x = cx * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    const z = cz * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    // ★ 玩家近旁不刷（防贴脸 pop-in；出生 chunk 自身已整体排除，
    //   邻 chunk 允许到 12m——初始密度够又不出现在脚边）
    const p = this.player?.position;
    if (p) {
      const ddx = x - p.x, ddz = z - p.z;
      if (ddx * ddx + ddz * ddz < 12 * 12) return false;
    }
    // ★ 坑/水/虚空/未生成：不站（isDepression 包含坑洞与水）
    const role = this.raster.tileDefAt(x, z).genRole;
    if (role === 'pit' || role === 'liquid') return false;
    const y = this.raster.surfaceHeightAt(x, z);
    // ★ 落点过低（挖坑后的深坑区）不生成
    if (y < -1.2) return false;
    return this.spawnOne(this.pickMob(), x, y, z);
  }

  /** ★ 定时波次：在玩家 LOD 外环（60m+，chunk 数据环内）周围随机生成一波 */
  private spawnAmbientWave(px: number, pz: number): void {
    if (this.testChunk || this.mobDefs.length === 0) return;
    if (this.chunks.isBoss4D) return; // 四维空间不补杂兵
    const want = 1 + (Math.random() < 0.5 ? 1 : 0); // 每波 1~2 个（弱化档）
    let placed = 0;
    // 环带：内圈 > LOD3（60m），外圈 < 数据预载环（~2 chunk）
    for (let i = 0; i < want * 10 && placed < want; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 64 + Math.random() * 40; // 64~104m
      const x = px + Math.cos(ang) * dist;
      const z = pz + Math.sin(ang) * dist;
      // 目标 chunk 必须已有地形数据（未生成的世界区域不刷）
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      if (chunkKeyOf(cx, cz) === this.spawnChunkKey) continue;
      if (!this.raster.getChunkData(cx, cz)) continue;
      const role = this.raster.tileDefAt(x, z).genRole;
      if (role === 'pit' || role === 'liquid') continue;
      const y = this.raster.surfaceHeightAt(x, z);
      if (y < -1.2) continue;
      if (this.spawnOne(this.pickMob(), x, y, z)) placed++;
    }
    if (placed > 0) {
      console.log(`[WorldMode] LOD 外环波次 → ${placed} 个杂兵（共 ${this.enemies.length}）`);
    }
  }

  /** ★ 随机取一条杂兵配置（按 weight 加权：原石虫权重大 → 成群出现） */
  private pickMob(): MobDef {
    let total = 0;
    for (const d of this.mobDefs) total += d.weight;
    let r = Math.random() * total;
    for (const d of this.mobDefs) {
      r -= d.weight;
      if (r <= 0) return d;
    }
    return this.mobDefs[this.mobDefs.length - 1];
  }

  /** ★ 远距回收：距玩家超 ENEMY_CULL_RADIUS 的敌人销毁并移除
   *   （无限世界防累积；靠近后再由 chunk 激活/周期波次补上） */
  private cullFarEnemies(px: number, pz: number): void {
    const r2 = WorldMode.ENEMY_CULL_RADIUS ** 2;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      if (dx * dx + dz * dz > r2) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  /** ★ 生成一"窝"杂兵：以落点为中心放 def.pack 只（原石虫 = 一整窝），
   *   同伴围绕中心 ±1.6m 散布（同一 asset/属性）。返回是否至少放了 1 只。 */
  private spawnOne(
    def: MobDef,
    x: number, y: number, z: number,
  ): boolean {
    if (!this.scene || !this.camera) return false;
    let any = false;
    for (let k = 0; k < def.pack; k++) {
      // ★ 同伴散布（k=0 中心；其余绕圈小偏移）
      let sx = x, sz = z;
      if (k > 0) {
        const ang = (k / def.pack) * Math.PI * 2 + Math.random() * 0.8;
        const dist = 1.2 + Math.random() * 1.6;
        sx = x + Math.cos(ang) * dist;
        sz = z + Math.sin(ang) * dist;
      }
      // ★ 上限检查（每只都查）
      if (this.enemies.length >= WorldMode.MAX_ENEMIES) break;
      // ★ 同伴落点也要可站（坑/水/过低跳过该同伴）
      const role = this.raster.tileDefAt(sx, sz).genRole;
      if (role === 'pit' || role === 'liquid') continue;
      const sy = this.raster.surfaceHeightAt(sx, sz);
      if (sy < -1.2) continue;
      const enemy = new EnemyBase(this.entities, this.scene, def.asset, {
        x: sx, y: sy, z: sz,
        animMap: {
          states: {
            idle: { 前: ['前'], 后: ['后'] },
            walk: { 前: ['前'], 后: ['后'] },
            attack: { 前: ['前'], 后: ['后'] },
          },
          fps: { idle: 1, walk: 1, attack: 1 },
        },
        facing: Math.random() < 0.5 ? '前' : '后',
        aggressive: true,
        aiConfig: def.ai,
        hp: def.hp,
        defense: def.defense,
        attackPower: def.attackPower,
        scale: def.scale,
        collisionScale: def.collisionScale,
      }, this.camera);
      enemy.billboard = false;
      this.enemyDefs.set(enemy, def);
      this.enemies.push(enemy);
      any = true;
    }
    return any;
  }

  /**
   * ★ 角色入水检测：走进水面 / 从高处落入水面 → 该处水面剧烈波动；
   *   在水中持续移动 → 脚下周期性泛波。只触发波动表现，不改角色位置。
   */
  private updateWaterEntry(e: CharacterBase, dt: number): void {
    const p = e.position;
    const liquid = this.raster.tileDefAt(p.x, p.z).genRole === 'liquid';
    const prev = this.waterPrev.get(e);
    this.waterPrev.set(e, {
      liquid, y: p.y, rippleMs: prev ? prev.rippleMs : 0,
    });
    if (!prev) return;
    // 走进水面（方块由非水 → 水，且脚底在水面以下 0.5m 内才算真正入水）
    if (liquid && !prev.liquid && p.y < 0.5) {
      this.waterPrev.get(e)!.rippleMs = performance.now();
      sharedWaterMaterial.addImpact(p.x, p.z, 0.8);
      return;
    }
    // 高处坠落 / 跳入：本帧穿过 y=0 水面 → 波幅随坠落速度增大
    if (liquid && prev.y > 0.08 && p.y <= 0.08) {
      this.waterPrev.get(e)!.rippleMs = performance.now();
      const vy = Math.max(0, (prev.y - p.y) / Math.max(dt, 1e-3));
      sharedWaterMaterial.addImpact(p.x, p.z, Math.min(1.6, 0.7 + vy * 0.15));
      return;
    }
    // ★ 在水中移动 → 脚下周期性泛波（速度越快越密/越强）
    if (liquid && e.controller.moveSpeed > 0.3) {
      const st = this.waterPrev.get(e)!;
      const now = performance.now();
      const gap = 340 - e.controller.moveSpeed * 28; // 慢走 0.3s 一泛，快跑 ~0.2s
      if (now - st.rippleMs >= gap) {
        st.rippleMs = now;
        sharedWaterMaterial.addImpact(p.x, p.z, Math.min(0.55, 0.28 + e.controller.moveSpeed * 0.06));
      }
    }
  }

  /**
   * ★ 炮弹/子弹落点 0.6m 半径内若存在水面 → 注入水面剧烈波动。
   */
  /**
   * ★★ 命中解析层（唯一入口）：一次子弹碰撞 → 全分类结算。
   *   敌人实体 → 伤害管线 + 'damage' 事件（combat 归口）；
   *   静态世界（地块 / 装饰物）→ resolveImpact 一次权威判定 →
   *     地形扣除（消费地块属性）/ 水面波动 / 物品掉落（消费报告三键）。
   */
  private resolveBulletHit({ self, other, point, damage }: BulletHitPayload): void {
    if (other) {
      const r = applyDamage(damage, self, other);
      eventBus.emit('damage', { target: other, damage: r.final, crit: r.crit, dodged: r.dodged, blocked: r.blocked });
      console.log(`[bullet] 命中 ${other.constructor.name}，穿透${r.crit ? '【暴击】' : ''}（-${r.final}）`);
      return;
    }
    const impact = this.chunks.resolveImpact(point.x, point.y, point.z);
    this.chunks.playBulletImpact(impact); // 地形修改：消费解析结果（含地块资格门）
    this.agitateWaterNear(point.x, point.z); // 水面波动
    this.spawnItemDrops(impact); // 掉落：ground/water/crystal 全来自报告
  }

  private agitateWaterNear(x: number, z: number): void {
    const hit = this.waterPointWithin(x, z, 0.6);
    if (!hit) return;
    sharedWaterMaterial.addImpact(hit.x, hit.z, 1.4);
  }

  /** 命中点及半径 r 的十字采样内找水面；返回最近水面点，无则 null */
  private waterPointWithin(
    x: number, z: number, r: number,
  ): { x: number; z: number } | null {
    if (this.raster.tileDefAt(x, z).genRole === 'liquid') return { x, z };
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (this.raster.tileDefAt(sx, sz).genRole === 'liquid') {
        return { x: sx, z: sz };
      }
    }
    return null;
  }

  /**
   * ★ 物品掉落管线：命中报告（ImpactReport）→ 掷掉落 → 背包落账 + UI 提示。
   *   地面(固原岩) / 水面或贴水地块(酮凝集) / 耗尽原石晶体~2.2m(异铁)；
   *   有空间直接入袋&提示，背包满则提示失败。
   */
  /** ★ 击杀掉落：按敌人 MobDef.drops 逐项掷概率 → 直接入袋 + UI 提示 */
  private rollEnemyDrops(enemy: EnemyBase): void {
    const def = this.enemyDefs.get(enemy);
    if (!def || !this.itemManager || !this.worldUIManager) return;
    for (const d of def.drops) {
      if (Math.random() >= d.chance) continue;
      const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      const ok = this.itemManager.hasSpace('player', d.itemId, count)
        && this.itemManager.addItem('player', d.itemId, count);
      this.worldUIManager.showPickupResult(d.itemId, ok, count);
      if (ok) this.worldUIManager.flashItemAndRefresh(d.itemId);
    }
  }

  private spawnItemDrops(r: ImpactReport): void {
    const drops = rollDrops({
      hasGround: r.tile.role === 'ground' || r.tile.role === 'platform',
      hasWater: r.water !== 'none',
      hasCrystal: r.prop?.key === 'depleted_crystal',
    });
    for (const drop of drops) {
      const ok = this.itemManager.hasSpace('player', drop.itemId, drop.count)
        && this.itemManager.addItem('player', drop.itemId, drop.count);
      this.worldUIManager.showPickupResult(drop.itemId, ok, drop.count);
      if (ok) this.worldUIManager.flashItemAndRefresh(drop.itemId);
    }
  }

  private spawnDroneNearPlayer(): void {
    if (!this.scene || !this.player || !this.droneAsset) return;
    this.drone?.dispose();
    const p = this.player.position;
    const asset = this.droneAsset;
    const drone = new DroneEntity(this.entities, this.scene, asset, {
      x: p.x, y: p.y + 2.0, z: p.z,
      scale: 1.2,
    });
    this.drone = drone;
    // ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享 WebGL 上下文（同 MoonEffect）
    if (this.renderer) drone.setRenderer(this.renderer);
  }

  private clampCharacter(e: CharacterBase, dt: number): void {
    // ★ 空中态不钉地形：真实跳跃（空格）让 y 由 CharacterBase 的抛物线结算，
    //   落地瞬间再回落贴地；否则会把跳起来的角色钉回地面、无法跃过 0.5 高差。
    if (e.controller.isAirborne()) return;
    const p = e.position;
    const targetY = this.raster.surfaceHeightAt(p.x, p.z);
    // ★ 脚下地块复核（2026-09-05 用户实测：补丁把普通地块挖到 <−1.5 也被当深坑判死）：
    //   死亡只属于"坑洞地块的足够深位置"——地面低于 −1.5 只是触发条件之一，还须
    //   所在 4m 地块是坑洞（tileDefAt.isDepression）。普通地块被挖深的补丁坑：
    //   正常贴地站立（不沉落、不判死）；天然坑洞：维持沉落死亡。
    const onPitTile = this.raster.tileDefAt(p.x, p.z).isDepression;
    if (targetY >= -1.5 || !onPitTile) {
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
        // 杂兵坠坑死亡：从列表移除
        const idx = this.enemies.indexOf(e as EnemyBase);
        if (idx !== -1) this.enemies.splice(idx, 1);
      }
    }
  }
}