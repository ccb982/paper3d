import type { FluidSolverConfig, InjectionConfig } from './FluidSolver';
import { base64ToUint8, uint8ToBase64 } from '../core/ftxCore';

// ============================================================
// 流体配置 JSON 导入/导出（与 fluid-player.html 同格式）
// ============================================================
//
// 独立成文件：只依赖 FluidSolver 类型，不引入 colorCompressor/THREE，
// 避免与 useAppStore 形成循环依赖（useAppStore ↔ colorCompressor 已有环）。
//
// JSON 外部格式（fluid-player.html 的 loadConfig/parseConfig）：
//   {
//     coreSwitches:        { enableAdvection, enablePressure, pressureIterations,
//                            pressureOmega, pressureBoundaryMode, enableWarmStart },
//     advectionAndComposite: { advectionMode, combineMode,
//                              channels: {h,s,l,a} 或 {r,g,b,a},
//                              scalarConfig: {hMul,sMul,lMul,aMul,baseline,decay} },
//     globalForce:         { gravity:{x,y}, velocityScale, maxVelocity, colorBoundaryMode },
//     resolution:          {w,h} 或 number,
//     continuousSources:   [...],
//     obstacle:            { width, height, data: base64 }   ← 主编辑器忽略，用区域边界
//   }
//
// 内部 FluidSolverConfig 为扁平结构，channels 用 {r,g,b,a}（物理 RGBA = 逻辑 HSLA）。

/**
 * 规范化单个注入源，补全缺省字段。
 */
export function normalizeInjectionSource(s: any): InjectionConfig {
  const pos = s.position || { x: 0.5, y: 0.5 };
  const vel = s.velocity || { x: 0, y: 0 };
  return {
    enabled: s.enabled ?? true,
    position: { x: Number(pos.x) ?? 0.5, y: Number(pos.y) ?? 0.5 },
    radius: s.radius ?? 0.08,
    velocity: { x: Number(vel.x) ?? 0, y: Number(vel.y) ?? 0 },
    color: Array.isArray(s.color) ? s.color.map(Number) : undefined,
    density: s.density !== undefined ? Number(s.density) : undefined,
    rate: s.rate !== undefined ? Number(s.rate) : 1.0,
    wave: s.wave
      ? { enabled: !!s.wave.enabled, amplitude: Number(s.wave.amplitude) || 0,
          frequency: Number(s.wave.frequency) || 0, phase: s.wave.phase !== undefined ? Number(s.wave.phase) : 0 }
      : undefined,
    waypoints: Array.isArray(s.waypoints) ? s.waypoints.map((w: any) => ({ x: Number(w.x), y: Number(w.y) })) : undefined,
    waypointMode: s.waypointMode || 'forward',
    waypointSpeed: s.waypointSpeed !== undefined ? Number(s.waypointSpeed) : 1.0,
    // ★ 间歇注入（脉冲）：注入 onDuration 秒 → 暂停 offDuration 秒 → 循环
    intermittent: s.intermittent
      ? {
          onDuration: Math.max(0, Number(s.intermittent.onDuration) || 0),
          offDuration: Math.max(0, Number(s.intermittent.offDuration) || 0),
        }
      : undefined,
  };
}

/**
 * 将外部 JSON（fluid-player.html 格式）解析为内部 FluidSolverConfig。
 * 与 fluid-player.html parseConfig 完全一致的字段映射。
 *
 * @param json        外部 JSON 对象
 * @param fallbackRes 当 JSON 无 resolution 时使用的回退分辨率（应取绑定纹理尺寸）
 */
