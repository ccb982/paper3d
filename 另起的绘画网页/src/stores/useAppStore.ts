import { create } from 'zustand';
import * as THREE from 'three';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point, ToolType, Layer, PointAnnotation, RegionAnnotation, ColorBlock } from '../types';

import { computeRegionsExact, computeScanlineIntervals, computeGridRegions, BFS_WORLD_BOUNDS, type ScanlineCache } from '../utils/regionDetectionExact';
import { detectColorBlocks } from '../utils/colorBlockDetection';
import { extractPolygonsFromImageData, hexToRgb } from '../utils/paintBufferUtils';
import { isPointInPolygonWithHoles } from '../utils/regionDetection';
import { computeAllDashedClosedRegions } from '../utils/colorExtractionUtils';
import { hslToRgb, clusterAndGenerateTexturesV2 } from '../utils/colorCompressor';
import { RegionEntity } from '../core/RegionEntity';
import { parseImportedFluidConfig, serializeFluidConfigToJSON, defaultFluidRuntime } from '../fluid/fluidConfigIO';

export interface SharedBaseColor {
  id: number;
  h: number;
  s: number;
  l: number;
  frameIds: string[];
  area: number;
  tempFlag?: boolean;
}

interface PaletteColor {
  h: number;
  s: number;
  l: number;
  frameIds: Set<string>;
}

interface UnifiedFrameRef {
  id: string;
  type: 'skillGroup' | 'frameData';
  regionIdTex: Uint8Array | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

interface AppState {
  // 图片导入状态
  imageState: ImageImportState;
  setOriginalImage: (img: HTMLImageElement | null, src: string | null) => void;
  setSelectionRect: (rect: ImageImportState['selectionRect']) => void;
  clearImage: () => void;

  // 选区预览阶段状态
  isPreviewStage: boolean;
  setPreviewStage: (preview: boolean) => void;
  applySelectionToCanvas: () => void;

  // 坐标轴配置
  axis: AxisConfig;
  setAxis: (axis: Partial<AxisConfig>) => void;
  resetAxis: () => void;

  // 格子配置
  grid: GridConfig;
  setGrid: (grid: Partial<GridConfig>) => void;

  // 图层可见性
  layerVisibility: LayerVisibility;
  toggleLayer: (layer: keyof LayerVisibility) => void;

  // 分组管理
  groups: Group[];
  activeGroupId: string | null;
  addGroup: (name: string, color: string) => void;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, updates: Partial<Group>) => void;
  setActiveGroup: (id: string | null) => void;

  // 图层管理
  layers: Layer[];
  activeLayerId: string | null;
  addLayer: (name: string) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setActiveLayer: (id: string | null) => void;
  toggleLayerVisibility: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;

  // 形状管理
  shapes: Shape[];
  addShape: (shape: Shape) => void;
  removeShape: (id: string) => void;
  updateShape: (id: string, updates: Partial<Shape>) => void;
  clearShapes: () => void;

  // 鼠标位置
  mousePosition: Point | null;
  setMousePosition: (pos: Point | null) => void;

  // 选区状态
  isSelecting: boolean;
  selectionStart: Point | null;
  selectionEnd: Point | null;
  setSelection: (start: Point | null, end: Point | null) => void;
  setIsSelecting: (selecting: boolean) => void;

