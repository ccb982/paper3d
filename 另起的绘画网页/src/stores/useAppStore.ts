import { create } from 'zustand';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point, ToolType, Layer, PointAnnotation, RegionAnnotation } from '../types';
import { computeRegionsExact, computeScanlineIntervals, computeGridRegions, getDebugRegions, type ScanlineCache } from '../utils/regionDetectionExact';

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

  // 撤销历史（复合快照）
  historySnapshots: Array<{ shapes: Shape[]; pointAnnotations: PointAnnotation[]; regionAnnotations: RegionAnnotation[] }>;
  historyIndex: number;
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
      
      return {
        layers: renumberedLayers,
        activeLayerId: newActiveLayerId,
        shapes: state.shapes.filter((s) => s.layerId !== id),
        regionPolygonsCache: newPolyCache,
        regionScanlineCache: newScanCache,
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
      }, 0);
      return { shapes: [...state.shapes, newShape] };
    }),
  removeShape: (id) =>
    set((state) => {
      const shape = state.shapes.find(s => s.id === id);
      if (shape) {
        setTimeout(() => {
          get().refreshRegionCache(shape.layerId);
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
      }, 0);
      return { shapes: state.shapes.map((s) => (s.id === id ? newShape : s)) };
    }),
  clearShapes: () => set({ shapes: [] }),

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
    set((state) => ({
      pointAnnotations: state.pointAnnotations.map(a =>
        a.id === id ? { ...a, text, updatedAt: Date.now() } : a
      ),
    })),
  removePointAnnotation: (id) =>
    set((state) => ({
      pointAnnotations: state.pointAnnotations.filter(a => a.id !== id),
    })),
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
    set((state) => ({
      regionAnnotations: state.regionAnnotations.map(a =>
        a.id === id ? { ...a, text, updatedAt: Date.now() } : a
      ),
    })),
  // 更新区域注释（包含 regionId）
  updateRegionAnnotationWithRegionId: (id, text, regionId) =>
    set((state) => ({
      regionAnnotations: state.regionAnnotations.map(a =>
        a.id === id ? { ...a, text, regionId, updatedAt: Date.now() } : a
      ),
    })),
  removeRegionAnnotation: (id) =>
    set((state) => ({
      regionAnnotations: state.regionAnnotations.filter(a => a.id !== id),
    })),
  clearRegionAnnotations: () => set({ regionAnnotations: [] }),

  regionPolygonsCache: {},
  regionScanlineCache: {},
  refreshRegionCache: (layerId) => {
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
    set((s) => ({
      regionPolygonsCache: { ...s.regionPolygonsCache, [layerId]: regions },
      regionScanlineCache: { ...s.regionScanlineCache, [layerId]: scanlineCache },
    }));
  },

  historySnapshots: [{ shapes: [], pointAnnotations: [], regionAnnotations: [] }],
  historyIndex: 0,
  saveHistory: () =>
    set((state) => {
      const newSnapshot = { 
        shapes: [...state.shapes], 
        pointAnnotations: [...state.pointAnnotations],
        regionAnnotations: [...state.regionAnnotations]
      };
      const newHistory = state.historySnapshots.slice(0, state.historyIndex + 1);
      newHistory.push(newSnapshot);
      if (newHistory.length > 50) newHistory.shift();
      return { historySnapshots: newHistory, historyIndex: newHistory.length - 1 };
    }),
  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        const snapshot = state.historySnapshots[newIndex];
        return {
          shapes: [...snapshot.shapes],
          pointAnnotations: [...snapshot.pointAnnotations],
          regionAnnotations: [...snapshot.regionAnnotations],
          historyIndex: newIndex,
        };
      }
      return state;
    }),
  redo: () =>
    set((state) => {
      if (state.historyIndex < state.historySnapshots.length - 1) {
        const newIndex = state.historyIndex + 1;
        const snapshot = state.historySnapshots[newIndex];
        return {
          shapes: [...snapshot.shapes],
          pointAnnotations: [...snapshot.pointAnnotations],
          regionAnnotations: [...snapshot.regionAnnotations],
          historyIndex: newIndex,
        };
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
        };
      });
    } catch (e) {
      console.error('Failed to load from storage:', e);
    }
  },
}));