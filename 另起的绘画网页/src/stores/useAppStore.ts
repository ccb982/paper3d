import { create } from 'zustand';
import * as THREE from 'three';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point, ToolType, Layer, PointAnnotation, RegionAnnotation, ColorBlock } from '../types';

import { computeRegionsExact, computeScanlineIntervals, computeGridRegions, type ScanlineCache } from '../utils/regionDetectionExact';
import { detectColorBlocks } from '../utils/colorBlockDetection';
import { extractPolygonsFromImageData, hexToRgb } from '../utils/paintBufferUtils';
import { isPointInPolygonWithHoles } from '../utils/regionDetection';
import { computeAllDashedClosedRegions } from '../utils/colorExtractionUtils';
import { hslToRgb, clusterAndGenerateTexturesV2, computeBBoxAllRings, rasterizeRegionMaskLocal, quantizeH, quantizeS, quantizeL, dequantizeH, dequantizeS, dequantizeL } from '../utils/colorCompressor';
import { RegionEntity } from '../core/RegionEntity';

export interface SharedBaseColor {
  id: number;
  h: number;
  s: number;
  l: number;
  frameIds: string[];
  area: number;
  tempFlag?: boolean;
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
  updateRegionFtxData: (layerId: string, regionId: number, ftxData: {
    baseColors: Array<{ h: number; s: number; l: number }>;
    deltaTexture: Uint8Array;
    regionIdTexture: Uint8Array | undefined;
    bbox: { x: number; y: number; w: number; h: number };
  }) => void;

