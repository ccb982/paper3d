// ============================================================
// main.ts —— 游戏入口（路由器模式）
// 职责：初始化共享资源 + 响应模式切换事件
// 不做的：物理步进、输入处理、实体管理、资源清理
// ============================================================
// 架构：BOOT → SHIP(日常) → WORLD(战斗) → 返回 SHIP → ...
// 核心原则：main.ts 只做"路由器"，不做"管家"
// 每个 Mode 拥有自己的私有领地，enter/exit 自管理
// ============================================================

import * as THREE from 'three';
import { WebAdapter } from './platform/WebAdapter';
import { FtxAsset } from './vendor/player/FtxAsset';
import { Asset } from './vendor/player';
import type { IGameMode } from './core/IGameMode';
import { ShipMode } from './modes/ShipMode';
import { WorldMode } from './modes/WorldMode';
import type { WorldModeEnterContext } from './modes/WorldMode';
import { SaveSystem } from './core/SaveSystem';
import { createNewSession, type GameSession, type PlayerCombatStats } from './core/Session';

// ============================================================
// 全局状态（最小化：只保留 shared 资源和当前模式引用）
// ============================================================

let currentMode: IGameMode | null = null;
let currentSession: GameSession | null = null;

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
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '0';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(adapter.info.dpr);
  renderer.setClearColor(0xcccccc, 1);

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

  // ★★★★★ 修复：如果标志为 true 但游戏刚启动，说明上次出击未正常执行 ★★★★★
  if (currentSession && currentSession.dayProgress.hasDepartedToday) {
    console.warn('[boot] 检测到未完成的出击（hasDepartedToday=true），战斗未正常执行，维持当天存档');
    currentSession.dayProgress.hasDepartedToday = false;
    SaveSystem.save(currentSession);
    console.log(`[boot] 已重置出击标志，当前仍为第 ${currentSession.meta.day} 天`);
  }

  // ---- 4. 启动主循环 ----
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (currentMode) {
      currentMode.update(dt);
      currentMode.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  // ---- 5. 进入 ShipMode（默认模式） ----
  enterShipMode(scene, camera, renderer);

  animate();
  console.log('[boot] 架构就绪：main.ts 作为路由器，委托模式管理');
}

// ============================================================
// 模式切换函数（main.ts 的唯一额外职责）
// ============================================================

/** 进入舰船模式 */
function enterShipMode(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): void {
  // 1. 如果有旧模式，彻底清理
  currentMode?.exit();
  currentMode = null;

  // 2. 保存存档
  if (currentSession) {
    SaveSystem.save(currentSession);
  }

  // 3. 创建新 ShipMode
  const ship = new ShipMode();
  ship.enter({
    scene, camera, renderer,
    session: currentSession!,
    onDepart: (day: number, combatStats: PlayerCombatStats) => {
      enterWorldMode(scene, camera, renderer, day, combatStats);
    },
  });
  currentMode = ship;
  console.log(`[main] 进入 ShipMode，当前第 ${currentSession?.meta.day} 天`);
}

/** 出击到世界模式 */
function enterWorldMode(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  day: number,
  combatStats: PlayerCombatStats,
): void {
  // 1. 清理旧模式
  currentMode?.exit();
  currentMode = null;

  // 2. 创建 WorldMode（完全自包含：PhysicsWorld/DesktopBinding 内部创建）
  const world = new WorldMode();
  const ctx: WorldModeEnterContext = {
    scene, camera, renderer,
    session: currentSession!,
    day,
    combatStats,
    protagonistAsset,
    bulletAsset,
    enemyAsset,
    hitEffectAsset: hitEffectAsset ?? undefined,
    onReturn: () => {
      // 返回时：推进天数 + 进入 ShipMode
      if (currentSession) {
        currentSession.meta.day++;
        currentSession.meta.totalDaysSurvived++;
        currentSession.dayProgress.hasDepartedToday = false;
      }
      enterShipMode(scene, camera, renderer);
    },
  };
  world.enter(ctx);
  currentMode = world;

  console.log(`[main] 进入 WorldMode，第 ${day} 天，战斗属性: HP ${combatStats.maxHp}`);
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