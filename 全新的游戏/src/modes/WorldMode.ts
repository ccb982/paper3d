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
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { RasterMap } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { ChunkManager } from '../services/map/ChunkManager';
import type { ChunkGroundHost } from '../services/map/decor/MapEntityDecorBase';
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
  /** ★ 调试开关（main.ts 从 URL 参数解析；素材填充测试用） */
  debug?: { testChunk?: boolean };
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
  private pickupGlows: PickupGlowEffect[] = [];
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
      // ★ 子弹撞地 → 一次性地形扣除（ChunkManager.playBulletImpact）
      (x, y, z) => this.chunks.playBulletImpact(x, y, z),
    );
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);

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

    // ---- AI 驱动 ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- 实体管线驱动 ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- 角色地形跟随 ----
    this.clampCharacter(this.player, dt);
    if (this.enemy) this.clampCharacter(this.enemy, dt);

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
      speed: 20, camp: 'player', lifetime: 2, damage: 10,
    });
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
        this.enemy = null;
      }
    }
  }
}