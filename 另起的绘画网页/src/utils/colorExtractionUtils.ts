import type { Point, Shape } from '../types';
import { computeRegionsExact } from './regionDetectionExact';

// 子区域信息结构（包含 ID）
// 使用与 Ctrl+G 相同的区域 ID
export interface DashedSubRegion {
  id: number;               // 区域 ID（与 Ctrl+G 相同）
  solidRegionId: number;    // 所属实线区域 ID（与 id 相同）
  polygon: Point[][];       // 子区域多边形（外环+内环）
  pixelCount: number;       // 像素数量
  centroid: Point;          // 中心点（世界坐标）
}

// ========== 点在多边形内判断（射线法）==========
function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ========== 计算多边形面积 ==========
function computePolygonArea(polygon: Point[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area / 2);
}

// ========== 计算多边形中心点 ==========
function computeCentroid(polygon: Point[]): Point {
  let cx = 0, cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

// ========== 使用与 Ctrl+G 相同的算法计算纯虚线闭合区域 ==========
// 只使用虚线形状（颜色为 '#ffaa00'）进行区域检测
export function computeAllDashedClosedRegions(
  shapes: Shape[],
  canvasWidth: number,
  canvasHeight: number,
  resolution: number = 1000
): DashedSubRegion[] {
  // 只筛选虚线形状（颜色为 '#ffaa00'）
  const dashedShapes = shapes.filter(s => s.color === '#ffaa00');
  
  if (dashedShapes.length === 0) {
    return [];
  }
  
  const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  
  // 使用与调试模式相同的区域检测算法，但只使用虚线形状
  // 输入的 dashedShapes 已经全是虚线，不需要再排除
  const regions = computeRegionsExact(dashedShapes, worldBounds, resolution);
  
  const result: DashedSubRegion[] = [];
  
  for (let i = 0; i < regions.length; i++) {
    const polygon = regions[i];
    if (polygon.length === 0 || polygon[0].length < 3) continue;
    
    const outerRing = polygon[0];
    const centroid = computeCentroid(outerRing);
    const area = computePolygonArea(outerRing);
    
    result.push({
      id: i,                    // 全局唯一 ID
      solidRegionId: i,         // 每个区域自己的 ID（作为实线区域）
      polygon: polygon,         // 完整的多边形（外环+内环）
      pixelCount: Math.floor(area * canvasWidth * canvasHeight),
      centroid: centroid
    });
  }
  
  return result;
}

// ========== 根据点击位置查找区域 ==========
export function findRegionAtPoint(
  point: Point,
  regions: DashedSubRegion[],
  canvasWidth: number,
  canvasHeight: number
): DashedSubRegion | null {
  for (const region of regions) {
    if (region.polygon.length > 0 && region.polygon[0].length >= 3) {
      if (isPointInPolygon(point, region.polygon[0])) {
        return region;
      }
    }
  }
  return null;
}

// ========== 根据区域 ID 查找区域 ==========
export function findRegionById(
  regionId: number,
  regions: DashedSubRegion[]
): DashedSubRegion | null {
  return regions.find((r) => r.id === regionId) || null;
}
