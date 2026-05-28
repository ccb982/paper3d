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

// ========== 射线与形状求交（用于精确边界）==========
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

// ========== 边界交点定义 ==========
interface BoundaryPoint {
  point: Point;           // 精确交点坐标
  insideId: number;       // 内侧区域 ID（当前区域）
  outsideId: number;      // 外侧区域 ID（射线穿过边界后所属的栅格区域）
  direction: 'left' | 'right' | 'up' | 'down'; // 射线方向（从边界单元格向外）
}

// 判断单元格是否为某个区域的边界单元格（即至少有一个邻接单元格区域不同）
function isBoundaryCell(i: number, j: number, regionId: number, regionIdGrid: number[][], resolution: number): boolean {
  if (regionIdGrid[i][j] !== regionId) return false;
  const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [di, dj] of neighbors) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || ni >= resolution || nj < 0 || nj >= resolution) return true; // 触碰世界边界也算边界
    if (regionIdGrid[ni][nj] !== regionId) return true;
  }
  return false;
}

// 将世界坐标点转换到栅格索引
function probePointToGrid(point: Point, gridData: GridData): { i: number; j: number } | null {
  const { xMin, yMin, stepX, stepY, resolution } = gridData;
  const j = Math.floor((point.x - xMin) / stepX);
  const i = Math.floor((point.y - yMin) / stepY);
  if (i >= 0 && i < resolution && j >= 0 && j < resolution) return { i, j };
  return null;
}

// 从边界单元格向外部发射射线，收集交点
function collectBoundaryPointsForRegion(
  regionId: number,
  gridData: GridData,
  shapes: Shape[]
): BoundaryPoint[] {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const boundaryPoints: BoundaryPoint[] = [];

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (!isBoundaryCell(i, j, regionId, regionIdGrid, resolution)) continue;

      const cellLeft = xMin + j * stepX;
      const cellRight = xMin + (j + 1) * stepX;
      const cellTop = yMin + i * stepY;
      const cellBottom = yMin + (i + 1) * stepY;

      // 检查四个方向是否有外部区域
      const leftBg = (j === 0) || (regionIdGrid[i][j - 1] !== regionId);
      const rightBg = (j === resolution - 1) || (regionIdGrid[i][j + 1] !== regionId);
      const upBg = (i === 0) || (regionIdGrid[i - 1][j] !== regionId);
      const downBg = (i === resolution - 1) || (regionIdGrid[i + 1][j] !== regionId);

      if (leftBg) {
        const origin = { x: cellLeft, y: (cellTop + cellBottom) / 2 };
        const dir = { x: -1, y: 0 };
        const hit = getNearestIntersection(origin, dir, shapes);
        if (hit) {
          // 确定外侧区域 ID：从交点沿射线方向微移一点，查询所属栅格区域
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          boundaryPoints.push({
            point: hit.point,
            insideId: regionId,
            outsideId,
            direction: 'left',
          });
        }
      }
      if (rightBg) {
        const origin = { x: cellRight, y: (cellTop + cellBottom) / 2 };
        const dir = { x: 1, y: 0 };
        const hit = getNearestIntersection(origin, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          boundaryPoints.push({
            point: hit.point,
            insideId: regionId,
            outsideId,
            direction: 'right',
          });
        }
      }
      if (upBg) {
        const origin = { x: (cellLeft + cellRight) / 2, y: cellTop };
        const dir = { x: 0, y: -1 };
        const hit = getNearestIntersection(origin, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          boundaryPoints.push({
            point: hit.point,
            insideId: regionId,
            outsideId,
            direction: 'up',
          });
        }
      }
      if (downBg) {
        const origin = { x: (cellLeft + cellRight) / 2, y: cellBottom };
        const dir = { x: 0, y: 1 };
        const hit = getNearestIntersection(origin, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          boundaryPoints.push({
            point: hit.point,
            insideId: regionId,
            outsideId,
            direction: 'down',
          });
        }
      }
    }
  }

  // 去重（相同坐标只保留一个）
  const unique = new Map<string, BoundaryPoint>();
  for (const bp of boundaryPoints) {
    const key = `${Math.round(bp.point.x * 1e9)}_${Math.round(bp.point.y * 1e9)}`;
    if (!unique.has(key)) unique.set(key, bp);
  }
  return Array.from(unique.values());
}

// ========== 从边界点重建多边形（支持外环 + 内孔）==========
function buildPolygonsFromBoundaryPoints(boundaryPoints: BoundaryPoint[], stepX: number): Point[][] {
  if (boundaryPoints.length < 3) return [];

  const points = boundaryPoints.map(bp => bp.point);

  // 计算中心点
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  // 简单按极角排序，对于大多数情况足够
  const sorted = [...points];
  sorted.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  // 闭合
  if (Math.hypot(sorted[0].x - sorted[sorted.length - 1].x, sorted[0].y - sorted[sorted.length - 1].y) > 1e-6) {
    sorted.push(sorted[0]);
  }

  // 计算面积判断方向
  let area = 0;
  for (let i = 0, j = sorted.length - 1; i < sorted.length; j = i++) {
    area += (sorted[j].x * sorted[i].y - sorted[j].y * sorted[i].x);
  }
  area /= 2;

  // 确保是逆时针（外环）
  if (area < 0) {
    sorted.reverse();
  }

  return [sorted];
}