export function parseImportedFluidConfig(
  json: any,
  fallbackRes: { w: number; h: number },
): FluidSolverConfig {
  // ★ 兼容内部扁平格式（.phys.json 公共物理参数库 / 素材包 physics 字段）：
  //   这类 JSON 无 coreSwitches 五块结构，字段直接在顶层
  //   （enableAdvection/gravity/continuousSources/...）。此前只读五块格式 →
  //   扁平格式导入时除 continuousSources 外全部字段丢失（gravity/levelSet/
  //   advectionMode 全回默认值），特效与编辑器里调好的完全不同。
  if (isInternalFluidConfig(json)) {
    return parseInternalFluidConfig(json, fallbackRes);
  }

  const cs = json.coreSwitches || {};
  const ac = json.advectionAndComposite || {};
  const gf = json.globalForce || {};

  // channels: 兼容 {h,s,l,a}（JSON 导出）与 {r,g,b,a}（内部直传）
  const _ch = ac.channels || { h: true, s: true, l: true, a: true };
  const channels = (_ch.r !== undefined)
    ? { r: !!_ch.r, g: !!_ch.g, b: !!_ch.b, a: !!_ch.a }
    : { r: !!_ch.h, g: !!_ch.s, b: !!_ch.l, a: !!_ch.a };

  const sc = ac.scalarConfig || {};
  const scalarConfig = {
    hMultiplier: sc.hMultiplier ?? 1,
    sMultiplier: sc.sMultiplier ?? 1,
    lMultiplier: sc.lMultiplier ?? 1,
    aMultiplier: sc.aMultiplier ?? 1,
    baselineDensity: sc.baselineDensity ?? 1.0,
    decayRate: sc.decayRate ?? 0,
  };

  const resolution = json.resolution
    ? (typeof json.resolution === 'number'
        ? { w: json.resolution, h: json.resolution }
        : { w: Number(json.resolution.w), h: Number(json.resolution.h) })
    : { ...fallbackRes };

  // ★ Level Set 模块配置（与 fluid-player.html 互操作）
  //   enabled：主绘画页面命名；enableLevelSet：流体编辑器 buildRecipe 命名 → 两者都读（双向兼容）
  const ls = json.levelSet || {};
  const levelSetConfig = {
    enabled: !!(ls.enabled ?? ls.enableLevelSet),
    reinitIterations: ls.reinitIterations ?? 2,
    surfaceTension: ls.surfaceTension ?? 0,
    smoothingRadius: ls.smoothingRadius ?? 2,
  };

  // ★ 墙体掩码（多帧物理配置导出携带；主绘画页面优先于区域边界）
  const obstacle = (json.obstacle && typeof json.obstacle.data === 'string')
    ? {
        width: Number(json.obstacle.width) || 0,
        height: Number(json.obstacle.height) || 0,
        data: json.obstacle.data,
      }
    : undefined;

  return {
    enableAdvection: cs.enableAdvection ?? true,
    enablePressure: cs.enablePressure ?? true,
    pressureIterations: cs.pressureIterations ?? 20,
    pressureOmega: cs.pressureOmega ?? 1.7,
    pressureBoundaryMode: cs.pressureBoundaryMode ?? 'dirichlet',
    enableWarmStart: cs.enableWarmStart ?? true,
    advectionMode: ac.advectionMode || 'vector',
    combineMode: ac.combineMode || 'add',
    channels,
    scalarConfig,
    levelSetConfig,
    gravity: gf.gravity || { x: 0, y: 0 },
    velocityScale: gf.velocityScale ?? 1,
    maxVelocity: gf.maxVelocity ?? 5000,
    colorBoundaryMode: gf.colorBoundaryMode || 'clamp',
    resolution,
    continuousSources: (json.continuousSources || []).map(normalizeInjectionSource),
    ...(obstacle ? { obstacle } : {}),
  };
}

// ============================================================
// 内部 FluidSolverConfig 格式（素材包 physics 字段 / 编辑器 store 直存格式）
// 导入端同时兼容：外部 JSON（fluid-player 格式，coreSwitches/…）与内部扁平格式。
// ============================================================

const INTERNAL_DEFAULTS: FluidSolverConfig = {
  resolution: { w: 512, h: 512 },
  channels: { r: true, g: true, b: true, a: true },
  enableAdvection: true,
  enablePressure: true,
  pressureIterations: 20,
  pressureOmega: 1.7,
  pressureBoundaryMode: 'dirichlet',
  enableWarmStart: true,
  gravity: { x: 0, y: 0 },
  velocityScale: 1,
  maxVelocity: 5000,
  colorBoundaryMode: 'clamp',
  advectionMode: 'vector',
  combineMode: 'add',
  scalarConfig: { hMultiplier: 1, sMultiplier: 1, lMultiplier: 1, aMultiplier: 1, baselineDensity: 1.0, decayRate: 0 },
  levelSetConfig: { enabled: false, reinitIterations: 2, surfaceTension: 0, smoothingRadius: 2 },
  continuousSources: [],
};

