import type { FluidSolverConfig, InjectionConfig } from './FluidSolver';

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
    hMultiplier: sc.hMultiplier ?? 0.1,
    sMultiplier: sc.sMultiplier ?? 0.1,
    lMultiplier: sc.lMultiplier ?? 0.1,
    aMultiplier: sc.aMultiplier ?? 0.1,
    baselineDensity: sc.baselineDensity ?? 1.0,
    decayRate: sc.decayRate ?? 0,
  };

  const resolution = json.resolution
    ? (typeof json.resolution === 'number'
        ? { w: json.resolution, h: json.resolution }
        : { w: Number(json.resolution.w), h: Number(json.resolution.h) })
    : { ...fallbackRes };

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
    gravity: gf.gravity || { x: 0, y: 0 },
    velocityScale: gf.velocityScale ?? 1,
    maxVelocity: gf.maxVelocity ?? 5000,
    colorBoundaryMode: gf.colorBoundaryMode || 'clamp',
    resolution,
    continuousSources: (json.continuousSources || []).map(normalizeInjectionSource),
  };
}

/**
 * 将内部 FluidSolverConfig 序列化为外部 JSON 格式（与 fluid-player.html 导出一致），
 * 便于在 fluid-player.html 与主编辑器之间互换配置。
 * 不导出 obstacle（主编辑器用区域边界，由 useFluidSolver 实时光栅化）。
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
    })),
  };
}

/** 默认运行时状态（导入配置时初始化） */
export function defaultFluidRuntime() {
  return {
    isPlaying: false,
    speed: 1,
    currentTime: 0,
    viewMode: 'composite' as const,
    frameCount: 0,
    _needsReset: true,
  };
}