// ========== 主入口：计算带孔多边形区域 ==========
export function computeRegionsExact(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 500,
  _angleStepDeg: number = 1.0
): Point[][][] {
  console.log('[computeRegionsExact] 开始精确区域检测（新算法）...');
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  console.log(`[computeRegionsExact] 发现 ${gridData.regions.length} 个连通区域`);

  const allPolygons: Point[][][] = [];

  for (const region of gridData.regions) {
    // 跳过单元格太少的区域（噪声）
    if (region.cells.length < 10) continue;

    // 跳过触及世界边界的区域（背景）
    const { minI, maxI, minJ, maxJ } = region.bounds;
    const touchesEdge = (minI === 0 || maxI === resolution - 1 || minJ === 0 || maxJ === resolution - 1);
    if (touchesEdge) {
      console.log(`[computeRegionsExact] 跳过与世界边界相邻的区域 ${region.id}`);
      continue;
    }

    // 收集该区域的所有边界交点
    const boundaryPoints = collectBoundaryPointsForRegion(region.id, gridData, shapes);
    if (boundaryPoints.length < 3) continue;

    // 重建多边形
    const rings = buildPolygonsFromBoundaryPoints(boundaryPoints, gridData.stepX);
    if (rings.length === 0 || rings[0].length < 3) continue;

    allPolygons.push(rings);
    console.log(`[computeRegionsExact] 区域 ${region.id}: 外环点数=${rings[0].length}`);
  }

  console.log(`[computeRegionsExact] 提取到 ${allPolygons.length} 个有效多边形`);
  return allPolygons;
}

// ========== 调试射线类型 ==========
export interface DebugRay {
  start: Point;
  end: Point;
  direction: 'left' | 'right' | 'up' | 'down';
  outsideId: number;
}

// ========== 调试数据类型 ==========
export interface DebugRegionData {
  id: number;
  cellCount: number;
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
  seed: Point;
  boundaryPolygon: Point[];
  rays: DebugRay[];
}

// ========== 收集区域边界射线（调试用）==========
export function collectBoundaryRaysForRegion(
  regionId: number,
  gridData: GridData,
  shapes: Shape[]
): DebugRay[] {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const rays: DebugRay[] = [];

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (!isBoundaryCell(i, j, regionId, regionIdGrid, resolution)) continue;

      const cellLeft = xMin + j * stepX;
      const cellRight = xMin + (j + 1) * stepX;
      const cellTop = yMin + i * stepY;
      const cellBottom = yMin + (i + 1) * stepY;

      const leftBg = (j === 0) || (regionIdGrid[i][j - 1] !== regionId);
      const rightBg = (j === resolution - 1) || (regionIdGrid[i][j + 1] !== regionId);
      const upBg = (i === 0) || (regionIdGrid[i - 1][j] !== regionId);
      const downBg = (i === resolution - 1) || (regionIdGrid[i + 1][j] !== regionId);

      if (leftBg) {
        const start = { x: cellLeft, y: (cellTop + cellBottom) / 2 };
        const dir = { x: -1, y: 0 };
        const hit = getNearestIntersection(start, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          rays.push({ start, end: hit.point, direction: 'left', outsideId });
        }
      }
      if (rightBg) {
        const start = { x: cellRight, y: (cellTop + cellBottom) / 2 };
        const dir = { x: 1, y: 0 };
        const hit = getNearestIntersection(start, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          rays.push({ start, end: hit.point, direction: 'right', outsideId });
        }
      }
      if (upBg) {
        const start = { x: (cellLeft + cellRight) / 2, y: cellTop };
        const dir = { x: 0, y: -1 };
        const hit = getNearestIntersection(start, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          rays.push({ start, end: hit.point, direction: 'up', outsideId });
        }
      }
      if (downBg) {
        const start = { x: (cellLeft + cellRight) / 2, y: cellBottom };
        const dir = { x: 0, y: 1 };
        const hit = getNearestIntersection(start, dir, shapes);
        if (hit) {
          const epsilon = 1e-6;
          const probe = { x: hit.point.x + dir.x * epsilon, y: hit.point.y + dir.y * epsilon };
          const probeGrid = probePointToGrid(probe, gridData);
          const outsideId = probeGrid !== null ? regionIdGrid[probeGrid.i][probeGrid.j] : -1;
          rays.push({ start, end: hit.point, direction: 'down', outsideId });
        }
      }
    }
  }

  return rays;
}

// ========== 调试辅助 ==========
export function getDebugRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 300
): DebugRegionData[] {
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const debug: DebugRegionData[] = [];
  for (const region of gridData.regions) {
    const boundaryPoints = collectBoundaryPointsForRegion(region.id, gridData, shapes);
    let boundaryPolygon: Point[] = [];
    if (boundaryPoints.length >= 3) {
      const rings = buildPolygonsFromBoundaryPoints(boundaryPoints, gridData.stepX);
      if (rings.length > 0) boundaryPolygon = rings[0];
    }
    const rays = collectBoundaryRaysForRegion(region.id, gridData, shapes);
    debug.push({
      id: region.id,
      cellCount: region.cells.length,
      bounds: region.bounds,
      seed: region.seed,
      boundaryPolygon,
      rays,
    });
    console.log(`[getDebugRegions] 区域 ${region.id}: cells=${region.cells.length}, boundaryPoints=${boundaryPoints.length}, rays=${rays.length}`);
  }
  return debug;
}

// ========== 扫描线区间（保留以兼容旧代码）==========
export interface ScanlineSpan {
  y: number;
  xMin: number;
  xMax: number;
}

export type ScanlineCache = Record<number, ScanlineSpan[]>;

export function computeScanlineIntervals(gridData: GridData): ScanlineCache {
  return {};
}