/**
 * 将注入源/路径点从「全帧归一化坐标」（流体编辑器坐标系）转换到
 * 「bbox 裁剪后归一化坐标」（主绘画页面解算器坐标系）。
 *
 * 背景：流体编辑器在全帧 texSize×texSize 画布上排版注入源（recipe.resolution
 * = cfg.resolution = sourceResolution），而主绘画页面解算器作用于 bbox 裁剪纹理
 * （boundResidualTexture = bbox 尺寸，如 597×974）。两者都使用归一化 (0~1)、
 * Y 向下为正（flipY=false，row 0 = 顶部），因此无需翻转 Y；但归一化基准不同：
 *   编辑器 pos=(0.5, 0.5) → 全帧像素 (0.5·S, 0.5·S) → bbox 内 (px−bbox.x, py−bbox.y)
 *   → 主页面局部 (… / bbox.w, … / bbox.h)。
 *
 * 判定规则：仅当 JSON 声明的 resolution 与 frame.sourceResolution 一致
 * （编辑器全帧导出）时才转换；若 JSON resolution 已等于 bbox 尺寸
 * （主绘画页面再导出），直接透传，避免二次偏移。
 *
 * @param sources 已解析的注入源列表
 * @param frame   帧数据（rawBbox + sourceResolution 用于坐标映射）
 * @param jsonRes JSON 中声明的分辨率（决定坐标空间）
 */
export function transformSourcesToBboxLocal(
  sources: InjectionConfig[],
  frame: {
    rawBbox: { x: number; y: number; w: number; h: number } | null;
    sourceResolution: number;
  },
  jsonRes: { w: number; h: number } | undefined,
): InjectionConfig[] {
  if (!frame.rawBbox || !(frame.sourceResolution > 0)) return sources;
  const bbox = frame.rawBbox;

  // 坐标系判定：仅当 JSON 分辨率 = 源纹理分辨率（编辑器全帧导出）时转换
  const isFullFrame = !!jsonRes
    && Math.abs(jsonRes.w - frame.sourceResolution) < 1
    && Math.abs(jsonRes.h - frame.sourceResolution) < 1;
  if (!isFullFrame) return sources;

  const toLocal = (p: { x: number; y: number }) => {
    const px = p.x * frame.sourceResolution;
    const py = p.y * frame.sourceResolution;
    return {
      x: (px - bbox.x) / bbox.w,
      y: (py - bbox.y) / bbox.h,
    };
  };

  return sources.map(s => ({
    ...s,
    position: toLocal(s.position),
    ...(s.waypoints ? { waypoints: s.waypoints.map(toLocal) } : {}),
  }));
}

/**
 * 将注入源位置从「bbox 局部归一化坐标」按比例映射进「区域实体」世界包围盒内。
 *
 * 主绘画页面的流体只在区域实体多边形内流动（区域外 = 墙，注入被屏蔽）。
 * 若源位置落在区域外，注入会被墙体掩码完全跳过 → 视觉上"看不到注入"。
 * 此映射将源的相对位置（bbox 内的 x%/y%）等比应用到区域实体的 worldBbox 上，
 * 保证源一定落在区域内。
 *
 * 坐标链：
 *   - 输入 pos：bbox 局部归一化 (0~1)，Y 向下为正（编辑器/纹理约定）
 *   - regionBbox：区域实体 worldBbox，world 归一化 (0~1)，Y 向上为正（y=0 底部）
 *   - 输出：解算器注入 UV（world 归一化），Y 向下为正（row 0 = world 顶部，与 colorGrid 对齐）
 *
 * 映射公式：
 *   worldX = bbox.x + pos.x * bbox.w
 *   worldY = bbox.y + (1 − pos.y) * bbox.h          （Y-down → Y-up 翻转）
 *   uv = (worldX, 1 − worldY)
 *
 * @param sources     已解析的注入源（坐标应在 bbox 局部空间）
 * @param regionBbox  区域实体 worldBbox（world 归一化，Y-up）
 */
