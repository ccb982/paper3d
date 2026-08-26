export interface Point {
  x: number;
  y: number;
}

export interface MaskEffectDistortion {
  id: string;
  type: 'wave' | 'turbulent' | 'twirl';
  enabled: boolean;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  direction?: 'normal' | 'tangent' | 'xy';
  center?: { x: number; y: number };
  falloffRadius?: number;
  seed?: number;
  octaves?: number;
}

export interface MaskEffect {
  enabled: boolean;
  transform: {
    position: { x: number; y: number };
    anchor: { x: number; y: number } | null;
    rotation: number;
    scale: { x: number; y: number };
  };
  distortions: MaskEffectDistortion[];
}

export interface SerializedRegionEntity {
  id: number;
  layerId: string;
  boundary: Point[][];
  transform: {
    position: { x: number; y: number };
    rotation: number;
    scale: { x: number; y: number };
    anchor: { x: number; y: number } | null;
  };
  maskEffect: MaskEffect | null;
  worldBbox: { x: number; y: number; w: number; h: number } | null;
  fixedVertices: number[];
}

export interface PhysicsConfig {
  enableAdvection?: boolean;
  enablePressure?: boolean;
  pressureIterations?: number;
  pressureOmega?: number;
  pressureBoundaryMode?: 'dirichlet' | 'neumann';
  enableWarmStart?: boolean;
  advectionMode?: 'vector' | 'scalar';
  combineMode?: 'add' | 'sub';
  channels?: { r?: boolean; g?: boolean; b?: boolean; a?: boolean; h?: boolean; s?: boolean; l?: boolean };
  scalarConfig?: {
    hMultiplier?: number;
    sMultiplier?: number;
    lMultiplier?: number;
    aMultiplier?: number;
    baselineDensity?: number;
    decayRate?: number;
  };
  levelSetConfig?: {
    enabled?: boolean;
    reinitIterations?: number;
    surfaceTension?: number;
    smoothingRadius?: number;
  };
  gravity?: { x: number; y: number };
  velocityScale?: number;
  maxVelocity?: number;
  colorBoundaryMode?: 'clamp' | 'repeat' | 'zero';
  resolution?: { w: number; h: number };
  continuousSources?: Array<{
    enabled?: boolean;
    position?: { x: number; y: number };
    radius?: number;
    velocity?: { x: number; y: number };
    color?: number[];
    density?: number;
    rate?: number;
    wave?: { enabled: boolean; amplitude?: number; frequency?: number; speed?: number };
    waypoints?: Array<{ x: number; y: number }>;
  }>;
  obstacle?: { width: number; height: number; data: string };
  /** ★ 色块交界自动加墙（默认 false）：无 obstacle 位图时按帧 regionIdTex
   *  自主生成大色块边界墙（游戏端移植 editor/regionWallMask.ts 算法） */
  regionWalls?: boolean;
  /** 大色块面积阈值（占全帧比例，默认 0.004） */
  regionWallsMinAreaRatio?: number;
}

export interface PerFrameData {
  name: string;
  layerId: string;
  displayId: number;
  hasTexture: boolean;
  textureIndex: number;
  boundRegionId: number | null;
  regionEntities: SerializedRegionEntity[];
  physics: PhysicsConfig | null;
  /** 底图变换 + 呼吸式扭曲（播放器渲染用） */
  textureOffset?: { x: number; y: number };
  textureScale?: { x: number; y: number };
  textureRotation?: number;
  distortEnabled?: boolean;
  distortAmplitude?: number;
  distortFrequency?: number;
  distortSpeed?: number;
  distortRotation?: number;
}

export interface Manifest {
  version: number;
  exportType: string;
  generatedAt: string;
  totalFrames: number;
  textureFrameCount: number;
  textureFile: string;
  ftxByteLength: number;
  ftxUncompressedByteLength: number;
  predictionEnabled: boolean;
  frameOrder: string[];
  paletteCount: number;
  annotationCount: number;
  annotationFile: string | null;
  /** 击中特效（矢量动画）定义文件（素材包内 hit_effects.json；无则 null） */
  hitEffectFile: string | null;
  hashes: Record<string, string>;
}

// ============ 击中特效（矢量动画）============

/** 击中特效形状填充（纯色） */
export interface HitEffectSolidFill {
  h: number; s: number; l: number; a: number;
}

/** 击中特效形状填充（FTX 帧纹理嵌入） */
export interface HitEffectFtxFill {
  baseHslBase64: string;
  residualBase64: string;
  width: number;
  height: number;
}

/** 击中特效外置残差层 */
export interface HitEffectResidualLayer {
  dataBase64: string;
  width: number;
  height: number;
}

/** 击中特效形状（与编辑器导出一致） */
export interface HitEffectShapeExport {
  name: string;
  outline: Point[];
  fillMode: 'solid' | 'ftx';
  solid: HitEffectSolidFill | null;
  ftx: HitEffectFtxFill | null;
  residualLayer: HitEffectResidualLayer | null;
  params: {
    distortion: { amplitude: number; frequency: number; randomRange: number };
    rotation: { min: number; max: number };
    expand: { xMin: number; xMax: number; yMin: number; yMax: number; duration: number; easing: 'linear' | 'easeOut' };
    spinWhileExpand: boolean;
    spinSpeed: number;
  };
}

export interface HitEffectsFile {
  version: number;
  type: string;
  shapes: HitEffectShapeExport[];
}

export interface PureAnnotationExport {
  id: string;
  layerId: string;
  layerName: string;
  displayId: number;
  text: string;
  color: string;
  regionId: string | number;
  polygon: Point[][];
  maskEffect: MaskEffect | null;
}

export interface AnnotationsFile {
  version: number;
  total: number;
  annotations: PureAnnotationExport[];
}

export interface FrameTextureData {
  name: string;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
  regionIdTex: Uint8Array;
  deltaPacked: Uint16Array;
  blockFlags: bigint;
}

export interface PaletteColor {
  h: number;
  s: number;
  l: number;
}
