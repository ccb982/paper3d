import { defaultFluidConfig, type FluidSolverConfig, type InjectionConfig } from './FluidSolver';

// ============================================================
// 素材包 physics 字段 → FluidSolverConfig 解析
// ============================================================
//
// 素材包 per_frame_data.physics 存储主编辑器内部扁平 FluidSolverConfig，
// 兼容两种格式：
//   1. 内部扁平格式（enableAdvection / channels / continuousSources…）
//   2. 外部 JSON 格式（coreSwitches / advectionAndComposite / globalForce…）
//
// 本文件为 fluidConfigIO 的播放器精简版（无 base64/导入映射逻辑）。

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  return base64ToUint8(b64);
}

/** 规范化单个注入源，补全缺省字段。 */
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

function num(v: any, d: number): number {
  return (v !== undefined && v !== null && isFinite(Number(v)) ? Number(v) : d);
}
function bool(v: any, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

/** 解析内部扁平 FluidSolverConfig（素材包 physics 字段）。 */
export function parsePhysicsConfig(raw: any, fallbackRes: { w: number; h: number }): FluidSolverConfig {
  const ch = raw?.channels ?? {};
  const sc = raw?.scalarConfig ?? {};
  const ls = raw?.levelSetConfig ?? {};
  const srcs = Array.isArray(raw?.continuousSources) ? raw.continuousSources : [];

  return {
    resolution: raw?.resolution
      ? { w: num(raw.resolution.w, fallbackRes.w), h: num(raw.resolution.h, fallbackRes.h) }
      : { ...fallbackRes },
    channels: {
      r: ch.r !== undefined ? bool(ch.r, true) : bool(ch.h, true),
      g: ch.g !== undefined ? bool(ch.g, true) : bool(ch.s, true),
      b: ch.b !== undefined ? bool(ch.b, true) : bool(ch.l, true),
      a: bool(ch.a, true),
    },
    enableAdvection: bool(raw?.enableAdvection, true),
    enablePressure: bool(raw?.enablePressure, true),
    pressureIterations: Math.round(num(raw?.pressureIterations, 20)),
    pressureOmega: num(raw?.pressureOmega, 1.7),
    pressureBoundaryMode: raw?.pressureBoundaryMode === 'neumann' ? 'neumann' : 'dirichlet',
    enableWarmStart: bool(raw?.enableWarmStart, true),
    gravity: { x: num(raw?.gravity?.x, 0), y: num(raw?.gravity?.y, 0) },
    velocityScale: num(raw?.velocityScale, 1),
    maxVelocity: num(raw?.maxVelocity, 5000),
    viscosity: num(raw?.viscosity, 0),
    colorBoundaryMode: raw?.colorBoundaryMode === 'repeat' || raw?.colorBoundaryMode === 'zero'
      ? raw.colorBoundaryMode : 'clamp',
    advectionMode: raw?.advectionMode === 'scalar' ? 'scalar' : 'vector',
    combineMode: raw?.combineMode === 'sub' ? 'sub' : 'add',
    scalarConfig: {
      hMultiplier: num(sc.hMultiplier, 1),
      sMultiplier: num(sc.sMultiplier, 1),
      lMultiplier: num(sc.lMultiplier, 1),
      aMultiplier: num(sc.aMultiplier, 1),
      baselineDensity: num(sc.baselineDensity, 1.0),
      decayRate: num(sc.decayRate, 0),
    },
    levelSetConfig: {
      enabled: bool(ls.enabled, false),
      reinitIterations: Math.round(num(ls.reinitIterations, 2)),
      surfaceTension: num(ls.surfaceTension, 10000),
      smoothingRadius: num(ls.smoothingRadius, 2),
      reinitInterval: Math.round(num(ls.reinitInterval, 10)),
      narrowBandWidth: num(ls.narrowBandWidth, 5),
      constrainLiquid: bool(ls.constrainLiquid, false),
      outwardDamping: num(ls.outwardDamping, 0),
      clampAirPhi: bool(ls.clampAirPhi, true),
      maxAirPhi: num(ls.maxAirPhi, 0),
      compensateWaterPhi: bool(ls.compensateWaterPhi, true),
      waterCompensationRate: num(ls.waterCompensationRate, 0.1),
    },
    continuousSources: srcs.map(normalizeInjectionSource),
  };
}

/** 完整配置合并（缺省字段用 defaultFluidConfig 补齐）。 */
export function buildFullConfig(raw: any, fallbackRes: { w: number; h: number }): FluidSolverConfig {
  const parsed = parsePhysicsConfig(raw, fallbackRes);
  return {
    ...defaultFluidConfig,
    ...parsed,
    resolution: { ...parsed.resolution },
    scalarConfig: { ...defaultFluidConfig.scalarConfig, ...parsed.scalarConfig },
    levelSetConfig: { ...defaultFluidConfig.levelSetConfig, ...parsed.levelSetConfig },
  };
}
