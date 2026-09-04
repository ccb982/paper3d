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
import { Asset, MoonEffect } from './vendor/player';
import type { IGameMode } from './core/IGameMode';
import { ShipMode } from './modes/ShipMode';
import { WorldMode } from './modes/WorldMode';
import type { WorldModeEnterContext } from './modes/WorldMode';
import { SaveSystem } from './core/SaveSystem';
import { RasterMap } from './services/map/RasterMap';
import { setTestGroup } from './services/map/TileGroups';
import { showTestGroupPanel } from './services/map/debug/TestGroupPanel';
import { createNewSession, type GameSession, type PlayerCombatStats } from './core/Session';
import { renderManager, LIGHT_TUNING } from './services/render/RenderManager';

/** 剪贴板兜底（非安全上下文/旧浏览器）：textarea 选中 + execCommand */
function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

// ============================================================
// 全局状态（最小化：只保留 shared 资源和当前模式引用）
// ============================================================

let currentMode: IGameMode | null = null;
let currentSession: GameSession | null = null;

/** 当前模式环境：ship=舰船内部（固定深空背景），world=露天战场（背景随天空变化） */
let currentEnv: 'ship' | 'world' = 'ship';

// 渲染资源（全局持有，供逐帧刷新背景/雾色）
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;

/** 舰船内部固定背景色（深空舱内；不随昼夜变化） */
const SHIP_BG = 0x14142a;

/**
 * ★ 每帧刷新背景清屏色 + 雾色（按当前模式区分）：
 *   - world：露天战场，背景用天空边界（地平线）色随昼夜渐变，雾色与之同色，
 *            远处地形融进地平线 → 与穹顶底部无缝衔接
 *   - ship：舰船内部，用固定深空背景，不受天空影响
 */