  // 技能组编辑器（多帧）
  skillGroupEditor: {
    frames: Array<{
      id: string;
      name: string;
      bgImageData: ImageData | null;
      dashedPolygons: Point[][];
      baseTexture: ImageData | null;
      residualTexture: ImageData | null;
      deltaTex: Uint8Array;
      bbox: { x: number; y: number; w: number; h: number } | null;
      regionIdTex: Uint8Array;
      baseColorValues: Array<{ h: number; s: number; l: number }>;
    }>;
    sharedBaseColors: Array<SharedBaseColor>;
    activeFrameId: string | null;
    globalBbox: { x: number; y: number; w: number; h: number } | null;
    nextColorId: number;
  };
  addSkillFrame: (name?: string) => void;
  removeSkillFrame: (frameId: string) => void;
  switchSkillFrame: (frameId: string) => void;
  updateSkillFrame: (frameId: string, data: Partial<{
    bgImageData: ImageData | null;
    dashedPolygons: Point[][];
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    deltaTex: Uint8Array;
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
  reclusterCurrentFrame: () => void;
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
    set({ activeLayerId: id });
    if (id) {
      setTimeout(() => {
        get().refreshRegionCache(id);
        get().refreshColorBlockCache(id);
        if (get().layerVisibility.regionLayer) {
          get().refreshRegionEntities(id);
        }
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
    const newBlocks = detectColorBlocks(shapesInLayer, layerId, state.nextColorBlockId);
    
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
    const worldBounds = {
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
    };

    const gridData = computeGridRegions(allShapesInLayer, worldBounds, 1000, '#ffaa00');  // 排除虚线
    const scanlineCache = computeScanlineIntervals(gridData);
    const regions = computeRegionsExact(allShapesInLayer, worldBounds, 1000, '#ffaa00');  // 排除虚线
    
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
    
    // 创建一个 512x512 的透明纹理
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    const texture = ctx.getImageData(0, 0, size, size);
    
    if (!paintBuffer || shapes.length === 0) {
      set((s) => ({
        regionLayerTexture: { ...s.regionLayerTexture, [layerId]: texture },
      }));
      return;
    }
    
    // 只获取虚线闭合区域
    const dashedRegions = computeAllDashedClosedRegions(shapes, size, size);
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
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          // 将像素坐标转换为世界坐标
          const worldX = px / size;
          const worldY = 1 - py / size; // Y轴翻转
          
          // 检查点是否在区域内
          if (isPointInPolygonWithHoles({ x: worldX, y: worldY }, region.polygon)) {
            // 从 paintBuffer 提取颜色
            const bufIdx = (py * size + px) * 4;
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

  /**
   * 更新区域纹理列表（为每个虚线区域生成独立的GPU纹理）
   * 【重构】使用 RegionEntity.getGPUTexture() 按需生成纹理
   */
  // 【重构】构建区域实体（从 paintBuffer 提取 ftx 数据）
  refreshRegionEntities: (layerId) => {
    const state = get();
    const paintBuffer = state.paintBuffers[layerId];

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

    if (!paintBuffer) {
      set((s) => ({
        regionEntities: { ...s.regionEntities, [layerId]: [] },
      }));
      return;
    }

    const regions = state.regionPolygonsCache[layerId] || [];
    const entities: RegionEntity[] = [];

    for (let i = 0; i < regions.length; i++) {
      const polygon = regions[i];

      if (polygon.length === 0 || polygon[0].length < 3) continue;

      // 创建区域实体
      const entity = new RegionEntity(i, layerId, polygon);

      // 构建 ftx 压缩数据
      entity.buildFromPaintBuffer(paintBuffer, 0.025, 128);

      // 恢复变换参数和边框扭曲参数（从区域注释中读取）
      const anno = annoMap.get(i);
      if (anno?.maskEffect) {
        // 恢复边框扭曲参数
        entity.maskEffect = anno.maskEffect;
        
        // 恢复纹理变换参数（带校验）
        if (anno.maskEffect.transform) {
          const savedTransform = anno.maskEffect.transform;
          
          // 校验并恢复锚点（只有在有效范围内才使用）
          const savedAnchor = savedTransform.anchor;
          if (savedAnchor && savedAnchor.x >= 0 && savedAnchor.x <= 1 && savedAnchor.y >= 0 && savedAnchor.y <= 1) {
            entity.transform.anchor = { x: savedAnchor.x, y: savedAnchor.y };
          }
          
          // 校验并恢复位置（钳制到合理范围）
          if (savedTransform.position) {
            entity.transform.position = {
              x: Math.max(-0.5, Math.min(0.5, savedTransform.position.x)),
              y: Math.max(-0.5, Math.min(0.5, savedTransform.position.y)),
            };
          }
          
          // 恢复旋转和缩放（无需校验）
          if (typeof savedTransform.rotation === 'number') {
            entity.transform.rotation = savedTransform.rotation;
          }
          if (savedTransform.scale) {
            entity.transform.scale = { ...savedTransform.scale };
          }
        }
      }

      // 计算默认锚点（区域中心世界坐标）
      const bbox = entity.worldBbox;
      if (bbox && !entity.transform.anchor) {
        // bbox 已经是世界坐标（0~1，Y向上），直接计算中心
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
      if (anno?.maskEffect) {
        entity.maskEffect = anno.maskEffect;
      }
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
        deltaTex: Array.from(frame.deltaTex),
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
          deltaTex: new Uint8Array(frame.deltaTex || []),
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
          deltaTex: new Uint8Array(frame.deltaTex || []),
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
    const regions = computeRegionsExact(state.shapes, worldBounds, 1000);

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

  showRegionBorder2D: true,
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
  updateRegionFtxData: (layerId, regionId, ftxData) => {
    set((state) => {
      const entities = state.regionEntities[layerId] || [];
      const newEntities = [...entities];
      const entity = newEntities.find(e => e.id === regionId);
      if (entity) {
        entity.setFtxData({
          version: 2,
          baseColors: ftxData.baseColors,
          deltaTexture: ftxData.deltaTexture,
          regionIdTexture: ftxData.regionIdTexture,
          textureSize: 128,
          bbox: ftxData.bbox,
        });
      }
      return {
        ...state,
        regionEntities: { ...state.regionEntities, [layerId]: newEntities },
      };
    });
    setTimeout(() => {
      get().triggerCanvasRedraw();
    }, 0);
  },

  // 技能组编辑器
  skillGroupEditor: {
    frames: [],
    sharedBaseColors: [],
    activeFrameId: null,
    globalBbox: null,
    nextColorId: 1,
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
        deltaTex: new Uint8Array(0),
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
    set((state) => ({
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
    const state = get();
    const newId = state.skillGroupEditor.nextColorId;
    const newColors = [
      ...state.skillGroupEditor.sharedBaseColors,
      { id: newId, ...color, frameIds: [frameId], area: 0 },
    ];
    set({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: newColors,
        nextColorId: newId + 1,
      },
    });
    return newId;
  },
  updateColorInGlobal: (id, color, sourceFrameId) => {
    const state = get();
    const colors = [...state.skillGroupEditor.sharedBaseColors];
    const idx = colors.findIndex(c => c.id === id);
    if (idx === -1) return;

    colors[idx].h = color.h;
    colors[idx].s = color.s;
    colors[idx].l = color.l;

    set({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: colors,
      },
    });

    get().recalculateAllAreas();
    get().mergeAndSortColors(id);
  },
  recalculateAllAreas: () => {
    const state = get();
    const { frames, sharedBaseColors } = state.skillGroupEditor;

    const colorMap = new Map<number, SharedBaseColor>();
    for (const c of sharedBaseColors) {
      colorMap.set(c.id, { ...c, area: 0, frameIds: [...c.frameIds] });
    }

    for (const frame of frames) {
      const { regionIdTex, bbox } = frame;
      if (!regionIdTex || regionIdTex.length === 0 || !bbox) continue;

      const countMap = new Map<number, number>();
      for (let i = 0; i < regionIdTex.length; i++) {
        const colorId = regionIdTex[i];
        if (colorId > 0) {
          countMap.set(colorId, (countMap.get(colorId) || 0) + 1);
        }
      }

      for (const [colorId, count] of countMap) {
        const color = colorMap.get(colorId);
        if (color) {
          color.area += count;
          if (!color.frameIds.includes(frame.id)) {
            color.frameIds.push(frame.id);
          }
        }
      }
    }

    const newColors = Array.from(colorMap.values());
    set({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: newColors,
      },
    });
  },
  mergeAndSortColors: (updatedColorId) => {
    const state = get();
    let colors = state.skillGroupEditor.sharedBaseColors.map(c => ({ ...c, frameIds: [...c.frameIds] }));
    const hslThreshold = 0.025;

    if (updatedColorId !== undefined) {
      const idx = colors.findIndex(c => c.id === updatedColorId);
      if (idx === -1) return;
      const target = colors[idx];

      let mergeTarget: SharedBaseColor | null = null;
      let mergeIdx = -1;
      for (let i = 0; i < colors.length; i++) {
        if (i === idx) continue;
        const c = colors[i];
        const dh = Math.min(Math.abs(c.h - target.h), 1 - Math.abs(c.h - target.h));
        const ds = Math.abs(c.s - target.s);
        const dl = Math.abs(c.l - target.l);
        if (dh < hslThreshold && ds < 0.1 && dl < 0.1) {
          mergeTarget = c;
          mergeIdx = i;
          break;
        }
      }

      if (mergeTarget) {
        const keepIdx = target.area >= mergeTarget.area ? idx : mergeIdx;
        const removeIdx = keepIdx === idx ? mergeIdx : idx;
        const keep = colors[keepIdx];
        const remove = colors[removeIdx];

        keep.frameIds = Array.from(new Set([...keep.frameIds, ...remove.frameIds]));
        keep.area += remove.area;

        colors.splice(removeIdx, 1);
      }
    }

    colors.sort((a, b) => b.area - a.area);

    set({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        sharedBaseColors: colors,
      },
    });
  },
  reclusterCurrentFrame: () => {
    const state = get();
    const { activeFrameId, frames, sharedBaseColors, nextColorId, globalBbox } = state.skillGroupEditor;
    if (!activeFrameId) return;
    const frame = frames.find(f => f.id === activeFrameId);
    if (!frame || !frame.bgImageData || !frame.baseTexture) return;

    const colors = sharedBaseColors.map(c => ({ ...c, tempFlag: false }));

    let currentNextId = nextColorId;

    const effectiveBbox = globalBbox || frame.bbox;
    if (!effectiveBbox) return;
    const { w, h, x: offsetX, y: offsetY } = effectiveBbox;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskImageData = maskCtx.createImageData(w, h);
    const maskData = maskImageData.data;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const globalIdx = ((offsetY + py) * 512 + (offsetX + px)) * 4;
        const alpha = frame.baseTexture.data[globalIdx + 3];
        const maskIdx = (py * w + px) * 4;
        maskData[maskIdx] = alpha > 0 ? 255 : 0;
        maskData[maskIdx + 1] = alpha > 0 ? 255 : 0;
        maskData[maskIdx + 2] = alpha > 0 ? 255 : 0;
        maskData[maskIdx + 3] = alpha > 0 ? 255 : 0;
      }
    }

    const result = clusterAndGenerateTexturesV2(
      maskImageData,
      effectiveBbox,
      frame.bgImageData,
      0.025,
      512
    );

    if (!result) return;

    const { baseColors: extractedColors, regionIdTex: rawRegionIdTex, deltaTex: newDeltaTex } = result;

    const tempColors = [...colors];
    const newColorEntries: SharedBaseColor[] = [];

    for (const ec of extractedColors) {
      let found = false;
      for (const gc of tempColors) {
        const dh = Math.min(Math.abs(gc.h - ec.h), 1 - Math.abs(gc.h - ec.h));
        const ds = Math.abs(gc.s - ec.s);
        const dl = Math.abs(gc.l - ec.l);
        if (dh < 0.025 && ds < 0.1 && dl < 0.1) {
          gc.tempFlag = true;
          found = true;
          break;
        }
      }
      if (!found) {
        newColorEntries.push({
          id: currentNextId,
          h: ec.h,
          s: ec.s,
          l: ec.l,
          frameIds: [activeFrameId],
          area: 0,
          tempFlag: true,
        });
        currentNextId++;
      }
    }

    const finalColors = [...tempColors, ...newColorEntries];

    const filtered = finalColors.filter(c => {
      if (c.frameIds.includes(activeFrameId) && c.tempFlag === false) {
        return false;
      }
      return true;
    });

    const localToGlobal = new Map<number, number>();
    let localIdx = 0;
    for (const ec of extractedColors) {
      let globalId: number | undefined;
      let minDist = 0.3;
      for (const fc of finalColors) {
        if (!fc.tempFlag) continue;
        const dh = Math.min(Math.abs(fc.h - ec.h), 1 - Math.abs(fc.h - ec.h));
        const ds = Math.abs(fc.s - ec.s);
        const dl = Math.abs(fc.l - ec.l);
        const dist = dh + ds * 0.5 + dl * 0.5;
        if (dist < minDist) {
          minDist = dist;
          globalId = fc.id;
        }
      }
      if (globalId !== undefined) {
        localToGlobal.set(localIdx, globalId);
      }
      localIdx++;
    }

    const newRegionIdTex = new Uint8Array(rawRegionIdTex.length);
    for (let i = 0; i < rawRegionIdTex.length; i++) {
      const localIdxVal = rawRegionIdTex[i];
      if (localIdxVal > 0) {
        const globalId = localToGlobal.get(localIdxVal - 1);
        newRegionIdTex[i] = globalId || 0;
      }
    }

    const updatedFrames = frames.map(f =>
      f.id === activeFrameId ? { ...f, regionIdTex: newRegionIdTex, deltaTex: newDeltaTex } : f
    );

    const cleanColors = filtered.map(c => {
      const { tempFlag, ...rest } = c;
      return { ...rest, tempFlag: false };
    });

    set({
      skillGroupEditor: {
        ...state.skillGroupEditor,
        frames: updatedFrames,
        sharedBaseColors: cleanColors,
        nextColorId: currentNextId,
      },
    });

    get().recalculateAllAreas();
    get().mergeAndSortColors();
  },
}));

// ===== 辅助函数：合成图像数据 =====
function getCompositedImageData(state: AppState): ImageData | null {
  const { imageState, paintBuffers, layerVisibility, canvasWidth, canvasHeight, activeLayerId, layers } = state;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = canvasWidth;
  offCanvas.height = canvasHeight;
  const ctx = offCanvas.getContext('2d')!;

  // 1. 绘制背景图片（如果存在且可见）
  if (layerVisibility.imageLayer && imageState.originalImage && imageState.imageSrc) {
    const img = imageState.originalImage;
    const bgOffsetX = imageState.offsetX ?? 0;
    const bgOffsetY = imageState.offsetY ?? 0;
    const bgScale = imageState.scale ?? 1;

    if (imageState.selectionRect) {
      const sel = imageState.selectionRect;
      const scaleX = canvasWidth / sel.width;
      const scaleY = canvasHeight / sel.height;
      const fitScale = Math.min(scaleX, scaleY);
      const drawWidth = sel.width * fitScale * bgScale;
      const drawHeight = sel.height * fitScale * bgScale;
      const offsetX = (canvasWidth - drawWidth) / 2 + bgOffsetX;
      const offsetY = (canvasHeight - drawHeight) / 2 + bgOffsetY;
      ctx.drawImage(img, sel.x, sel.y, sel.width, sel.height, offsetX, offsetY, drawWidth, drawHeight);
    } else {
      const fitScale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
      const drawWidth = img.width * fitScale * bgScale;
      const drawHeight = img.height * fitScale * bgScale;
      const offsetX = (canvasWidth - drawWidth) / 2 + bgOffsetX;
      const offsetY = (canvasHeight - drawHeight) / 2 + bgOffsetY;
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    }
  }

  // 2. 绘制绘制层（paintBuffer）
  if (layerVisibility.drawLayer) {
    const layerId = activeLayerId || layers[0]?.id;
    const buffer = paintBuffers[layerId];
    if (buffer) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = buffer.width;
      tempCanvas.height = buffer.height;
      tempCanvas.getContext('2d')!.putImageData(buffer, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
    }
  }

  return ctx.getImageData(0, 0, canvasWidth, canvasHeight);
}