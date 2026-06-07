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

export type ShapeType = 'point' | 'line' | 'rectangle' | 'circle' | 'triangle' | 'quadratic' | 'brush';

export type ToolType = 
  | 'select' | 'point' | 'line' | 'rectangle' | 'circle' | 'triangle' 
  | 'quadratic' | 'brush' | 'eraser'
  | 'pointAnnotation'   // 点注释工具
  | 'regionAnnotation'; // 区域注释工具

export interface Shape {
  id: string;
  groupId: string;
  layerId: string;
  type: ShapeType;
  points: Point[];
  color: string;
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
  createdAt: number;
  updatedAt: number;
}