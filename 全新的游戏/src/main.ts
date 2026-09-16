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
import { BaseMode } from './modes/BaseMode';
import { WorldMode, worldPerf } from './modes/WorldMode';
import { entityPerf } from './entity/EntityPerf';
import type { WorldModeEnterContext } from './modes/WorldMode';
import { SaveSystem } from './core/SaveSystem';
import { RasterMap } from './services/map/RasterMap';
import { digPerf } from './services/map/ChunkManager';
import { setTestGroup } from './services/map/TileGroups';
import { setTestPreset } from './services/map/TerrainPresets';
import { showTestGroupPanel } from './services/map/debug/TestGroupPanel';
import { createNewSession, dailyMapSeed, type GameSession } from './core/Session';
import { minimapWarmupState } from './services/ui/MinimapWarmup';
import { renderManager, LIGHT_TUNING } from './services/render/RenderManager';
import { setGameRenderer, applyShaderDebug } from './services/render/GameRenderer';
import { getDroneIconAnimator } from './services/item/DroneIcon';
import { registerAssetIconSource, registerDynamicIcon } from './services/item/ItemIconRegistry';
import { ItemManager } from './systems/inventory/ItemManager';
import { relicGrantsFor, dispatchRelicEvent } from './core/RelicEffects';
import { RELIC_ITEM_CONFIG } from './config/relics';
import { createButton } from './ui/components/Button';
import { createBackButton } from './ui/components/BackButton';

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

/** 舰船内部固定背景色（中性灰；2026-09-14 用户定调：基地区背景改为灰色，不随昼夜变化） */
const SHIP_BG = 0x808080;

