import type { Point, Shape } from '../types';

// ========== 基础几何函数 ==========
function pointToSegmentDistanceSq(p: Point, a: Point, b: Point): number {
  const ax = p.x - a.x, ay = p.y - a.y;
  const bx = b.x - a.x, by = b.y - a.y;
  const dot = ax * bx + ay * by;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return ax * ax + ay * ay;
  let t = dot / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * bx;
  const projY = a.y + t * by;
  const dx = p.x - projX, dy = p.y - projY;
  return dx * dx + dy * dy;
}

function rasterizeLine(
  x0: number, y0: number,
  x1: number, y1: number,
  stepX: number, stepY: number,
  xMin: number, yMin: number,
  resolution: number,
  wallGrid: boolean[][]
): void {
  const toGrid = (x: number, y: number): [number, number] => {
    let i = Math.floor((y - yMin) / stepY);
    let j = Math.floor((x - xMin) / stepX);
    i = Math.max(0, Math.min(resolution - 1, i));
    j = Math.max(0, Math.min(resolution - 1, j));
    return [i, j];
  };

  const [i0, j0] = toGrid(x0, y0);
  const [i1, j1] = toGrid(x1, y1);

  let i = i0, j = j0;
  const di = Math.abs(i1 - i0);
  const dj = Math.abs(j1 - j0);
  const si = i0 < i1 ? 1 : -1;
  const sj = j0 < j1 ? 1 : -1;
  let err = di - dj;

  while (true) {
    if (i >= 0 && i < resolution && j >= 0 && j < resolution) {
      wallGrid[i][j] = true;
    }
    if (i === i1 && j === j1) break;
    const e2 = 2 * err;
    if (e2 > -dj) { err -= dj; i += si; }
    if (e2 < di) { err += di; j += sj; }
  }
}

function rasterizeShape(shape: Shape, stepX: number, stepY: number, xMin: number, yMin: number, resolution: number, wallGrid: boolean[][]): void {
  const pts = shape.points;
  const maxSegLen = Math.min(stepX, stepY) * 0.3;

  const segments: [Point, Point][] = [];

  switch (shape.type) {
    case 'point':
      break;
    case 'line':
      if (pts.length >= 2) segments.push([pts[0], pts[1]]);
      break;
    case 'rectangle':
      if (pts.length >= 2) {
        const p1 = pts[0], p2 = pts[1];
        const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
        const bottom = Math.min(p1.y, p2.y), top = Math.max(p1.y, p2.y);
        segments.push(
          [{ x: left, y: bottom }, { x: right, y: bottom }],
          [{ x: right, y: bottom }, { x: right, y: top }],
          [{ x: right, y: top }, { x: left, y: top }],
          [{ x: left, y: top }, { x: left, y: bottom }]
        );
      }
      break;
    case 'circle':
      if (pts.length >= 2) {
        const center = pts[0];
        const radius = Math.hypot(pts[1].x - center.x, pts[1].y - center.y);
        const steps = Math.max(20, Math.ceil(2 * Math.PI * radius / maxSegLen));
        let prev = { x: center.x + radius, y: center.y };
        for (let i = 1; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const cur = {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
          };
          segments.push([prev, cur]);
          prev = cur;
        }
      }
      break;
    case 'triangle':
      if (pts.length >= 3) {
        segments.push([pts[0], pts[1]]);
        segments.push([pts[1], pts[2]]);
        segments.push([pts[2], pts[0]]);
      }
      break;
    case 'quadratic':
      if (pts.length >= 3) {
        const p0 = pts[0], p1 = pts[1], ctrl = pts[2];
        const approxLen = Math.hypot(p0.x - p1.x, p0.y - p1.y);
        const steps = Math.max(10, Math.ceil(approxLen / maxSegLen));
        let prev = p0;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
          const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
          const cur = { x, y };
          segments.push([prev, cur]);
          prev = cur;
        }
      }
      break;
    case 'brush':
      if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) {
          segments.push([pts[i], pts[i + 1]]);
        }
      }
      break;
  }

  for (const [a, b] of segments) {
    rasterizeLine(a.x, a.y, b.x, b.y, stepX, stepY, xMin, yMin, resolution, wallGrid);
  }
}

