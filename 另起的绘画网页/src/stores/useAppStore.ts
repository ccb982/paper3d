import { create } from 'zustand';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point, ToolType, Layer } from '../types';

interface AppState {
  // 图片导入状态
  imageState: ImageImportState;
  setOriginalImage: (img: HTMLImageElement | null, src: string | null) => void;
  setSelectionRect: (rect: ImageImportState['selectionRect']) => void;
  clearImage: () => void;

  // 选区预览阶段状态
  isPreviewStage: boolean;  // 是否处于选区预览阶段
  setPreviewStage: (preview: boolean) => void;
  applySelectionToCanvas: () => void;  // 确认选区并应用到画布

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
  zoom: number;  // 缩放比例，1.0 表示 100%
  panOffset: Point;  // 拖拽偏移
  isPanMode: boolean;  // 是否处于拖动模式
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: Point) => void;
  setPanMode: (panMode: boolean) => void;
  resetView: () => void;

  // 当前工具
  currentTool: ToolType;
  setCurrentTool: (tool: ToolType) => void;

  // 点吸附配置
  snapRadius: number;  // 吸附半径（像素）
  setSnapRadius: (radius: number) => void;
  snapEnabled: boolean;  // 是否启用吸附
  setSnapEnabled: (enabled: boolean) => void;

  // 撤销历史
  shapesHistory: Shape[][];
  historyIndex: number;
  saveHistory: () => void;
  undo: () => void;
  canUndo: () => boolean;

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