/**
 * ★ 每帧刷新背景清屏色 + 雾色（按当前模式区分）：
 *   - world：露天战场，背景用天空边界（地平线）色随昼夜渐变，雾色与之同色，
 *            远处地形融进地平线 → 与穹顶底部无缝衔接
 *   - ship：舰船内部，固定灰色背景，不受天空影响
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
/** ★ 三个杂兵素材（纯纹理包；地图大量随机生成用） */
let mobAssets: FtxAsset[] = [];
let hitEffectAsset: Asset | null;
/** ★ 可露希尔的无人机（特效包优先，回退纯纹理包） */
let droneAsset: Asset | FtxAsset | null = null;
/** ★ 祖宗素材（站桩友军；缺失时回退无人机素材占位） */
let sentinelAsset: Asset | FtxAsset | null = null;
/** ★ 采集物纹理图集（key → FTX 包，每包 4 帧；'plant' 渲染器消费；缺省 = 不生成） */
const plantAssets: Record<string, FtxAsset> = {};
/** ★ 测试地图开关（boot 从 URL 参数解析；enterWorldMode 消费） */
let testChunk = false;
/** ★ P0 蜂群压测：?enemies=N 开局铺 N 只代理（0 = 关；《蜂群架构.md》§8-P0） */
let enemyStress = 0;

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
  // ★ 着色器错误校验默认关闭：three 默认 true 会让每个 program 链接后同步回读
  //   驱动日志（getProgramInfoLog，强制 GPU 同步），实测 CPU 占比 ~66%，
  //   是"进入世界/停靠"长任务主因。排查 GLSL 错误用 ?shadercheck=1。
  applyShaderDebug(rendererLocal);
  renderer = rendererLocal;
  // ★ UI 离屏烘焙（背包/加工台无人机图标）复用主渲染器，与战斗共用纹理绘制路径
  setGameRenderer(rendererLocal);
  rendererLocal.setSize(window.innerWidth, window.innerHeight);
  // ★ 像素比上限：高 DPI 屏（dpr=2）全渲染 = 4 倍像素，是低帧率最大单点开销；
  //   压到 1.5 视觉几乎无差（画布由 CSS 拉伸）
  rendererLocal.setPixelRatio(Math.min(adapter.info.dpr, 1.5));
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
  // ★ 地形结构预设调试：?preset=maze|plain|lake|plateau|ridges|ruins|pitfield|terraces|corridor
  const testPreset = urlParams.get('preset');
  if (testPreset) setTestPreset(testPreset); // 未知 key 抛错（fail-fast）
  testChunk = testGroup !== null || urlParams.get('single') === '1';
  enemyStress = Math.max(0, Math.min(200, Number(urlParams.get('enemies') ?? 0) || 0));
  // ★ 测试组面板延后到存档就绪（需当天地图种子 = 主种子 × 天数）再显示
  // 控制台换组时联动刷新面板
  (window as unknown as { setTestPreset?: (k: string | null) => void }).setTestPreset = (k) => {
    setTestPreset(k);
    location.reload(); // 结构化地形需重建：直接刷新
  };
  (window as unknown as { setTestGroup: (k: string | null) => void }).setTestGroup = (k) => {
    setTestGroup(k);
    if (testChunk) {
      showTestGroupPanel(
        k ?? undefined,
        currentSession ? dailyMapSeed(currentSession.meta.seed, currentSession.meta.day) : undefined,
      );
    }
  };
  // ★ ?perf=1 → 暴露性能采样钩子（scripts/perf/* 采集用，默认零足迹）
  if (urlParams.get('perf') === '1') {
    (window as unknown as { __ppMode?: () => unknown }).__ppMode = () => currentMode;
    (window as unknown as { __ppWp?: unknown }).__ppWp = worldPerf;
    (window as unknown as { __ppEp?: unknown }).__ppEp = entityPerf;
    // ★ 打坑链路分项耗时（累计 ms / 计数；脚本按段 reset() 采样）
    (window as unknown as { __ppDig?: unknown }).__ppDig = digPerf;
    // ★ 小地图预加载状态（拿它验证"抽卡页预热 → 进世界交接"是否生效）
    (window as unknown as { __mmWarm?: () => unknown }).__mmWarm = () => minimapWarmupState();
    (window as unknown as { __ppEnterWorld?: () => void }).__ppEnterWorld = () => {
      if (currentSession) enterWorldMode(scene, camera, renderer, currentSession.meta.day);
    };
  }

  // ---- 3. 加载资产 ----
  protagonistAsset = await FtxAsset.load(encodeURI('/characters/protagonist/维维美.ftx3.gz'));

  try {
    bulletAsset = await Asset.load(encodeURI('/fx/bullets/维什戴尔子弹.scene.zip'));
  } catch {
    bulletAsset = await FtxAsset.load(encodeURI('/fx/bullets/维什戴尔子弹.ftx3.gz'));
  }
  // ★ 常规子弹动态图标：统一走 DynamicIconAnimator（VAT + 流体离屏 + 循环）
  registerDynamicIcon('bullet_default', bulletAsset);

  enemyAsset = await Asset.load(encodeURI('/characters/enemies/普瑞赛斯.scene.zip'));
  registerDynamicIcon('priestess', enemyAsset); // ★ 6★ 普瑞赛斯图标（卡池/遗物面板）

  // ---- ★ 三个杂兵（纯纹理包）：地图大量随机生成用 ----
  mobAssets = await Promise.all([
    FtxAsset.load(encodeURI('/characters/enemies/原石虫，杂兵.ftx3.gz')),
    FtxAsset.load(encodeURI('/characters/enemies/整合运动人员，杂兵.ftx3.gz')),
    FtxAsset.load(encodeURI('/characters/enemies/牢杰，杂兵.ftx3.gz')),
  ]);

  // ---- ★ 采集物纹理图集（每 key 一包 4 帧；替代程序化模型，直接贴图）----
  for (const [key, file] of [
    ['herb_grass', '草'], ['flower_bloom', '花'],
    ['berry_bush', '浆果丛'], ['young_tree', '树'],
  ] as const) {
    try {
      plantAssets[key] = await FtxAsset.load(encodeURI(`/textures/${file}.ftx3.gz`));
    } catch {
      console.warn(`[boot] 采集物纹理缺失：/textures/${file}.ftx3.gz（${key} 将不生成）`);
    }
  }

  try {
    hitEffectAsset = await Asset.load(encodeURI('/fx/bullets/主角子弹击中特效.scene.zip'));
  } catch {
    hitEffectAsset = null;
  }

  // ---- ★ 可露希尔的无人机（特效包优先；回退纯纹理包） ----
  try {
    droneAsset = await Asset.load(encodeURI('/fx/可露希尔的无人机.scene.zip'));
  } catch {
    droneAsset = await FtxAsset.load(encodeURI('/fx/可露希尔的无人机.ftx3.gz'));
  }
  // ★ 预热无人机动态图标（主渲染器离屏烘焙；背包/加工台从 this 取动画帧）
  getDroneIconAnimator().warm(droneAsset);

  // ---- ★ 祖宗素材（站桩友军）：特效包优先 → 纯纹理包 → 无人机素材占位 ----
  //   路径约定：public/fx/祖宗.scene.zip（或 .ftx3.gz）；素材到位只放文件即可
  try {
    sentinelAsset = await Asset.load(encodeURI('/fx/祖宗.scene.zip'));
  } catch {
    try {
      sentinelAsset = await FtxAsset.load(encodeURI('/fx/祖宗.ftx3.gz'));
    } catch {
      console.warn('[boot] 祖宗素材缺失，暂用无人机素材占位（放入 public/fx/祖宗.scene.zip 或 .ftx3.gz 即生效）');
      sentinelAsset = droneAsset;
    }
  }
  // ★ 祖宗图标路径：注册资产图标源（背包/加工台/友军列表统一由此合成贴图）
  if (sentinelAsset) registerAssetIconSource('zuzong', sentinelAsset);

  // ---- ★ 鱼生萌萌香（头部装备）：3 帧动态图标统一走 DynamicIconAnimator 通用线 ----
  try {
    const yushengAsset = await FtxAsset.load(encodeURI('/fx/鱼生萌萌香.ftx3.gz'));
    registerDynamicIcon('yusheng_mengmengxiang', yushengAsset);
  } catch {
    console.warn('[boot] 鱼生萌萌香素材缺失，图标回退色块');
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
      } else {
        // 只有静态纹理 → 用旧模式直接采样
        renderManager.setMoonTexture(pair.base, pair.residual);
      }
    } else {
      renderManager.setMoonEffect(null);
      console.warn('[boot] 大猫哥月亮素材包缺帧数据，回退程序化月相');
    }
  } catch (e) {
    renderManager.setMoonEffect(null);
    console.warn('[boot] 大猫哥月亮素材包加载失败，回退程序化月相:', e);
  }

  // ---- 3. 读取或创建存档（?wipe=1 → 先删档再开新档） ----
  if (new URLSearchParams(location.search).get('wipe') === '1') {
    try {
      localStorage.removeItem('arknights_rogue_save');
      console.warn('[boot] 已删档（?wipe=1）：旧存档清除，将创建新档');
    } catch (e) {
      console.error('[boot] 删档失败:', e);
    }
  }
  currentSession = SaveSystem.load();
  if (!currentSession) {
    currentSession = createNewSession();
    SaveSystem.save(currentSession);
  }
  // ★ 测试组面板（调试）：存档就绪后用当天地图种子（主种子 × 天数）统计实际 chunk
  if (testChunk) {
    showTestGroupPanel(testGroup ?? undefined, dailyMapSeed(currentSession.meta.seed, currentSession.meta.day));
  }

  // ★ 调试：?priestess=1 直接获得普瑞赛斯（验证四维空间 Boss 流程用）
  if (new URLSearchParams(location.search).get('priestess') === '1' && currentSession) {
    if (!currentSession.outOfRun) currentSession.outOfRun = { owned: {} };
    if (!currentSession.outOfRun.owned) currentSession.outOfRun.owned = {};
    currentSession.outOfRun.owned.priestess = 1;
    currentSession.meta.bossCleared = false;
    SaveSystem.save(currentSession);
    console.warn('[boot] 调试：已直接获得普瑞赛斯（?priestess=1）');
  }

  // ★★★★★ 修复：如果标志为 true 但游戏刚启动，说明上次出击未正常执行 ★★★★★
  if (currentSession && currentSession.dayProgress.hasDepartedToday) {
    console.warn('[boot] 检测到未完成的出击（hasDepartedToday=true），战斗未正常执行，维持当天存档');
    currentSession.dayProgress.hasDepartedToday = false;
    SaveSystem.save(currentSession);
  }

  // ---- 4. 启动主循环 ----
  const clock = new THREE.Clock();

  // ★ 调试 HUD（坐标 + 帧率技术统计）：默认隐藏，右上角「性能」按钮开关
  //   （控制台 setHudVisible(true/false)；__PP_HUD=true 可让启动即显示；
  //    __PP_COORD_HUD=false 只关坐标块，__PP_FPS_HUD=false 只关帧率块）
  //   「复制位置」按钮一键复制帧率 + 坐标
  const hudWrap = document.createElement('div');
  // ★ 调试 HUD 可见性：默认隐藏，由右上角「性能」按钮切换（控制台 setHudVisible(true) 亦可）
  //   hidden 时整段统计代码跳过 → 零累加、零 DOM 写入，不存在后台白烧
  let hudVisible = (globalThis as { __PP_HUD?: boolean }).__PP_HUD === true;
  hudWrap.style.cssText =
    'position:fixed;top:38px;right:8px;z-index:999;display:none;flex-direction:column;gap:4px;align-items:flex-end;pointer-events:none';
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
    // ★ 复制内容含帧率技术统计（FPS/绘制/更新/渲染）+ 坐标，便于定位性能问题
    const txt = `${fpsEl.textContent ?? ''}\n${hudEl.textContent ?? ''}`;
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

  function applyHudVisible(v: boolean): void {
    hudVisible = v;
    hudWrap.style.display = v ? 'flex' : 'none';
  }
  // ★ 设置面板（左上角白齿轮）：性能面板开关 + 删档
  applyHudVisible(hudVisible);
  settingsUi = createSettingsUI({
    isHudVisible: () => hudVisible,
    setHudVisible: applyHudVisible,
  });
  // 控制台逃生口：setHudVisible(true/false) / toggleSettings()
  (globalThis as { setHudVisible?: (v: boolean) => void }).setHudVisible = applyHudVisible;
  (globalThis as { toggleSettings?: () => void }).toggleSettings = () => settingsUi?.toggle();

  // ★ 帧率技术统计（FPS / 帧时峰值 / 主渲染器绘制调用与三角数 / 更新与渲染耗时）
  const fpsEl = document.createElement('div');
  fpsEl.style.cssText =
    'color:#9fe8ff;background:rgba(0,0,0,0.55);'
    + 'padding:6px 10px;font:13px Consolas,monospace;white-space:pre;border-radius:6px';
  fpsEl.textContent = '-- FPS';
  hudWrap.prepend(fpsEl);

  /** 帧率统计窗口（0.25s 聚合一次；_FPS_HUD=false 可隐藏文本） */
  let fpsFrames = 0;
  let fpsAcc = 0;
  let fpsWorstMs = 0;
  let updMsSum = 0;
  let rendMsSum = 0;
  let callsSum = 0;
  let trisSum = 0;
  // ★ 世界更新拆项也按同窗口平均（否则与"更新 ms"对不上账：拆项瞬时值看不到装配尖峰）
  let wpChunksSum = 0, wpUiSum = 0, wpCombatSum = 0, wpAiSum = 0;
  let wpEntSum = 0, wpPostSum = 0, wpPhysSum = 0;
  let wpDronesSum = 0, wpEntSubSum = 0, wpWaterSum = 0, wpClampSum = 0;
  /** ★ 窗口内 chunk 装配峰值（确认走路卡顿是否来自交付尖峰） */
  let wpAsmMax = 0;
  // ★ 实体管线阶段耗时（EntityBase.update 聚合；同窗口平均）
  let epBehSum = 0, epPhysSum = 0, epAnimSum = 0;
  let epRenderSum = 0, epMovedSum = 0, epShadowSum = 0;
  /** ★ 行为细分（移动/角色推挤/静态推挤/染料） */
  let epMoveSum = 0, epSepOtherSum = 0, epSepStaticSum = 0, epDyeSum = 0;
  /** ★ 蜂群分项（P0 度量） */
  let epSwarmSum = 0, epSwarmSepSum = 0, epSwarmRenderSum = 0;
  const cameraPos = camera.position;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // 角色世界坐标 HUD（世界米，与 chunk 原点 0,0 同系）
    if (hudVisible && (globalThis as { __PP_COORD_HUD?: boolean }).__PP_COORD_HUD !== false) {
      hudAcc += dt;
      if (hudAcc > 0.15) {
        hudAcc = 0;
        const p = cameraPos;
        // ★ 种子权威来源 = 存档（主种子 × 天数）；RasterMap.current 极端情况
        //   （HMR/模块换代）可能为空 → 用 dailyMapSeed 回退，保证 HUD 恒有数值
        const dailySeed = RasterMap.current?.worldSeed
          ?? (currentSession ? dailyMapSeed(currentSession.meta.seed, currentSession.meta.day) : null);
        hudEl.textContent =
          `${currentEnv === 'world' ? '世界' : '基地'}  seed ${dailySeed ?? '?'}\n`
          + `x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}\n`
          + `chunk (${Math.floor(p.x / 60)},${Math.floor(p.z / 60)})`;
      }
    }

    // ★ 实时渲染域先推进（昼夜时间 + hitstop 时间缩放）→ 世界用缩放时间驱动
    renderManager.update(dt);

    // ★ 天空/雾色跟随昼夜（放在 update 之后、render 之前，保证用的是本帧时间）
    updateSky();

    if (currentMode) {
      // ★ 实体阶段计时清零（该帧无实体更新 → 全 0，不显示陈旧值）
      entityPerf.behavior = 0; entityPerf.phys = 0; entityPerf.anim = 0;
      entityPerf.render = 0; entityPerf.moved = 0; entityPerf.shadow = 0;
      entityPerf.move = 0; entityPerf.sepOther = 0; entityPerf.sepStatic = 0; entityPerf.dye = 0;
      entityPerf.count = 0;
      // ★ 蜂群分项同样逐帧清零（此前只读不清 → HUD 显示的是跨帧累计和，越跑越大）
      entityPerf.swarmBrain = 0; entityPerf.swarmMove = 0; entityPerf.swarmSep = 0;
      entityPerf.swarmRender = 0; entityPerf.swarmTier = 0;
      const u0 = performance.now();
      // ★ 帧级异常兜底：update/render 抛错不再中断 rAF 循环（错误上屏，见 showRuntimeError）
      try {
        currentMode.update(renderManager.scaledDt);
        const u1 = performance.now();
        currentMode.render();
        const r1 = performance.now();
        updMsSum += u1 - u0;
        rendMsSum += r1 - u1;
      } catch (err) {
        showRuntimeError('[frame]', err);
      }
    } else {
      const r0 = performance.now();
      renderer.render(scene, camera);
      rendMsSum += performance.now() - r0;
    }

    // ★ 性能 HUD 关闭时整段跳过：零累加、零 DOM 写入（默认关闭，右上角「性能」按钮开启）
    if (hudVisible) {
      // ★ 帧率技术统计：主渲染器本帧绘制调用 / 三角数（读在 render 紧后，不受离屏烘焙污染）
      const rinfo = rendererLocal.info.render;
      callsSum += rinfo.calls;
      trisSum += rinfo.triangles;
      // ★ 世界拆项只在世界模式累加（舰船模式下 worldPerf 是上一局旧值 → 会误导）
      const inWorldEnv = currentEnv === 'world';
      if (inWorldEnv) {
        wpChunksSum += worldPerf.chunks;
        wpUiSum += worldPerf.ui;
        wpCombatSum += worldPerf.combat;
        wpAiSum += worldPerf.ai;
        wpEntSum += worldPerf.entity;
        wpPostSum += worldPerf.post;
        wpPhysSum += worldPerf.phys;
        wpDronesSum += worldPerf.drones;
        wpEntSubSum += worldPerf.ent;
        wpWaterSum += worldPerf.water;
        wpClampSum += worldPerf.clamp;
        if (worldPerf.assembly > wpAsmMax) wpAsmMax = worldPerf.assembly;
        epBehSum += entityPerf.behavior;
        epPhysSum += entityPerf.phys;
        epAnimSum += entityPerf.anim;
        epRenderSum += entityPerf.render;
        epMovedSum += entityPerf.moved;
        epShadowSum += entityPerf.shadow;
        epMoveSum += entityPerf.move;
        epSepOtherSum += entityPerf.sepOther;
        epSepStaticSum += entityPerf.sepStatic;
        epDyeSum += entityPerf.dye;
        epSwarmSum += entityPerf.swarmBrain + entityPerf.swarmMove + entityPerf.swarmTier;
        epSwarmSepSum += entityPerf.swarmSep;
        epSwarmRenderSum += entityPerf.swarmRender;
      }
      fpsFrames++;
      fpsAcc += dt;
      if (dt > fpsWorstMs) fpsWorstMs = dt;
      if (fpsAcc >= 0.25) {
        if ((globalThis as { __PP_FPS_HUD?: boolean }).__PP_FPS_HUD !== false) {
          fpsEl.textContent =
            `${(fpsFrames / fpsAcc).toFixed(1)} FPS   ${((fpsAcc / fpsFrames) * 1000).toFixed(1)} ms (峰值 ${(fpsWorstMs * 1000).toFixed(0)})\n`
            + `绘制 ${Math.round(callsSum / fpsFrames)} 调用   三角 ${Math.round(trisSum / fpsFrames)}\n`
            + `更新 ${(updMsSum / fpsFrames).toFixed(2)} ms   渲染 ${(rendMsSum / fpsFrames).toFixed(2)} ms\n`
            + `区块 ${(wpChunksSum / fpsFrames).toFixed(1)}  装配峰 ${wpAsmMax.toFixed(1)}  界面 ${(wpUiSum / fpsFrames).toFixed(1)}  贴片 ${(wpCombatSum / fpsFrames).toFixed(1)}  AI ${(wpAiSum / fpsFrames).toFixed(1)}\n`
            + `实体 ${(wpEntSum / fpsFrames).toFixed(1)}  后段 ${(wpPostSum / fpsFrames).toFixed(1)}  物理 ${(wpPhysSum / fpsFrames).toFixed(1)}\n`
            + `子项 无人机 ${(wpDronesSum / fpsFrames).toFixed(1)}  实体更新 ${(wpEntSubSum / fpsFrames).toFixed(1)}  入水 ${(wpWaterSum / fpsFrames).toFixed(1)}  贴地 ${(wpClampSum / fpsFrames).toFixed(1)}\n`
            + `阶段 行为 ${(epBehSum / fpsFrames).toFixed(1)}  物理 ${(epPhysSum / fpsFrames).toFixed(1)}  动画 ${(epAnimSum / fpsFrames).toFixed(1)}  渲染 ${(epRenderSum / fpsFrames).toFixed(1)}  索引 ${(epMovedSum / fpsFrames).toFixed(1)}  影子 ${(epShadowSum / fpsFrames).toFixed(1)}\n`
            + `行为拆 移动 ${(epMoveSum / fpsFrames).toFixed(1)}  推挤 ${(epSepOtherSum / fpsFrames).toFixed(1)}  静态 ${(epSepStaticSum / fpsFrames).toFixed(1)}  染料 ${(epDyeSum / fpsFrames).toFixed(1)}\n`
            + `蜂群 决策 ${(epSwarmSum / fpsFrames).toFixed(2)}  分离 ${(epSwarmSepSum / fpsFrames).toFixed(2)}  批渲 ${(epSwarmRenderSum / fpsFrames).toFixed(2)}\n`
            + (inWorldEnv
              ? `实体数 ${worldPerf.nBases} (敌 ${worldPerf.nEnemies} 代理 ${worldPerf.nAgents} 机 ${worldPerf.nDrones})  `
                + `刚体记录 ${worldPerf.nEntities} = 地形 ${worldPerf.nGround} + 装饰/友军 ${worldPerf.nDecor}`
                + ` + 其他 ${worldPerf.nEntities - worldPerf.nGround - worldPerf.nDecor}`
              : `（舰船模式：世界统计暂停）`);
        }
        fpsFrames = 0;
        fpsAcc = 0;
        fpsWorstMs = 0;
        updMsSum = 0;
        rendMsSum = 0;
        callsSum = 0;
        trisSum = 0;
        wpChunksSum = 0; wpUiSum = 0; wpCombatSum = 0; wpAiSum = 0;
        wpEntSum = 0; wpPostSum = 0; wpPhysSum = 0;
        wpDronesSum = 0; wpEntSubSum = 0; wpWaterSum = 0; wpClampSum = 0;
        wpAsmMax = 0;
        epBehSum = 0; epPhysSum = 0; epAnimSum = 0;
        epRenderSum = 0; epMovedSum = 0; epShadowSum = 0;
        epMoveSum = 0; epSepOtherSum = 0; epSepStaticSum = 0; epDyeSum = 0;
        epSwarmSum = 0; epSwarmSepSum = 0; epSwarmRenderSum = 0;
      }
    }
  }

  // ---- 5. 进入 BaseMode（基地，默认模式；2026-09-12 从 ShipMode 独立归属） ----
  enterBaseMode(scene, camera, renderer);

  animate();
}

