import type { Point } from '../types';

export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function isPointInMultiRingPolygon(point: Point, polygon: Point[][]): boolean {
  if (polygon.length === 0) return false;
  const isInOuterRing = isPointInPolygon(point, polygon[0]);
  if (!isInOuterRing) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (isPointInPolygon(point, polygon[i])) {
      return false;
    }
  }
  return true;
}

export function findRegionByPoint(point: Point, regions: Point[][][]): Point[][] | null {
  for (const region of regions) {
    if (isPointInMultiRingPolygon(point, region)) {
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