export function mapSourcesIntoRegion(
  sources: InjectionConfig[],
  regionBbox: { x: number; y: number; w: number; h: number },
): InjectionConfig[] {
  const toUv = (p: { x: number; y: number }) => ({
    x: regionBbox.x + p.x * regionBbox.w,
    y: 1 - (regionBbox.y + (1 - p.y) * regionBbox.h),
  });

  return sources.map(s => ({
    ...s,
    position: toUv(s.position),
    ...(s.waypoints ? { waypoints: s.waypoints.map(toUv) } : {}),
  }));
}

/**
 * 主绘画页面保存的注入源坐标空间标记。
 *
 * 用于区分 fluidConfig.continuousSources 中 position 的坐标基准，
 * 避免「导入时」与「绑定时」重复映射，以及主页面再导入被二次映射。
 *
 * - 'bbox-local'：bbox 局部归一化（= 解算器网格 UV，未做区域映射）
 * - 'region'：已按区域实体 worldBbox 映射为 world UV；记录 regionId 与
 *   当时使用的 bbox 快照（用于换区域时逆映射回 bbox 局部）
 * - null：坐标空间未知（如主页面再导出的 JSON 直接导入），不自动重映射
 */
export type FluidSourceSpace =
  | { kind: 'bbox-local' }
  | { kind: 'region'; regionId: number; bbox: { x: number; y: number; w: number; h: number } }
  | null;

/**
 * 将「区域 world UV」坐标逆映射回「bbox 局部归一化」坐标。
 * 与 mapSourcesIntoRegion 互逆（需传入当初映射时使用的 regionBbox 快照）。
 */
export function inverseMapSourcesFromRegion(
  sources: InjectionConfig[],
  regionBbox: { x: number; y: number; w: number; h: number },
): InjectionConfig[] {
  const toLocal = (p: { x: number; y: number }) => ({
    x: (p.x - regionBbox.x) / regionBbox.w,
    y: 1 - ((1 - p.y) - regionBbox.y) / regionBbox.h,
  });

  return sources.map(s => ({
    ...s,
    position: toLocal(s.position),
    ...(s.waypoints ? { waypoints: s.waypoints.map(toLocal) } : {}),
  }));
}

/**
 * 把已保存的注入源坐标重映射进「新绑定的区域」。
 *
 * 覆盖两类情况：
 * - 空间为 'bbox-local'（先导入后绑定）：直接映射进新区域。
 * - 空间为 'region' 且 regionId ≠ 新区域（换区域）：先用旧区域 bbox 快照
 *   逆映射回 bbox 局部，再映射进新区域。
 *
 * 空间为同一区域时原样返回（幂等）。
 *
 * @param space 当前保存坐标的空间（非 null；null=未知空间不处理）
 */
export function remapSourcesForRegion(
  sources: InjectionConfig[],
  space: Exclude<FluidSourceSpace, null>,
  newRegionId: number,
  newRegionBbox: { x: number; y: number; w: number; h: number },
): { sources: InjectionConfig[]; space: { kind: 'region'; regionId: number; bbox: { x: number; y: number; w: number; h: number } } } {
  if (space.kind === 'region' && space.regionId === newRegionId) {
    return { sources, space: { ...space } };
  }
  const bboxLocal = space.kind === 'region'
    ? inverseMapSourcesFromRegion(sources, space.bbox)
    : sources;
  return {
    sources: mapSourcesIntoRegion(bboxLocal, newRegionBbox),
    space: { kind: 'region', regionId: newRegionId, bbox: { ...newRegionBbox } },
  };
}