// ============================================================
// 模式切换函数（main.ts 的唯一额外职责）
// ============================================================

/** 进入基地模式（返回后 / 启动默认） */
function enterBaseMode(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): void {
  // 1. 如果有旧模式，彻底清理
  currentMode?.exit();
  currentMode = null;
  settingsUi?.setVisible(true); // ★ 仅基地模式提供设置入口（左上角齿轮）

  // 2. 保存存档
  if (currentSession) {
    SaveSystem.save(currentSession);
  }

  // 3. 创建新 BaseMode（基地内部：3D 剖切空间 + 主按钮 + 覆盖层）
  const base = new BaseMode();
  try {
    base.enter({
      scene, camera, renderer,
      session: currentSession!,
      protagonistAsset, // ★ 基地内部行走立绘（维维美）
      droneAsset: droneAsset ?? undefined, // 基地盟友跟随（无人机；祖宗为弹药消耗品不绘制）
      onDepart: (day: number) => {
        enterWorldMode(scene, camera, renderer, day);
      },
    });
  } catch (err) {
    showRuntimeError('[enterBase]', err);
    return;
  }
  currentMode = base;
  currentEnv = 'ship';
  renderManager.setEnvironment('ship');
}

/** 出击到世界模式 */
function enterWorldMode(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  day: number,
): void {
  // 1. 清理旧模式
  currentMode?.exit();
  currentMode = null;
  settingsUi?.setVisible(false); // ★ 世界模式不提供设置入口（左上角小地图占用）

  // 2. 创建 WorldMode（完全自包含：PhysicsWorld/DesktopBinding 内部创建）
  const world = new WorldMode();
  const ctx: WorldModeEnterContext = {
    scene, camera, renderer,
    session: currentSession!,
    day,
    protagonistAsset,
    bulletAsset,
    enemyAssets: mobAssets,
    bossAsset: enemyAsset, // ★ 普瑞赛斯（Boss 战）
    hitEffectAsset: hitEffectAsset ?? undefined,
    droneAsset: droneAsset ?? undefined,
    sentinelAsset: sentinelAsset ?? undefined,
    plantAssets,
    debug: { testChunk, enemyStress },
    onReturn: () => {
      // 返回时：★ 行囊（弹药背包）保持原样——不转移祖宗，随存档原样落盘
      //   → 遗物"返回/天数"时机管线 → 推进天数 → BaseMode（内部 SaveSystem.save）
      if (currentSession) {
        const im = new ItemManager(currentSession);
        // ★ 遗物「返回」时机（可授予道具；行囊落账）
        for (const g of relicGrantsFor(currentSession, RELIC_ITEM_CONFIG, 'onRunEnd')) {
          if (im.hasSpace('player', g.itemId, g.count)) im.addItem('player', g.itemId, g.count);
        }
        currentSession.meta.day++;
        currentSession.meta.totalDaysSurvived++;
        currentSession.dayProgress.hasDepartedToday = false;
        // ★ 遗物「天数推进」时机
        dispatchRelicEvent(currentSession, RELIC_ITEM_CONFIG, 'onDayAdvance', {});
      }
      enterBaseMode(scene, camera, renderer);
    },
  };
  try {
    world.enter(ctx);
  } catch (err) {
    showRuntimeError('[enterWorld]', err);
    return; // 进图失败：错误上屏（不再留下"空世界 + 冻结 HUD"的无提示状态）
  }
  currentMode = world;
  currentEnv = 'world';
  renderManager.setEnvironment('world');
}