  // 视图缩放和偏移
  zoom: number;
  panOffset: Point;
  isPanMode: boolean;
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: Point) => void;
  setPanMode: (panMode: boolean) => void;
  resetView: () => void;
  
  // 画布尺寸
  canvasWidth: number;
  canvasHeight: number;
  setCanvasWidth: (width: number) => void;
  setCanvasHeight: (height: number) => void;

  // 当前工具
  currentTool: ToolType;
  setCurrentTool: (tool: ToolType) => void;

  // 颜色提取模式
  colorExtractMode: boolean;
  setColorExtractMode: (mode: boolean) => void;
  colorExtractTool: 'polygon' | 'bezier' | null;
  setColorExtractTool: (tool: 'polygon' | 'bezier' | null) => void;
  colorExtractPoints: Point[];
  setColorExtractPoints: (points: Point[]) => void;
  addColorExtractPoint: (point: Point) => void;
  clearColorExtractPoints: () => void;
  colorExtractPreviewPoint: Point | null;
  setColorExtractPreviewPoint: (point: Point | null) => void;
  colorExtractWaitingFor: 'start' | 'end' | 'control' | null;
  colorExtractRegionId: number | null;   // 当前正在绘制的曲线所在的区域 ID
  setColorExtractWaitingFor: (waiting: 'start' | 'end' | 'control' | null) => void;
  setColorExtractRegionId: (id: number | null) => void;
  // 已绘制的曲线列表（支持贝塞尔曲线和折线）
  colorExtractCurves: Array<{ type: 'bezier'; start: Point; end: Point; control: Point; shapeId?: string } | { type: 'polyline'; points: Point[]; shapeId?: string }>;
  addColorExtractCurve: (curve: { type: 'bezier'; start: Point; end: Point; control: Point; shapeId?: string } | { type: 'polyline'; points: Point[]; shapeId?: string }) => void;
  removeColorExtractCurve: (index: number) => void;
  clearColorExtractCurves: () => void;
  // 清空所有虚线并删除对应的 shapes（用于重新开始）
  clearColorExtractCurvesAndShapes: () => void;
  // 获取所有虚线形状的 ID 列表
  getDashedShapeIds: () => string[];
  // 颜色提取等待状态（等待用户点击实线闭合区域）
  colorExtractWaiting: boolean;
  setColorExtractWaiting: (waiting: boolean) => void;
  // 颜色提取橡皮模式
  colorExtractEraserMode: boolean;
  setColorExtractEraserMode: (mode: boolean) => void;
  // 折线模式最后一个点坐标（用于检测双击结束）
  lastPolygonPoint: Point | null;
  setLastPolygonPoint: (point: Point | null) => void;
  // 手动触发颜色提取的多边形（Toolbar → MainCanvas 通信）
  pendingExtractPolygon: Point[] | null;
  setPendingExtractPolygon: (polygon: Point[] | null) => void;
  // 次级颜色提取色块（从闭合曲线内部提取）
  extractedColorBlocks: Array<{
    id: number;
    avgColor: { r: number; g: number; b: number };
    pixels: Array<{ x: number; y: number }>;  // 世界坐标 0-1
  }>;
  clearExtractedColorBlocks: () => void;
  addExtractedColorBlock: (block: { id: number; avgColor: { r: number; g: number; b: number }; pixels: Array<{ x: number; y: number }> }) => void;
  setExtractedColorBlocks: (blocks: Array<{ id: number; avgColor: { r: number; g: number; b: number }; pixels: Array<{ x: number; y: number }> }>) => void;
  
  // 颜色提取调试数据（用于绘制BFS识别效果）
  colorExtractDebugData: {
    maskPixels: Array<{ x: number; y: number }>;  // 掩码内的像素
    blocks: Array<{
      id: number;
      color: string;
      pixels: Array<{ x: number; y: number }>;
    }>;
  } | null;
  setColorExtractDebugData: (data: { maskPixels: Array<{ x: number; y: number }>; blocks: Array<{ id: number; color: string; pixels: Array<{ x: number; y: number }> }> } | null) => void;

  // 点吸附配置
  snapRadius: number;
  setSnapRadius: (radius: number) => void;
  
  // 颜色提取调试模式（Ctrl+G切换）
  showColorExtractDebug: boolean;
  setShowColorExtractDebug: (show: boolean) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;

  // 线条粗细配置
  lineWidth: number;
  setLineWidth: (width: number) => void;

  // BFS 光栅化分辨率（越大越精细，但越慢；默认1000，范围200~3000）
  bfsResolution: number;
  setBfsResolution: (resolution: number) => void;

  // 点注释
  pointAnnotations: PointAnnotation[];
  addPointAnnotation: (annotation: Omit<PointAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updatePointAnnotation: (id: string, text: string) => void;
  removePointAnnotation: (id: string) => void;
  clearPointAnnotations: () => void;

  // 区域注释
  regionAnnotations: RegionAnnotation[];
  addRegionAnnotation: (annotation: Omit<RegionAnnotation, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateRegionAnnotation: (id: string, text: string) => void;
  updateRegionAnnotationWithRegionId: (id: string, text: string, regionId: string) => void;
  removeRegionAnnotation: (id: string) => void;
  clearRegionAnnotations: () => void;

  // GPU/CPU 切换模式（用于性能对比）
  forceCPUMode: boolean;
  setForceCPUMode: (force: boolean) => void;

  // 区域检测缓存
  regionPolygonsCache: Record<string, Point[][][]>;
  regionScanlineCache: Record<string, ScanlineCache>;
  refreshRegionCache: (layerId: string, options?: { clearPaintData?: boolean }) => void;

  // 色块区域检测缓存（独立存储，使用相同算法）
  colorBlockRegionsCache: Record<string, Point[][][]>;
  refreshColorBlockCache: (layerId: string) => void;

  // 虚线子区域缓存（带 ID）
  dashedSubRegionsCache: Record<string, Array<{
    id: number;
    solidRegionId: number;
    polygon: Point[][];
    pixelCount: number;
    centroid: Point;
  }>>;
  refreshDashedSubRegionsCache: (layerId: string) => void;

  // 区域色块图层缓存（静态纹理画布）
  regionLayerCanvas: HTMLCanvasElement | null;
  // 【新增】区域色块图层 GPU 纹理 - 用于后续流体解算
  regionLayerTextureGPU: THREE.DataTexture | null;

  /** 每个图层的像素绘制缓冲区 (512x512 RGBA) */
  paintBuffers: Record<string, ImageData | null>;

  /** 初始化图层的像素缓冲区 */
  initPaintBuffer: (layerId: string) => void;
  /** 更新指定图层的缓冲区（合并绘制） */
  updatePaintBuffer: (layerId: string, updater: (imageData: ImageData) => void) => void;
  /** 清除图层的缓冲区（全透明） */
  clearPaintBuffer: (layerId: string) => void;
  /** 从缓冲区中提取当前颜色的多边形并添加到 shapes，同时清除对应颜色的像素 */
  extractPolygonsFromPaintBuffer: (layerId: string, targetColor: string) => void;

  // 色块
  colorBlocks: ColorBlock[];
  nextColorBlockId: number;
  setColorBlocks: (blocks: ColorBlock[]) => void;
  updateColorBlocksForLayer: (layerId: string) => void;
  clearColorBlocksForLayer: (layerId: string) => void;

  // 按区域ID存储被涂色的像素坐标（去重）
  // key: regionId, value: Set<string> 存储 "x,y" 格式的像素坐标
  regionPixelsMap: Map<number, Set<string>>;
  addPixelToRegion: (regionId: number, pixelX: number, pixelY: number) => void;
  clearRegionPixels: () => void;

  // 区域ID纹理缓存 - 用于快速查询像素所属区域
  regionIdTexture: Map<string, Uint8Array>; // key: layerId, value: 512x512 Uint8Array
  generateRegionIdTexture: (layerId: string) => void;

  // 区域色块图层纹理缓存（静态烘焙）
  // key: layerId, value: ImageData
  regionLayerTexture: Record<string, ImageData | null>;
  /** 生成区域色块图层纹理（只使用虚线围成的区域） */
  generateRegionLayerTexture: (layerId: string) => void;

  // 【重构】区域实体列表（存储 ftx 压缩数据，按需生成 GPU 纹理）
  regionEntities: Record<string, RegionEntity[]>;
  /** 构建区域实体（从 paintBuffer 提取 ftx 数据） */
  refreshRegionEntities: (layerId: string) => void;
  /** 释放区域实体资源 */
  disposeRegionEntities: (layerId: string) => void;

  // 撤销历史（复合快照）
  historySnapshots: Array<{ 
    id: number;
    shapes: Shape[]; 
    pointAnnotations: PointAnnotation[]; 
    regionAnnotations: RegionAnnotation[]; 
    regionPixelsMap: Map<number, string[]>;
    paintBuffers: Record<string, { width: number; height: number; data: number[] }>;
    // 操作统计
    stats: {
      shapeCount: number;           // 线条总数
      shapeTypes: string[];        // 线条类型列表
      pointAnnotationCount: number; // 点注释数量
      regionAnnotationCount: number; // 区域注释数量
      paintedPixelCount: number;   // 绘画像素总数
    };
  }>;
  historyIndex: number;
  /** 标志：是否正在恢复历史（撤销/重做中），用于阻止循环保存 */
  isRestoringHistory: boolean;
  saveHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // 保存/加载
  saveToStorage: () => void;
  exportToJson: () => void;
  loadFromStorage: () => void;
  /** 触发画布重绘（用于蒙版特效参数修改后立即更新实时预览） */
  redrawTrigger: number;
  triggerCanvasRedraw: () => void;

  // 区域动画播放参数（CPU/GPU 同步）
  regionAnimationSpeed: number;
  setRegionAnimationSpeed: (speed: number) => void;
  regionAnimationTime: number;
  setRegionAnimationTime: (time: number) => void;

  // 顶点固定画笔模式（由蒙版面板控制）
  isVertexPinMode: boolean;
  setVertexPinMode: (mode: boolean) => void;
  vertexPinRadius: number;
  setVertexPinRadius: (radius: number) => void;
  isVertexPinEraserMode: boolean;
  setVertexPinEraserMode: (mode: boolean) => void;

  showRegionBorderWebGL: boolean;
  setShowRegionBorderWebGL: (show: boolean) => void;

  showRegionBorder2D: boolean;
  setShowRegionBorder2D: (show: boolean) => void;

  // 基础色编辑器状态
  baseColorEditorState: {
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
    baseColors: Array<{ h: number; s: number; l: number }>;
    regionIdTex: Uint8Array;
    bgImageData: ImageData | null;
  };
  setBaseColorEditorState: (state: Partial<{
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
    baseColors: Array<{ h: number; s: number; l: number }>;
    regionIdTex: Uint8Array;
    bgImageData: ImageData | null;
  }>) => void;
  clearBaseColorEditorState: () => void;

  // 技能组编辑器（多帧）
  skillGroupEditor: {
    frames: Array<{
      id: string;
      name: string;
      bgImageData: ImageData | null;
      dashedPolygons: Point[][];
      baseTexture: ImageData | null;
      residualTexture: ImageData | null;
      deltaPacked: Uint16Array;
      blockFlags: bigint;
      bbox: { x: number; y: number; w: number; h: number } | null;
      regionIdTex: Uint8Array;
      baseColorValues: Array<{ h: number; s: number; l: number }>;
    }>;
    sharedBaseColors: Array<SharedBaseColor>;
    activeFrameId: string | null;
    globalBbox: { x: number; y: number; w: number; h: number } | null;
    nextColorId: number;
    enableFramePrediction: boolean;  // 帧间预测开关
  };

  // ===== 新架构：全局调色板（唯一真相源）=====
  palette: Map<number, PaletteColor>;
  nextColorId: number;
  sharedBaseColors: Array<SharedBaseColor>;

  // ===== 新架构核心函数 =====
  // 第一层：调色板原子操作
  addColorToPalette: (hsl: { h: number; s: number; l: number }, frameId: string) => number;
  updateColorValue: (colorId: number, newHsl: { h: number; s: number; l: number }) => void;
  incrementColorRef: (colorId: number, frameId: string) => void;
  decrementColorRef: (colorId: number, frameId: string) => void;
  pruneUnusedColors: () => void;
  replaceColorReferences: (oldId: number, newId: number) => void;

  // 第二层：帧像素映射
  extractAndApplyColorsToFrame: (frameId: string) => void;
  reclusterFrameFromScratch: (frameId: string) => void;
  deleteColorFromFrame: (frameId: string, colorId: number) => void;
  clearAllColorsInFrame: (frameId: string) => void;

  // 第三层：统计与渲染
  getAllFrameRefs: () => UnifiedFrameRef[];
  sortPaletteByArea: () => void;
  syncFrameTextures: (frameId: string) => void;

  // 高级工作流
  mergeSimilarColors: (threshold?: number) => void;
  resetCurrentFrameColors: (frameId: string) => void;

  addSkillFrame: (name?: string) => void;
  removeSkillFrame: (frameId: string) => void;
  switchSkillFrame: (frameId: string) => void;
  updateSkillFrame: (frameId: string, data: Partial<{
    name: string;
    bgImageData: ImageData | null;
    dashedPolygons: Point[][];
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    deltaPacked: Uint16Array;
    blockFlags: bigint;
    bbox: { x: number; y: number; w: number; h: number } | null;
    regionIdTex: Uint8Array;
    baseColorValues: Array<{ h: number; s: number; l: number }>;
  }>) => void;
  setSharedBaseColors: (colors: SharedBaseColor[]) => void;
  setGlobalBbox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  syncGlobalBboxFromCurrentFrame: () => void;
  setNextColorId: (nextId: number) => void;
  addColorToGlobal: (color: { h: number; s: number; l: number }, frameId: string) => number;
  updateColorInGlobal: (id: number, color: { h: number; s: number; l: number }, sourceFrameId?: string) => void;
  recalculateAllAreas: () => void;
  mergeAndSortColors: (updatedColorId?: number) => void;
  cleanupAndSortColors: () => void;
  reclusterCurrentFrame: () => void;

  // 多帧 FTX 导入（主绘画页面底图数据）
  frameDataMap: Record<string, import('../types').FrameData>;
  importMultiFrameData: (buffer: ArrayBuffer) => void;

  // 绑定图层到区域
  bindFrameToLayer: (layerId: string, regionId: number | null) => Promise<void>;

  // 获取某图层可绑定的区域列表
  getBindableRegions: (layerId: string) => Array<{ id: number; name: string }>;

  // 帧间预测开关
  setEnableFramePrediction: (enabled: boolean) => void;

  // ===== 流体特效（轻量解算器 FluidSolver）=====
  // 流体配置/运行时强绑定到 frameDataMap[layerId]，切图层即切流体状态
  updateFluidConfig: (layerId: string, partial: Partial<import('../fluid/FluidSolver').FluidSolverConfig>) => void;
  toggleFluidPlaying: (layerId: string) => void;
  setFluidSpeed: (layerId: string, speed: number) => void;
  setFluidViewMode: (layerId: string, mode: import('../types').FluidRuntime['viewMode']) => void;
  resetFluid: (layerId: string) => void;
  addFluidSource: (layerId: string, source: import('../fluid/FluidSolver').InjectionConfig) => void;
  removeFluidSource: (layerId: string, index: number) => void;
  updateFluidSource: (layerId: string, index: number, partial: Partial<import('../fluid/FluidSolver').InjectionConfig>) => void;
  /** 从外部 JSON（fluid-player.html 格式）导入流体配置，整替换 fluidConfig + 初始化 runtime + 标记重置 */
  importFluidConfig: (layerId: string, json: any) => boolean;
  /** 导出当前流体配置为外部 JSON 格式（fluid-player.html 可读）；无配置返回 null */
  exportFluidConfig: (layerId: string) => any;
}

const defaultAxis: AxisConfig = {
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1,
};

export const useAppStore = create<AppState>((set, get) => ({
  imageState: {
    originalImage: null,
    imageSrc: null,
    selectionRect: null,
    imageLayerId: null,
    // 背景层变换参数
    offsetX: 0,      // 背景图片偏移 X
    offsetY: 0,      // 背景图片偏移 Y
    scale: 1,        // 背景图片缩放比例
    isBackgroundDragging: false, // 是否处于背景拖动模式
    backgroundDragStart: null, // 拖动起始位置（初始为null）
  },
  setOriginalImage: (img, src) =>
    set((state) => {
      const imageLayerId = `image_layer_${Date.now()}`;
      const newLayer: Layer = {
        id: imageLayerId,
        displayId: 0,
        name: '参考图片',
        visible: true,
        locked: false,
        opacity: 0.5,
      };
      const renumberedLayers = state.layers.map((layer, index) => ({
        ...layer,
        displayId: index + 1,
      }));
      return {
        imageState: { ...state.imageState, originalImage: img, imageSrc: src, imageLayerId },
        layers: [newLayer, ...renumberedLayers],
      };
    }),
  setSelectionRect: (rect) =>
    set((state) => ({
      imageState: { ...state.imageState, selectionRect: rect },
    })),
  // 背景层变换控制
  setBackgroundOffset: (offsetX, offsetY) =>
    set((state) => ({
      imageState: { ...state.imageState, offsetX, offsetY },
    })),
  setBackgroundScale: (scale) =>
    set((state) => ({
      imageState: { ...state.imageState, scale: Math.max(0.1, Math.min(10, scale)) },
    })),
  resetBackgroundTransform: () =>
    set((state) => ({
      imageState: { ...state.imageState, offsetX: 0, offsetY: 0, scale: 1 },
    })),
  // 背景拖动模式控制
  setBackgroundDragging: (enabled) =>
    set((state) => ({
      imageState: { ...state.imageState, isBackgroundDragging: enabled },
    })),
  startBackgroundDrag: (x, y) =>
    set((state) => ({
      imageState: { ...state.imageState, backgroundDragStart: { x, y } },
    })),
  updateBackgroundDrag: (x, y) =>
    set((state) => {
      if (!state.imageState.backgroundDragStart) return state;
      const dx = x - state.imageState.backgroundDragStart.x;
      const dy = y - state.imageState.backgroundDragStart.y;
      return {
        imageState: {
          ...state.imageState,
          offsetX: state.imageState.offsetX + dx,
          offsetY: state.imageState.offsetY + dy,
          backgroundDragStart: { x, y },
        },
      };
    }),
  endBackgroundDrag: () =>
    set((state) => ({
      imageState: { ...state.imageState, backgroundDragStart: null },
    })),
  clearImage: () =>
    set((state) => {
      const imageLayerId = state.imageState.imageLayerId;
      const newLayers = imageLayerId
        ? state.layers.filter((l) => l.id !== imageLayerId)
        : state.layers;
      const renumberedLayers = newLayers.map((layer, index) => ({
        ...layer,
        displayId: index + 1,
      }));
      return {
        imageState: { 
          originalImage: null, 
          imageSrc: null, 
          selectionRect: null, 
          imageLayerId: null, 
          offsetX: 0, 
          offsetY: 0, 
          scale: 1,
          isBackgroundDragging: false,
          backgroundDragStart: null,
        },
        isPreviewStage: false,
        layers: renumberedLayers,
        shapes: imageLayerId
          ? state.shapes.filter((s) => s.layerId !== imageLayerId)
          : state.shapes,
      };
    }),

  isPreviewStage: false,
  setPreviewStage: (preview) => set({ isPreviewStage: preview }),
  applySelectionToCanvas: () => {
    set((state) => ({
      isPreviewStage: false,
    }));
  },

  axis: defaultAxis,
  setAxis: (axis) =>
    set((state) => ({ 
      axis: { ...state.axis, ...axis }, 
      zoom: 1, 
      panOffset: { x: 0, y: 0 } 
    })),
  resetAxis: () => set({ axis: defaultAxis }),

  grid: {
    cols: 10,
    rows: 10,
    visible: true,
  },
  setGrid: (grid) =>
    set((state) => ({ grid: { ...state.grid, ...grid } })),

  layerVisibility: {
    imageLayer: true,
    frameLayer: true,   // 帧图层（FTX导入数据），默认可见
    drawLayer: true,
    axisLayer: true,
    regionLayer: false, // 区域注释算法提取的色块区域
  },
  toggleLayer: (layer) =>
    set((state) => ({
      layerVisibility: {
        ...state.layerVisibility,
        [layer]: !state.layerVisibility[layer],
      },
    })),

  groups: [],
  activeGroupId: null,
  addGroup: (name, color) =>
    set((state) => ({
      groups: [
        ...state.groups,
        {
          id: `group_${Date.now()}`,
          name,
          color,
          visible: true,
        },
      ],
    })),
  removeGroup: (id) =>
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      activeGroupId: state.activeGroupId === id ? null : state.activeGroupId,
    })),
  updateGroup: (id, updates) =>
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
    })),
  setActiveGroup: (id) => set({ activeGroupId: id }),

  layers: [
    {
      id: 'layer_1',
      displayId: 1,
      name: '图层 1',
      visible: true,
      locked: false,
      opacity: 1,
    },
  ],
  activeLayerId: 'layer_1',
  addLayer: (name) =>
    set((state) => {
      const maxDisplayId = state.layers.length > 0
        ? Math.max(...state.layers.map(l => l.displayId))
        : 0;
      const newDisplayId = maxDisplayId >= 0 ? maxDisplayId + 1 : 1;
      const newLayers = [
        ...state.layers,
        {
          id: `layer_${Date.now()}`,
          displayId: newDisplayId,
          name,
          visible: true,
          locked: false,
          opacity: 1,
        },
      ];
      return { layers: newLayers };
    }),
  removeLayer: (id) =>
    set((state) => {
      const remainingLayers = state.layers.filter((l) => l.id !== id);
      
      const renumberedLayers = remainingLayers.map((layer, index) => {
        if (layer.displayId === 0) {
          return layer;
        }
        const startIndex = remainingLayers[0]?.displayId === 0 ? 1 : 0;
        return {
          ...layer,
          displayId: startIndex + index,
        };
      });
      
      const isRemovingActive = state.activeLayerId === id;
      const newActiveLayerId = isRemovingActive
        ? (renumberedLayers.length > 0 ? renumberedLayers[0].id : null)
        : state.activeLayerId;
      
      // 清理缓存
      const { [id]: _, ...newPolyCache } = state.regionPolygonsCache;
      const { [id]: __, ...newScanCache } = state.regionScanlineCache;
      const { [id]: ___, ...newColorBlockCache } = state.colorBlockRegionsCache;
      const { [id]: ____, ...newPaintBuffers } = state.paintBuffers;
      
      // 清理该图层的色块
      const newColorBlocks = state.colorBlocks.filter(b => b.layerId !== id);
      
      return {
        layers: renumberedLayers,
        activeLayerId: newActiveLayerId,
        shapes: state.shapes.filter((s) => s.layerId !== id),
        regionPolygonsCache: newPolyCache,
        regionScanlineCache: newScanCache,
        colorBlockRegionsCache: newColorBlockCache,
        paintBuffers: newPaintBuffers,
        colorBlocks: newColorBlocks,
      };
    }),
  updateLayer: (id, updates) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
  setActiveLayer: (id) => {
    const state = get();
    set({ activeLayerId: id });
    
    // 如果切换到有帧数据的图层，更新画布尺寸为 bbox 尺寸并重置视图
    if (id) {
      const frameData = state.frameDataMap[id];
      if (frameData && frameData.rawBbox) {
        const bbox = frameData.rawBbox;
        if (state.canvasWidth !== bbox.w || state.canvasHeight !== bbox.h) {
          set({
            canvasWidth: bbox.w,
            canvasHeight: bbox.h,
            zoom: 1,
            panOffset: { x: 0, y: 0 },
          });
        }
      }
      
      setTimeout(() => {
        get().refreshRegionCache(id);
        get().refreshColorBlockCache(id);
        get().refreshRegionEntities(id);   // ← 总是刷新，独立于区域图层可见性
      }, 0);
    }
  },
  toggleLayerVisibility: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      const fromLayer = state.layers[fromIndex];
      if (fromLayer.displayId === 0) {
        return state;
      }
      
      const adjustedToIndex = toIndex === 0 ? 1 : toIndex;
      
      const newLayers = [...state.layers];
      const [removed] = newLayers.splice(fromIndex, 1);
      newLayers.splice(adjustedToIndex, 0, removed);
      
      const renumberedLayers = newLayers.map((layer, index) => {
        if (layer.displayId === 0) {
          return layer;
        }
        return {
          ...layer,
          displayId: index,
        };
      });
      
      return { layers: renumberedLayers };
    }),

  shapes: [],
  addShape: (shape) =>
    set((state) => {
      const newShape = { ...shape };
      setTimeout(() => {
        get().refreshRegionCache(shape.layerId);
        get().refreshColorBlockCache(shape.layerId);
        get().updateColorBlocksForLayer(shape.layerId);
        // 自动更新区域色块图层（如果可见）
        if (state.layerVisibility.regionLayer) {
          get().refreshRegionEntities(shape.layerId);
        }
      }, 0);
      return { shapes: [...state.shapes, newShape] };
    }),
  removeShape: (id) =>
    set((state) => {
      const shape = state.shapes.find(s => s.id === id);
      if (shape) {
        const layerId = shape.layerId;
        setTimeout(() => {
          get().refreshRegionCache(layerId);
          get().refreshColorBlockCache(layerId);
          get().updateColorBlocksForLayer(layerId);
          // 自动更新区域色块图层（如果可见）
          if (state.layerVisibility.regionLayer) {
            get().refreshRegionEntities(layerId);
          }
        }, 0);
      }
      return { shapes: state.shapes.filter((s) => s.id !== id) };
    }),
  updateShape: (id, updates) =>
    set((state) => {
      const oldShape = state.shapes.find(s => s.id === id);
      if (!oldShape) return state;
      const newShape = { ...oldShape, ...updates };
      setTimeout(() => {
        get().refreshRegionCache(newShape.layerId);
        get().refreshColorBlockCache(newShape.layerId);
        get().updateColorBlocksForLayer(newShape.layerId);
        // 自动更新区域色块图层（如果可见）
        if (state.layerVisibility.regionLayer) {
          get().refreshRegionEntities(newShape.layerId);
        }
      }, 0);
      return { shapes: state.shapes.map((s) => (s.id === id ? newShape : s)) };
    }),
  clearShapes: () => {
    set({ shapes: [], colorBlocks: [], nextColorBlockId: 1 });
  },

  mousePosition: null,
  setMousePosition: (pos) => set({ mousePosition: pos }),

  isSelecting: false,
  selectionStart: null,
  selectionEnd: null,
  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),
  setIsSelecting: (selecting) => set({ isSelecting: selecting }),

  zoom: 1.0,
  panOffset: { x: 0, y: 0 },
  isPanMode: false,
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setPanOffset: (offset) => set({ panOffset: offset }),
  setPanMode: (panMode) => set({ isPanMode: panMode }),
  resetView: () => set({ zoom: 1.0, panOffset: { x: 0, y: 0 } }),
  
  // 画布尺寸
  canvasWidth: 512,
  canvasHeight: 512,
  setCanvasWidth: (width) => set({ canvasWidth: Math.max(64, Math.min(4096, width)) }),
  setCanvasHeight: (height) => set({ canvasHeight: Math.max(64, Math.min(4096, height)) }),

  currentTool: 'select',
  setCurrentTool: (tool) => set({ currentTool: tool }),

  // 颜色提取模式
  colorExtractMode: false,
  setColorExtractMode: (mode) => set({ colorExtractMode: mode }),
  colorExtractTool: null,
  setColorExtractTool: (tool) => set({ colorExtractTool: tool, colorExtractPoints: [], colorExtractPreviewPoint: null, colorExtractWaitingFor: null, colorExtractRegionId: null }),
  colorExtractPoints: [],
  setColorExtractPoints: (points) => set({ colorExtractPoints: points }),
  addColorExtractPoint: (point) => set((state) => ({ colorExtractPoints: [...state.colorExtractPoints, point] })),
  clearColorExtractPoints: () => set({ colorExtractPoints: [], colorExtractPreviewPoint: null, colorExtractWaitingFor: null, colorExtractRegionId: null, lastPolygonPoint: null }),
  colorExtractPreviewPoint: null,
  setColorExtractPreviewPoint: (point) => set({ colorExtractPreviewPoint: point }),
  colorExtractWaitingFor: null,
  setColorExtractWaitingFor: (waiting) => set({ colorExtractWaitingFor: waiting }),
  colorExtractRegionId: null,
  setColorExtractRegionId: (id) => set({ colorExtractRegionId: id }),
  colorExtractCurves: [],
  addColorExtractCurve: (curve) => set((state) => ({ colorExtractCurves: [...state.colorExtractCurves, curve] })),
  removeColorExtractCurve: (index) => set((state) => ({
    colorExtractCurves: state.colorExtractCurves.filter((_, i) => i !== index)
  })),
  clearColorExtractCurves: () => set({ colorExtractCurves: [] }),
  clearColorExtractCurvesAndShapes: () => {
    const state = useAppStore.getState();
    // 删除所有对应的 shapes
    for (const curve of state.colorExtractCurves) {
      if (curve.shapeId) {
        state.removeShape(curve.shapeId);
      }
    }
    // 清空曲线列表
    set({ colorExtractCurves: [] });
  },
  getDashedShapeIds: () => {
    const state = useAppStore.getState();
    return state.colorExtractCurves
      .map(curve => curve.shapeId)
      .filter((id): id is string => !!id);
  },
  colorExtractWaiting: false,
  setColorExtractWaiting: (waiting) => set({ colorExtractWaiting: waiting }),
  colorExtractEraserMode: false,
  setColorExtractEraserMode: (mode) => set({ colorExtractEraserMode: mode }),
  lastPolygonPoint: null,
  setLastPolygonPoint: (point) => set({ lastPolygonPoint: point }),
  pendingExtractPolygon: null,
  setPendingExtractPolygon: (polygon) => set({ pendingExtractPolygon: polygon }),
  extractedColorBlocks: [],
  clearExtractedColorBlocks: () => set({ extractedColorBlocks: [] }),
  addExtractedColorBlock: (block) => set((state) => ({ extractedColorBlocks: [...state.extractedColorBlocks, block] })),
  setExtractedColorBlocks: (blocks) => set({ extractedColorBlocks: blocks }),
  
  colorExtractDebugData: null,
  setColorExtractDebugData: (data) => set({ colorExtractDebugData: data }),

  snapRadius: 15,
  setSnapRadius: (radius) => set({ snapRadius: Math.max(1, Math.min(50, radius)) }),
  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  
  showColorExtractDebug: false,
  setShowColorExtractDebug: (show) => set({ showColorExtractDebug: show }),

  // 线条粗细配置（0表示无，不显示线条，支持小数如0.1, 0.5等）
  lineWidth: 2,
  setLineWidth: (width) => set({ lineWidth: Math.max(0, Math.min(5, Math.round(width * 10) / 10)) }),

  // BFS 光栅化分辨率（越大越精细，但越慢；默认800，范围200~3000）
  bfsResolution: 800,
  setBfsResolution: (resolution) => set({ bfsResolution: Math.max(200, Math.min(3000, Math.round(resolution))) }),

  // 上色画笔大小（世界坐标单位）
  paintBrushSize: 0.01,
  setPaintBrushSize: (size) => set({ paintBrushSize: Math.max(0.002, Math.min(0.2, Math.round(size * 1000) / 1000)) }),

  // 当前颜色配置
  currentColor: '#ff0000',
  setCurrentColor: (color) => set({ currentColor: color }),

  // 点注释
  pointAnnotations: [],
  addPointAnnotation: (annotation) => {
    // 生成随机颜色
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    return set((state) => ({
      pointAnnotations: [
        ...state.pointAnnotations,
        {
          ...annotation,
          id: `point_anno_${Date.now()}_${Math.random()}`,
          color: randomColor,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }));
  },
  updatePointAnnotation: (id, text) =>
    set((state) => {
      get().saveHistory(); // 保存历史
      return {
        pointAnnotations: state.pointAnnotations.map(a =>
          a.id === id ? { ...a, text, updatedAt: Date.now() } : a
        ),
      };
    }),
  removePointAnnotation: (id) =>
    set((state) => {
      get().saveHistory(); // 保存历史
      return { pointAnnotations: state.pointAnnotations.filter(a => a.id !== id) };
    }),
  clearPointAnnotations: () => set({ pointAnnotations: [] }),

  regionAnnotations: [],
  addRegionAnnotation: (annotation) => {
    // 生成随机颜色
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    return set((state) => {
      // 如果该区域已有注释，先移除旧注释（确保一个区域只有一个注释）
      const filteredAnnotations = annotation.regionId
        ? state.regionAnnotations.filter(a => a.regionId !== annotation.regionId)
        : state.regionAnnotations;
      
      return {
        regionAnnotations: [
          ...filteredAnnotations,
          {
            ...annotation,
            id: `region_anno_${Date.now()}_${Math.random()}`,
            color: randomColor,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      };
    });
  },
  updateRegionAnnotation: (id, text) =>
    set((state) => {
      get().saveHistory(); // 保存历史
      return {
        regionAnnotations: state.regionAnnotations.map(a =>
          a.id === id ? { ...a, text, updatedAt: Date.now() } : a
        ),
      };
    }),
  // 更新区域注释（包含 regionId）
  updateRegionAnnotationWithRegionId: (id, text, regionId) =>
    set((state) => {
      get().saveHistory(); // 保存历史
      return {
        regionAnnotations: state.regionAnnotations.map(a =>
          a.id === id ? { ...a, text, regionId, updatedAt: Date.now() } : a
        ),
      };
    }),
  removeRegionAnnotation: (id) =>
    set((state) => {
      get().saveHistory(); // 保存历史
      return { regionAnnotations: state.regionAnnotations.filter(a => a.id !== id) };
    }),
  clearRegionAnnotations: () => set({ regionAnnotations: [] }),

  // GPU/CPU 切换模式
  forceCPUMode: false,
  setForceCPUMode: (force) => set({ forceCPUMode: force }),

  // 色块相关
  colorBlocks: [],
  nextColorBlockId: 1,  // 从1开始，只增不减

  setColorBlocks: (blocks) => set({ colorBlocks: blocks }),

  updateColorBlocksForLayer: (layerId) => {
    const state = get();
    const shapesInLayer = state.shapes.filter(s => s.layerId === layerId);
    // 调用色块检测函数
    const newBlocks = detectColorBlocks(shapesInLayer, layerId, state.nextColorBlockId, state.bfsResolution);
    
    // 保留其他图层的色块不变
    const otherBlocks = state.colorBlocks.filter(b => b.layerId !== layerId);
    
    // 计算最大已使用ID（确保 nextColorBlockId 足够大）
    let maxId = state.nextColorBlockId - 1;
    for (const block of newBlocks) {
      if (block.id > maxId) maxId = block.id;
    }
    
    set({
      colorBlocks: [...otherBlocks, ...newBlocks],
      nextColorBlockId: maxId + 1,  // 确保下次新色块ID更大
    });
  },

  clearColorBlocksForLayer: (layerId) => {
    set(state => ({
      colorBlocks: state.colorBlocks.filter(b => b.layerId !== layerId),
    }));
  },

  // 按区域ID存储被涂色的像素坐标（去重）
  regionPixelsMap: new Map(),
  addPixelToRegion: (regionId, pixelX, pixelY) =>
    set((state) => {
      const key = `${pixelX},${pixelY}`;
      const regionMap = new Map(state.regionPixelsMap);
      if (!regionMap.has(regionId)) {
        regionMap.set(regionId, new Set());
      }
      regionMap.get(regionId)!.add(key);
      return { regionPixelsMap: regionMap };
    }),
  clearRegionPixels: () => {
    set({ regionPixelsMap: new Map() });
  },

  // 区域ID纹理缓存 - 用于快速查询像素所属区域
  regionIdTexture: new Map(),
  generateRegionIdTexture: (layerId) => {
    const state = get();
    const regions = state.regionPolygonsCache[layerId] || [];
    const width = 512;
    const height = 512;
    const regionIdMap = new Uint8Array(width * height); // 初始为0
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const worldX = x / width;
        const worldY = 1 - y / height; // Y轴翻转
        for (let i = 0; i < regions.length; i++) {
          if (isPointInPolygonWithHoles({ x: worldX, y: worldY }, regions[i])) {
            regionIdMap[y * width + x] = i + 1; // 区域ID从1开始
            break; // 找到第一个即可（区域不重叠）
          }
        }
      }
    }
    
    set((s) => ({
      regionIdTexture: new Map(s.regionIdTexture).set(layerId, regionIdMap),
    }));
  },

  regionPolygonsCache: {},
  regionScanlineCache: {},
  refreshRegionCache: (layerId, options?: { clearPaintData?: boolean }) => {
    const state = get();
    const allShapesInLayer = state.shapes.filter(s => s.layerId === layerId);

    // 世界坐标固定为 [0,1]，与坐标轴显示范围无关
    const worldBounds = BFS_WORLD_BOUNDS;

    const gridData = computeGridRegions(allShapesInLayer, worldBounds, state.bfsResolution, '#ffaa00');  // 排除虚线
    const scanlineCache = computeScanlineIntervals(gridData);
    const regions = computeRegionsExact(allShapesInLayer, worldBounds, state.bfsResolution, '#ffaa00');  // 排除虚线
    
    // 区域重计算后，仅在需要时清空该图层的画笔缓冲区和区域像素记录
    // 默认不清空（用于撤销/重做后的重新计算），仅在添加/删除形状时手动调用清空
    if (options?.clearPaintData !== false) {
      state.clearPaintBuffer(layerId);
      state.clearRegionPixels();
    }
    
    set((s) => ({
      regionPolygonsCache: { ...s.regionPolygonsCache, [layerId]: regions },
      regionScanlineCache: { ...s.regionScanlineCache, [layerId]: scanlineCache },
    }));
    
    // 直接从 gridData.regionIdGrid 生成 regionIdTexture（使用合并后的实际 ID）
    // 这样可以保证 regionIdTexture 与 getRegionIdAtPoint 返回的 ID 一致
    const texWidth = 512;
    const texHeight = 512;
    const regionIdMap = new Uint8Array(texWidth * texHeight); // 初始为0
    
    const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
    
    for (let ty = 0; ty < texHeight; ty++) {
      for (let tx = 0; tx < texWidth; tx++) {
        // 将纹理坐标转换为世界坐标 [0,1]
        const worldX = tx / texWidth;
        const worldY = 1 - ty / texHeight; // Y轴翻转
        
        // 将世界坐标转换为 grid 坐标
        const gx = Math.floor((worldX - xMin) / stepX);
        const gy = Math.floor((worldY - yMin) / stepY);
        
        if (gx >= 0 && gx < resolution && gy >= 0 && gy < resolution) {
          const gridId = regionIdGrid[gy][gx];
          // gridId > 0 表示有效区域（负数为墙）
          // 但纹理中存储的是 1-based 索引，所以需要转换
          // 实际上 getRegionIdAtPoint 返回的是 gridId > 0 ? gridId : null
          // 所以我们直接存储 gridId（如果是正数）
          regionIdMap[ty * texWidth + tx] = gridId > 0 ? gridId : 0;
        }
      }
    }
    
    set((s) => ({
      regionIdTexture: new Map(s.regionIdTexture).set(layerId, regionIdMap),
    }));

    // 自动刷新区域实体（使绑定下拉框总能获取到本图层的区域 ID）
    get().refreshRegionEntities(layerId);
  },

  colorBlockRegionsCache: {},
  refreshColorBlockCache: (layerId) => {
    const state = get();
    // 直接使用 regionPolygonsCache（区域注释算法检测到的封闭区域）
    const regions = state.regionPolygonsCache[layerId] || [];
    
    set((s) => ({
      colorBlockRegionsCache: { ...s.colorBlockRegionsCache, [layerId]: regions },
    }));
  },

  // 虚线子区域缓存（带 ID）
  dashedSubRegionsCache: {},
  refreshDashedSubRegionsCache: (layerId) => {
    const state = get();
    // 获取当前图层的所有形状
    const allShapesInLayer = state.shapes.filter(s => s.layerId === layerId);
    
    if (allShapesInLayer.length === 0) {
      set((s) => ({
        dashedSubRegionsCache: { ...s.dashedSubRegionsCache, [layerId]: [] },
      }));
      return;
    }

    // 使用与 Ctrl+G 相同的算法计算所有闭合区域
    const subRegions = computeAllDashedClosedRegions(
      allShapesInLayer,
      state.canvasWidth,
      state.canvasHeight
    );

    set((s) => ({
      dashedSubRegionsCache: { ...s.dashedSubRegionsCache, [layerId]: subRegions },
    }));
  },

  // 区域色块图层缓存（静态纹理画布）
  regionLayerCanvas: null,
  regionLayerTextureGPU: null,
  redrawTrigger: 0,

  // 像素缓冲区相关
  paintBuffers: {},
  regionLayerTexture: {}, // 区域色块图层纹理缓存
  regionEntities: {}, // 区域实体列表（存储 ftx 压缩数据）
  initPaintBuffer: (layerId) =>
    set((state) => {
      if (state.paintBuffers[layerId]) return state;
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      return {
        paintBuffers: { ...state.paintBuffers, [layerId]: imageData },
      };
    }),
  updatePaintBuffer: (layerId, updater) =>
    set((state) => {
      const old = state.paintBuffers[layerId];
      if (!old) return state;
      const newImageData = new ImageData(new Uint8ClampedArray(old.data), old.width, old.height);
      updater(newImageData);
      setTimeout(() => {
        if (get().layerVisibility.regionLayer) {
          get().refreshRegionEntities(layerId);
        }
      }, 0);
      return {
        paintBuffers: { ...state.paintBuffers, [layerId]: newImageData },
      };
    }),
  clearPaintBuffer: (layerId) =>
    set((state) => {
      if (!state.paintBuffers[layerId]) return state;
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);
      const empty = ctx.getImageData(0, 0, size, size);
      return {
        paintBuffers: { ...state.paintBuffers, [layerId]: empty },
      };
    }),
  extractPolygonsFromPaintBuffer: (layerId, targetColor) => {
    const state = get();
    const buffer = state.paintBuffers[layerId];
    if (!buffer) return;

    const polygons = extractPolygonsFromImageData(buffer, targetColor);
    if (polygons.length === 0) return;

    const newShapes: Shape[] = polygons.map((polygon) => ({
      id: `shape_${Date.now()}_${Math.random()}`,
      groupId: state.activeGroupId || 'default',
      layerId,
      type: 'polygon',
      points: polygon,
      color: targetColor,
      fillOnly: true,
    }));

    set((s) => ({
      shapes: [...s.shapes, ...newShapes],
    }));

    const colorRgb = hexToRgb(targetColor);
    if (colorRgb) {
      state.updatePaintBuffer(layerId, (imgData) => {
        for (let i = 0; i < imgData.data.length; i += 4) {
          if (imgData.data[i] === colorRgb.r &&
              imgData.data[i+1] === colorRgb.g &&
              imgData.data[i+2] === colorRgb.b &&
              imgData.data[i+3] > 0) {
            imgData.data[i+3] = 0;
          }
        }
      });
    }
  },

  /**
   * 生成区域色块图层纹理（静态烘焙）
   * 只使用虚线围成的区域，直接从 paintBuffer 提取像素
   */
  generateRegionLayerTexture: (layerId) => {
    const state = get();
    const shapes = state.shapes.filter(s => s.layerId === layerId);
    const paintBuffer = state.paintBuffers[layerId];
    
    // ★ 使用实际画布尺寸，而非硬编码 512
    const width = state.canvasWidth;
    const height = state.canvasHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    const texture = ctx.getImageData(0, 0, width, height);
    
    if (!paintBuffer || shapes.length === 0) {
      set((s) => ({
        regionLayerTexture: { ...s.regionLayerTexture, [layerId]: texture },
      }));
      return;
    }
    
    // 只获取虚线闭合区域
    const dashedRegions = computeAllDashedClosedRegions(shapes, width, height);
    console.log(`[区域图层纹理] 图层 ${layerId} 检测到 ${dashedRegions.length} 个虚线闭合区域`);
    
    if (dashedRegions.length === 0) {
      set((s) => ({
        regionLayerTexture: { ...s.regionLayerTexture, [layerId]: texture },
      }));
      return;
    }
    
    // 将区域转换为像素掩码并从 paintBuffer 提取颜色
    dashedRegions.forEach((region) => {
      if (region.polygon.length === 0 || region.polygon[0].length < 3) return;
      
      // 遍历区域内的像素（使用世界坐标）
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          // 将像素坐标转换为世界坐标
          const worldX = px / width;
          const worldY = 1 - py / height; // Y轴翻转
          
          // 检查点是否在区域内
          if (isPointInPolygonWithHoles({ x: worldX, y: worldY }, region.polygon)) {
            // 从 paintBuffer 提取颜色
            const bufIdx = (py * width + px) * 4;
            const r = paintBuffer.data[bufIdx];
            const g = paintBuffer.data[bufIdx + 1];
            const b = paintBuffer.data[bufIdx + 2];
            const a = paintBuffer.data[bufIdx + 3];
            
            // 如果 paintBuffer 中有颜色，复制到纹理
            if (a > 0) {
              texture.data[bufIdx] = r;
              texture.data[bufIdx + 1] = g;
              texture.data[bufIdx + 2] = b;
              texture.data[bufIdx + 3] = a;
            }
          }
        }
      }
    });
    
    set((s) => ({
      regionLayerTexture: { ...s.regionLayerTexture, [layerId]: texture },
    }));
    
    console.log(`[区域图层纹理] 图层 ${layerId} 纹理生成完成`);
  },

  // 构建区域实体（只存几何和特效，不存储颜色数据）
  refreshRegionEntities: (layerId) => {
    const state = get();

    // 获取区域注释中的变换参数和边框扭曲参数
    const annoMap = new Map<number, RegionAnnotation>();
    state.regionAnnotations
      .filter(a => a.layerId === layerId)
      .forEach(a => {
        const id = Number(a.regionId);
        annoMap.set(id, a);
      });

    // 释放旧的区域实体
    const oldEntities = state.regionEntities[layerId] || [];
    
    // ★ 保存旧实体的固定点
    const fixedVerticesMap = new Map<number, Set<number>>();
    for (const old of oldEntities) {
      if (old.fixedVertices.size > 0) {
        fixedVerticesMap.set(old.id, new Set(old.fixedVertices));
      }
    }
    
    oldEntities.forEach(e => e.dispose());

    const regions = state.regionPolygonsCache[layerId] || [];
    const entities: RegionEntity[] = [];

    for (let i = 0; i < regions.length; i++) {
      const polygon = regions[i];

      if (polygon.length === 0 || polygon[0].length < 3) continue;

      // 创建区域实体（构造函数自动计算 worldBbox）
      const entity = new RegionEntity(i, layerId, polygon);

      // 恢复蒙版特效参数（从区域注释中读取）
      const anno = annoMap.get(i);
      if (anno?.maskEffect) {
        entity.maskEffect = anno.maskEffect;
        
        if (anno.maskEffect.transform) {
          const savedTransform = anno.maskEffect.transform;
          
          // 校验并恢复锚点
          const savedAnchor = savedTransform.anchor;
          if (savedAnchor && savedAnchor.x >= 0 && savedAnchor.x <= 1 && savedAnchor.y >= 0 && savedAnchor.y <= 1) {
            entity.transform.anchor = { x: savedAnchor.x, y: savedAnchor.y };
          }
          
          // 校验并恢复位置
          if (savedTransform.position) {
            entity.transform.position = {
              x: Math.max(-0.5, Math.min(0.5, savedTransform.position.x)),
              y: Math.max(-0.5, Math.min(0.5, savedTransform.position.y)),
            };
          }
          
          if (typeof savedTransform.rotation === 'number') {
            entity.transform.rotation = savedTransform.rotation;
          }
          if (savedTransform.scale) {
            entity.transform.scale = { ...savedTransform.scale };
          }
        }
      } else {
        entity.maskEffect = null;  // 确保显式置 null，防止旧特效残留
      }

      // 计算默认锚点（区域中心世界坐标）
      const bbox = entity.worldBbox;
      if (bbox && !entity.transform.anchor) {
        const cx = bbox.x + bbox.w / 2;
        const cy = bbox.y + bbox.h / 2;
        entity.transform.anchor = { x: cx, y: cy };
      }

      // ★ 恢复固定点
      const savedFixed = fixedVerticesMap.get(i);
      if (savedFixed) {
        entity.fixedVertices = new Set(savedFixed);
      }

      entities.push(entity);
    }

    set((s) => ({
      regionEntities: { ...s.regionEntities, [layerId]: entities },
    }));
  },

  updateRegionDisplacementOnly: (layerId: string) => {
    const state = get();
    const entities = state.regionEntities[layerId] || [];
    const { canvasWidth, canvasHeight } = state;
    
    entities.forEach(entity => {
      const anno = state.regionAnnotations.find(
        a => a.layerId === layerId && Number(a.regionId) === entity.id
      );
      // ★ 关键修复：无论 maskEffect 是否存在，都直接赋值（或置 null）
      entity.maskEffect = anno?.maskEffect || null;
      entity.updateDisplacementOnly(canvasWidth, canvasHeight);
    });
    
    set((s) => ({
      regionEntities: { ...s.regionEntities, [layerId]: [...entities] },
    }));
  },

  // 【重构】释放区域实体资源
  disposeRegionEntities: (layerId) => {
    const state = get();
    const entities = state.regionEntities[layerId] || [];
    entities.forEach(e => e.dispose());
    set((s) => ({
      regionEntities: { ...s.regionEntities, [layerId]: [] },
    }));
  },

  historySnapshots: [{ 
    id: 0, 
    shapes: [], 
    pointAnnotations: [], 
    regionAnnotations: [], 
    regionPixelsMap: new Map(), 
    paintBuffers: {},
    stats: { shapeCount: 0, shapeTypes: [], pointAnnotationCount: 0, regionAnnotationCount: 0, paintedPixelCount: 0 }
  }],
  historyIndex: 0,
  isRestoringHistory: false,
  saveHistory: () =>
    set((state) => {
      // 如果正在恢复历史，跳过保存
      if (state.isRestoringHistory) {
        return state;
      }
      // 将 regionPixelsMap 转换为可序列化格式
      const serializedRegionPixelsMap = new Map<number, string[]>();
      state.regionPixelsMap.forEach((pixels, regionId) => {
        serializedRegionPixelsMap.set(regionId, Array.from(pixels));
      });
      
      // 计算绘画像素总数
      let paintedPixelCount = 0;
      serializedRegionPixelsMap.forEach((pixels) => {
        paintedPixelCount += pixels.length;
      });
      
      // 将 paintBuffers（普通对象）转换为可序列化格式
      const serializedPaintBuffers: Record<string, { width: number; height: number; data: number[] }> = {};
      for (const [layerId, imgData] of Object.entries(state.paintBuffers)) {
        if (imgData) {
          serializedPaintBuffers[layerId] = {
            width: imgData.width,
            height: imgData.height,
            data: Array.from(imgData.data),
          };
        }
      }
      
      // 统计线条类型
      const shapeTypes = [...new Set(state.shapes.map(s => s.type))];
      
      const serializeImageData = (imgData: ImageData | null): { width: number; height: number; data: number[] } | null => {
        if (!imgData) return null;
        return {
          width: imgData.width,
          height: imgData.height,
          data: Array.from(imgData.data),
        };
      };

      const serializedSkillGroupFrames = state.skillGroupEditor.frames.map(frame => ({
        ...frame,
        bgImageData: serializeImageData(frame.bgImageData),
        baseTexture: serializeImageData(frame.baseTexture),
        residualTexture: serializeImageData(frame.residualTexture),
        deltaPacked: Array.from(frame.deltaPacked),
        regionIdTex: Array.from(frame.regionIdTex),
        colorPixelsMap: null,
      }));

      const snapshotId = Date.now();
      const newSnapshot = { 
        id: snapshotId,
        shapes: [...state.shapes], 
        pointAnnotations: [...state.pointAnnotations],
        regionAnnotations: [...state.regionAnnotations],
        regionPixelsMap: serializedRegionPixelsMap,
        paintBuffers: serializedPaintBuffers,
        skillGroupEditor: {
          frames: serializedSkillGroupFrames,
          sharedBaseColors: [...state.skillGroupEditor.sharedBaseColors],
          activeFrameId: state.skillGroupEditor.activeFrameId,
          globalBbox: state.skillGroupEditor.globalBbox ? { ...state.skillGroupEditor.globalBbox } : null,
          nextColorId: state.skillGroupEditor.nextColorId,
        },
        stats: {
          shapeCount: state.shapes.length,
          shapeTypes: shapeTypes,
          pointAnnotationCount: state.pointAnnotations.length,
          regionAnnotationCount: state.regionAnnotations.length,
          paintedPixelCount: paintedPixelCount,
        },
      };
      const newHistory = state.historySnapshots.slice(0, state.historyIndex + 1);
      newHistory.push(newSnapshot);
      if (newHistory.length > 30) newHistory.shift(); // 减少历史记录数量以节省内存
      return { historySnapshots: newHistory, historyIndex: newHistory.length - 1 };
    }),
  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        const snapshot = state.historySnapshots[newIndex];
        
        // 恢复 regionPixelsMap
        const restoredRegionPixelsMap = new Map<number, Set<string>>();
        snapshot.regionPixelsMap.forEach((pixels, regionId) => {
          restoredRegionPixelsMap.set(regionId, new Set(pixels));
        });
        
        // 恢复 paintBuffers（普通对象）
        const restoredPaintBuffers: Record<string, ImageData | null> = {};
        for (const [layerId, serialized] of Object.entries(snapshot.paintBuffers)) {
          restoredPaintBuffers[layerId] = new ImageData(new Uint8ClampedArray(serialized.data), serialized.width, serialized.height);
        }
        
        const deserializeImageData = (serialized: { width: number; height: number; data: number[] } | null): ImageData | null => {
          if (!serialized) return null;
          return new ImageData(new Uint8ClampedArray(serialized.data), serialized.width, serialized.height);
        };

        const restoredSkillGroupFrames = snapshot.skillGroupEditor?.frames.map(frame => ({
          ...frame,
          bgImageData: deserializeImageData(frame.bgImageData),
          baseTexture: deserializeImageData(frame.baseTexture),
          residualTexture: deserializeImageData(frame.residualTexture),
          deltaPacked: new Uint16Array(frame.deltaPacked || []),
          regionIdTex: new Uint8Array(frame.regionIdTex),
          colorPixelsMap: null,
        })) || [];
        
        const newState = {
          shapes: [...snapshot.shapes],
          pointAnnotations: [...snapshot.pointAnnotations],
          regionAnnotations: [...snapshot.regionAnnotations],
          regionPixelsMap: restoredRegionPixelsMap,
          paintBuffers: restoredPaintBuffers,
          historyIndex: newIndex,
          isRestoringHistory: true, // 标记正在恢复
          colorExtractMode: false,  // 强制退出颜色提取模式
          colorExtractPoints: [],   // 清空点集
          colorExtractTool: null,   // 重置工具
          skillGroupEditor: snapshot.skillGroupEditor ? {
            frames: restoredSkillGroupFrames,
            sharedBaseColors: [...snapshot.skillGroupEditor.sharedBaseColors],
            activeFrameId: snapshot.skillGroupEditor.activeFrameId,
            globalBbox: snapshot.skillGroupEditor.globalBbox ? { ...snapshot.skillGroupEditor.globalBbox } : null,
            nextColorId: snapshot.skillGroupEditor.nextColorId,
          } : state.skillGroupEditor,
          // 恢复顶层共享颜色和调色板 Map
          sharedBaseColors: snapshot.skillGroupEditor ? [...snapshot.skillGroupEditor.sharedBaseColors] : state.sharedBaseColors,
          palette: snapshot.skillGroupEditor ? new Map(snapshot.skillGroupEditor.sharedBaseColors.map(c => [c.id, { h: c.h, s: c.s, l: c.l, frameIds: new Set(c.frameIds || []) }])) : state.palette,
        };
        
        // 延迟重置标志并重新计算区域数据
        setTimeout(() => {
          const state = get();
          // 重新计算所有图层的区域数据，但不清空绘画数据
          const layerIds = [...new Set(state.shapes.map(s => s.layerId))];
          layerIds.forEach(layerId => {
            state.refreshRegionCache(layerId, { clearPaintData: false });
            if (state.layerVisibility.regionLayer) {
              state.refreshRegionEntities(layerId);
            }
          });
          set({ isRestoringHistory: false });
        }, 0);
        
        return newState;
      }
      return {
        ...state,
        colorExtractMode: false,
        colorExtractPoints: [],
        colorExtractTool: null,
      };
    }),
  redo: () =>
    set((state) => {
      if (state.historyIndex < state.historySnapshots.length - 1) {
        const newIndex = state.historyIndex + 1;
        const snapshot = state.historySnapshots[newIndex];
        
        // 恢复 regionPixelsMap
        const restoredRegionPixelsMap = new Map<number, Set<string>>();
        snapshot.regionPixelsMap.forEach((pixels, regionId) => {
          restoredRegionPixelsMap.set(regionId, new Set(pixels));
        });
        
        // 恢复 paintBuffers（普通对象）
        const restoredPaintBuffers: Record<string, ImageData | null> = {};
        for (const [layerId, serialized] of Object.entries(snapshot.paintBuffers)) {
          restoredPaintBuffers[layerId] = new ImageData(new Uint8ClampedArray(serialized.data), serialized.width, serialized.height);
        }
        
        const deserializeImageData = (serialized: { width: number; height: number; data: number[] } | null): ImageData | null => {
          if (!serialized) return null;
          return new ImageData(new Uint8ClampedArray(serialized.data), serialized.width, serialized.height);
        };

        const restoredSkillGroupFrames = snapshot.skillGroupEditor?.frames.map(frame => ({
          ...frame,
          bgImageData: deserializeImageData(frame.bgImageData),
          baseTexture: deserializeImageData(frame.baseTexture),
          residualTexture: deserializeImageData(frame.residualTexture),
          deltaPacked: new Uint16Array(frame.deltaPacked || []),
          regionIdTex: new Uint8Array(frame.regionIdTex),
          colorPixelsMap: null,
        })) || [];
        
        console.log(`[重做] 恢复到快照 ID: ${snapshot.id}, 索引: ${newIndex}`);
        console.log(`  线条: ${snapshot.stats.shapeCount}个 (类型: ${snapshot.stats.shapeTypes.join(', ') || '无'})`);
        console.log(`  点注释: ${snapshot.stats.pointAnnotationCount}个`);
        console.log(`  区域注释: ${snapshot.stats.regionAnnotationCount}个`);
        console.log(`  绘画像素: ${snapshot.stats.paintedPixelCount}个`);
        
        const newState = {
          shapes: [...snapshot.shapes],
          pointAnnotations: [...snapshot.pointAnnotations],
          regionAnnotations: [...snapshot.regionAnnotations],
          regionPixelsMap: restoredRegionPixelsMap,
          paintBuffers: restoredPaintBuffers,
          historyIndex: newIndex,
          isRestoringHistory: true, // 标记正在恢复
          colorExtractMode: false,  // 强制退出颜色提取模式
          colorExtractPoints: [],   // 清空点集
          colorExtractTool: null,   // 重置工具
          skillGroupEditor: snapshot.skillGroupEditor ? {
            frames: restoredSkillGroupFrames,
            sharedBaseColors: [...snapshot.skillGroupEditor.sharedBaseColors],
            activeFrameId: snapshot.skillGroupEditor.activeFrameId,
            globalBbox: snapshot.skillGroupEditor.globalBbox ? { ...snapshot.skillGroupEditor.globalBbox } : null,
            nextColorId: snapshot.skillGroupEditor.nextColorId,
          } : state.skillGroupEditor,
          // 恢复顶层共享颜色和调色板 Map
          sharedBaseColors: snapshot.skillGroupEditor ? [...snapshot.skillGroupEditor.sharedBaseColors] : state.sharedBaseColors,
          palette: snapshot.skillGroupEditor ? new Map(snapshot.skillGroupEditor.sharedBaseColors.map(c => [c.id, { h: c.h, s: c.s, l: c.l, frameIds: new Set(c.frameIds || []) }])) : state.palette,
        };
        
        // 延迟重置标志并重新计算区域数据
        setTimeout(() => {
          const state = get();
          // 重新计算所有图层的区域数据，但不清空绘画数据
          const layerIds = [...new Set(state.shapes.map(s => s.layerId))];
          layerIds.forEach(layerId => {
            state.refreshRegionCache(layerId, { clearPaintData: false });
            if (state.layerVisibility.regionLayer) {
              state.refreshRegionEntities(layerId);
            }
          });
          set({ isRestoringHistory: false });
        }, 0);
        
        return newState;
      }
      return {
        ...state,
        colorExtractMode: false,
        colorExtractPoints: [],
        colorExtractTool: null,
      };
    }),
  canUndo: () => {
    const state = useAppStore.getState();
    return state.historyIndex > 0;
  },
  canRedo: () => {
    const state = useAppStore.getState();
    return state.historyIndex < state.historySnapshots.length - 1;
  },

  saveToStorage: () => {
    const state = useAppStore.getState();
    const imageLayerId = state.imageState.imageLayerId;
    
    const data = {
      shapes: state.shapes.filter(s => s.layerId !== imageLayerId),
      pointAnnotations: state.pointAnnotations,
      regionAnnotations: state.regionAnnotations,
      groups: state.groups,
      layers: state.layers.filter(l => l.id !== imageLayerId),
      activeLayerId: state.activeLayerId,
      activeGroupId: state.activeGroupId,
      axis: state.axis,
      grid: state.grid,
      layerVisibility: state.layerVisibility,
      zoom: state.zoom, // 保存缩放状态
      panOffset: state.panOffset, // 保存平移偏移
    };
    localStorage.setItem('drawing-app-data', JSON.stringify(data));
  },
  exportToJson: () => {
    const state = useAppStore.getState();
    const imageLayerId = state.imageState.imageLayerId;

    // 计算正式区域信息（使用正式算法）
    const worldBounds = {
      xMin: state.axis.xMin,
      xMax: state.axis.xMax,
      yMin: state.axis.yMin,
      yMax: state.axis.yMax,
    };
    
    // 使用正式算法 computeRegionsExact
    const regions = computeRegionsExact(state.shapes, worldBounds, state.bfsResolution);

    // 构建区域环信息（标注内环/外环）
    const regionRingsInfo = regions.map((region, regionIdx) => {
      const rings = region.map((ring, ringIdx) => {
        // 判断内环/外环：第一个是外环，其余是内环
        const isOuter = ringIdx === 0;
        
        // 计算环的面积（用于验证方向）
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          area += ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
        }
        area /= 2;

        return {
          ringIndex: ringIdx,
          type: isOuter ? 'outer' : 'inner',  // 明确标注内环/外环
          pointCount: ring.length,
          area: area,
          direction: area >= 0 ? 'counterclockwise' : 'clockwise',  // 旋转方向
          // 环上每个点的坐标和顺序（按绘制顺序排列）
          points: ring.map((p, pIdx) => ({
            index: pIdx,
            x: p.x,
            y: p.y,
          })),
          // 环的包围框
          bounds: ring.length > 0 ? {
            minX: Math.min(...ring.map(p => p.x)),
            maxX: Math.max(...ring.map(p => p.x)),
            minY: Math.min(...ring.map(p => p.y)),
            maxY: Math.max(...ring.map(p => p.y)),
          } : null,
        };
      });

      // 计算区域总面积（外环面积 - 所有内环面积）
      const outerArea = rings.find(r => r.type === 'outer')?.area || 0;
      const innerAreas = rings.filter(r => r.type === 'inner').reduce((sum, r) => sum + Math.abs(r.area), 0);
      const totalArea = outerArea - innerAreas;

      return {
        regionIndex: regionIdx,
        ringCount: rings.length,
        outerRingCount: rings.filter(r => r.type === 'outer').length,
        innerRingCount: rings.filter(r => r.type === 'inner').length,
        totalArea: totalArea,
        rings: rings,
      };
    });

    const exportData = {
      version: '1.2',  // 版本升级：正式算法+内环/外环标注
      exportTime: new Date().toISOString(),
      axis: {
        xMin: state.axis.xMin,
        xMax: state.axis.xMax,
        yMin: state.axis.yMin,
        yMax: state.axis.yMax,
      },
      grid: {
        cols: state.grid.cols,
        rows: state.grid.rows,
        cellWidth: (state.axis.xMax - state.axis.xMin) / state.grid.cols,
        cellHeight: (state.axis.yMax - state.axis.yMin) / state.grid.rows,
      },
      layers: state.layers
        .filter(layer => layer.id !== imageLayerId)
        .map((layer, index) => ({
          id: layer.id,
          displayId: index + 1,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          shapes: state.shapes
            .filter(shape => shape.layerId === layer.id)
            .map(shape => ({
              id: shape.id,
              type: shape.type,
              groupId: shape.groupId,
              color: shape.color,
              points: shape.points.map(point => ({
                x: point.x,
                y: point.y,
              })),
            })),
        })),
      pointAnnotations: state.pointAnnotations,
      regionAnnotations: state.regionAnnotations,
      groups: state.groups,
      // 区域环信息（使用正式算法）
      regions: regionRingsInfo,
      // 色块数据
      colorBlocks: state.colorBlocks,
      nextColorBlockId: state.nextColorBlockId,
      // 【重构】区域实体数据（含 ftx 压缩数据）
      regionEntities: [],
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  loadFromStorage: () => {
    const stored = localStorage.getItem('drawing-app-data');
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      console.log('[loadFromStorage] 加载图形数量:', data.shapes?.length || 0);
      set((state) => {
        const activeLayerId = data.activeLayerId || state.activeLayerId;
        setTimeout(() => {
          get().refreshRegionCache(activeLayerId);
          get().refreshColorBlockCache(activeLayerId);
        }, 0);
        return {
          ...state,
          shapes: data.shapes || [],
          pointAnnotations: data.pointAnnotations || [],
          regionAnnotations: data.regionAnnotations || [],
          groups: data.groups || [],
          layers: data.layers.length > 0 ? data.layers : state.layers,
          activeLayerId,
          activeGroupId: data.activeGroupId || null,
          axis: data.axis || defaultAxis,
          grid: data.grid || state.grid,
          layerVisibility: data.layerVisibility || state.layerVisibility,
          colorBlocks: data.colorBlocks || [],
          nextColorBlockId: data.nextColorBlockId || 1,
          zoom: data.zoom ?? state.zoom ?? 1.0, // 加载缩放状态，使用默认值
          panOffset: data.panOffset ?? state.panOffset ?? { x: 0, y: 0 }, // 加载平移偏移
        };
      });
    } catch (e) {
      console.error('Failed to load from storage:', e);
    }
  },

  /** 触发画布重绘（用于蒙版特效参数修改后立即更新实时预览） */
  triggerCanvasRedraw: () => {
    // 通过递增 redrawTrigger 来触发 MainCanvas 中的 drawCanvas 重绘
    set((state) => ({
      redrawTrigger: state.redrawTrigger + 1,
    }));
  },

  regionAnimationSpeed: 0.5,
  setRegionAnimationSpeed: (speed) => set({ regionAnimationSpeed: speed }),
  regionAnimationTime: 0,
  setRegionAnimationTime: (time) => set({ regionAnimationTime: time }),

  isVertexPinMode: false,
  setVertexPinMode: (mode) => set({ isVertexPinMode: mode }),
  vertexPinRadius: 0.02,
  setVertexPinRadius: (radius) => set({ vertexPinRadius: Math.max(0.005, Math.min(0.1, radius)) }),
  isVertexPinEraserMode: false,
  setVertexPinEraserMode: (mode) => set({ isVertexPinEraserMode: mode }),

  showRegionBorderWebGL: true,
  setShowRegionBorderWebGL: (show) => set({ showRegionBorderWebGL: show }),

  showRegionBorder2D: false,
  setShowRegionBorder2D: (show) => set({ showRegionBorder2D: show }),

  baseColorEditorState: {
    baseTexture: null,
    residualTexture: null,
    bbox: null,
    baseColors: [],
    regionIdTex: new Uint8Array(0),
    bgImageData: null,
  },
  setBaseColorEditorState: (updates) => set((state) => ({
    baseColorEditorState: { ...state.baseColorEditorState, ...updates },
  })),
  clearBaseColorEditorState: () => set({
    baseColorEditorState: {
      baseTexture: null,
      residualTexture: null,
      bbox: null,
      baseColors: [],
      regionIdTex: new Uint8Array(0),
      bgImageData: null,
    },
  }),

  // 技能组编辑器
  skillGroupEditor: {
    frames: [],
    sharedBaseColors: [],
    activeFrameId: null,
    globalBbox: null,
    nextColorId: 1,
    enableFramePrediction: true,  // 默认开启帧间预测
  },

  // ===== 新架构：全局调色板初始状态 =====
  palette: new Map<number, PaletteColor>(),
  nextColorId: 1,
  sharedBaseColors: [],

  // ===== 新架构：核心函数实现 =====

  getAllFrameRefs: () => {
    const state = get();
    const refs: UnifiedFrameRef[] = [];
    // skillGroupEditor.frames
    for (const frame of state.skillGroupEditor.frames) {
      refs.push({
        id: frame.id,
        type: 'skillGroup' as const,
        regionIdTex: frame.regionIdTex || null,
        bbox: frame.bbox || null,
      });
    }
    // frameDataMap (only entries with rawRegionIdTex)
    for (const [layerId, fd] of Object.entries(state.frameDataMap)) {
      if (fd.rawRegionIdTex && fd.rawBbox) {
        refs.push({
          id: layerId,
          type: 'frameData' as const,
          regionIdTex: fd.rawRegionIdTex,
          bbox: fd.rawBbox,
        });
      }
    }
    return refs;
  },

  addColorToPalette: (hsl, frameId) => {
    const state = get();
    const palette = state.palette;
    const thresholdH = 0.005;
    const thresholdSL = 0.015;

    // 查找相似颜色
    let foundId: number | null = null;
    for (const [id, data] of palette) {
      const dh = Math.min(Math.abs(data.h - hsl.h), 1 - Math.abs(data.h - hsl.h));
      if (dh < thresholdH && Math.abs(data.s - hsl.s) < thresholdSL && Math.abs(data.l - hsl.l) < thresholdSL) {
        foundId = id;
        break;
      }
    }

    if (foundId !== null) {
      get().incrementColorRef(foundId, frameId);
      return foundId;
    }

    // 创建新颜色
    const newId = state.nextColorId;
    palette.set(newId, {
      h: hsl.h, s: hsl.s, l: hsl.l,
      frameIds: new Set<string>([frameId]),
    });
    set({ palette: new Map(palette), nextColorId: newId + 1 });
    // 同步到 skillGroupEditor（向后兼容）
    get().sortPaletteByArea();
    return newId;
  },

  updateColorValue: (colorId, newHsl) => {
    const state = get();
    const palette = state.palette;
    if (!palette.has(colorId)) return;
    const data = palette.get(colorId)!;
    data.h = newHsl.h; data.s = newHsl.s; data.l = newHsl.l;
    palette.set(colorId, data);
    set({ palette: new Map(palette) });
    // 刷新所有引用该颜色的帧纹理
    for (const frameId of data.frameIds) {
      get().syncFrameTextures(frameId);
    }
    get().sortPaletteByArea();
  },

  incrementColorRef: (colorId, frameId) => {
    const state = get();
    const palette = state.palette;
    if (!palette.has(colorId)) return;
    const data = palette.get(colorId)!;
    data.frameIds.add(frameId);
    palette.set(colorId, data);
    set({ palette: new Map(palette) });
    get().sortPaletteByArea();
  },

  decrementColorRef: (colorId, frameId) => {
    const state = get();
    const palette = state.palette;
    if (!palette.has(colorId)) return;
    const data = palette.get(colorId)!;
    data.frameIds.delete(frameId);
    palette.set(colorId, data);
    set({ palette: new Map(palette) });
    get().sortPaletteByArea();
  },

  pruneUnusedColors: () => {
    const state = get();
    const palette = state.palette;
    let changed = false;
    for (const [id, data] of palette) {
      if (data.frameIds.size === 0) {
        palette.delete(id);
        changed = true;
      }
    }
    if (changed) {
      set({ palette: new Map(palette) });
      get().sortPaletteByArea();
    }
  },

  replaceColorReferences: (oldId, newId) => {
    if (oldId === newId) return;
    const state = get();
    const palette = state.palette;
    if (!palette.has(oldId) || !palette.has(newId)) return;

    const oldData = palette.get(oldId)!;
    const newData = palette.get(newId)!;

    // 合并 frameIds
    for (const fid of oldData.frameIds) newData.frameIds.add(fid);
    oldData.frameIds.clear();

    // 遍历所有帧（skillGroupEditor 和 frameDataMap），替换像素中的 oldId 为 newId
    const allRefs = get().getAllFrameRefs();
    let updatedFrames = state.skillGroupEditor.frames;
    const updatedFrameDataMap = { ...state.frameDataMap };

    for (const ref of allRefs) {
      if (!ref.regionIdTex || ref.regionIdTex.length === 0) continue;
      const tex = ref.regionIdTex;
      let changed = false;
      for (let i = 0; i < tex.length; i++) {
        if (tex[i] === oldId) { tex[i] = newId; changed = true; }
      }
      if (!changed) continue;
      
      if (ref.type === 'skillGroup') {
        updatedFrames = updatedFrames.map(f => 
          f.id === ref.id ? { ...f, regionIdTex: tex } : f
        );
      } else {
        updatedFrameDataMap[ref.id] = { ...updatedFrameDataMap[ref.id], rawRegionIdTex: tex };
      }
    }

    palette.delete(oldId);
    set({
      palette: new Map(palette),
      skillGroupEditor: { ...state.skillGroupEditor, frames: updatedFrames },
      frameDataMap: updatedFrameDataMap,
    });

    // 刷新所有受影响帧的纹理
    for (const ref of allRefs) {
      if (ref.type === 'skillGroup') {
        get().syncFrameTextures(ref.id);
      }
    }
    get().sortPaletteByArea();
  },

  extractAndApplyColorsToFrame: (frameId) => {
    const state = get();
    const frame = state.skillGroupEditor.frames.find(f => f.id === frameId);
    if (!frame || !frame.bbox) {
      console.warn(`[提取] 帧 ${frameId} 缺少 bbox`);
      return;
    }

    // 颜色源优先级：用户修改后的 baseTexture > 原始背景图
    const colorSource = frame.baseTexture || frame.bgImageData;
    if (!colorSource) {
      console.warn(`[提取] 帧 ${frameId} 没有颜色数据源`);
      return;
    }

    const bbox = frame.bbox;

    // 掩码：基于 bbox 内所有不透明像素（不再依赖虚线多边形）
    const mask = new Uint8Array(bbox.w * bbox.h);
    let maskPixelCount = 0;
    for (let py = 0; py < bbox.h; py++) {
      for (let px = 0; px < bbox.w; px++) {
        const gx = bbox.x + px;
        const gy = bbox.y + py;
        const idx = (gy * 512 + gx) * 4;
        if (colorSource.data[idx + 3] > 0) {
          mask[py * bbox.w + px] = 1;
          maskPixelCount++;
        }
      }
    }
    if (maskPixelCount === 0) {
      console.warn(`[提取] 帧 ${frameId} bbox 内无有效像素`);
      return;
    }

    // 聚类提取（添加异常保护）
    let baseColors: Array<{ h: number; s: number; l: number }>;
    let regionIdTex: Uint8Array | null;
    let deltaPacked: Uint16Array;
    let blockFlags: bigint;
    try {
      const result = clusterAndGenerateTexturesV2(mask, bbox, colorSource, 0.025, 512);
      baseColors = result.baseColors;
      regionIdTex = result.regionIdTex;
      deltaPacked = result.deltaPacked;
      blockFlags = BigInt(result.blockFlags);
    } catch (err) {
      console.error(`[提取] 帧 ${frameId} 聚类失败:`, err);
      return;
    }

    if (baseColors.length === 0) {
      console.warn(`[提取] 帧 ${frameId} 未提取到颜色`);
      return;
    }

    console.log(`[重新聚类] 帧 ${frameId} 提取到 ${baseColors.length} 种基础色 (来自 ${maskPixelCount} 个有效像素)`);

    // 将本地颜色映射为全局 ID（通过 addColorToPalette 校验复用）
    const localToGlobal = new Map<number, number>();
    for (let i = 0; i < baseColors.length; i++) {
      const globalId = get().addColorToPalette(baseColors[i], frameId);
      localToGlobal.set(i + 1, globalId);
    }

    // 替换 regionIdTex 中的本地索引为全局 ID
    const newRegionIdTex = regionIdTex
      ? new Uint8Array(regionIdTex.length)
      : new Uint8Array(0);
    if (regionIdTex) {
      for (let i = 0; i < regionIdTex.length; i++) {
        const localIdx = regionIdTex[i];
        newRegionIdTex[i] = localIdx === 0 ? 0 : (localToGlobal.get(localIdx) || 0);
      }
    }

    const updatedFrames = state.skillGroupEditor.frames.map(f =>
      f.id === frameId ? { ...f, regionIdTex: newRegionIdTex, deltaPacked, blockFlags, baseColorValues: [] } : f
    );
    set({ skillGroupEditor: { ...state.skillGroupEditor, frames: updatedFrames } });

    get().syncFrameTextures(frameId);
    get().sortPaletteByArea();
  },

  reclusterFrameFromScratch: (frameId) => {
    const state = get();
    const frame = state.skillGroupEditor.frames.find(f => f.id === frameId);
    if (!frame) {
      console.warn(`[重新聚类] 帧 ${frameId} 不存在`);
      return;
    }

    const { regionIdTex } = frame;
    if (!regionIdTex || regionIdTex.length === 0) {
      console.warn(`[重新聚类] 帧 ${frameId} 没有 regionIdTex`);
      return;
    }

    // ============ 1. 统计当前帧每个 ID 的使用次数 ============
    const usageCount = new Map<number, number>();
    for (const id of regionIdTex) {
      if (id !== 0) {
        usageCount.set(id, (usageCount.get(id) || 0) + 1);
      }
    }

    if (usageCount.size === 0) {
      console.warn(`[重新聚类] 帧 ${frameId} 没有有效颜色`);
      return;
    }

    // 按使用次数降序排序（大面积颜色优先作为合并目标）
    const sortedIds = Array.from(usageCount.keys()).sort(
      (a, b) => (usageCount.get(b) || 0) - (usageCount.get(a) || 0)
    );
    console.log(`[重新聚类] 帧 ${frameId} 当前使用 ${sortedIds.length} 种颜色`);

    // ============ 2. 合并相似颜色（H/S/L 阈值均为 0.015）============
    const THRESHOLD = 0.015;
    const palette = state.palette;
    const mergeMap = new Map<number, number>(); // oldId → mergedToId
    const keptIds = new Set<number>();

    for (const candidateId of sortedIds) {
      if (mergeMap.has(candidateId)) continue; // 已被合并到其他颜色
      if (!palette.has(candidateId)) continue; // 调色板中不存在（异常）

      const candidateColor = palette.get(candidateId)!;
      keptIds.add(candidateId);

      // 与后续 ID 比较相似度
      for (const otherId of sortedIds) {
        if (otherId === candidateId) continue;
        if (mergeMap.has(otherId)) continue; // 已被合并
        if (!palette.has(otherId)) continue;

        const otherColor = palette.get(otherId)!;
        // 色相环距离
        const dh = Math.min(
          Math.abs(candidateColor.h - otherColor.h),
          1 - Math.abs(candidateColor.h - otherColor.h)
        );
        const ds = Math.abs(candidateColor.s - otherColor.s);
        const dl = Math.abs(candidateColor.l - otherColor.l);

        if (dh < THRESHOLD && ds < THRESHOLD && dl < THRESHOLD) {
          // 相似 → 合并到 candidateId（大面积优先）
          mergeMap.set(otherId, candidateId);
          keptIds.delete(otherId);
        }
      }
    }

    // ============ 3. 更新当前帧的 regionIdTex ============
    if (mergeMap.size > 0) {
      const newRegionIdTex = new Uint8Array(regionIdTex);
      for (let i = 0; i < newRegionIdTex.length; i++) {
        const oldId = newRegionIdTex[i];
        if (oldId !== 0 && mergeMap.has(oldId)) {
          newRegionIdTex[i] = mergeMap.get(oldId)!;
        }
      }

      // 维护调色板引用计数：被合并的 ID 从当前帧解引用
      for (const [oldId, newId] of mergeMap) {
        get().decrementColorRef(oldId, frameId);
        get().incrementColorRef(newId, frameId);
      }

      // 更新 store
      const updatedFrames = state.skillGroupEditor.frames.map(f =>
        f.id === frameId ? { ...f, regionIdTex: newRegionIdTex } : f
      );
      set({
        skillGroupEditor: {
          ...state.skillGroupEditor,
          frames: updatedFrames,
        },
      });

      console.log(`[重新聚类] 合并了 ${mergeMap.size} 个相似颜色，保留 ${keptIds.size} 种`);
    } else {
      console.log(`[重新聚类] 未发现需要合并的相似颜色`);
    }

    // ============ 4. 清理全局调色板（遍历所有帧，删除无引用的颜色）============
    // 注意：只删除全局范围内无任何帧引用的颜色，不影响其他帧的可用颜色
    const allRefs = get().getAllFrameRefs();
    const globalUsedIds = new Set<number>();
    for (const ref of allRefs) {
      if (ref.regionIdTex) {
        for (const id of ref.regionIdTex) {
          if (id !== 0) globalUsedIds.add(id);
        }
      }
    }

    let paletteChanged = false;
    for (const [id] of palette) {
      if (!globalUsedIds.has(id)) {
        palette.delete(id);
        paletteChanged = true;
      }
    }
    if (paletteChanged) {
      set({ palette: new Map(palette) });
      console.log(`[重新聚类] 清理了未被任何帧引用的冗余颜色`);
    }

    // ============ 5. 重新生成 sharedBaseColors 并同步纹理 ============
    get().sortPaletteByArea();
    get().syncFrameTextures(frameId);
    get().triggerCanvasRedraw();

    console.log(`[重新聚类] 帧 ${frameId} 完成，合并 ${mergeMap.size} 个 ID，清理 ${paletteChanged ? '冗余' : '无'} 颜色`);
  },

  deleteColorFromFrame: (frameId, colorId) => {
    const state = get();
    const frame = state.skillGroupEditor.frames.find(f => f.id === frameId);
    
    if (frame && frame.regionIdTex && frame.regionIdTex.length > 0) {
      const tex = frame.regionIdTex;
      // 统计该帧内各颜色像素数（排除要删除的 colorId）
      const colorCount = new Map<number, number>();
      for (const id of tex) {
        if (id !== 0 && id !== colorId) {
          colorCount.set(id, (colorCount.get(id) || 0) + 1);
        }
      }

      if (colorCount.size === 0) {
        get().clearAllColorsInFrame(frameId);
        return;
      }

      // 找面积最大的颜色作为替换色
      let replaceId = 0, maxCount = 0;
      for (const [id, cnt] of colorCount) {
        if (cnt > maxCount) { maxCount = cnt; replaceId = id; }
      }

      const newTex = new Uint8Array(tex);
      for (let i = 0; i < newTex.length; i++) {
        if (newTex[i] === colorId) newTex[i] = replaceId;
      }

      const updatedFrames = state.skillGroupEditor.frames.map(f =>
        f.id === frameId ? { ...f, regionIdTex: newTex } : f
      );
      set({ skillGroupEditor: { ...state.skillGroupEditor, frames: updatedFrames } });

      get().decrementColorRef(colorId, frameId);
      get().pruneUnusedColors();
      get().syncFrameTextures(frameId);
      get().sortPaletteByArea();
      return;
    }

    // 尝试 frameDataMap
    const fd = state.frameDataMap[frameId];
    if (!fd || !fd.rawRegionIdTex || fd.rawRegionIdTex.length === 0) return;

    const tex = fd.rawRegionIdTex;
    const colorCount = new Map<number, number>();
    for (const id of tex) {
      if (id !== 0 && id !== colorId) {
        colorCount.set(id, (colorCount.get(id) || 0) + 1);
      }
    }

    if (colorCount.size === 0) {
      get().clearAllColorsInFrame(frameId);
      return;
    }

    let replaceId = 0, maxCount = 0;
    for (const [id, cnt] of colorCount) {
      if (cnt > maxCount) { maxCount = cnt; replaceId = id; }
    }

    const newTex = new Uint8Array(tex);
    for (let i = 0; i < newTex.length; i++) {
      if (newTex[i] === colorId) newTex[i] = replaceId;
    }

    set({
      frameDataMap: {
        ...state.frameDataMap,
        [frameId]: { ...fd, rawRegionIdTex: newTex },
      },
    });

    get().decrementColorRef(colorId, frameId);
    get().pruneUnusedColors();
    get().syncFrameTextures(frameId);
    get().sortPaletteByArea();
  },

  clearAllColorsInFrame: (frameId) => {
    const state = get();
    
    // 先尝试 skillGroupEditor.frames
    const frame = state.skillGroupEditor.frames.find(f => f.id === frameId);
    if (frame) {
      // 收集该帧引用的所有颜色 ID
      const usedIds = new Set<number>();
      if (frame.regionIdTex) {
        for (const id of frame.regionIdTex) {
          if (id !== 0) usedIds.add(id);
        }
      }

      // 清空像素映射
      const newTex = frame.regionIdTex ? new Uint8Array(frame.regionIdTex.length) : new Uint8Array(0);
      const updatedFrames = state.skillGroupEditor.frames.map(f =>
        f.id === frameId ? { ...f, regionIdTex: newTex, baseTexture: null, residualTexture: null } : f
      );
      set({ skillGroupEditor: { ...state.skillGroupEditor, frames: updatedFrames } });

      // 解绑引用
      for (const id of usedIds) {
        get().decrementColorRef(id, frameId);
      }
      get().pruneUnusedColors();
      get().sortPaletteByArea();
      return;
    }

    // 尝试 frameDataMap
    const fd = state.frameDataMap[frameId];
    if (!fd) return;

    const usedIds = new Set<number>();
    if (fd.rawRegionIdTex) {
      for (const id of fd.rawRegionIdTex) {
        if (id !== 0) usedIds.add(id);
      }
    }

    const newTex = fd.rawRegionIdTex ? new Uint8Array(fd.rawRegionIdTex.length) : new Uint8Array(0);
    set({
      frameDataMap: {
        ...state.frameDataMap,
        [frameId]: { ...fd, rawRegionIdTex: newTex, baseTexture: null },
      },
    });

    for (const id of usedIds) {
      get().decrementColorRef(id, frameId);
    }
    get().pruneUnusedColors();
    get().sortPaletteByArea();
  },

  sortPaletteByArea: () => {
    const state = get();
    const palette = state.palette;
    const areaMap = new Map<number, number>();
    for (const [id] of palette) areaMap.set(id, 0);

    for (const ref of get().getAllFrameRefs()) {
      if (!ref.regionIdTex || ref.regionIdTex.length === 0) continue;
      for (const id of ref.regionIdTex) {
        if (id !== 0) areaMap.set(id, (areaMap.get(id) || 0) + 1);
      }
    }

    const sorted = Array.from(palette.entries())
      .map(([id, data]) => ({
        id, h: data.h, s: data.s, l: data.l,
        frameIds: Array.from(data.frameIds),
        area: areaMap.get(id) || 0,
      }))
      .sort((a, b) => b.area - a.area);

    set({
      sharedBaseColors: sorted,
      skillGroupEditor: { ...state.skillGroupEditor, sharedBaseColors: sorted },
    });
  },

  syncFrameTextures: (frameId) => {
    const state = get();
    
    // 先尝试 skillGroupEditor.frames
    const frame = state.skillGroupEditor.frames.find(f => f.id === frameId);
    if (frame && frame.regionIdTex && frame.bbox) {
      const sortedColors = state.sharedBaseColors;
      const bbox = frame.bbox;
      const textureSize = frame.bgImageData?.width || 512;
      const totalPixels = textureSize * textureSize;

      // 内联 buildBaseTextureFromRegionId
      const baseData = new Uint8ClampedArray(totalPixels * 4);
      const colorMap = new Map<number, { h: number; s: number; l: number }>();
      for (const c of sortedColors) colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });

      for (let py = 0; py < bbox.h; py++) {
        for (let px = 0; px < bbox.w; px++) {
          const localIdx = py * bbox.w + px;
          const colorId = frame.regionIdTex[localIdx];
          const globalIdx = ((bbox.y + py) * textureSize + (bbox.x + px)) * 4;
          if (colorId === 0) {
            baseData[globalIdx] = 0; baseData[globalIdx + 1] = 0;
            baseData[globalIdx + 2] = 0; baseData[globalIdx + 3] = 0;
            continue;
          }
          const c = colorMap.get(colorId);
          if (!c) {
            baseData[globalIdx + 3] = 0;
            continue;
          }
          const { r, g, b } = hslToRgb(c.h, c.s, c.l);
          baseData[globalIdx] = r; baseData[globalIdx + 1] = g;
          baseData[globalIdx + 2] = b; baseData[globalIdx + 3] = 255;
        }
      }
      const newBase = new ImageData(baseData, textureSize, textureSize);

      // 内联 buildResidualTextureFromPacked
      const residualData = new Uint8ClampedArray(totalPixels * 4);
      if (frame.deltaPacked && frame.deltaPacked.length > 0) {
        for (let py = 0; py < bbox.h; py++) {
          for (let px = 0; px < bbox.w; px++) {
            const localIdx = py * bbox.w + px;
            const colorId = frame.regionIdTex[localIdx];
            const globalIdx = ((bbox.y + py) * textureSize + (bbox.x + px)) * 4;
            if (colorId === 0) { residualData[globalIdx + 3] = 0; continue; }

            // 解包 RGB565
            const packed = frame.deltaPacked[localIdx];
            const r = (packed >> 11) & 0x1F;
            const g = (packed >> 5) & 0x3F;
            const b_val = packed & 0x1F;
            residualData[globalIdx] = Math.round((r / 31) * 255);
            residualData[globalIdx + 1] = Math.round((g / 63) * 255);
            residualData[globalIdx + 2] = Math.round((b_val / 31) * 255);
            residualData[globalIdx + 3] = 255;
          }
        }
      }
      const newResidual = new ImageData(residualData, textureSize, textureSize);

      const updatedFrames = state.skillGroupEditor.frames.map(f =>
        f.id === frameId ? { ...f, baseTexture: newBase, residualTexture: newResidual } : f
      );
      set({ skillGroupEditor: { ...state.skillGroupEditor, frames: updatedFrames } });
      get().triggerCanvasRedraw();
      return;
    }

    // 尝试 frameDataMap
    const fd = state.frameDataMap[frameId];
    if (fd && fd.rawRegionIdTex && fd.rawBbox) {
      const sortedColors = state.sharedBaseColors;
      const bbox = fd.rawBbox;
      const textureSize = fd.sourceResolution || 512;
      const totalPixels = textureSize * textureSize;
      const colorMap = new Map<number, { h: number; s: number; l: number }>();
      for (const c of sortedColors) colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });

      const baseData = new Uint8ClampedArray(totalPixels * 4);
      for (let py = 0; py < bbox.h; py++) {
        for (let px = 0; px < bbox.w; px++) {
          const localIdx = py * bbox.w + px;
          const colorId = fd.rawRegionIdTex[localIdx];
          const globalIdx = ((bbox.y + py) * textureSize + (bbox.x + px)) * 4;
          if (colorId === 0) {
            baseData[globalIdx] = 0; baseData[globalIdx + 1] = 0;
            baseData[globalIdx + 2] = 0; baseData[globalIdx + 3] = 0;
            continue;
          }
          const c = colorMap.get(colorId);
          if (!c) { baseData[globalIdx + 3] = 0; continue; }
          const { r, g, b } = hslToRgb(c.h, c.s, c.l);
          baseData[globalIdx] = r; baseData[globalIdx + 1] = g;
          baseData[globalIdx + 2] = b; baseData[globalIdx + 3] = 255;
        }
      }
      const newBase = new ImageData(baseData, textureSize, textureSize);

      set({
        frameDataMap: {
          ...state.frameDataMap,
          [frameId]: {
            ...fd,
            baseTexture: newBase,
            boundBaseTexture: fd.boundRegionId !== null ? newBase : fd.boundBaseTexture,
          },
        },
      });
      return;
    }
  },

  mergeSimilarColors: (threshold = 0.005) => {
    const state = get();
    const palette = state.palette;
    const ids = Array.from(palette.keys());

    const areaMap = new Map<number, number>();
    for (const ref of get().getAllFrameRefs()) {
      if (!ref.regionIdTex || ref.regionIdTex.length === 0) continue;
      for (const id of ref.regionIdTex) {
        if (id !== 0) areaMap.set(id, (areaMap.get(id) || 0) + 1);
      }
    }
    const sortedIds = ids.sort((a, b) => (areaMap.get(b) || 0) - (areaMap.get(a) || 0));
    const merged = new Set<number>();

    for (const id of sortedIds) {
      if (merged.has(id) || !palette.has(id)) continue;
      const data = palette.get(id)!;
      for (const otherId of sortedIds) {
        if (otherId === id || merged.has(otherId) || !palette.has(otherId)) continue;
        const otherData = palette.get(otherId)!;
        const dh = Math.min(Math.abs(data.h - otherData.h), 1 - Math.abs(data.h - otherData.h));
        if (dh < threshold && Math.abs(data.s - otherData.s) < 0.015 && Math.abs(data.l - otherData.l) < 0.015) {
          get().replaceColorReferences(otherId, id);
          merged.add(otherId);
        }
      }
    }

    get().pruneUnusedColors();
    get().sortPaletteByArea();
    for (const ref of get().getAllFrameRefs()) {
      get().syncFrameTextures(ref.id);
    }
  },

  resetCurrentFrameColors: (frameId) => {
    get().clearAllColorsInFrame(frameId);
    get().extractAndApplyColorsToFrame(frameId);
    get().mergeSimilarColors(0.005);
    get().pruneUnusedColors();
    get().sortPaletteByArea();
    for (const ref of get().getAllFrameRefs()) {
      get().syncFrameTextures(ref.id);
    }
  },

  addSkillFrame: (name) => {
    set((state) => {
      const newFrame = {
        id: `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name || `帧 ${state.skillGroupEditor.frames.length + 1}`,
        bgImageData: null,
        dashedPolygons: [],
        baseTexture: null,
        residualTexture: null,
        deltaPacked: new Uint16Array(0),
        blockFlags: 0n,
        bbox: null,
        regionIdTex: new Uint8Array(0),
        baseColorValues: [],
      };
      return {
        skillGroupEditor: {
          ...state.skillGroupEditor,
          frames: [...state.skillGroupEditor.frames, newFrame],
          activeFrameId: state.skillGroupEditor.frames.length === 0 ? newFrame.id : state.skillGroupEditor.activeFrameId,
        },
      };
    });
  },
  removeSkillFrame: (frameId) => {
    set((state) => {
      const newFrames = state.skillGroupEditor.frames.filter(f => f.id !== frameId);
      let newActiveId = state.skillGroupEditor.activeFrameId;
      if (newActiveId === frameId) {
        newActiveId = newFrames.length > 0 ? newFrames[0].id : null;
      }
      return {
        skillGroupEditor: {
          ...state.skillGroupEditor,
          frames: newFrames,
          activeFrameId: newActiveId,
        },
      };
    });
  },
  switchSkillFrame: (frameId) => {
    set((state) => ({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        activeFrameId: frameId,
      },
    }));
  },
  updateSkillFrame: (frameId, data) => {
    set((state) => ({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        frames: state.skillGroupEditor.frames.map((f) =>
          f.id === frameId ? { ...f, ...data } : f
        ),
      },
    }));
  },
  setSharedBaseColors: (colors) => {
    const newPalette = new Map<number, PaletteColor>();
    for (const c of colors) {
      newPalette.set(c.id, {
        h: c.h, s: c.s, l: c.l,
        frameIds: new Set(Array.isArray(c.frameIds) ? c.frameIds : []),
      });
    }
    set((state) => ({
      palette: newPalette,
      sharedBaseColors: colors,
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: colors,
      },
    }));
  },
  setGlobalBbox: (bbox) => {
    set((state) => ({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        globalBbox: bbox,
      },
    }));
  },
  syncGlobalBboxFromCurrentFrame: () => {
    const state = get();
    const { activeFrameId, frames } = state.skillGroupEditor;
    if (!activeFrameId) return;
    const frame = frames.find(f => f.id === activeFrameId);
    if (!frame || !frame.bbox) return;
    set((state) => ({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        globalBbox: { ...frame.bbox! },
      },
    }));
  },
  setNextColorId: (nextId) => {
    set((state) => ({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        nextColorId: nextId,
      },
    }));
  },
  addColorToGlobal: (color, frameId) => {
    return get().addColorToPalette(color, frameId);
  },
  updateColorInGlobal: (id, color, _sourceFrameId) => {
    get().updateColorValue(id, color);
  },
  recalculateAllAreas: () => {
    get().sortPaletteByArea();
  },
  mergeAndSortColors: (_updatedColorId?) => {
    get().mergeSimilarColors();
  },

  cleanupAndSortColors: () => {
    get().pruneUnusedColors();
    get().sortPaletteByArea();
  },

  reclusterCurrentFrame: () => {
    const state = get();
    const frameId = state.skillGroupEditor.activeFrameId;
    if (frameId) get().reclusterFrameFromScratch(frameId);
  },

  // 多帧 FTX 导入
  frameDataMap: {},

  importMultiFrameData: async (buffer: ArrayBuffer) => {
    const { unpackMultiFrameFromBinary } = await import('../utils/binaryCompression');
    const { decodeFrameToTextures } = await import('../utils/colorCompressor');
    const state = get();

    const multiData = unpackMultiFrameFromBinary(buffer);
    const { palette, frames } = multiData;

    if (frames.length === 0) return;

    // ---------- 合并调色板 ----------
    const currentPalette = [...state.skillGroupEditor.sharedBaseColors];
    let nextId = currentPalette.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    const globalIdMap = new Map<number, number>();

    for (let i = 0; i < palette.length; i++) {
      const imp = palette[i];
      let found = false;
      for (const c of currentPalette) {
        const dh = Math.min(Math.abs(c.h - imp.h), 1 - Math.abs(c.h - imp.h));
        if (dh < 0.02 && Math.abs(c.s - imp.s) < 0.015 && Math.abs(c.l - imp.l) < 0.015) {
          globalIdMap.set(i + 1, c.id);
          found = true;
          break;
        }
      }
      if (!found) {
        const newId = nextId++;
        currentPalette.push({ ...imp, id: newId, frameIds: [], area: 0 });
        globalIdMap.set(i + 1, newId);
      }
    }

    // ---------- 获取背景层（displayId === 0）----------
    const bgLayerId = state.imageState.imageLayerId;
    const bgLayer = state.layers.find(l => l.id === bgLayerId);

    // ---------- 获取所有绘制层（非背景层），按现有 displayId 排序 ----------
    const drawLayers = state.layers
      .filter(l => l.id !== bgLayerId)
      .sort((a, b) => (a.displayId || 0) - (b.displayId || 0));

    const newFrameDataMap: Record<string, import('../types').FrameData> = {};
    const updatedLayers: Layer[] = [];

    // ---------- 按帧顺序处理 ----------
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];

      // 将 regionIdTex 从导入索引映射到全局 ID
      const mappedRegionIdTex = new Uint8Array(frame.regionIdTex.length);
      for (let j = 0; j < frame.regionIdTex.length; j++) {
        const oldId = frame.regionIdTex[j];
        mappedRegionIdTex[j] = oldId === 0 ? 0 : (globalIdMap.get(oldId) || 0);
      }

      // 解码生成预览纹理（使用合并后的调色板）
      const previewFrame = {
        ...frame,
        regionIdTex: mappedRegionIdTex,
      };
      const { baseTexture, residualTexture } = decodeFrameToTextures(previewFrame, currentPalette);

      // 调试日志
      let paintedPixels = 0;
      const bd = baseTexture.data;
      for (let j = 3; j < bd.length; j += 4) {
        if (bd[j] > 0) paintedPixels++;
      }
      console.log(`[FTX导入] 帧"${frame.name}" 解码完成，底图像素数: ${paintedPixels}, bbox: (${frame.bbox.x},${frame.bbox.y},${frame.bbox.w}x${frame.bbox.h})`);

      const layerName = frame.name || `帧 ${i + 1}`;
      let layerId: string;
      let existingLayer: Layer | undefined;

      if (i < drawLayers.length) {
        // ---------- 复用已有绘制图层 ----------
        existingLayer = drawLayers[i];
        layerId = existingLayer.id;
        existingLayer.name = layerName;
        updatedLayers.push(existingLayer);
      } else {
        // ---------- 新建绘制图层 ----------
        layerId = `layer_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        const newLayer: Layer = {
          id: layerId,
          displayId: 0,
          name: layerName,
          visible: true,
          locked: false,
          opacity: 1,
        };
        updatedLayers.push(newLayer);
      }

      // 存入 frameDataMap（包含原始数据和预览纹理）
      newFrameDataMap[layerId] = {
        id: layerId,
        rawRegionIdTex: mappedRegionIdTex,
        rawDeltaPacked: frame.deltaPacked,
        rawBbox: frame.bbox,
        rawBlockFlags: BigInt(frame.blockFlags),
        sourceResolution: frame.width,
        baseTexture,
        residualTexture,
        boundRegionId: null,
        boundBaseTexture: null,
        boundResidualTexture: null,
        textureOffset: { x: 0, y: 0 },
        textureScale: { x: 1, y: 1 },
        textureRotation: 0,
        distortEnabled: false,
        distortAmplitude: 0.06,
        distortFrequency: 5.0,
        distortSpeed: 1.2,
        distortRotation: 0,
      };
    }

    // ---------- 移除多余的绘制层（帧数少于原有图层） ----------
    const layersToRemove = drawLayers.slice(frames.length);

    // ---------- 清理被删除的图层数据 ----------
    const finalFrameDataMap = { ...state.frameDataMap };
    for (const layer of layersToRemove) {
      delete finalFrameDataMap[layer.id];
    }
    Object.assign(finalFrameDataMap, newFrameDataMap);

    // ---------- 构建最终图层列表：背景层 + 所有绘制层（重新编号） ----------
    const finalLayers: Layer[] = [];

    // 1. 背景层（如果存在）保持 displayId = 0
    if (bgLayer) {
      bgLayer.displayId = 0;
      finalLayers.push(bgLayer);
    }

    // 2. 所有绘制层（复用 + 新建）重新分配 displayId 从 1 开始
    let displayCounter = 1;
    for (const layer of updatedLayers) {
      layer.displayId = displayCounter++;
      finalLayers.push(layer);
    }

    // 激活第一个导入的帧对应的图层（如果有）
    const firstLayerId = updatedLayers.length > 0 ? updatedLayers[0].id : state.activeLayerId;

    // 取第一帧的 bbox 调整画布尺寸
    const firstFrame = frames[0];
    const firstBbox = firstFrame?.bbox;

    // ---------- 一次性更新状态 ----------
    // 同时构建新调色板 Map
    const newPalette = new Map<number, PaletteColor>();
    for (const c of currentPalette) {
      newPalette.set(c.id, {
        h: c.h, s: c.s, l: c.l,
        frameIds: new Set(Array.isArray(c.frameIds) ? c.frameIds : []),
      });
    }

    // 将导入帧的 layerId 加入调色板中对应颜色的 frameIds
    for (const [layerId, frameData] of Object.entries(newFrameDataMap)) {
      if (frameData.rawRegionIdTex && frameData.rawRegionIdTex.length > 0) {
        const usedIds = new Set<number>();
        for (const id of frameData.rawRegionIdTex) {
          if (id > 0) usedIds.add(id);
        }
        for (const c of currentPalette) {
          if (usedIds.has(c.id) && !c.frameIds.includes(layerId)) {
            c.frameIds.push(layerId);
          }
        }
        // 同步更新 newPalette
        for (const [id, pdata] of newPalette) {
          if (usedIds.has(id)) {
            pdata.frameIds.add(layerId);
          }
        }
      }
    }

    set({
      layers: finalLayers,
      frameDataMap: finalFrameDataMap,
      activeLayerId: firstLayerId,
      palette: newPalette,
      sharedBaseColors: currentPalette,
      nextColorId: nextId,
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: currentPalette,
      },
      // 动态调整画布尺寸以匹配 bbox
      canvasWidth: firstBbox ? firstBbox.w : state.canvasWidth,
      canvasHeight: firstBbox ? firstBbox.h : state.canvasHeight,
      // 🔽 重置视图变换，避免导入后内容偏移和重复绘制
      zoom: 1.0,
      panOffset: { x: 0, y: 0 },
    });

    console.log(`[FTX导入] 成功导入 ${frames.length} 帧，调色板 ${palette.length}→${currentPalette.length} 色，更新/创建 ${updatedLayers.length} 个绘制图层`);
  },

  // ===== 获取某图层可绑定的区域列表 =====
  getBindableRegions: (layerId: string) => {
    const state = get();
    const entities = state.regionEntities[layerId] || [];
    return entities.map(entity => ({
      id: entity.id,
      name: `区域 ${entity.id} (${entity.boundary.length} 环)`,
    }));
  },

  // ===== 帧间预测开关 =====
  setEnableFramePrediction: (enabled: boolean) => {
    set((s) => ({
      skillGroupEditor: { ...s.skillGroupEditor, enableFramePrediction: enabled },
    }));
  },

  // ===== 绑定图层到区域（使用全局调色板 + 多边形裁剪）=====
  bindFrameToLayer: async (layerId: string, regionId: number | null) => {
    const { decodeFrameWithGlobalPalette } = await import('../utils/colorCompressor');
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) {
      console.warn(`[绑定] 图层 ${layerId} 没有帧数据`);
      return;
    }

    // 解绑
    if (regionId === null) {
      set((s) => ({
        frameDataMap: {
          ...s.frameDataMap,
          [layerId]: {
            ...frameData,
            boundRegionId: null,
            boundBaseTexture: null,
            boundResidualTexture: null,
          },
        },
      }));
      console.log(`[绑定] 图层 ${layerId} 已解绑`);
      return;
    }

    // 查找对应的区域实体
    const entities = state.regionEntities[layerId] || [];
    const entity = entities.find(e => e.id === regionId);
    if (!entity) {
      console.warn(`[绑定] 图层 ${layerId} 中不存在区域 ID ${regionId}`);
      return;
    }

    // 使用全局调色板解码帧数据（rawRegionIdTex 已经是全局 ID）
    const globalPalette = state.skillGroupEditor.sharedBaseColors;
    const raw = frameData.rawRegionIdTex;
    if (!raw || raw.length === 0) {
      console.warn(`[绑定] 图层 ${layerId} 没有原始区域ID纹理`);
      return;
    }

    // ★ 关键修复：使用原始纹理尺寸（sourceResolution），而非硬编码 512
    const texSize = frameData.sourceResolution || 512;
    const fullBase = decodeFrameWithGlobalPalette(
      raw,
      frameData.rawDeltaPacked,
      globalPalette,
      frameData.rawBbox!,
      frameData.rawBlockFlags,
      texSize
    );

    // 裁剪为 bbox 区域，确保绑定后纹理尺寸与画布（= bbox 尺寸）匹配
    const cropToBbox = (src: ImageData, bbox: { x: number; y: number; w: number; h: number }): ImageData => {
      const dst = new ImageData(bbox.w, bbox.h);
      const srcData = src.data;
      const dstData = dst.data;
      for (let r = 0; r < bbox.h; r++) {
        for (let c = 0; c < bbox.w; c++) {
          const si = ((bbox.y + r) * src.width + (bbox.x + c)) * 4;
          const di = (r * bbox.w + c) * 4;
          dstData[di] = srcData[si];
          dstData[di + 1] = srcData[si + 1];
          dstData[di + 2] = srcData[si + 2];
          dstData[di + 3] = srcData[si + 3];
        }
      }
      return dst;
    };
    const croppedBase = frameData.rawBbox
      ? cropToBbox(fullBase, frameData.rawBbox)
      : fullBase;

    // 直接保存裁剪后的底图（bbox 尺寸），模板缓冲负责每帧的边界裁剪
    // VAT 驱动网格顶点扭曲 → 填充网格写入模板缓冲 → 颜色网格采样（仅模板=1区域）
    let validPixelCount = 0;
    const data = fullBase.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) validPixelCount++;
    }

    if (validPixelCount === 0) {
      console.warn(`[绑定] 该帧没有有效像素`);
      return;
    }

    set((s) => {
      const bbox = frameData.rawBbox;
      return {
        frameDataMap: {
          ...s.frameDataMap,
          [layerId]: {
            ...frameData,
            boundRegionId: regionId,
            boundBaseTexture: croppedBase,
            boundResidualTexture: null,
            textureOffset: frameData.textureOffset || { x: 0, y: 0 },
            textureScale: frameData.textureScale || { x: 1, y: 1 },
            textureRotation: frameData.textureRotation || 0,
            distortEnabled: frameData.distortEnabled || false,
            distortAmplitude: frameData.distortAmplitude ?? 0.06,
            distortFrequency: frameData.distortFrequency ?? 5.0,
            distortSpeed: frameData.distortSpeed ?? 1.2,
            distortRotation: frameData.distortRotation ?? 0,
          },
        },
        // 绑定后更新画布尺寸为 bbox 尺寸，并重置视图
        ...(bbox && (s.canvasWidth !== bbox.w || s.canvasHeight !== bbox.h) ? {
          canvasWidth: bbox.w,
          canvasHeight: bbox.h,
          zoom: 1,
          panOffset: { x: 0, y: 0 },
        } : {}),
      };
    });

    // ★ 状态更新是异步的，需要延迟刷新确保使用新的画布尺寸
    setTimeout(() => {
      // 强制刷新区域实体，确保位移纹理使用新的画布尺寸
      get().refreshRegionEntities(layerId);
      // 触发画布重绘
      get().triggerCanvasRedraw();
    }, 0);

    console.log(`[绑定] 图层 ${layerId} 成功绑定到区域 ${regionId}，有效像素 ${validPixelCount}`);
  },

  // ===== 设置底图纹理变换（偏移、缩放和旋转）=====
  setFrameTextureTransform: (layerId: string, offset: { x: number; y: number }, scale: { x: number; y: number }, rotation: number = 0, distortEnabled: boolean = false) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) {
      console.warn(`[底图变换] 图层 ${layerId} 没有帧数据`);
      return;
    }
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          textureOffset: offset,
          textureScale: scale,
          textureRotation: rotation,
          distortEnabled: distortEnabled,
        },
      },
    }));
    console.log(`[底图变换] 图层 ${layerId} 偏移=(${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}) 缩放=(${scale.x.toFixed(3)}, ${scale.y.toFixed(3)}) 旋转=${rotation.toFixed(3)}rad 扭曲=${distortEnabled}`);
  },

  // ===== 切换呼吸式纹理扭曲效果 =====
  toggleFrameDistort: (layerId: string) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) {
      console.warn(`[底图变换] 图层 ${layerId} 没有帧数据`);
      return;
    }
    const newEnabled = !frameData.distortEnabled;
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          distortEnabled: newEnabled,
        },
      },
    }));
    console.log(`[底图变换] 图层 ${layerId} 呼吸扭曲效果 ${newEnabled ? '启用' : '禁用'}`);
  },

  // ===== 设置呼吸式扭曲参数 =====
  setFrameDistortParams: (layerId: string, params: { amplitude?: number; frequency?: number; speed?: number; rotation?: number }) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) {
      console.warn(`[底图变换] 图层 ${layerId} 没有帧数据`);
      return;
    }
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          distortAmplitude: params.amplitude ?? frameData.distortAmplitude,
          distortFrequency: params.frequency ?? frameData.distortFrequency,
          distortSpeed: params.speed ?? frameData.distortSpeed,
          distortRotation: params.rotation ?? frameData.distortRotation,
        },
      },
    }));
  },

  // ===== 流体特效 actions =====
  updateFluidConfig: (layerId, partial) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const prev = (frameData.fluidConfig ?? {}) as Record<string, any>;
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          fluidConfig: {
            ...prev,
            ...partial,
            scalarConfig: { ...(prev.scalarConfig ?? {}), ...(partial.scalarConfig ?? {}) },
            // ★ Level Set 配置深度合并（与 scalarConfig 同处理）
            levelSetConfig: { ...(prev.levelSetConfig ?? {}), ...(partial.levelSetConfig ?? {}) },
            resolution: partial.resolution ?? prev.resolution ?? { w: frameData.sourceResolution || 512, h: frameData.sourceResolution || 512 },
          } as any,
        },
      },
    }));
  },

  toggleFluidPlaying: (layerId) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const rt = frameData.fluidRuntime ?? { isPlaying: false, speed: 1, currentTime: 0, viewMode: 'composite' as const, frameCount: 0 };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: { ...frameData, fluidRuntime: { ...rt, isPlaying: !rt.isPlaying } },
      },
    }));
  },

  setFluidSpeed: (layerId, speed) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const rt = frameData.fluidRuntime ?? { isPlaying: false, speed: 1, currentTime: 0, viewMode: 'composite' as const, frameCount: 0 };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: { ...frameData, fluidRuntime: { ...rt, speed } },
      },
    }));
  },

  setFluidViewMode: (layerId, mode) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const rt = frameData.fluidRuntime ?? { isPlaying: false, speed: 1, currentTime: 0, viewMode: mode, frameCount: 0 };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: { ...frameData, fluidRuntime: { ...rt, viewMode: mode } },
      },
    }));
  },

  resetFluid: (layerId) => {
    // 仅重置运行时状态；解算器实例的 reset() 由 MainCanvas 在渲染循环检测到时调用
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const rt = frameData.fluidRuntime ?? { isPlaying: false, speed: 1, currentTime: 0, viewMode: 'composite' as const, frameCount: 0 };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: { ...frameData, fluidRuntime: { ...rt, currentTime: 0, frameCount: 0, _needsReset: true } },
      },
    }));
  },

  addFluidSource: (layerId, source) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return;
    const cfg = frameData.fluidConfig ?? { continuousSources: [] as any[] } as any;
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          fluidConfig: { ...cfg, continuousSources: [...(cfg.continuousSources ?? []), source] },
        },
      },
    }));
  },

  removeFluidSource: (layerId, index) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData || !frameData.fluidConfig) return;
    const sources = [...(frameData.fluidConfig.continuousSources ?? [])];
    sources.splice(index, 1);
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          fluidConfig: { ...frameData.fluidConfig!, continuousSources: sources },
        },
      },
    }));
  },

  updateFluidSource: (layerId, index, partial) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData || !frameData.fluidConfig) return;
    const sources = [...(frameData.fluidConfig.continuousSources ?? [])];
    if (index < 0 || index >= sources.length) return;
    sources[index] = { ...sources[index], ...partial };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          fluidConfig: { ...frameData.fluidConfig!, continuousSources: sources },
        },
      },
    }));
  },

  importFluidConfig: (layerId, json) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData) return false;
    // 分辨率锁定到绑定纹理尺寸（与 fluid-player.html 锁定 FTX 一致；内联避免循环依赖）
    const r = frameData.boundResidualTexture;
    const b = frameData.boundBaseTexture;
    const fallbackRes = (r && r.width > 0 && r.height > 0) ? { w: r.width, h: r.height }
      : (b && b.width > 0 && b.height > 0) ? { w: b.width, h: b.height }
      : { w: frameData.sourceResolution || 512, h: frameData.sourceResolution || 512 };
    // 解析外部 JSON → 内部 FluidSolverConfig
    const cfg = parseImportedFluidConfig(json, fallbackRes);
    cfg.resolution = { ...fallbackRes };
    set((s) => ({
      frameDataMap: {
        ...s.frameDataMap,
        [layerId]: {
          ...frameData,
          fluidConfig: cfg,
          fluidRuntime: { ...defaultFluidRuntime() },
        },
      },
    }));
    return true;
  },

  exportFluidConfig: (layerId) => {
    const state = get();
    const frameData = state.frameDataMap[layerId];
    if (!frameData?.fluidConfig) return null;
    return serializeFluidConfigToJSON(frameData.fluidConfig);
  },

}));