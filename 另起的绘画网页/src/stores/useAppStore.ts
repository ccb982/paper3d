import { create } from 'zustand';
import type { Group, Shape, ImageImportState, AxisConfig, GridConfig, LayerVisibility, Point } from '../types';

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
  },
  setOriginalImage: (img, src) =>
    set((state) => ({
      imageState: { ...state.imageState, originalImage: img, imageSrc: src },
    })),
  setSelectionRect: (rect) =>
    set((state) => ({
      imageState: { ...state.imageState, selectionRect: rect },
    })),
  clearImage: () =>
    set({
      imageState: { originalImage: null, imageSrc: null, selectionRect: null },
      isPreviewStage: false,
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
}));