// ========== 栅格化与连通区域 ==========
export interface GridRegion {
  id: number;
  cells: { i: number; j: number }[];
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
  seed: Point;
}

export interface GridData {
  regionIdGrid: number[][];
  regions: GridRegion[];
  stepX: number;
  stepY: number;
  xMin: number;
  yMin: number;
  resolution: number;
}

export function computeGridRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 500
): GridData {
  const { xMin, xMax, yMin, yMax } = worldBounds;
  const stepX = (xMax - xMin) / resolution;
  const stepY = (yMax - yMin) / resolution;

  const wallGrid: boolean[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(false));
  for (const shape of shapes) {
    rasterizeShape(shape, stepX, stepY, xMin, yMin, resolution, wallGrid);
  }

  const regionIdGrid: number[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(-1));
  const regions: GridRegion[] = [];
  let currentId = 0;

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (wallGrid[i][j] || regionIdGrid[i][j] !== -1) continue;

      const queue: [number, number][] = [[i, j]];
      regionIdGrid[i][j] = currentId;
      const cells: { i: number; j: number }[] = [{ i, j }];
      let minI = i, maxI = i, minJ = j, maxJ = j;

      while (queue.length) {
        const [ci, cj] = queue.shift()!;
        for (const [di, dj] of dirs) {
          const ni = ci + di, nj = cj + dj;
          if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution &&
              !wallGrid[ni][nj] && regionIdGrid[ni][nj] === -1) {
            regionIdGrid[ni][nj] = currentId;
            queue.push([ni, nj]);
            cells.push({ i: ni, j: nj });
            minI = Math.min(minI, ni);
            maxI = Math.max(maxI, ni);
            minJ = Math.min(minJ, nj);
            maxJ = Math.max(maxJ, nj);
          }
        }
      }

      let sumX = 0, sumY = 0;
      for (const cell of cells) {
        const wx = xMin + (cell.j + 0.5) * stepX;
        const wy = yMin + (cell.i + 0.5) * stepY;
        sumX += wx;
        sumY += wy;
      }
      const seed = { x: sumX / cells.length, y: sumY / cells.length };

      regions.push({
        id: currentId,
        cells,
        bounds: { minI, maxI, minJ, maxJ },
        seed,
      });
      currentId++;
    }
  }

  return {
    regionIdGrid,
    regions,
    stepX,
    stepY,
    xMin,
    yMin,
    resolution,
  };
}

// ========== 扫描线区间辅助 ==========
export interface ScanlineSpan {
  y: number;      // 该行的世界坐标 Y（单元格中心）
  xMin: number;   // 左边界（世界坐标）
  xMax: number;   // 右边界（世界坐标）
}

export type ScanlineCache = Record<number, ScanlineSpan[]>;

export function computeScanlineIntervals(gridData: GridData): ScanlineCache {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const cache: ScanlineCache = {};

  for (let i = 0; i < resolution; i++) {
    let currentId = -1;
    let spanStart = -1;
    const worldY = yMin + (i + 0.5) * stepY;

    for (let j = 0; j <= resolution; j++) {
      const id = (j < resolution) ? regionIdGrid[i][j] : -1;

      if (id !== currentId) {
        if (currentId !== -1 && spanStart !== -1) {
          const xLeft = xMin + spanStart * stepX;
          const xRight = xMin + j * stepX;   // 修正：j 是下一个不同 ID 的起始列，右边界正确
          if (!cache[currentId]) cache[currentId] = [];
          cache[currentId].push({ y: worldY, xMin: xLeft, xMax: xRight });
        }
        if (id !== -1) {
          currentId = id;
          spanStart = j;
        } else {
          currentId = -1;
          spanStart = -1;
        }
      }
    }
  }
  return cache;
}

// ========== 垂直扫描线区间（按列）==========
export interface VerticalSpan {
  x: number;      // 该列的世界坐标 X（单元格中心）
  yMin: number;  // 下边界（世界坐标）
  yMax: number;  // 上边界（世界坐标）
}