/**
 * 主绘画页面导入时确保注入源「可见」。
 *
 * 两类不可见情况，都改写为可见配置（转换结果随导入配置一起保存）：
 *
 * 1. vector 模式：流体编辑器用「速度模式」创建的持续源导出为 rate=0、color=[0,0,0,0]，
 *    它只在编辑器里推动画布上已有的颜料。而主绘画页面绑定区域后
 *    boundResidualTexture 为空（中性残差，全 128 = delta 0），速度源推的是空场，
 *    即使区域画面有内容（那来自静态 base）也看不到任何变化。
 *    → 改写为带可见颜色（天蓝）与 rate 的水源：颜色直接注入残差场。
 *    判定：rate <= 0 且 color 全零（或缺失）。
 *
 * 2. scalar 模式：编辑器把 density=1.0（满浓度）当注入约定（densityGrid 初始化为 0），
 *    但主页面 densityGrid 初始化为 baseline=1.0（FluidSolver.ts），
 *    于是 density=1.0 == baseline → factor = density/baseline − 1 = 0 → 完全不可见。
 *    → 改写 density 为低于 baseline 的可见浓度（0.8，与主页面手动源一致）。
 *    判定：density 缺失，或 density == baselineDensity（factor=0 中性）。
 */
export function ensureVisibleSources(
  sources: InjectionConfig[],
  advectionMode?: string,
  baselineDensity?: number,
): InjectionConfig[] {
  const baseline = typeof baselineDensity === 'number' && baselineDensity > 0 ? baselineDensity : 1.0;
  const isScalar = advectionMode === 'scalar';

  return sources.map(s => {
    if (isScalar) {
      const d = s.density;
      const isNeutral = d === undefined || Math.abs(d - baseline) < 1e-6;
      if (isNeutral) {
        return { ...s, density: 0.8 };
      }
      return s;
    }

    const hasRate = typeof s.rate === 'number' && s.rate > 0;
    const hasVisibleColor = Array.isArray(s.color) && s.color.some(v => Math.abs(v) > 0.001);
    if (hasRate || hasVisibleColor) return s;
    return {
      ...s,
      color: [0.0, 0.8, 1.0, 1.0],
      rate: 0.3,
    };
  });
}

/**
 * 将编辑器的「全帧墙体掩码」裁剪为「bbox 局部掩码」。
 *
 * 编辑器导出的 obstacle 掩码尺寸 = cfg.resolution = sourceResolution（全帧），
 * 而主绘画页面的解算器网格 = bbox 裁剪尺寸。若直接缩放（nearest-neighbor），
 * 墙体会被整体错位拉伸，可能把注入区域整片封死。
 *
 * 裁剪规则：mask 像素 (gx,gy) ∈ bbox → bbox 局部 (gx−bbox.x, gy−bbox.y)。
 * 与 sourceResolution 一致的掩码（编辑器全帧导出）才裁剪；否则透传原样
 * （主绘画页面再导出的掩码已经是 bbox 局部尺寸）。
 *
 * @param obstacle 解析后的障碍物配置（data 为 1 bit/像素 base64）
 * @param frame    帧数据（rawBbox + sourceResolution）
 * @returns 裁剪后的障碍物配置；无需裁剪时原样返回
 */
export function transformObstacleToBboxLocal(
  obstacle: { width: number; height: number; data: string },
  frame: {
    rawBbox: { x: number; y: number; w: number; h: number } | null;
    sourceResolution: number;
  },
): { width: number; height: number; data: string } | undefined {
  if (!frame.rawBbox || !(frame.sourceResolution > 0)) return obstacle;
  const bbox = frame.rawBbox;

  // 仅当掩码为全帧尺寸（= sourceResolution²）时裁剪；否则透传
  const isFullFrame = Math.abs(obstacle.width - frame.sourceResolution) < 1
    && Math.abs(obstacle.height - frame.sourceResolution) < 1;
  if (!isFullFrame) return obstacle;

  // 解码 1 bit/像素 → 逐像素位图
  let packed: Uint8Array;
  try {
    packed = base64ToUint8(obstacle.data);
  } catch {
    return obstacle;
  }
  const srcW = obstacle.width;
  const unpacked = new Uint8Array(srcW * obstacle.height);
  for (let i = 0; i < srcW * obstacle.height; i++) {
    if (packed[Math.floor(i / 8)] & (1 << (i % 8))) unpacked[i] = 1;
  }

  // 裁剪到 bbox
  const { w, h } = bbox;
  const cropped = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const gx0 = bbox.x;
    const gy0 = bbox.y + gy;
    if (gy0 < 0 || gy0 >= obstacle.height) continue;
    const srcRow = gy0 * srcW;
    const dstRow = gy * w;
    for (let lx = 0; lx < w; lx++) {
      const gx = gx0 + lx;
      if (gx < 0 || gx >= srcW) continue;
      cropped[dstRow + lx] = unpacked[srcRow + gx];
    }
  }

  // 重新打包为 1 bit/像素 base64
  const packedOut = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) {
    if (cropped[i]) packedOut[Math.floor(i / 8)] |= (1 << (i % 8));
  }

  return { width: w, height: h, data: uint8ToBase64(packedOut) };
}