function updateSky(): void {
  if (currentEnv === 'world') {
    // 天空边界 = horizon（穹顶底部就是这个颜色，背景+雾同色保证无缝）
    const horizon = renderManager.querySky().horizon;
    renderer.setClearColor(horizon, 1);
    if (scene.fog && (scene.fog as THREE.Fog).color) {
      (scene.fog as THREE.Fog).color.setHex(horizon);
    }
  } else {
    renderer.setClearColor(SHIP_BG, 1);
    if (scene.fog && (scene.fog as THREE.Fog).color) {
      (scene.fog as THREE.Fog).color.setHex(SHIP_BG);
    }
  }
}

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

  const rendererLocal = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer = rendererLocal;
  rendererLocal.setSize(window.innerWidth, window.innerHeight);
  rendererLocal.setPixelRatio(adapter.info.dpr);
  rendererLocal.setClearColor(0xcccccc, 1);
  // ★ 实时光照包：电影级色调滚降（所有颜色统一进 ACES 管线）
  rendererLocal.toneMapping = THREE.ACESFilmicToneMapping;
  rendererLocal.toneMappingExposure = LIGHT_TUNING.exposure;

  const sceneLocal = new THREE.Scene();
  scene = sceneLocal;
  // ★ 雾：远处融进背景色，遮 chunk 加载边缘 + 大气氛围（舰船内部距离小，不受影响）
  sceneLocal.fog = new THREE.Fog(0xcccccc, 80, 200);
  // ★ 光照词汇表：半球光(天/地双色) + 太阳平行光（实体影子走 SilhouetteShadow 解析剪影，不用 shadow map）
  // （实时阴影管线已移除：全项目无 castShadow 者，shadow map 是纯空转开销——2026-08-26 清理）
  renderManager.setup(sceneLocal, rendererLocal);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  window.addEventListener('resize', () => {
    rendererLocal.setSize(window.innerWidth, window.innerHeight);
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

  // ---- ★ 月亮贴图：加载大猫哥月亮素材包（特效播放器解码），替换天空程序化月相 ----
  try {
    const moonAsset = await Asset.load(encodeURI('/characters/大猫哥的月亮.scene.zip'));
    const pair = moonAsset.getFramePair(0);
    const ftx = moonAsset.getFtxFrame(0);
    if (pair && ftx && moonAsset.frameCount > 0) {
      // 检查素材包是否有 regionEntities（VAT 数据），有就用 MoonEffect 走完整播放器管线
      const f0 = moonAsset.frames[0];
      if (f0 && f0.regionEntities && f0.regionEntities.length > 0) {
        // ★ 用特效播放器完整管线 → 支持 VAT 顶点动画/扭曲等特效
        const moonEffect = new MoonEffect(moonAsset);
        renderManager.setMoonEffect(moonEffect);
        console.log(`[boot] 月亮已启用特效播放器: ${ftx.width}×${ftx.height}, ${f0.regionEntities.length} region(s), VAT enabled`);
      } else {
        // 只有静态纹理 → 用旧模式直接采样
        renderManager.setMoonTexture(pair.base, pair.residual);
        console.log(`[boot] 月亮已加载静态纹理: ${ftx.width}×${ftx.height}, bbox=(${ftx.bbox.x},${ftx.bbox.y},${ftx.bbox.w}x${ftx.bbox.h})`);
      }
    } else {
      renderManager.setMoonEffect(null);
      console.warn('[boot] 大猫哥月亮素材包缺帧数据，回退程序化月相');
    }
  } catch (e) {
    renderManager.setMoonEffect(null);
    console.warn('[boot] 大猫哥月亮素材包加载失败，回退程序化月相:', e);
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

  // ★ 调试坐标 HUD（始终显示）：右上角显示 seed + 角色世界坐标
  //   （控制台设 __PP_COORD_HUD=false 可关闭）；「复制」按钮一键复制定位数据
  const hudWrap = document.createElement('div');
  hudWrap.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:999;display:flex;flex-direction:column;gap:4px;align-items:flex-end;pointer-events:none';
  const hudEl: HTMLDivElement = document.createElement('div');
  let hudAcc = 0;
  hudEl.style.cssText =
    'color:#fff;background:rgba(0,0,0,0.55);'
    + 'padding:6px 10px;font:14px Consolas,monospace;white-space:pre;border-radius:6px';
  hudEl.textContent = '...';
  const hudBtn = document.createElement('button');
  hudBtn.textContent = '复制位置';
  hudBtn.style.cssText =
    'pointer-events:auto;color:#fff;background:rgba(20,80,200,0.75);border:none;border-radius:6px;'
    + 'padding:4px 10px;font:13px "Microsoft YaHei",sans-serif;cursor:pointer';
  hudBtn.addEventListener('click', () => {
    const txt = hudEl.textContent ?? '';
    const done = () => {
      hudBtn.textContent = '已复制 ✓';
      setTimeout(() => { hudBtn.textContent = '复制位置'; }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => { fallbackCopy(txt); done(); });
    } else { fallbackCopy(txt); done(); }
  });
  hudWrap.appendChild(hudEl);
  hudWrap.appendChild(hudBtn);
  document.body.appendChild(hudWrap);
  const cameraPos = camera.position;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // 角色世界坐标 HUD（世界米，与 chunk 原点 0,0 同系）
    if ((globalThis as { __PP_COORD_HUD?: boolean }).__PP_COORD_HUD !== false) {
      hudAcc += dt;
      if (hudAcc > 0.15) {
        hudAcc = 0;
        const p = cameraPos;
        hudEl.textContent =
          `seed ${RasterMap.current?.worldSeed ?? '?'}\n`
          + `x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}\n`
          + `chunk (${Math.floor(p.x / 60)},${Math.floor(p.z / 60)})`;
      }
    }

    // ★ 实时渲染域先推进（昼夜时间 + hitstop 时间缩放）→ 世界用缩放时间驱动
    renderManager.update(dt);

    // ★ 天空/雾色跟随昼夜（放在 update 之后、render 之前，保证用的是本帧时间）
    updateSky();

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
  currentEnv = 'ship';
  renderManager.setEnvironment('ship');
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
  currentEnv = 'world';
  renderManager.setEnvironment('world');

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