export type VerticalCache = Record<number, VerticalSpan[]>;

export function computeVerticalIntervals(gridData: GridData): VerticalCache {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const cache: VerticalCache = {};

  for (let j = 0; j < resolution; j++) {
    let currentId = -1;
    let spanStart = -1;
    const worldX = xMin + (j + 0.5) * stepX;

    for (let i = 0; i <= resolution; i++) {
      const id = (i < resolution) ? regionIdGrid[i][j] : -1;

      if (id !== currentId) {
        if (currentId !== -1 && spanStart !== -1) {
          const yBottom = yMin + spanStart * stepY;
          const yTop = yMin + i * stepY;
          if (!cache[currentId]) cache[currentId] = [];
          cache[currentId].push({ x: worldX, yMin: yBottom, yMax: yTop });
        }
        if (id !== -1) {
          currentId = id;
          spanStart = i;
        } else {
          currentId = -1;
          spanStart = -1;
        }
      }
    }
  }
  return cache;
}

// ========== 射线与形状求交 ==========
function intersectLineSegment(origin: Point, dir: Point, a: Point, b: Point): number | null {
  const ax = a.x, ay = a.y;
  const bx = b.x, by = b.y;
  const dx = bx - ax, dy = by - ay;
  const det = dir.x * dy - dir.y * dx;
  if (Math.abs(det) < 1e-12) return null;
  const t = ((ax - origin.x) * dy - (ay - origin.y) * dx) / det;
  if (t <= 1e-12) return null;
  const u = ((ax - origin.x) * dir.y - (ay - origin.y) * dir.x) / det;
  if (u >= -1e-12 && u <= 1 + 1e-12) return t;
  return null;
}

function intersectCircle(origin: Point, dir: Point, center: Point, radius: number): number | null {
  const ox = origin.x - center.x, oy = origin.y - center.y;
  const dx = dir.x, dy = dir.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - radius * radius;
  const delta = b * b - 4 * a * c;
  if (delta < 0) return null;
  const sqrtDelta = Math.sqrt(delta);
  const t1 = (-b - sqrtDelta) / (2 * a);
  const t2 = (-b + sqrtDelta) / (2 * a);
  let tmin = null;
  if (t1 > 1e-12) tmin = t1;
  if (t2 > 1e-12 && (tmin === null || t2 < tmin)) tmin = t2;
  return tmin;
}

function intersectQuadratic(origin: Point, dir: Point, p0: Point, p1: Point, ctrl: Point, segments: number = 30): number | null {
  let minT: number | null = null;
  let prev = p0;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    const cur = { x, y };
    const tHit = intersectLineSegment(origin, dir, prev, cur);
    if (tHit !== null && (minT === null || tHit < minT)) minT = tHit;
    prev = cur;
  }
  return minT;
}

function getNearestIntersection(origin: Point, dir: Point, shapes: Shape[]): { point: Point; t: number } | null {
  let bestT: number | null = null;
  let bestPoint: Point | null = null;

  for (const shape of shapes) {
    const pts = shape.points;
    switch (shape.type) {
      case 'point':
        break;
      case 'line':
        if (pts.length >= 2) {
          const t = intersectLineSegment(origin, dir, pts[0], pts[1]);
          if (t !== null && (bestT === null || t < bestT)) {
            bestT = t;
            bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
          }
        }
        break;
      case 'rectangle':
        if (pts.length >= 2) {
          const p1 = pts[0], p2 = pts[1];
          const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
          const bottom = Math.min(p1.y, p2.y), top = Math.max(p1.y, p2.y);
          const rectSegments: [Point, Point][] = [
            [{ x: left, y: bottom }, { x: right, y: bottom }],
            [{ x: right, y: bottom }, { x: right, y: top }],
            [{ x: right, y: top }, { x: left, y: top }],
            [{ x: left, y: top }, { x: left, y: bottom }],
          ];
          for (const [a, b] of rectSegments) {
            const t = intersectLineSegment(origin, dir, a, b);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t;
              bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
            }
          }
        }
        break;
      case 'circle':
        if (pts.length >= 2) {
          const center = pts[0];
          const radius = Math.hypot(pts[1].x - center.x, pts[1].y - center.y);
          const t = intersectCircle(origin, dir, center, radius);
          if (t !== null && (bestT === null || t < bestT)) {
            bestT = t;
            bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
          }
        }
        break;
      case 'triangle':
        if (pts.length >= 3) {
          for (let i = 0; i < 3; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % 3];
            const t = intersectLineSegment(origin, dir, a, b);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t;
              bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
            }
          }
        }
        break;
      case 'quadratic':
        if (pts.length >= 3) {
          const t = intersectQuadratic(origin, dir, pts[0], pts[1], pts[2]);
          if (t !== null && (bestT === null || t < bestT)) {
            bestT = t;
            bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
          }
        }
        break;
      case 'brush':
        if (pts.length >= 2) {
          for (let i = 0; i < pts.length - 1; i++) {
            const t = intersectLineSegment(origin, dir, pts[i], pts[i + 1]);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t;
              bestPoint = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
            }
          }
        }
        break;
    }
  }

  if (bestPoint) return { point: bestPoint, t: bestT! };
  return null;
}

