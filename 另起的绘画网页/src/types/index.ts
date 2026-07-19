export interface Point {
  x: number;
  y: number;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export type ShapeType = 'point' | 'line' | 'rectangle' | 'circle' | 'triangle' | 'quadratic' | 'brush' | 'polygon' | 'polyline';

export type ToolType = 
  | 'select' | 'point' | 'line' | 'rectangle' | 'circle' | 'triangle' 
  | 'quadratic' | 'brush' | 'eraser'
  | 'pointAnnotation'   // 点注释工具
  | 'regionAnnotation'  // 区域注释工具
  | 'paintBrush'        // 上色画笔工具
  | 'picker'            // 取色器工具
  | 'vertexPin'         // 顶点固定画笔（不在工具栏显示）
  | 'move';             // 移动工具

export interface Shape {
  id: string;
  groupId: string;
  layerId: string;
  type: ShapeType;
  points: Point[];
  color: string;
  fillOnly?: boolean; // 是否仅填充（无描边）
}

export interface ImageImportState {
  originalImage: HTMLImageElement | null;
  imageSrc: string | null;
  selectionRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  imageLayerId: string | null;
  // 背景层变换参数
  offsetX: number;      // 背景图片偏移 X
  offsetY: number;      // 背景图片偏移 Y
  scale: number;        // 背景图片缩放比例
  isBackgroundDragging: boolean; // 是否处于背景拖动模式
  backgroundDragStart: { x: number; y: number } | null; // 拖动起始位置
}

export interface AxisConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GridConfig {
  cols: number;  // 列数（水平格子数）
  rows: number;  // 行数（垂直格子数）
  visible: boolean;
}

export interface LayerVisibility {
  imageLayer: boolean;
  drawLayer: boolean;
  axisLayer: boolean;
  regionLayer: boolean; // 区域注释算法提取的色块区域
}

export interface Layer {
  id: string;
  displayId: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

// 点注释（独立）
export interface PointAnnotation {
  id: string;
  text: string;
  position: Point;      // 世界坐标
  layerId: string;
  color: string;        // 注释颜色
  createdAt: number;
  updatedAt: number;
}

// 区域注释（独立）
export interface RegionAnnotation {
  id: string;
  text: string;
  polygon: Point[][];   // 多环多边形：第一个环为外环，后续为内洞
  layerId: string;
  regionId: string | number;     // 绑定的区域ID，用于匹配同一区域（支持字符串签名或数字BFS区域ID）
  color: string;        // 注释颜色
  createdAt: number;
  updatedAt: number;
  // 新增：遮罩特效参数（GPU扭曲蒙版）
  maskEffect?: {
    enabled: boolean;
    transform: {
      position: { x: number; y: number };
      anchor: { x: number; y: number } | null; // null 表示自动计算重心
      rotation: number; // 弧度
      scale: { x: number; y: number };
    };
    distortions: Array<{
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
    }>;
  };
}

// 色块（独立）
export interface ColorBlock {
  id: number;           // 永不重用的唯一 ID
  layerId: string;
  color: string;        // hex 颜色值，如 '#ff0000'
  polygon: Point[][];   // 多边形（外环+内环），与 RegionAnnotation.polygon 结构相同
  createdAt: number;
  updatedAt: number;
}

// 帧数据（存储从基础色编辑器导入的底图和残差信息）
export interface FrameData {
  id: string;                         // 对应图层ID
  baseTexture: ImageData | null;      // 解码后的基础色纹理（全尺寸 512x512）
  residualTexture: ImageData | null;  // 残差纹理（全尺寸，后续给流体）
  bbox: { x: number; y: number; w: number; h: number } | null;
  deltaPacked: Uint16Array | null;    // 残差打包数据（RGB565），后续给流体
  blockFlags: number;
  sourceResolution: number;           // 原始纹理尺寸（通常512）
}