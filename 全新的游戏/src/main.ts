// ============================================================
// main.ts —— 游戏入口
// 架构：BOOT → SHIP(日常) → WORLD(战斗) → 返回 SHIP → ...
// 核心运行时：Session + SaveSystem + ModeManager + GameLoop
// ============================================================

import * as THREE from 'three';
import { WebAdapter } from './platform/WebAdapter';
import { FtxAsset } from './vendor/player/FtxAsset';
import { Asset } from './vendor/player';
import { WorldMode } from './modes/WorldMode';
import { ShipMode } from './modes/ShipMode';
import { DesktopBinding } from './platform/input/DesktopBinding';
import { PhysicsWorld } from './services/physics/PhysicsWorld';
import { SaveSystem } from './core/SaveSystem';
import { createNewSession, computeCombatStats, type GameSession, type PlayerCombatStats } from './core/Session';
import { RELIC_CONFIG } from './config/relics';
import { ModeManager } from './core/ModeManager';
import type { Mode } from './core/ModeManager';

// ============================================================
// 全局状态
// ============================================================

let currentSession: GameSession | null = null;
let currentWorldMode: WorldMode | null = null;
let worldPhysics: PhysicsWorld | null = null;
let worldBinding: DesktopBinding | null = null;

/** ★ WorldMode 的 Mode 适配器：注册到 ModeManager 时，将 onExit 委托给 dispose */
class WorldModeAdapter implements Mode {
  readonly id = 'world' as const;
  constructor(private wm: WorldMode) {}
  onEnter(): void {}
  onExit(): void { this.wm.dispose(); }
  update(_dt: number): void {}
  render(): void {}
}
let clock: THREE.Clock;
let acc = 0;

// 资产（全局持有，避免重复加载）
let protagonistAsset: FtxAsset;
let bulletAsset: Asset | FtxAsset;
let enemyAsset: Asset;
let hitEffectAsset: Asset | null;

// ============================================================
// 启动引导
// ============================================================

async function boot() {
  // ---- 1. 平台初始化 ----
  const adapter = new WebAdapter();
  const canvas = adapter.createCanvas();
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(adapter.info.dpr);
  renderer.setClearColor(0x1a1a2e, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- 2. 加载资产 ----
  protagonistAsset = await FtxAsset.load(encodeURI('/characters/protagonist/维维美.ftx3.gz'));
  console.log('[boot] 主角已加载:', protagonistAsset.frameNames().join(', '));

  try {
    bulletAsset = await Asset.load(encodeURI('/fx/bullets/维什戴尔子弹.scene.zip'));
  } catch {
    bulletAsset = await FtxAsset.load(encodeURI('/fx/bullets/维什戴尔子弹.ftx3.gz'));
  }
  console.log('[boot] 子弹资产已加载');

  enemyAsset = await Asset.load(encodeURI('/characters/enemies/普瑞赛斯.scene.zip'));
  console.log('[boot] 敌人已加载:', enemyAsset.frameNames().join(', '), '帧');

  try {
    hitEffectAsset = await Asset.load(encodeURI('/fx/bullets/主角子弹击中特效.scene.zip'));
  } catch {
    hitEffectAsset = null;
  }

  // ---- 3. 读取或创建存档 ----
  currentSession = SaveSystem.load();
  if (!currentSession) {
    currentSession = createNewSession();
    SaveSystem.save(currentSession);
    console.log('[boot] 新游戏存档已创建');
  }

  // ★★★★★ 修复：如果标志为 true 但游戏刚启动，说明上次出击未正常返回 ★★★★★
  if (currentSession && currentSession.dayProgress.hasDepartedToday) {
    console.warn('[boot] 检测到未完成的出击（hasDepartedToday=true），自动结算并推进一天');
    currentSession.meta.day += 1;
    currentSession.meta.totalDaysSurvived += 1;
    currentSession.dayProgress.hasDepartedToday = false;
    SaveSystem.save(currentSession);
    console.log(`[boot] 已自动恢复，当前第 ${currentSession.meta.day} 天`);
  }

  // ---- 4. 创建模式管理器 ----
  const modeManager = new ModeManager();

  // ---- 5. 注册 ShipMode ----
  const shipMode = new ShipMode();
  modeManager.register(shipMode);

  // ---- 6. 启动主循环 ----
  clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    const current = modeManager.getCurrent();
    if (!current) {
      renderer.render(scene, camera);
      return;
    }

    // 当前模式更新 + 渲染
    if (current.id === 'ship') {
      // ShipMode：直接更新
      current.update(dt);
      current.render();
    } else if (current.id === 'world' && currentWorldMode) {
      // WorldMode：需要输入/物理驱动
      if (worldBinding) {
        worldBinding.update();
        const input = worldBinding.input;
        const attackPressed = worldBinding.consumeAttack();
        const look = worldBinding.consumeLook();
        const zoom = worldBinding.consumeZoom();

        // 按 E 键返回舰船（held 状态，每帧重新计算）
        if (input.held.interact) {
          returnToShip(modeManager, scene, camera, renderer);
          return;
        }

        currentWorldMode.update(dt, input, attackPressed, look, zoom);

        // 物理固定步长
        acc += dt;
        const FIXED = 1 / 60;
        let steps = 0;
        while (acc >= FIXED && steps < 5) {
          worldPhysics?.step();
          acc -= FIXED;
          steps++;
        }
        if (steps >= 5) acc = 0;

        currentWorldMode.render(renderer);
      }
    } else {
      renderer.render(scene, camera);
    }
  }

  // ---- 7. 进入 ShipMode（默认模式） ----
  enterShipMode(modeManager, scene, camera, renderer);

  animate();
  console.log('[boot] 架构就绪：BOOT → SHIP → WORLD 模式切换');
}

