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

export type ToolType = 'select' | 'point' | 'line' | 'rectangle' | 'circle' | 'triangle' | 'quadratic' | 'brush' | 'eraser' | 'annotation';

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

export type AnnotationGeometryType = 'point' | 'polyline' | 'polygon';

export interface AnnotationGeometry {
  type: AnnotationGeometryType;
  points: Point[];
}

export interface Annotation {
  id: string;
  text: string;
  geometry: AnnotationGeometry;
  layerId: string;
  createdAt: number;
  updatedAt: number;
}
