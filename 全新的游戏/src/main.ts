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
import { ensureRapierReady } from './services/physics/PhysicsWorld';
import { FtxAsset } from './vendor/player/FtxAsset';
import { Asset } from './vendor/player';
import type { IGameMode } from './core/IGameMode';
import { ShipMode } from './modes/ShipMode';
import { WorldMode } from './modes/WorldMode';
import type { WorldModeEnterContext } from './modes/WorldMode';
import { SaveSystem } from './core/SaveSystem';
import { setTestGroup } from './services/map/TileGroups';
import { showTestGroupPanel } from './services/map/debug/TestGroupPanel';
import { createNewSession, type GameSession, type PlayerCombatStats } from './core/Session';
import { renderManager, LIGHT_TUNING } from './services/render/RenderManager';

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
/** ★ 测试地图开关（boot 从 URL 参数解析；enterWorldMode 消费） */
let testChunk = false;

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
  // ★ 实时光照包：电影级色调滚降（所有颜色统一进 ACES 管线）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT_TUNING.exposure;

  const scene = new THREE.Scene();
  // ★ 雾：远处融进背景色，遮 chunk 加载边缘 + 大气氛围（舰船内部距离小，不受影响）
  scene.fog = new THREE.Fog(0xcccccc, 80, 200);
  // ★ 光照词汇表：半球光(天/地双色) + 太阳平行光（实体影子走 SilhouetteShadow 解析剪影，不用 shadow map）
  // （实时阴影管线已移除：全项目无 castShadow 者，shadow map 是纯空转开销——2026-08-26 清理）
  renderManager.setup(scene);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- 2. 物理引擎初始化（一次性；必须在进入战斗前完成，
  //      否则 rapier 的 wasm 绑定未就绪 → rawintegrationparameters_new undefined）----
  await ensureRapierReady();

  // ---- 2.5 测试地图（可选；素材填充调试用）----
  //   URL 参数：?group=crystal        → 单组世界 + 单 chunk 陈列馆 + 地块名标注
  //             ?single=1             → 仅单 chunk 陈列馆（组正常随机）
  //   控制台：  setTestGroup('ashen') / setTestGroup(null) 运行时换组
  //   （运行中换组只影响之后新生成的 chunk；刷新页面完整生效）
  const urlParams = new URLSearchParams(location.search);
  const testGroup = urlParams.get('group');
  if (testGroup) setTestGroup(testGroup); // 未知 key 在 setTestGroup 内抛错（fail-fast）
  testChunk = testGroup !== null || urlParams.get('single') === '1';
  if (testChunk) showTestGroupPanel(testGroup ?? undefined); // 组内容面板（缺省=实际 chunk 生效组）
  // 控制台换组时联动刷新面板
  (window as unknown as { setTestGroup: (k: string | null) => void }).setTestGroup = (k) => {
    setTestGroup(k);
    if (testChunk) showTestGroupPanel(k ?? undefined);
  };

  // ---- 3. 加载资产 ----
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

    // ★ 实时渲染域先推进（昼夜时间 + hitstop 时间缩放）→ 世界用缩放时间驱动
    renderManager.update(dt);

    if (currentMode) {
      currentMode.update(renderManager.scaledDt);
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
    debug: { testChunk },
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