// ============================================================
// ★ 运行期异常上屏（进图/模式切换/帧更新抛错不再无声空屏）
// ============================================================

let runtimeErrShown = 0;
function showRuntimeError(tag: string, err: unknown): void {
  console.error(tag, err);
  if (runtimeErrShown >= 6) return; // 防刷屏（同一异常每帧抛也只显示前几条）
  runtimeErrShown++;
  let el = document.getElementById('__pp_err');
  if (!el) {
    el = document.createElement('div');
    el.id = '__pp_err';
    el.style.cssText =
      'position:fixed;bottom:8px;left:8px;right:8px;max-height:45vh;overflow:auto;'
      + 'color:#ff9090;background:rgba(25,0,0,0.9);padding:8px 10px;'
      + 'font:12px/1.5 Consolas,monospace;white-space:pre-wrap;z-index:99999;'
      + 'border:1px solid #a33;border-radius:6px;pointer-events:auto';
    document.body.appendChild(el);
  }
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  el.textContent += `${tag} ${msg}\n\n`;
}
// ★ 忽略浏览器扩展异常（钱包 inpage.js 等注入脚本的 promise 拒绝会冒泡到页面；
//   不是游戏错误，不上屏；标识：堆栈/来源命中 inpage/扩展协议/已知扩展报错文案）
function isExtensionError(data: unknown, source?: string): boolean {
  const text = `${source ?? ''}
${data instanceof Error ? (data.stack ?? data.message) : String(data)}`;
  return /inpage\.js|contentscript|chrome-extension:\/\/|moz-extension:\/\/|safari-extension:|callback id:|func sseError not found/i.test(text);
}
window.addEventListener('error', (e) => {
  const data = e.error ?? e.message;
  if (isExtensionError(data, e.filename)) return;
  showRuntimeError('[error]', data);
});
window.addEventListener('unhandledrejection', (e) => {
  if (isExtensionError(e.reason)) return;
  showRuntimeError('[reject]', e.reason);
});