// ========== 判断单元格是否为该区域的外边界单元格（与背景-1相邻）==========
function isOuterBoundaryCell(
  i: number,
  j: number,
  regionId: number,
  regionIdGrid: number[][],
  resolution: number
): boolean {
  if (i < 0 || i >= resolution || j < 0 || j >= resolution) return false;
  if (regionIdGrid[i][j] !== regionId) return false;
  const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [di, dj] of neighbors) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || ni >= resolution || nj < 0 || nj >= resolution) return true;
    if (regionIdGrid[ni][nj] === -1) return true;
  }
  return false;
}

// ========== 精确边界提取（从外边界单元边缘向背景区域发射射线）==========
export function extractExactBoundary(
  regionId: number,
  shapes: Shape[],
  gridData: GridData,
  scanlineCache: ScanlineCache,
  verticalCache: VerticalCache,
  angleStepDeg: number = 1.0
): Point[] {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const boundaryPointsSet = new Set<string>();
  const addPoint = (p: Point) => {
    const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
    boundaryPointsSet.add(key);
  };

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (!isOuterBoundaryCell(i, j, regionId, regionIdGrid, resolution)) continue;

      const cellLeft = xMin + j * stepX;
      const cellRight = xMin + (j + 1) * stepX;
      const cellTop = yMin + i * stepY;
      const cellBottom = yMin + (i + 1) * stepY;

      const leftBg = (j === 0) || (regionIdGrid[i][j - 1] === -1);
      const rightBg = (j === resolution - 1) || (regionIdGrid[i][j + 1] === -1);
      const upBg = (i === 0) || (regionIdGrid[i - 1][j] === -1);
      const downBg = (i === resolution - 1) || (regionIdGrid[i + 1][j] === -1);

      if (leftBg) {
        const ox = cellLeft;
        const oy = (cellTop + cellBottom) / 2;
        const p = getNearestIntersection({ x: ox, y: oy }, { x: -1, y: 0 }, shapes);
        if (p) addPoint(p.point);
      }
      if (rightBg) {
        const ox = cellRight;
        const oy = (cellTop + cellBottom) / 2;
        const p = getNearestIntersection({ x: ox, y: oy }, { x: 1, y: 0 }, shapes);
        if (p) addPoint(p.point);
      }
      if (upBg) {
        const ox = (cellLeft + cellRight) / 2;
        const oy = cellTop;
        const p = getNearestIntersection({ x: ox, y: oy }, { x: 0, y: -1 }, shapes);
        if (p) addPoint(p.point);
      }
      if (downBg) {
        const ox = (cellLeft + cellRight) / 2;
        const oy = cellBottom;
        const p = getNearestIntersection({ x: ox, y: oy }, { x: 0, y: 1 }, shapes);
        if (p) addPoint(p.point);
      }
    }
  }

  let points = Array.from(boundaryPointsSet).map(key => {
    const [xStr, yStr] = key.split('_');
    return { x: parseFloat(xStr) / 1e6, y: parseFloat(yStr) / 1e6 };
  });

  if (points.length < 3) {
    const region = gridData.regions.find(r => r.id === regionId);
    if (region) {
      const { minI, maxI, minJ, maxJ } = region.bounds;
      const p1 = { x: xMin + minJ * stepX, y: yMin + minI * stepY };
      const p2 = { x: xMin + maxJ * stepX, y: yMin + minI * stepY };
      const p3 = { x: xMin + maxJ * stepX, y: yMin + maxI * stepY };
      const p4 = { x: xMin + minJ * stepX, y: yMin + maxI * stepY };
      return [p1, p2, p3, p4];
    }
    return [];
  }

  let centerX = 0, centerY = 0;
  for (const p of points) { centerX += p.x; centerY += p.y; }
  centerX /= points.length;
  centerY /= points.length;

  points.sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });

  if (points.length >= 2 &&
      Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) > 1e-9) {
    points.push(points[0]);
  }
  return points;
}