/**
 * 检测 JSON 是否为内部 FluidSolverConfig 扁平格式（素材包 physics 字段 / .phys.json）。
 * 判定：顶层存在扁平格式特征字段（enableAdvection/enablePressure/gravity/velocityScale 任一），
 * 且无五块格式的 coreSwitches 标志。
 */
export function isInternalFluidConfig(json: any): boolean {
  return !!json && typeof json === 'object'
    && !json.coreSwitches && !json.advectionAndComposite && !json.globalForce
    && (typeof json.enableAdvection === 'boolean'
      || typeof json.enablePressure === 'boolean'
      || typeof json.gravity === 'object'
      || typeof json.velocityScale === 'number');
}

/**
 * 解析内部 FluidSolverConfig（素材包 physics）为完整配置。
 * 与 parseImportedFluidConfig 的区别：字段扁平直接，无需 coreSwitches/… 映射。
 */
export function parseInternalFluidConfig(
  raw: any,
  fallbackRes: { w: number; h: number },
): FluidSolverConfig {
  const num = (v: any, d: number) => (v !== undefined && v !== null && isFinite(Number(v)) ? Number(v) : d);
  const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d);

  const ch = raw.channels ?? {};
  const cfg: FluidSolverConfig = {
    ...INTERNAL_DEFAULTS,
    resolution: raw.resolution
      ? { w: num(raw.resolution.w, fallbackRes.w), h: num(raw.resolution.h, fallbackRes.h) }
      : { ...fallbackRes },
    channels: {
      r: ch.r !== undefined ? bool(ch.r, true) : bool(ch.h, true),
      g: ch.g !== undefined ? bool(ch.g, true) : bool(ch.s, true),
      b: ch.b !== undefined ? bool(ch.b, true) : bool(ch.l, true),
      a: bool(ch.a, true),
    },
    enableAdvection: bool(raw.enableAdvection, true),
    enablePressure: bool(raw.enablePressure, true),
    pressureIterations: Math.round(num(raw.pressureIterations, 20)),
    pressureOmega: num(raw.pressureOmega, 1.7),
    pressureBoundaryMode: raw.pressureBoundaryMode === 'neumann' ? 'neumann' : 'dirichlet',
    enableWarmStart: bool(raw.enableWarmStart, true),
    gravity: { x: num(raw.gravity?.x, 0), y: num(raw.gravity?.y, 0) },
    velocityScale: num(raw.velocityScale, 1),
    maxVelocity: num(raw.maxVelocity, 5000),
    colorBoundaryMode: raw.colorBoundaryMode === 'repeat' || raw.colorBoundaryMode === 'zero'
      ? raw.colorBoundaryMode : 'clamp',
    advectionMode: raw.advectionMode === 'scalar' ? 'scalar' : 'vector',
    combineMode: raw.combineMode === 'sub' ? 'sub' : 'add',
    scalarConfig: {
      hMultiplier: num(raw.scalarConfig?.hMultiplier, 1),
      sMultiplier: num(raw.scalarConfig?.sMultiplier, 1),
      lMultiplier: num(raw.scalarConfig?.lMultiplier, 1),
      aMultiplier: num(raw.scalarConfig?.aMultiplier, 1),
      baselineDensity: num(raw.scalarConfig?.baselineDensity, 1.0),
      decayRate: num(raw.scalarConfig?.decayRate, 0),
    },
    levelSetConfig: {
      enabled: bool(raw.levelSetConfig?.enabled, false),
      reinitIterations: Math.round(num(raw.levelSetConfig?.reinitIterations, 2)),
      surfaceTension: num(raw.levelSetConfig?.surfaceTension, 0),
      smoothingRadius: num(raw.levelSetConfig?.smoothingRadius, 2),
    },
    continuousSources: (Array.isArray(raw.continuousSources) ? raw.continuousSources : [])
      .map(normalizeInjectionSource),
  };

  if (raw.obstacle && typeof raw.obstacle?.data === 'string') {
    cfg.obstacle = {
      width: num(raw.obstacle.width, 0),
      height: num(raw.obstacle.height, 0),
      data: raw.obstacle.data,
    };
  }

  return cfg;
}

