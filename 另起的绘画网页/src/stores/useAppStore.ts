import { create } from 'zustand';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point, ToolType, Layer, PointAnnotation, RegionAnnotation, ColorBlock } from '../types';
import { computeRegionsExact, computeScanlineIntervals, computeGridRegions, getDebugRegions, type ScanlineCache, type GridData } from '../utils/regionDetectionExact';
import { detectColorBlocks } from '../utils/colorBlockDetection';
import { extractPolygonsFromImageData, hexToRgb } from '../utils/paintBufferUtils';
import { isPointInPolygonWithHoles } from '../utils/regionDetection';

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

  // 当前工具
  currentTool: ToolType;
  setCurrentTool: (tool: ToolType) => void;

  // 点吸附配置
  snapRadius: number;
  setSnapRadius: (radius: number) => void;
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

  // 区域检测缓存
  regionPolygonsCache: Record<string, Point[][][]>;
  regionScanlineCache: Record<string, ScanlineCache>;
  refreshRegionCache: (layerId: string) => void;

  // 色块区域检测缓存（独立存储，使用相同算法）
  colorBlockRegionsCache: Record<string, Point[][][]>;
  refreshColorBlockCache: (layerId: string) => void;

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
        imageState: { originalImage: null, imageSrc: null, selectionRect: null, imageLayerId: null },
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
      console.log('>>> [addShape] 被调用了！');
      console.log('>>> 图形类型:', shape.type);
      console.log('>>> 图形ID:', shape.id);
      console.log('>>> 所属图层:', shape.layerId);
      console.log('[addShape] 图形类型:', shape.type);
      console.log('[addShape] 原始点数:', shape.points.length);
      const newShape = { ...shape };
      setTimeout(() => {
        console.log('>>> [setTimeout] 准备刷新区域缓存, layerId:', shape.layerId);
        get().refreshRegionCache(shape.layerId);
        get().refreshColorBlockCache(shape.layerId);
        get().updateColorBlocksForLayer(shape.layerId);
      }, 0);
      return { shapes: [...state.shapes, newShape] };
    }),
  removeShape: (id) =>
    set((state) => {
      const shape = state.shapes.find(s => s.id === id);
      if (shape) {
        setTimeout(() => {
          get().refreshRegionCache(shape.layerId);
          get().refreshColorBlockCache(shape.layerId);
          get().updateColorBlocksForLayer(shape.layerId);
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

  currentTool: 'select',
  setCurrentTool: (tool) => set({ currentTool: tool }),

  snapRadius: 10,
  setSnapRadius: (radius) => set({ snapRadius: Math.max(1, Math.min(50, radius)) }),
  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

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
    console.log('==========================================');
    console.log('[绘画后区域检测] 图形总数:', allShapesInLayer.length);

    // 世界坐标固定为 [0,1]，与坐标轴显示范围无关
    const worldBounds = {
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
    };

    const gridData = computeGridRegions(allShapesInLayer, worldBounds, 300);
    const scanlineCache = computeScanlineIntervals(gridData);
    const regions = computeRegionsExact(allShapesInLayer, worldBounds, 300, 1.0);
    console.log('[绘画后区域检测] 检测到的封闭区域数量:', regions.length);
    
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      console.log(`--- 封闭区域 ${i} ---`);
      for (let j = 0; j < region.length; j++) {
        const ring = region[j];
        const ringType = j === 0 ? '外环' : `内环${j}`;
        console.log(`  ${ringType}: ${ring.length}个顶点`);
        if (ring.length > 0) {
          const first3 = ring.slice(0, 3).map(p => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`).join(' -> ');
          console.log(`  前3个点: ${first3}${ring.length > 3 ? ' -> ...' : ''}`);
        }
      }
    }
    console.log('==========================================');
    
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
    
    // 生成区域ID纹理（异步执行，不阻塞UI）
    setTimeout(() => {
      get().generateRegionIdTexture(layerId);
    }, 0);
  },

  colorBlockRegionsCache: {},
  refreshColorBlockCache: (layerId) => {
    const state = get();
    // 直接使用 regionPolygonsCache（区域注释算法检测到的封闭区域）
    const regions = state.regionPolygonsCache[layerId] || [];
    console.log('==========================================');
    console.log('[色块区域检测] 区域总数:', regions.length);
    
    set((s) => ({
      colorBlockRegionsCache: { ...s.colorBlockRegionsCache, [layerId]: regions },
    }));
  },

  // 像素缓冲区相关
  paintBuffers: {},
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
        console.log('[快照保存] 跳过（正在恢复历史）');
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
      
      const snapshotId = Date.now();
      const newSnapshot = { 
        id: snapshotId,
        shapes: [...state.shapes], 
        pointAnnotations: [...state.pointAnnotations],
        regionAnnotations: [...state.regionAnnotations],
        regionPixelsMap: serializedRegionPixelsMap,
        paintBuffers: serializedPaintBuffers,
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
      console.log(`[快照保存] ID: ${snapshotId}, 索引: ${newHistory.length - 1}`);
      console.log(`  线条: ${state.shapes.length}个 (类型: ${shapeTypes.join(', ') || '无'})`);
      console.log(`  点注释: ${state.pointAnnotations.length}个`);
      console.log(`  区域注释: ${state.regionAnnotations.length}个`);
      console.log(`  绘画像素: ${paintedPixelCount}个`);
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
        
        console.log(`[撤销] 恢复到快照 ID: ${snapshot.id}, 索引: ${newIndex}`);
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
        };
        
        // 延迟重置标志并重新计算区域数据
        setTimeout(() => {
          const state = get();
          // 重新计算所有图层的区域数据，但不清空绘画数据
          const layerIds = [...new Set(state.shapes.map(s => s.layerId))];
          layerIds.forEach(layerId => {
            state.refreshRegionCache(layerId, { clearPaintData: false });
          });
          set({ isRestoringHistory: false });
        }, 0);
        
        return newState;
      }
      return state;
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
        };
        
        // 延迟重置标志并重新计算区域数据
        setTimeout(() => {
          const state = get();
          // 重新计算所有图层的区域数据，但不清空绘画数据
          const layerIds = [...new Set(state.shapes.map(s => s.layerId))];
          layerIds.forEach(layerId => {
            state.refreshRegionCache(layerId, { clearPaintData: false });
          });
          set({ isRestoringHistory: false });
        }, 0);
        
        return newState;
      }
      return state;
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
    const regions = computeRegionsExact(state.shapes, worldBounds, 600);

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
}));