// ========== 对外主函数 ==========
export function computeRegionsExact(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 500,
  angleStepDeg: number = 1.0
): Point[][][] {
  console.log('[computeRegionsExact] 开始精确区域检测...');
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const scanlineCache = computeScanlineIntervals(gridData);
  const verticalCache = computeVerticalIntervals(gridData);
  console.log(`[computeRegionsExact] 发现 ${gridData.regions.length} 个连通区域`);

  const polygons: Point[][][] = [];

  // 辅助：判断多边形是否几乎等于全屏
  const isFullWorldPolygon = (poly: Point[]): boolean => {
    if (poly.length < 3) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const eps = 1e-6;
    return (Math.abs(minX - worldBounds.xMin) < eps &&
            Math.abs(maxX - worldBounds.xMax) < eps &&
            Math.abs(minY - worldBounds.yMin) < eps &&
            Math.abs(maxY - worldBounds.yMax) < eps);
  };

  for (const region of gridData.regions) {
    if (region.cells.length < 10) continue;

    // 过滤背景区域（触及世界边界栅格边缘的区域）
    const { minI, maxI, minJ, maxJ } = region.bounds;
    const touchesWorldEdge = (minI === 0 || maxI === resolution - 1 || minJ === 0 || maxJ === resolution - 1);
    if (touchesWorldEdge) {
      console.log(`[computeRegionsExact] 跳过与世界边界相邻的区域 ${region.id}`);
      continue;
    }

    const outerPoly = extractExactBoundary(
      region.id,
      shapes,
      gridData,
      scanlineCache,
      verticalCache,
      angleStepDeg
    );

    if (outerPoly.length >= 3 && !isFullWorldPolygon(outerPoly)) {
      polygons.push([outerPoly]);
    }
  }

  console.log(`[computeRegionsExact] 提取到 ${polygons.length} 个有效多边形`);
  return polygons;
}

// ========== 调试用 ==========
export interface DebugRegionData {
  id: number;
  cellCount: number;
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
  seed: Point;
  boundaryPolygon: Point[];
}

export function getDebugRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 300
): DebugRegionData[] {
  console.log('[getDebugRegions] 开始获取调试区域数据...');
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const scanlineCache = computeScanlineIntervals(gridData);
  const verticalCache = computeVerticalIntervals(gridData);
  console.log(`[getDebugRegions] 发现 ${gridData.regions.length} 个连通区域`);

  const debugRegions: DebugRegionData[] = [];

  for (const region of gridData.regions) {
    const boundaryPolygon = extractExactBoundary(
      region.id,
      shapes,
      gridData,
      scanlineCache,
      verticalCache,
      1.0
    );
    debugRegions.push({
      id: region.id,
      cellCount: region.cells.length,
      bounds: region.bounds,
      seed: region.seed,
      boundaryPolygon,
    });
    console.log(`[getDebugRegions] 区域${region.id}: cells=${region.cells.length}, boundaryPoints=${boundaryPolygon.length}`);
  }

  return debugRegions;
}