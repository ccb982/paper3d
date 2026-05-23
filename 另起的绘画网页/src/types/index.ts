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

export interface Shape {
  id: string;
  groupId: string;
  type: ShapeType;
  points: Point[];
  color: string;
  annotation?: string;
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
