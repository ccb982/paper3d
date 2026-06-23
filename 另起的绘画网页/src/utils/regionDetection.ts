import type { Point } from '../types';

// 生成区域的唯一签名（基于外环的几何特征）
export function generateRegionSignature(region: Point[][]): string {
  if (!region || region.length === 0 || !region[0] || region[0].length === 0) {
    return '';
  }
  
  const outerRing = region[0];
  
  // 计算重心（使用更高精度）
  let cx = 0, cy = 0;
  for (const p of outerRing) {
    cx += p.x;
    cy += p.y;
  }
  cx /= outerRing.length;
  cy /= outerRing.length;
  
  // 计算面积（使用绝对值）
  let area = 0;
  for (let i = 0; i < outerRing.length; i++) {
    const j = (i + 1) % outerRing.length;
    area += outerRing[i].x * outerRing[j].y - outerRing[j].x * outerRing[i].y;
  }
  area = Math.abs(area / 2);
  
  // 计算最小包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outerRing) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  
  const width = maxX - minX;
  const height = maxY - minY;
  
  // 生成签名（使用固定精度，确保稳定性）
  return `region_${cx.toFixed(8)}_${cy.toFixed(8)}_${area.toFixed(8)}_${width.toFixed(8)}_${height.toFixed(8)}`;
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function isPointInPolygon(
  point: Point,
  polygon: Point[],
  tolerance: number = 1e-9
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  if (!inside && polygon.length >= 3) {
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if (pointToSegmentDistance(point, a, b) < tolerance) return true;
    }
  }
  return inside;
}

export function isPointInPolygonWithHoles(
  point: Point,
  rings: Point[][],
  tolerance: number = 1e-9
): boolean {
  if (rings.length === 0) return false;
  const outer = rings[0];
  if (!isPointInPolygon(point, outer, tolerance)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (isPointInPolygon(point, rings[i], tolerance)) return false;
  }
  return true;
}

export function findRegionByPoint(
  point: Point,
  regions: Point[][][],
  tolerance: number = 1e-9
): Point[][] | null {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (isPointInPolygonWithHoles(point, region, tolerance)) {
      return region;
    }
  }
  return null;
}

export function computeRegionsFromPolygons(
  polygons: Point[][],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
): Point[][][] {
  if (polygons.length === 0) {
    const backgroundRegion = [[
      { x: worldBounds.xMin, y: worldBounds.yMin },
      { x: worldBounds.xMax, y: worldBounds.yMin },
      { x: worldBounds.xMax, y: worldBounds.yMax },
      { x: worldBounds.xMin, y: worldBounds.yMax },
    ]];
    return [backgroundRegion];
  }
  const result: Point[][][] = [];
  const backgroundPolygon = [
    { x: worldBounds.xMin, y: worldBounds.yMin },
    { x: worldBounds.xMax, y: worldBounds.yMin },
    { x: worldBounds.xMax, y: worldBounds.yMax },
    { x: worldBounds.xMin, y: worldBounds.yMax },
  ];
  result.push([backgroundPolygon]);
  for (const polygon of polygons) {
    if (polygon.length >= 3) {
      result.push([polygon]);
    }
  }
  return result;
}