/**
 * 将内部 FluidSolverConfig 序列化为外部 JSON 格式（与 fluid-player.html 导出一致），
 * 便于在 fluid-player.html 与主编辑器之间互换配置。
 * 若配置携带 obstacle（墙体掩码），一并序列化（1 bit/像素 base64）。
 */
export function serializeFluidConfigToJSON(config: FluidSolverConfig): any {
  return {
    coreSwitches: {
      enableAdvection: config.enableAdvection,
      enablePressure: config.enablePressure,
      pressureIterations: config.pressureIterations,
      pressureOmega: config.pressureOmega,
      pressureBoundaryMode: config.pressureBoundaryMode,
      enableWarmStart: config.enableWarmStart,
    },
    advectionAndComposite: {
      advectionMode: config.advectionMode,
      combineMode: config.combineMode,
      // 导出为 {h,s,l,a}（逻辑 HSLA）约定
      channels: { h: config.channels.r, s: config.channels.g, l: config.channels.b, a: config.channels.a },
      scalarConfig: { ...config.scalarConfig },
    },
    globalForce: {
      gravity: { ...config.gravity },
      velocityScale: config.velocityScale,
      maxVelocity: config.maxVelocity,
      colorBoundaryMode: config.colorBoundaryMode,
    },
    resolution: { w: config.resolution.w, h: config.resolution.h },
    // ★ Level Set 模块配置
    levelSet: {
      // enabled：主绘画页面命名；enableLevelSet：流体编辑器 buildRecipe 命名 → 两者都导出（双向兼容）
      enabled: config.levelSetConfig?.enabled ?? false,
      enableLevelSet: config.levelSetConfig?.enabled ?? false,
      reinitIterations: config.levelSetConfig?.reinitIterations ?? 2,
      surfaceTension: config.levelSetConfig?.surfaceTension ?? 0,
      smoothingRadius: config.levelSetConfig?.smoothingRadius ?? 2,
    },
    continuousSources: config.continuousSources.map(s => ({
      enabled: s.enabled,
      position: { ...s.position },
      radius: s.radius,
      velocity: { ...s.velocity },
      ...(s.color ? { color: [...s.color] } : {}),
      ...(s.density !== undefined ? { density: s.density } : {}),
      ...(s.rate !== undefined ? { rate: s.rate } : {}),
      ...(s.wave ? { wave: { ...s.wave } } : {}),
      ...(s.waypoints ? { waypoints: s.waypoints.map(w => ({ ...w })) } : {}),
      waypointMode: s.waypointMode,
      waypointSpeed: s.waypointSpeed,
      ...(s.intermittent ? { intermittent: { ...s.intermittent } } : {}),
    })),
    // ★ 墙体掩码（1 bit/像素 base64），供主绘画页面优先于区域边界光栅化
    ...(config.obstacle ? { obstacle: { ...config.obstacle } } : {}),
  };
}

/** 默认运行时状态（导入配置时初始化） */
export function defaultFluidRuntime() {
  return {
    isPlaying: false,
    speed: 1,
    viewMode: 'composite' as const,
    frameCount: 0,
    currentTime: 0,
    useWallMask: true,
    /** 手动注入开关：开启后点击画布会向流体解算器注入（位置/速度） */
    manualInject: false,
    _needsReset: true,
  };
}