// ============================================================
// ★ 设置面板（左上角白齿轮）：性能面板开关 / 删档
//   · 齿轮仅基地模式显示（左上角 8,8）；世界模式自带 UI 不需设置 → 自动隐藏
//   · 面板打开时吞掉键盘（capture 阶段），防止角色在面板背后乱走
//   · 删档 = 二次确认（3s 内再点）→ SaveSystem.clear() + reload（boot 自动开新档）
// ============================================================

/** 白色齿轮图标（Material settings，单 path 双子路径 → 自带中心圆孔） */
const GEAR_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path fill="#fff" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58'
  + 'c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94'
  + 'L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29'
  + 'L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12'
  + 's0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96'
  + 'c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54'
  + 'c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61'
  + 'L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

interface SettingsUi {
  /** 显隐（仅基地模式提供设置入口；世界模式隐藏） */
  setVisible(v: boolean): void;
  /** 面板开合（控制台 toggleSettings() 用） */
  toggle(): void;
}

/** 全局句柄：boot 内创建，模式切换时调 setVisible 显隐 */
let settingsUi: SettingsUi | null = null;

function createSettingsUI(deps: {
  isHudVisible: () => boolean;
  setHudVisible: (v: boolean) => void;
}): SettingsUi {
  let open = false;

  // ---- 左上角白齿轮按钮 ----
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.title = '设置';
  gear.setAttribute('aria-label', '设置');
  gear.innerHTML = GEAR_SVG;
  gear.style.cssText =
    // ★ z-index 必须高于遮罩(1201)：面板打开后齿轮仍在最上层，点它即返回/收起
    'position:fixed;top:8px;left:8px;z-index:1202;width:38px;height:38px;'
    + 'display:flex;align-items:center;justify-content:center;padding:0;'
    + 'border:none;border-radius:10px;background:rgba(0,0,0,0.45);'
    + 'cursor:pointer;opacity:0.72;pointer-events:auto;'
    + 'transition:opacity .18s,background .18s,transform .18s';
  gear.addEventListener('mouseenter', () => {
    gear.style.opacity = '1';
    gear.style.transform = 'rotate(40deg)';
  });
  gear.addEventListener('mouseleave', () => {
    gear.style.transform = 'none';
    if (!open) gear.style.opacity = '0.72';
  });

  // ---- 遮罩 + 卡片 ----
  const mask = document.createElement('div');
  mask.style.cssText =
    'position:fixed;inset:0;z-index:1201;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(0,0,0,0.5);pointer-events:auto';
  const card = document.createElement('div');
  card.style.cssText =
    'width:352px;max-width:88vw;background:rgba(12,22,36,0.97);border:1px solid #2a4a72;'
    + 'border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.65);'
    + 'color:#eaf6ff;font:14px "Microsoft YaHei",sans-serif;overflow:hidden';

  // ★ 标题栏：统一「返回」按钮（左上角；与背包/加工台/抽卡页同一套 UI）
  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:10px;'
    + 'padding:10px 14px;background:rgba(30,60,100,0.35);border-bottom:1px solid #2a4a72';
  const headTitle = document.createElement('div');
  headTitle.textContent = '设置';
  headTitle.style.cssText = 'font-size:16px;font-weight:bold;letter-spacing:3px;color:#cfe6ff';
  const backBtn = createBackButton({ onClick: () => setOpen(false), height: 30 });
  head.append(backBtn, headTitle);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column';

  /** 一行设置：左侧标题+说明，返回右侧控件插槽 */
  function mkRow(title: string, desc: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:14px;'
      + 'padding:13px 14px;border-bottom:1px solid rgba(42,74,114,0.45)';
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0';
    const t = document.createElement('div');
    t.textContent = title;
    t.style.cssText = 'font-size:14px;font-weight:bold;color:#eaf6ff';
    const d = document.createElement('div');
    d.textContent = desc;
    d.style.cssText = 'font-size:12px;color:#8fb0cd;line-height:1.55';
    left.append(t, d);
    const right = document.createElement('div');
    right.style.cssText = 'flex:none';
    row.append(left, right);
    body.appendChild(row);
    return right;
  }

  // ---- 行 1：性能面板 ----
  const perfSlot = mkRow('性能面板', '显示 FPS / 绘制调用 / 各阶段耗时。关闭时不累加、不写 DOM，零开销。');
  const perfBtn = createButton({
    label: '开启', style: 'secondary', size: 'sm',
    onClick: () => { deps.setHudVisible(!deps.isHudVisible()); syncPerf(); },
  });
  perfSlot.appendChild(perfBtn);
  function syncPerf(): void {
    const on = deps.isHudVisible();
    perfBtn.textContent = on ? '关闭' : '开启';
    perfBtn.style.background = on ? '#4488ff' : '#4466aa';
  }

  // ---- 行 2：删档（二次确认） ----
  const delSlot = mkRow('删除存档', '清空本地存档并重新开局：进度、道具、遗物全部丢失，不可恢复。');
  let armed = false;
  let armTimer = 0;
  const delBtn = createButton({
    label: '删除存档', style: 'danger', size: 'sm',
    onClick: () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = '确认删除？';
        delBtn.style.background = '#ff2f2f';
        armTimer = window.setTimeout(() => resetArm(), 3000);
        return;
      }
      window.clearTimeout(armTimer);
      SaveSystem.clear();
      console.warn('[设置] 手动删档：存档已清除，重载后将创建新档');
      location.reload();
    },
  });
  function resetArm(): void {
    armed = false;
    delBtn.textContent = '删除存档';
    delBtn.style.background = '#cc4444';
  }
  delSlot.appendChild(delBtn);

  card.append(head, body);
  mask.appendChild(card);
  document.body.append(gear, mask);

  function setOpen(v: boolean): void {
    open = v;
    mask.style.display = v ? 'flex' : 'none';
    gear.style.opacity = v ? '1' : '0.72';
    gear.style.background = v ? 'rgba(20,80,200,0.7)' : 'rgba(0,0,0,0.45)';
    gear.style.transform = 'none';
    gear.title = v ? '关闭设置' : '设置';
    if (v) { syncPerf(); resetArm(); }
  }

  gear.addEventListener('click', () => setOpen(!open)); // 开 / 关（返回）都是它
  mask.addEventListener('click', (e) => { if (e.target === mask) setOpen(false); }); // 点卡片外空白也收起
  // capture 阶段拦截：面板打开时吃掉按键（ESC 关闭 + 其余不下传，防角色乱走）
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') setOpen(false);
    e.stopPropagation();
  }, true);

  syncPerf();
  return {
    setVisible: (v: boolean) => {
      gear.style.display = v ? 'flex' : 'none';
      if (!v && open) setOpen(false); // 离开基地时顺手收面板
    },
    toggle: () => setOpen(!open),
  };
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