export const useAppStore = create<AppState>((set) => ({
  // 图片导入状态
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

  // 选区预览阶段状态
  isPreviewStage: false,
  setPreviewStage: (preview) => set({ isPreviewStage: preview }),
  applySelectionToCanvas: () => {
    // 确认选区后，进入画布编辑阶段
    set((state) => ({
      isPreviewStage: false,
      // 保留 selectionRect，但不再处于预览阶段
    }));
  },

  // 坐标轴配置
  axis: defaultAxis,
  setAxis: (axis) =>
    set((state) => ({ axis: { ...state.axis, ...axis } })),
  resetAxis: () => set({ axis: defaultAxis }),

  // 格子配置
  grid: {
    cols: 10,
    rows: 10,
    visible: true,
  },
  setGrid: (grid) =>
    set((state) => ({ grid: { ...state.grid, ...grid } })),

  // 图层可见性
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

  // 分组管理
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

  // 图层管理
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
        // 如果是图片图层（displayId === 0），保持为0
        if (layer.displayId === 0) {
          return layer;
        }
        // 其他图层重新编号
        // 如果第一个是图片图层，从1开始；否则从0开始
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
      return {
        layers: renumberedLayers,
        activeLayerId: newActiveLayerId,
        shapes: state.shapes.filter((s) => s.layerId !== id),
      };
    }),
  updateLayer: (id, updates) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  toggleLayerVisibility: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      // 不允许移动图层0（参考图片）
      const fromLayer = state.layers[fromIndex];
      if (fromLayer.displayId === 0) {
        return state;
      }
      
      // 如果目标位置是0，调整到位置1（图片图层后面）
      const adjustedToIndex = toIndex === 0 ? 1 : toIndex;
      
      const newLayers = [...state.layers];
      const [removed] = newLayers.splice(fromIndex, 1);
      newLayers.splice(adjustedToIndex, 0, removed);
      
      // 重新编号：图层0保持为0，其他图层从1开始
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

  // 形状管理
  shapes: [],
  addShape: (shape) =>
    set((state) => ({ shapes: [...state.shapes, shape] })),
  removeShape: (id) =>
    set((state) => ({ shapes: state.shapes.filter((s) => s.id !== id) })),
  updateShape: (id, updates) =>
    set((state) => ({
      shapes: state.shapes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  updateShapeAnnotation: (shapeId, annotation) =>
    set((state) => ({
      shapes: state.shapes.map((s) => 
        s.id === shapeId ? { ...s, annotation } : s
      ),
    })),
  updatePointAnnotation: (shapeId, pointIndex, annotation) =>
    set((state) => ({
      shapes: state.shapes.map((s) => 
        s.id === shapeId ? {
          ...s,
          points: s.points.map((p, idx) => 
            idx === pointIndex ? { ...p, annotation } : p
          ),
        } : s
      ),
    })),
  clearShapes: () => set({ shapes: [] }),

  // 鼠标位置
  mousePosition: null,
  setMousePosition: (pos) => set({ mousePosition: pos }),

  // 选区状态
  isSelecting: false,
  selectionStart: null,
  selectionEnd: null,
  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),
  setIsSelecting: (selecting) => set({ isSelecting: selecting }),

  // 视图缩放和偏移
  zoom: 1.0,
  panOffset: { x: 0, y: 0 },
  isPanMode: false,
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setPanOffset: (offset) => set({ panOffset: offset }),
  setPanMode: (panMode) => set({ isPanMode: panMode }),
  resetView: () => set({ zoom: 1.0, panOffset: { x: 0, y: 0 } }),

  // 当前工具
  currentTool: 'select',
  setCurrentTool: (tool) => set({ currentTool: tool }),

  // 点吸附配置
  snapRadius: 10,  // 默认吸附半径10像素
  setSnapRadius: (radius) => set({ snapRadius: Math.max(1, Math.min(50, radius)) }),
  snapEnabled: true,  // 默认启用吸附
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

  // 撤销历史
  shapesHistory: [[]],
  historyIndex: 0,
  saveHistory: () =>
    set((state) => {
      const newHistory = state.shapesHistory.slice(0, state.historyIndex + 1);
      newHistory.push([...state.shapes]);
      if (newHistory.length > 50) newHistory.shift();
      return { shapesHistory: newHistory, historyIndex: newHistory.length - 1 };
    }),
  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return { shapes: [...state.shapesHistory[newIndex]], historyIndex: newIndex };
      }
      return state;
    }),
  canUndo: () => {
    const state = useAppStore.getState();
    return state.historyIndex > 0;
  },

  // 保存/加载
  saveToStorage: () => {
    const state = useAppStore.getState();
    const imageLayerId = state.imageState.imageLayerId;
    const data = {
      shapes: state.shapes.filter(s => s.layerId !== imageLayerId),
      groups: state.groups,
      layers: state.layers.filter(l => l.id !== imageLayerId),
      activeLayerId: state.activeLayerId,
      axis: state.axis,
      grid: state.grid,
      snapRadius: state.snapRadius,
      snapEnabled: state.snapEnabled,
    };
    localStorage.setItem('drawing-app-data', JSON.stringify(data));
  },
  exportToJson: () => {
    const state = useAppStore.getState();
    const imageLayerId = state.imageState.imageLayerId;
    
    const exportData = {
      version: '1.0',
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
              annotation: shape.annotation,
              points: shape.points.map(point => ({
                x: point.x,
                y: point.y,
                annotation: point.annotation,
              })),
            })),
        })),
      groups: state.groups,
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
    const data = localStorage.getItem('drawing-app-data');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        const loadedLayers = parsed.layers || [{ id: 'layer_1', name: '图层 1', visible: true, locked: false, opacity: 1 }];
        const loadedActiveLayerId = parsed.activeLayerId || 'layer_1';
        const loadedShapes = (parsed.shapes || []).map((s: any) => ({
          ...s,
          layerId: s.layerId || loadedActiveLayerId,
        }));
        set((state) => ({
          shapes: loadedShapes,
          groups: parsed.groups || [],
          layers: loadedLayers,
          activeLayerId: loadedActiveLayerId,
          axis: parsed.axis || state.axis,
          grid: parsed.grid || state.grid,
          snapRadius: parsed.snapRadius ?? 10,
          snapEnabled: parsed.snapEnabled ?? true,
          shapesHistory: [loadedShapes],
          historyIndex: 0,
        }));
      } catch (e) {
        console.error('Failed to load data:', e);
      }
    }
  },
}));