// ============================================================
// 模式切换函数
// ============================================================

/** 进入舰船模式 */
function enterShipMode(
  modeManager: ModeManager,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): void {
  // 清理战斗模式引用（WorldMode.onExit 已通过模式切换自动调用 dispose）
  currentWorldMode = null;
  worldPhysics = null;
  if (worldBinding) {
    worldBinding.dispose();
    worldBinding = null;
  }

  // 保存存档
  if (currentSession) {
    SaveSystem.save(currentSession);
  }

  // 切换到 ShipMode
  modeManager.switchMode('ship', {
    session: currentSession!,
    scene,
    camera,
    renderer,
    onDepart: (day: number, combatStats: PlayerCombatStats) => {
      departToWorld(modeManager, scene, camera, renderer, day, combatStats);
    },
  });
}

/** 出击到世界模式 */
function departToWorld(
  modeManager: ModeManager,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  day: number,
  combatStats: PlayerCombatStats,
): void {
  // 创建物理世界
  worldPhysics = new PhysicsWorld();

  // 创建输入绑定
  worldBinding = new DesktopBinding(window, document.querySelector('canvas')!);

  // 创建 WorldMode
  currentWorldMode = new WorldMode(
    scene, camera, renderer,
    protagonistAsset,
    worldPhysics,
    enemyAsset,
    bulletAsset,
    hitEffectAsset ?? undefined,
  );

  // 注册 WorldMode 适配器到模式管理器，切换到世界模式（会先退出当前模式）
  modeManager.register(new WorldModeAdapter(currentWorldMode));
  modeManager.switchMode('world');

  // 应用战斗属性到玩家实体
  if (currentWorldMode.player) {
    currentWorldMode.player.maxHp = combatStats.maxHp;
    currentWorldMode.player.hp = combatStats.hp;
    (currentWorldMode.player as any).attackPower = combatStats.attackPower;
    (currentWorldMode.player as any).defense = combatStats.defense;
  }

  console.log(`[出击] 第 ${day} 天，战斗属性: HP ${combatStats.maxHp}, 攻击 ${combatStats.attackPower}, 防御 ${combatStats.defense}`);
}

/** 返回舰船 */
function returnToShip(
  modeManager: ModeManager,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): void {
  // 回写玩家血量
  if (currentWorldMode && currentSession) {
    currentSession.player.hp = currentWorldMode.player.hp;
    currentSession.player.maxHp = currentWorldMode.player.maxHp;
  }

  // 推进天数
  if (currentSession) {
    currentSession.meta.day++;
    currentSession.meta.totalDaysSurvived++;
    currentSession.dayProgress.hasDepartedToday = false;
  }

  // 进入舰船（自动保存）
  enterShipMode(modeManager, scene, camera, renderer);
  console.log(`[返回] 已返回舰船，第 ${currentSession?.meta.day} 天`);
}

// ============================================================
// 启动
// ============================================================

boot().catch((err) => {
  console.error('[boot] 启动失败:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;color:#f66;background:#000;padding:8px;z-index:99;font:12px monospace;white-space:pre;max-width:90vw';
  d.textContent = '启动失败: ' + (err as Error).message + '\n' + String(err);
  document.body.appendChild(d);
});