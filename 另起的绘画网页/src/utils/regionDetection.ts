import type { Point } from '../types';

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
  console.log('[findRegionByPoint] 开始查找区域...');
  console.log('[findRegionByPoint] 待检测点:', point);
  console.log('[findRegionByPoint] 区域数量:', regions.length);
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const outerRing = region[0];
    console.log(`[findRegionByPoint] 检查区域${i}, 外环点数:`, outerRing.length);
    if (outerRing.length > 0) {
      const isInOuter = isPointInPolygon(point, outerRing, tolerance);
      console.log(`[findRegionByPoint] 区域${i} 外环检测结果:`, isInOuter);
      if (isInOuter && region.length > 1) {
        for (let j = 1; j < region.length; j++) {
          const isInHole = isPointInPolygon(point, region[j], tolerance);
          console.log(`[findRegionByPoint] 区域${i} 内环${j}检测结果:`, isInHole);
        }
      }
    }
    if (isPointInPolygonWithHoles(point, region, tolerance)) {
      console.log(`[findRegionByPoint] ✅ 命中区域${i}`);
      return region;
    }
  }
  console.log('[findRegionByPoint] ❌ 未命中任何区域');
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