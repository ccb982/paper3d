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
import { WorldMode, worldPerf } from './modes/WorldMode';
import { entityPerf } from './entity/EntityPerf';
import type { WorldModeEnterContext } from './modes/WorldMode';
import { SaveSystem } from './core/SaveSystem';
import { RasterMap } from './services/map/RasterMap';
import { setTestGroup } from './services/map/TileGroups';
import { showTestGroupPanel } from './services/map/debug/TestGroupPanel';
import { createNewSession, type GameSession, type PlayerCombatStats } from './core/Session';
import { renderManager, LIGHT_TUNING } from './services/render/RenderManager';
import { setGameRenderer } from './services/render/GameRenderer';
import { getDroneIconAnimator } from './services/item/DroneIcon';
import { registerAssetIconSource, registerDynamicIcon } from './services/item/ItemIconRegistry';
import { ItemManager } from './systems/inventory/ItemManager';
import { relicGrantsFor, dispatchRelicEvent } from './core/RelicEffects';
import { RELIC_ITEM_CONFIG } from './config/relics';

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
/** ★ 三个杂兵素材（纯纹理包；地图大量随机生成用） */
let mobAssets: FtxAsset[] = [];
let hitEffectAsset: Asset | null;
/** ★ 可露希尔的无人机（特效包优先，回退纯纹理包） */
let droneAsset: Asset | FtxAsset | null = null;
/** ★ 祖宗素材（站桩友军；缺失时回退无人机素材占位） */
let sentinelAsset: Asset | FtxAsset | null = null;
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
  testChunk = testGroup !== null || urlParams.get('single') === '1';
  if (testChunk) showTestGroupPanel(testGroup ?? undefined); // 组内容面板（缺省=实际 chunk 生效组）
  // 控制台换组时联动刷新面板
  (window as unknown as { setTestGroup: (k: string | null) => void }).setTestGroup = (k) => {
    setTestGroup(k);
    if (testChunk) showTestGroupPanel(k ?? undefined);
  };

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

  // ---- ★ 三个杂兵（纯纹理包）：地图大量随机生成用 ----
  mobAssets = await Promise.all([
    FtxAsset.load(encodeURI('/characters/enemies/原石虫，杂兵.ftx3.gz')),
    FtxAsset.load(encodeURI('/characters/enemies/整合运动人员，杂兵.ftx3.gz')),
    FtxAsset.load(encodeURI('/characters/enemies/牢杰，杂兵.ftx3.gz')),
  ]);

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

  // ---- 3. 读取或创建存档 ----
  currentSession = SaveSystem.load();
  if (!currentSession) {
    currentSession = createNewSession();
    SaveSystem.save(currentSession);
  }

  // ★ 迁移（2026-09-11）：黑冠从旧"藏品"归位为"遗物"（开局即拥 1 件）
  // 旧存档可能残留 relics.owned；新权威字段为 outOfRun（遗物）
  if (currentSession) {
    const oldRelics = (currentSession as { relics?: { owned?: string[] } }).relics;
    const rIdx = oldRelics?.owned?.indexOf('black_crown') ?? -1;
    if (rIdx !== -1 && oldRelics?.owned) {
      oldRelics.owned.splice(rIdx, 1);
      if (!currentSession.outOfRun) currentSession.outOfRun = { owned: {} };
      if (!currentSession.outOfRun.owned) currentSession.outOfRun.owned = {};
      currentSession.outOfRun.owned.black_crown = (currentSession.outOfRun.owned.black_crown ?? 0) + 1;
      SaveSystem.save(currentSession);
    }
  }

  // ★★★★★ 修复：如果标志为 true 但游戏刚启动，说明上次出击未正常执行 ★★★★★
  if (currentSession && currentSession.dayProgress.hasDepartedToday) {
    console.warn('[boot] 检测到未完成的出击（hasDepartedToday=true），战斗未正常执行，维持当天存档');
    currentSession.dayProgress.hasDepartedToday = false;
    SaveSystem.save(currentSession);
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
      // ★ 实体阶段计时清零（该帧无实体更新 → 全 0，不显示陈旧值）
      entityPerf.behavior = 0; entityPerf.phys = 0; entityPerf.anim = 0;
      entityPerf.render = 0; entityPerf.moved = 0; entityPerf.shadow = 0;
      entityPerf.move = 0; entityPerf.sepOther = 0; entityPerf.sepStatic = 0; entityPerf.dye = 0;
      entityPerf.count = 0;
      const u0 = performance.now();
      currentMode.update(renderManager.scaledDt);
      const u1 = performance.now();
      currentMode.render();
      const r1 = performance.now();
      updMsSum += u1 - u0;
      rendMsSum += r1 - u1;
    } else {
      const r0 = performance.now();
      renderer.render(scene, camera);
      rendMsSum += performance.now() - r0;
    }

    // ★ 帧率技术统计：主渲染器本帧绘制调用 / 三角数（读在 render 紧后，不受离屏烘焙污染）
    const rinfo = rendererLocal.info.render;
    callsSum += rinfo.calls;
    trisSum += rinfo.triangles;
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
          + `实体数 ${worldPerf.nEntities} (敌 ${worldPerf.nEnemies} 机 ${worldPerf.nDrones})`;
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
    }
  }

  // ---- 5. 进入 ShipMode（默认模式） ----
  enterShipMode(scene, camera, renderer);

  animate();
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
    enemyAssets: mobAssets,
    hitEffectAsset: hitEffectAsset ?? undefined,
    droneAsset: droneAsset ?? undefined,
    sentinelAsset: sentinelAsset ?? undefined,
    debug: { testChunk },
    onReturn: () => {
      // 返回时：★ 行囊（弹药背包）保持原样——不转移祖宗，随存档原样落盘
      //   → 遗物"返回/天数"时机管线 → 推进天数 → ShipMode（内部 SaveSystem.save）
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
      enterShipMode(scene, camera, renderer);
    },
  };
  world.enter(ctx);
  currentMode = world;
  currentEnv = 'world';
  renderManager.setEnvironment('world');
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