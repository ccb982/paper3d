import type { Point, Shape } from '../types';

// ========== 1. 光栅化：将图形边缘画到网格上 ==========
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
    if (i >= 0 && i < resolution && j >= 0 && j < resolution) wallGrid[i][j] = true;
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
    case 'point': break;
    case 'line': if (pts.length >= 2) segments.push([pts[0], pts[1]]); break;
    case 'rectangle': if (pts.length >= 2) {
        const p1 = pts[0], p2 = pts[1];
        const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
        const bottom = Math.min(p1.y, p2.y), top = Math.max(p1.y, p2.y);
        segments.push([{ x: left, y: bottom }, { x: right, y: bottom }]);
        segments.push([{ x: right, y: bottom }, { x: right, y: top }]);
        segments.push([{ x: right, y: top }, { x: left, y: top }]);
        segments.push([{ x: left, y: top }, { x: left, y: bottom }]);
      } break;
    case 'circle': if (pts.length >= 2) {
        const center = pts[0];
        const radius = Math.hypot(pts[1].x - center.x, pts[1].y - center.y);
        const steps = Math.max(20, Math.ceil(2 * Math.PI * radius / maxSegLen));
        let prev = { x: center.x + radius, y: center.y };
        for (let i = 1; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const cur = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
          segments.push([prev, cur]);
          prev = cur;
        }
      } break;
    case 'triangle': if (pts.length >= 3) {
        segments.push([pts[0], pts[1]]);
        segments.push([pts[1], pts[2]]);
        segments.push([pts[2], pts[0]]);
      } break;
    case 'quadratic': if (pts.length >= 3) {
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
      } break;
    case 'brush': if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
      } break;
  }
  for (const [a, b] of segments) {
    rasterizeLine(a.x, a.y, b.x, b.y, stepX, stepY, xMin, yMin, resolution, wallGrid);
  }
}

// ========== 2. 连通区域识别（BFS）==========
export interface GridRegion {
  id: number;
  cells: { i: number; j: number }[];
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
  seed: Point;
  touchesEdge: boolean;
}

export interface WallRegion {
  id: number;
  cells: { i: number; j: number }[];
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
}

export interface GridData {
  regionIdGrid: number[][];
  regions: GridRegion[];
  wallRegionIdGrid: number[][];
  wallRegions: WallRegion[];
  stepX: number; stepY: number;
  xMin: number; yMin: number;
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
  for (const shape of shapes) rasterizeShape(shape, stepX, stepY, xMin, yMin, resolution, wallGrid);

  // 对墙格子进行八连通洪水填充，分配负ID
  const wallRegionIdGrid: number[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(0));
  const wallRegions: WallRegion[] = [];
  let currentWallId = -1;
  const wallDirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (wallGrid[i][j] && wallRegionIdGrid[i][j] === 0) {
        const regionId = currentWallId--;
        const cells: { i: number; j: number }[] = [];
        const queue: [number, number][] = [[i, j]];
        wallRegionIdGrid[i][j] = regionId;
        let minI = i, maxI = i, minJ = j, maxJ = j;

        while (queue.length > 0) {
          const [ci, cj] = queue.shift()!;
          cells.push({ i: ci, j: cj });
          minI = Math.min(minI, ci); maxI = Math.max(maxI, ci);
          minJ = Math.min(minJ, cj); maxJ = Math.max(maxJ, cj);

          for (const [di, dj] of wallDirs) {
            const ni = ci + di, nj = cj + dj;
            if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution &&
                wallGrid[ni][nj] && wallRegionIdGrid[ni][nj] === 0) {
              wallRegionIdGrid[ni][nj] = regionId;
              queue.push([ni, nj]);
            }
          }
        }

        wallRegions.push({
          id: regionId,
          cells,
          bounds: { minI, maxI, minJ, maxJ }
        });
      }
    }
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
      let touchesEdge = (i === 0 || i === resolution-1 || j === 0 || j === resolution-1);
      while (queue.length) {
        const [ci, cj] = queue.shift()!;
        for (const [di, dj] of dirs) {
          const ni = ci + di, nj = cj + dj;
          if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution &&
              !wallGrid[ni][nj] && regionIdGrid[ni][nj] === -1) {
            regionIdGrid[ni][nj] = currentId;
            queue.push([ni, nj]);
            cells.push({ i: ni, j: nj });
            minI = Math.min(minI, ni); maxI = Math.max(maxI, ni);
            minJ = Math.min(minJ, nj); maxJ = Math.max(maxJ, nj);
            if (ni === 0 || ni === resolution-1 || nj === 0 || nj === resolution-1) touchesEdge = true;
          }
        }
      }
      let sumX = 0, sumY = 0;
      for (const cell of cells) {
        sumX += xMin + (cell.j + 0.5) * stepX;
        sumY += yMin + (cell.i + 0.5) * stepY;
      }
      const seed = { x: sumX / cells.length, y: sumY / cells.length };
      regions.push({ id: currentId, cells, bounds: { minI, maxI, minJ, maxJ }, seed, touchesEdge });
      currentId++;
    }
  }
  return { regionIdGrid, regions, wallRegionIdGrid, wallRegions, stepX, stepY, xMin, yMin, resolution };
}

// ========== 3. 射线与图形精确求交 ==========
function intersectLineSegment(origin: Point, dir: Point, a: Point, b: Point): number | null {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
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
  const a = dx*dx + dy*dy;
  const b = 2*(ox*dx + oy*dy);
  const c = ox*ox + oy*oy - radius*radius;
  const delta = b*b - 4*a*c;
  if (delta < 0) return null;
  const sqrtDelta = Math.sqrt(delta);
  const t1 = (-b - sqrtDelta)/(2*a);
  const t2 = (-b + sqrtDelta)/(2*a);
  let tmin = null;
  if (t1 > 1e-12) tmin = t1;
  if (t2 > 1e-12 && (tmin === null || t2 < tmin)) tmin = t2;
  return tmin;
}

function intersectQuadratic(origin: Point, dir: Point, p0: Point, p1: Point, ctrl: Point, segments = 30): number | null {
  let minT: number | null = null;
  let prev = p0;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt*mt*p0.x + 2*mt*t*ctrl.x + t*t*p1.x;
    const y = mt*mt*p0.y + 2*mt*t*ctrl.y + t*t*p1.y;
    const cur = { x, y };
    const tHit = intersectLineSegment(origin, dir, prev, cur);
    if (tHit !== null && (minT === null || tHit < minT)) minT = tHit;
    prev = cur;
  }
  return minT;
}

function getNearestIntersection(origin: Point, dir: Point, shapes: Shape[]): { point: Point; t: number; shapeId?: string; segment?: [Point, Point] } | null {
  let bestT: number | null = null;
  let bestPoint: Point | null = null;
  let bestShapeId: string | undefined = undefined;
  let bestSegment: [Point, Point] | undefined = undefined;
  for (const shape of shapes) {
    const pts = shape.points;
    switch (shape.type) {
      case 'point': break;
      case 'line':
        if (pts.length >= 2) {
          const t = intersectLineSegment(origin, dir, pts[0], pts[1]);
          if (t !== null && (bestT === null || t < bestT)) {
            bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
            bestShapeId = shape.id; bestSegment = [pts[0], pts[1]];
          }
        }
        break;
      case 'rectangle':
        if (pts.length >= 2) {
          const p1 = pts[0], p2 = pts[1];
          const left = Math.min(p1.x,p2.x), right = Math.max(p1.x,p2.x);
          const bottom = Math.min(p1.y,p2.y), top = Math.max(p1.y,p2.y);
          const segs: [Point,Point][] = [
            [{x:left,y:bottom},{x:right,y:bottom}], [{x:right,y:bottom},{x:right,y:top}],
            [{x:right,y:top},{x:left,y:top}], [{x:left,y:top},{x:left,y:bottom}]
          ];
          for (const seg of segs) {
            const t = intersectLineSegment(origin, dir, seg[0], seg[1]);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
              bestShapeId = shape.id; bestSegment = seg;
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
            bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
            bestShapeId = shape.id;
          }
        }
        break;
      case 'triangle':
        if (pts.length >= 3) {
          for (let i=0;i<3;i++) {
            const a = pts[i], b = pts[(i+1)%3];
            const t = intersectLineSegment(origin, dir, a, b);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
              bestShapeId = shape.id; bestSegment = [a, b];
            }
          }
        }
        break;
      case 'quadratic':
        if (pts.length >= 3) {
          const t = intersectQuadratic(origin, dir, pts[0], pts[1], pts[2]);
          if (t !== null && (bestT === null || t < bestT)) {
            bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
            bestShapeId = shape.id;
          }
        }
        break;
      case 'brush':
        if (pts.length >= 2) {
          for (let i=0;i<pts.length-1;i++) {
            const t = intersectLineSegment(origin, dir, pts[i], pts[i+1]);
            if (t !== null && (bestT === null || t < bestT)) {
              bestT = t; bestPoint = { x: origin.x + dir.x*t, y: origin.y + dir.y*t };
              bestShapeId = shape.id; bestSegment = [pts[i], pts[i+1]];
            }
          }
        }
        break;
    }
  }
  if (bestPoint) {
    return { point: bestPoint, t: bestT!, shapeId: bestShapeId, segment: bestSegment };
  }
  return null;
}

// ========== 辅助：世界坐标转网格索引 ==========
function worldToGrid(
  x: number,
  y: number,
  xMin: number,
  yMin: number,
  stepX: number,
  stepY: number,
  resolution: number
): { i: number; j: number } | null {
  const j = Math.floor((x - xMin) / stepX);
  const i = Math.floor((y - yMin) / stepY);
  if (i >= 0 && i < resolution && j >= 0 && j < resolution) {
    return { i, j };
  }
  return null;
}

// ========== 在交点周围扫描网格，确定外部区域 ID ==========
function getOutsideIdAroundPoint(
  point: Point,
  gridData: GridData,
  rid: number,
  radius: number = 2
): number | null {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const gridPos = worldToGrid(point.x, point.y, xMin, yMin, stepX, stepY, resolution);
  if (!gridPos) return null;
  const { i: ci, j: cj } = gridPos;

  type Candidate = { id: number; distSq: number };
  const candidates: Candidate[] = [];

  for (let di = -radius; di <= radius; di++) {
    for (let dj = -radius; dj <= radius; dj++) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || ni >= resolution || nj < 0 || nj >= resolution) continue;
      const nid = regionIdGrid[ni][nj];
      if (nid === rid || nid === -1 || nid < 0) continue; // 排除负ID（墙区域）

      const centerX = xMin + (nj + 0.5) * stepX;
      const centerY = yMin + (ni + 0.5) * stepY;
      const dx = centerX - point.x;
      const dy = centerY - point.y;
      const distSq = dx * dx + dy * dy;
      candidates.push({ id: nid, distSq });
    }
  }

  if (candidates.length === 0) {
    if (radius < 4) {
      return getOutsideIdAroundPoint(point, gridData, rid, radius + 1);
    }
    return null;
  }

  const freqMap = new Map<number, { count: number; minDistSq: number }>();
  for (const cand of candidates) {
    const existing = freqMap.get(cand.id);
    if (existing) {
      existing.count++;
      if (cand.distSq < existing.minDistSq) existing.minDistSq = cand.distSq;
    } else {
      freqMap.set(cand.id, { count: 1, minDistSq: cand.distSq });
    }
  }

  let bestId: number | null = null;
  let bestCount = 0;
  let bestDistSq = Infinity;
  for (const [id, { count, minDistSq }] of freqMap.entries()) {
    if (count > bestCount || (count === bestCount && minDistSq < bestDistSq)) {
      bestCount = count;
      bestDistSq = minDistSq;
      bestId = id;
    }
  }
  return bestId;
}

// ========== 新增：获取点周围的墙区域ID（负ID）==========
/**
 * 在世界坐标点周围搜索，找到最常见的墙区域ID（负ID）。
 */
export function getWallIdAroundPoint(
  point: Point,
  gridData: GridData,
  radius: number = 2
): number | null {
  const { wallRegionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  const gridPos = worldToGrid(point.x, point.y, xMin, yMin, stepX, stepY, resolution);
  if (!gridPos) return null;
  const { i: ci, j: cj } = gridPos;

  const freq = new Map<number, number>();
  let hasWall = false;

  for (let di = -radius; di <= radius; di++) {
    for (let dj = -radius; dj <= radius; dj++) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || ni >= resolution || nj < 0 || nj >= resolution) continue;
      const wallId = wallRegionIdGrid[ni][nj];
      if (wallId < 0) {
        hasWall = true;
        freq.set(wallId, (freq.get(wallId) || 0) + 1);
      }
    }
  }

  if (!hasWall) return null;

  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, count] of freq.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * 将边界点按它们关联的墙区域ID（负ID）分组。
 */
export function groupBoundaryPointsByWallId(
  boundaryPoints: BoundaryPoint[],
  gridData: GridData,
  radius: number = 2
): Map<number, Point[]> {
  const groups = new Map<number, Point[]>();
  for (const bp of boundaryPoints) {
    const wallId = getWallIdAroundPoint(bp.point, gridData, radius);
    if (wallId !== null) {
      if (!groups.has(wallId)) groups.set(wallId, []);
      groups.get(wallId)!.push(bp.point);
    }
  }
  return groups;
}

// ========== 核心：收集边界点 ==========
export interface BoundaryPoint {
  point: Point;
  insideId: number;
  outsideId: number;
}

function collectBoundaryPointsForMainRegion(
  regionId: number,
  gridData: GridData,
  shapes: Shape[]
): BoundaryPoint[] {
  const { stepX, stepY, xMin, yMin } = gridData;

  const region = gridData.regions.find(r => r.id === regionId);
  if (!region) return [];

  const pointMap = new Map<string, BoundaryPoint>();

  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 0.7071067811865475, y: 0.7071067811865475 },
    { x: 0.7071067811865475, y: -0.7071067811865475 },
    { x: -0.7071067811865475, y: 0.7071067811865475 },
    { x: -0.7071067811865475, y: -0.7071067811865475 }
  ];

  for (const cell of region.cells) {
    const { i, j } = cell;
    const centerX = xMin + (j + 0.5) * stepX;
    const centerY = yMin + (i + 0.5) * stepY;
    const origin = { x: centerX, y: centerY };

    for (const dir of directions) {
      const hit = getNearestIntersection(origin, dir, shapes);
      if (!hit) continue;

      const hitPoint = hit.point;
      const outsideId = getOutsideIdAroundPoint(hitPoint, gridData, regionId);
      if (outsideId === null) continue;

      const key = `${Math.round(hitPoint.x * 1e9)}_${Math.round(hitPoint.y * 1e9)}`;
      const existing = pointMap.get(key);
      if (!existing) {
        pointMap.set(key, {
          point: hitPoint,
          insideId: regionId,
          outsideId: outsideId
        });
      } else if (existing.outsideId !== outsideId) {
        pointMap.delete(key);
      }
    }
  }

  return Array.from(pointMap.values());
}

export function groupBoundaryPointsByOutsideId(
  boundaryPoints: BoundaryPoint[]
): Map<number, Point[]> {
  const groups = new Map<number, Point[]>();

  for (const bp of boundaryPoints) {
    const { outsideId, point } = bp;
    if (!groups.has(outsideId)) {
      groups.set(outsideId, []);
    }
    groups.get(outsideId)!.push(point);
  }

  return groups;
}

// ========== 新增：按 outsideId 分组，对每组内的点进行最小距离降采样 ==========
/**
 * 对边界点进行降采样：每个 outsideId 内，保留的点之间距离不小于 minDistance。
 * @param boundaryPoints 原始边界点列表
 * @param minDistance 最小距离阈值（世界坐标单位）
 * @returns 降采样后的边界点列表
 */
export function downsampleBoundaryPointsByOutsideId(
  boundaryPoints: BoundaryPoint[],
  minDistance: number
): BoundaryPoint[] {
  if (minDistance <= 0) return boundaryPoints;

  const groups = new Map<number, BoundaryPoint[]>();
  for (const bp of boundaryPoints) {
    if (!groups.has(bp.outsideId)) groups.set(bp.outsideId, []);
    groups.get(bp.outsideId)!.push(bp);
  }

  const result: BoundaryPoint[] = [];

  for (const [outsideId, points] of groups) {
    if (points.length === 0) continue;

    const kept: BoundaryPoint[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      let tooClose = false;
      for (const keptPoint of kept) {
        const dist = Math.hypot(p.point.x - keptPoint.point.x, p.point.y - keptPoint.point.y);
        if (dist < minDistance) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        kept.push(p);
      }
    }
    result.push(...kept);
  }

  // console.log(`[降采样] 阈值=${minDistance.toFixed(6)}, 原始点数=${boundaryPoints.length}, 降采样后=${result.length}`);
  return result;
}

// ========== 4. 多边形构建（极角排序）==========
function buildClosedRing(points: Point[]): Point[] {
  if (points.length < 3) return [];
  const uniqueMap = new Map<string, Point>();
  for (const p of points) {
    const key = `${Math.round(p.x * 1e9)}_${Math.round(p.y * 1e9)}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }
  let unique = Array.from(uniqueMap.values());
  if (unique.length < 3) return [];

  let cx = 0, cy = 0;
  for (const p of unique) { cx += p.x; cy += p.y; }
  cx /= unique.length; cy /= unique.length;

  unique.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  if (Math.hypot(unique[0].x - unique[unique.length - 1].x, unique[0].y - unique[unique.length - 1].y) > 1e-6) {
    unique.push(unique[0]);
  }
  return unique;
}

function buildClosedRingsByDistanceGrouping(points: Point[], distanceThresholdFactor: number = 0.3): { rings: Point[][], groups: Point[][] } {
  if (points.length < 3) return { rings: [], groups: [] };

  const uniqueMap = new Map<string, Point>();
  for (const p of points) {
    const key = `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }
  const unique = Array.from(uniqueMap.values());
  if (unique.length < 3) return { rings: [], groups: [] };

  let cx = 0, cy = 0;
  for (const p of unique) { cx += p.x; cy += p.y; }
  cx /= unique.length; cy /= unique.length;

  const pointsWithInfo = unique.map(p => ({
    point: p,
    angle: Math.atan2(p.y - cy, p.x - cx),
    dist: Math.hypot(p.x - cx, p.y - cy)
  }));

  pointsWithInfo.sort((a, b) => a.angle - b.angle);

  const avgDist = pointsWithInfo.reduce((sum, p) => sum + p.dist, 0) / pointsWithInfo.length;
  const distThreshold = avgDist * distanceThresholdFactor;

  const groups: Point[][] = [];
  let currentGroup: Point[] = [pointsWithInfo[0].point];
  const n = pointsWithInfo.length;

  for (let i = 1; i < n; i++) {
    const prevDist = pointsWithInfo[i - 1].dist;
    const currDist = pointsWithInfo[i].dist;
    const distDiff = Math.abs(currDist - prevDist);

    if (distDiff > distThreshold && currentGroup.length >= 3) {
      groups.push(currentGroup);
      currentGroup = [pointsWithInfo[i].point];
    } else {
      currentGroup.push(pointsWithInfo[i].point);
    }
  }
  if (currentGroup.length >= 3) groups.push(currentGroup);
  else if (currentGroup.length > 0 && groups.length > 0) {
    groups[groups.length - 1].push(...currentGroup);
  }

  const rings: Point[][] = [];
  for (const group of groups) {
    const ring = buildClosedRing(group);
    if (ring.length >= 3) rings.push(ring);
  }
  return { rings, groups };
}

function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += points[j].x * points[i].y - points[j].y * points[i].x;
  }
  return area / 2;
}

// ========== 5. 主函数：计算所有封闭区域 ==========
export function computeRegionsExact(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 500
): Point[][][] {
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const mainRegions = gridData.regions.filter(r => !r.touchesEdge && r.cells.length >= 10);

  const result: Point[][][] = [];

  for (const region of mainRegions) {
    const boundaryPoints = collectBoundaryPointsForMainRegion(region.id, gridData, shapes);
    if (boundaryPoints.length < 3) continue;

    const groups = groupBoundaryPointsByOutsideId(boundaryPoints);

    const rings: { points: Point[]; outsideId: number; area: number }[] = [];
    for (const [outsideId, pts] of groups.entries()) {
      if (pts.length < 3) continue;
      const ring = buildClosedRing(pts);
      if (ring.length >= 3) {
        const area = polygonArea(ring);
        rings.push({ points: ring, outsideId, area });
      }
    }

    if (rings.length === 0) continue;

    const outerCandidates = rings.filter(r => r.outsideId === -1 && r.area > 0);
    let outerRing = outerCandidates.length > 0 ? outerCandidates[0] : null;

    if (!outerRing) {
      const positiveRings = rings.filter(r => r.area > 0);
      if (positiveRings.length > 0) {
        positiveRings.sort((a, b) => b.area - a.area);
        outerRing = positiveRings[0];
      }
    }
    if (!outerRing) continue;

    if (outerRing.area < 0) {
      outerRing.points.reverse();
    }

    const innerRings = rings.filter(r => r !== outerRing);

    const regionPolygon: Point[][] = [outerRing.points, ...innerRings.map(r => r.points)];
    result.push(regionPolygon);
  }

  return result;
}

// ========== 6. 调试辅助 ==========
export interface DebugRay { start: Point; end: Point; direction: string; outsideId: number; }
export interface OutsideIdEndpoint {
  outsideId: number;
  insideId: number;
  p1: { x: number; y: number; distToCentroid: number };
  p2: { x: number; y: number; distToCentroid: number } | null;
}

export interface DebugRegionData {
  id: number; cellCount: number; bounds: any; seed: Point;
  boundaryPolygon: Point[]; rays: DebugRay[];
  boundaryPoints: BoundaryPoint[];
  clusteredBoundaryPoints?: BoundaryPoint[];
  rings?: Point[][];
  centroid?: Point | null;
  uniqueBoundaryPoints?: { point: Point; insideId: number; outsideId: number }[];
  pointGroups?: Point[][];
  outsideIdEndpoints?: OutsideIdEndpoint[];
  originalOutsideIdEndpoints?: OutsideIdEndpoint[];
  segments?: SegmentForMatching[];  // 新增：用于调试绘制片段
  wallGroupedPoints?: Map<number, Point[]>;  // 按墙区域ID分组后的点集
}

// ========== 双重阈值辅助函数（新算法） ==========
function radialDist(p: Point, centroid: Point): number {
  return Math.hypot(p.x - centroid.x, p.y - centroid.y);
}

function meetsThreshold(
  a: Point,
  b: Point,
  centroid: Point,
  distThreshold: number,
  radialThreshold: number
): boolean {
  const euclidean = Math.hypot(a.x - b.x, a.y - b.y);
  if (euclidean >= distThreshold) return false;
  const radialA = radialDist(a, centroid);
  const radialB = radialDist(b, centroid);
  return Math.abs(radialA - radialB) < radialThreshold;
}

// ========== 第一次分组：将无序点集构建为有序片段 ==========
interface Segment {
  id: number;
  points: Point[];
  start: Point;
  end: Point;
  closed: boolean;
}

function groupIntoSegments(
  points: Point[],
  centroid: Point | null,
  distThreshold: number,
  radialThreshold: number
): Segment[] {
  if (points.length === 0) return [];

  if (!centroid) {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    centroid = { x: cx / points.length, y: cy / points.length };
  }

  // 极角排序
  const sorted = [...points];
  sorted.sort((a, b) => {
    const angleA = Math.atan2(a.y - centroid!.y, a.x - centroid!.x);
    const angleB = Math.atan2(b.y - centroid!.y, b.x - centroid!.x);
    return angleA - angleB;
  });

  const segments: Segment[] = [];
  let currentPoints: Point[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (meetsThreshold(prev, curr, centroid, distThreshold, radialThreshold)) {
      // 满足条件，继续当前 segment
      currentPoints.push(curr);
    } else {
      // 不满足，结束当前 segment，开启新 segment
      segments.push({
        id: segments.length,
        points: currentPoints,
        start: currentPoints[0],
        end: currentPoints[currentPoints.length - 1],
        closed: false,
      });
      currentPoints = [curr];
    }
  }

  // 最后一个 segment
  if (currentPoints.length > 0) {
    segments.push({
      id: segments.length,
      points: currentPoints,
      start: currentPoints[0],
      end: currentPoints[currentPoints.length - 1],
      closed: false,
    });
  }

  // 检查首尾是否满足闭环条件
  if (segments.length > 0 && segments[0].points.length > 0 && segments[segments.length - 1].points.length > 0) {
    const firstStart = segments[0].start;
    const lastEnd = segments[segments.length - 1].end;
    if (meetsThreshold(lastEnd, firstStart, centroid, distThreshold, radialThreshold)) {
      // 合并首尾为一个闭环 segment
      const mergedPoints = [...segments[segments.length - 1].points, ...segments[0].points];
      segments[0].points = mergedPoints;
      segments[0].start = mergedPoints[0];
      segments[0].end = mergedPoints[mergedPoints.length - 1];
      segments[0].closed = true;
      segments.pop(); // 移除最后一个
    }
  }

  return segments;
}

// 新版边界点重聚类函数（使用双重阈值）
export function reclusterBoundaryPointsByPolarAngle(
  boundaryPoints: BoundaryPoint[],
  distThreshold: number,
  radialThreshold: number
): BoundaryPoint[] {
  if (boundaryPoints.length === 0) return [];

  // 计算全局重心（所有边界点的平均）
  let gcx = 0, gcy = 0;
  for (const bp of boundaryPoints) {
    gcx += bp.point.x;
    gcy += bp.point.y;
  }
  const globalCentroid = { x: gcx / boundaryPoints.length, y: gcy / boundaryPoints.length };

  const byOriginalId = new Map<number, { point: Point; insideId: number }[]>();
  for (const bp of boundaryPoints) {
    if (!byOriginalId.has(bp.outsideId)) {
      byOriginalId.set(bp.outsideId, []);
    }
    byOriginalId.get(bp.outsideId)!.push({ point: bp.point, insideId: bp.insideId });
  }

  const newBoundaryPoints: BoundaryPoint[] = [];
  let nextSegmentId = 1;

  for (const [, ptsWithInfo] of byOriginalId) {
    const points = ptsWithInfo.map(item => item.point);

    // 使用全局重心进行极角排序，保证不同原始组的点排序基准一致
    const segments = groupIntoSegments(points, globalCentroid, distThreshold, radialThreshold);
    for (const seg of segments) {
      const newId = nextSegmentId++;
      for (const pt of seg.points) {
        const original = ptsWithInfo.find(item => Math.hypot(item.point.x - pt.x, item.point.y - pt.y) < 1e-6);
        const insideId = original ? original.insideId : boundaryPoints[0].insideId;
        newBoundaryPoints.push({
          point: pt,
          insideId: insideId,
          outsideId: newId,
        });
      }
    }
  }

  // console.log(`[reclusterBoundaryPointsByPolarAngle] 生成片段数量: ${nextSegmentId - 1}`);
  return newBoundaryPoints;
}

// ========== 调试主函数 getDebugRegions（已集成新聚类）==========
export function getDebugRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 300,
  distanceThresholdFactor: number = 1.2,
  radialThresholdFactor: number = 2,
  downsampleDistanceFactor: number = 0.5,
  ringDistanceThreshold: number = 2,
  ringRadialThreshold: number = 2
): DebugRegionData[] {
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const debug: DebugRegionData[] = [];
  for (const region of gridData.regions) {
    if (region.touchesEdge) continue;
    const boundaryPoints = collectBoundaryPointsForMainRegion(region.id, gridData, shapes);
    
    const step = Math.min(gridData.stepX, gridData.stepY);
    
    // 降采样：先减少点密度，避免极角排序后出现微小抖动
    // 使用更大的基础倍数（10倍step），使得滑块调整更有效果
    const downsampleThres = step * 10 * downsampleDistanceFactor;
    // console.log(`[调试] 区域 ${region.id} 降采样阈值=${downsampleThres.toFixed(6)}`);
    const downsampledPoints = downsampleBoundaryPointsByOutsideId(boundaryPoints, downsampleThres);
    
    // 调整常数因子，确保阈值足够大以匹配实际点间距
    const distThreshold = step * 8 * (1 + distanceThresholdFactor);
    const radialThreshold = step * 4 * (1 + radialThresholdFactor);
    const reclusteredPoints = reclusterBoundaryPointsByPolarAngle(downsampledPoints, distThreshold, radialThreshold);
    
    // 如果重新聚类失败（返回空），使用原始点作为回退
    const finalPoints = reclusteredPoints.length > 0 ? reclusteredPoints : downsampledPoints.length > 0 ? downsampledPoints : boundaryPoints;

    const allBoundaryPoints = finalPoints.map(bp => bp.point);
    
    const uniqueBoundaryPoints: { point: Point; insideId: number; outsideId: number }[] = finalPoints.map(bp => ({
      point: bp.point,
      insideId: bp.insideId,
      outsideId: bp.outsideId
    }));
    
    const uniquePoints = uniqueBoundaryPoints.map(ub => ub.point);
    
    // console.log(`[调试] 区域 ${region.id} 重新聚类后点数: ${uniqueBoundaryPoints.length}`);
    
    // 构建 segments 列表（基于 finalPoints 的分组）
    const segmentsMap = new Map<number, { points: Point[]; start: Point; end: Point; closed: boolean }>();
    for (const bp of finalPoints) {
      if (!segmentsMap.has(bp.outsideId)) {
        segmentsMap.set(bp.outsideId, { points: [], start: bp.point, end: bp.point, closed: false });
      }
      const seg = segmentsMap.get(bp.outsideId)!;
      seg.points.push(bp.point);
      seg.end = bp.point;
    }
    
    // 计算全局重心用于判断闭合
    const globalCentroid = { x: 0, y: 0 };
    let totalPoints = 0;
    for (const seg of segmentsMap.values()) {
      for (const p of seg.points) {
        globalCentroid.x += p.x;
        globalCentroid.y += p.y;
        totalPoints++;
      }
    }
    if (totalPoints > 0) {
      globalCentroid.x /= totalPoints;
      globalCentroid.y /= totalPoints;
    }
    
    // 构建 SegmentForMatching 列表
    const segmentsList: SegmentForMatching[] = [];
    for (const seg of segmentsMap.values()) {
      const start = seg.points[0];
      const end = seg.points[seg.points.length - 1];
      const euclidean = Math.hypot(start.x - end.x, start.y - end.y);
      const radialStart = Math.hypot(start.x - globalCentroid.x, start.y - globalCentroid.y);
      const radialEnd = Math.hypot(end.x - globalCentroid.x, end.y - globalCentroid.y);
      const closed = (euclidean < distThreshold && Math.abs(radialStart - radialEnd) < radialThreshold);
      segmentsList.push({
        points: seg.points,
        start,
        end,
        closed
      });
    }
    
    // 使用新的组环算法
    console.log(`[调试] 区域 ${region.id} segmentsList数量: ${segmentsList.length}`);
    segmentsList.forEach((seg, idx) => {
      console.log(`  segment${idx}: ${seg.points.length}点, closed=${seg.closed}, start=(${seg.start.x.toFixed(3)},${seg.start.y.toFixed(3)}), end=(${seg.end.x.toFixed(3)},${seg.end.y.toFixed(3)})`);
    });
    // 使用简单的欧式距离成环算法
    const allBoundaryPointsForRings = uniqueBoundaryPoints.map(bp => bp.point);
    const maxEdgeLength = step * 6 * ringDistanceThreshold; // 使用环拼接阈值系数
    const ringsFromSegments = connectPointsToRingsByDistance(allBoundaryPointsForRings, maxEdgeLength);
    console.log(`[调试] 区域 ${region.id} 成环数量: ${ringsFromSegments.length}`);
    ringsFromSegments.forEach((ring, idx) => {
      console.log(`  环${idx}: ${ring.length} 个顶点`);
    });
    
    // 保持后续代码兼容，pointGroups 设为空数组
    const pointGroups: Point[][] = [];

    let boundaryPolygon: Point[] = [];
    if (boundaryPoints.length >= 3) {
      const groups = new Map<number, Point[]>();
      for (const bp of boundaryPoints) {
        if (!groups.has(bp.outsideId)) groups.set(bp.outsideId, []);
        groups.get(bp.outsideId)!.push(bp.point);
      }
      const outerPts = groups.get(-1);
      if (outerPts && outerPts.length >= 3) boundaryPolygon = buildClosedRing(outerPts);
    }

    const originalOutsideIdEndpoints: OutsideIdEndpoint[] = [];
    if (boundaryPoints.length > 0) {
      const origCentroid = { x: 0, y: 0 };
      for (const bp of boundaryPoints) { origCentroid.x += bp.point.x; origCentroid.y += bp.point.y; }
      origCentroid.x /= boundaryPoints.length;
      origCentroid.y /= boundaryPoints.length;
      
      const byOriginalOutside = new Map<number, { point: Point; insideId: number }[]>();
      for (const bp of boundaryPoints) {
        if (!byOriginalOutside.has(bp.outsideId)) {
          byOriginalOutside.set(bp.outsideId, []);
        }
        byOriginalOutside.get(bp.outsideId)!.push({ point: bp.point, insideId: bp.insideId });
      }
      
      for (const [outsideId, points] of byOriginalOutside) {
        if (points.length < 1) continue;
        
        points.sort((a, b) => {
          const angleA = Math.atan2(a.point.y - origCentroid.y, a.point.x - origCentroid.x);
          const angleB = Math.atan2(b.point.y - origCentroid.y, b.point.x - origCentroid.x);
          return angleA - angleB;
        });
        
        const p1 = points[0];
        const dist1 = Math.hypot(p1.point.x - origCentroid.x, p1.point.y - origCentroid.y);
        
        let p2Data: { x: number; y: number; distToCentroid: number } | null = null;
        if (points.length >= 2) {
          const p2 = points[points.length - 1];
          const dist2 = Math.hypot(p2.point.x - origCentroid.x, p2.point.y - origCentroid.y);
          p2Data = { x: p2.point.x, y: p2.point.y, distToCentroid: dist2 };
        }
        
        originalOutsideIdEndpoints.push({
          outsideId,
          insideId: p1.insideId,
          p1: { x: p1.point.x, y: p1.point.y, distToCentroid: dist1 },
          p2: p2Data,
        });
      }
    }

    let centroid: Point | null = null;
    if (allBoundaryPoints.length > 0) {
      let cx = 0, cy = 0;
      for (const p of allBoundaryPoints) { cx += p.x; cy += p.y; }
      centroid = { x: cx / allBoundaryPoints.length, y: cy / allBoundaryPoints.length };
    }
    
    const outsideIdEndpoints: OutsideIdEndpoint[] = [];
    if (centroid) {
      // 按新的 outsideId 分组（每个片段一个独立 id）
      const byOutsideId = new Map<number, BoundaryPoint[]>();
      for (const bp of reclusteredPoints) {
        if (!byOutsideId.has(bp.outsideId)) byOutsideId.set(bp.outsideId, []);
        byOutsideId.get(bp.outsideId)!.push(bp);
      }

      for (const [outsideId, points] of byOutsideId) {
        if (points.length === 0) continue;
        
        // 使用片段本身的起点和终点（即 points 数组的第一个和最后一个点）
        const start = points[0].point;
        const end = points[points.length - 1].point;
        const radialStart = Math.hypot(start.x - centroid.x, start.y - centroid.y);
        const radialEnd = Math.hypot(end.x - centroid.x, end.y - centroid.y);
        const startInsideId = points[0].insideId;
        
        // 判断该片段是否自身闭合（首尾距离 < 阈值）
        const isClosed = points.length >= 3 && Math.hypot(end.x - start.x, end.y - start.y) < distThreshold * 0.5;
        
        if (isClosed) {
          // 自身闭合的片段不显示端点
          continue;
        }
        
        outsideIdEndpoints.push({
          outsideId,
          insideId: startInsideId,
          p1: { x: start.x, y: start.y, distToCentroid: radialStart },
          p2: { x: end.x, y: end.y, distToCentroid: radialEnd },
        });
        
        // console.log(`[调试] 区域 ${region.id} o:${outsideId} 端点: p1(${start.x.toFixed(3)},${start.y.toFixed(3)}) d1=${radialStart.toFixed(3)}, p2(${end.x.toFixed(3)},${end.y.toFixed(3)}) d2=${radialEnd.toFixed(3)}`);
      }
    }

    // 按墙ID分组边界点（使用降采样后的点）
    const wallGroupedPoints = groupBoundaryPointsByWallId(downsampledPoints, gridData, 2);

    const rays: DebugRay[] = [];
    debug.push({
      id: region.id,
      cellCount: region.cells.length,
      bounds: region.bounds,
      seed: region.seed,
      boundaryPolygon,
      rays,
      boundaryPoints,
      clusteredBoundaryPoints: [],
      rings: ringsFromSegments,
      centroid,
      uniqueBoundaryPoints,
      pointGroups,
      outsideIdEndpoints,
      originalOutsideIdEndpoints,
      segments: segmentsList,  // 新增：保存片段数据用于调试绘制
      wallGroupedPoints,  // 按墙ID分组后的点集
    });
  }
  return debug;
}

// 保留旧函数兼容（避免外部调用报错）
export function sortAndClusterBoundaryPoints(boundaryPoints: BoundaryPoint[], _threshold: number): BoundaryPoint[] {
  console.warn("sortAndClusterBoundaryPoints is deprecated, use reclusterBoundaryPointsByPolarAngle");
  return boundaryPoints;
}
export interface ScanlineSpan { y: number; xMin: number; xMax: number; }
export type ScanlineCache = Record<number, ScanlineSpan[]>;
export function computeScanlineIntervals(_gridData: GridData): ScanlineCache { return {}; }

// ========== 新组环函数：基于端点匹配的双重阈值算法 ==========
export interface SegmentForMatching {
  points: Point[];
  start: Point;
  end: Point;
  closed: boolean;
}

interface OpenRing {
  points: Point[];
  first: Point;
  last: Point;
}

// ========== 改进版：基于极角排序的片段连接算法 ==========
export function buildClosedRingsFromSegments(
  segments: SegmentForMatching[],
  centroid: Point,
  distThreshold: number,
  radialThreshold: number
): Point[][] {
  if (segments.length === 0) return [];

  // 过滤掉只有1个点的segment，它们无法形成有效的环
  const validSegments = segments.filter(seg => seg.points.length >= 2);
  if (validSegments.length === 0) return [];

  // 辅助函数：判断两个端点是否满足连接条件
  const meetsThreshold = (a: Point, b: Point): boolean => {
    const euclidean = Math.hypot(a.x - b.x, a.y - b.y);
    const radialA = Math.hypot(a.x - centroid.x, a.y - centroid.y);
    const radialB = Math.hypot(b.x - centroid.x, b.y - centroid.y);
    const radialDiff = Math.abs(radialA - radialB);
    return euclidean < distThreshold && radialDiff < radialThreshold;
  };

  // 为每个片段分配唯一ID（基于原始顺序）
  const segWithId = validSegments.map((seg, idx) => ({ ...seg, id: idx }));
  
  // 按片段起点的极角排序（保证环绕顺序）
  const sortedSegments = [...segWithId].sort((a, b) => {
    const angleA = Math.atan2(a.start.y - centroid.y, a.start.x - centroid.x);
    const angleB = Math.atan2(b.start.y - centroid.y, b.start.x - centroid.x);
    return angleA - angleB;
  });

  const used = new Array(validSegments.length).fill(false);
  const closedRings: Point[][] = [];
  
  // 开放环结构
  interface OpenRing {
    points: Point[];
    first: Point;
    last: Point;
  }
  const openRings: OpenRing[] = [];

  // 尝试将片段连接到指定开放环的指定端点
  const tryConnect = (
    ring: OpenRing,
    seg: typeof sortedSegments[0],
    connectToFirst: boolean,   // true=连接环首，false=连接环尾
    connectWithStart: boolean  // true=使用片段的起点，false=使用片段的终点
  ): { success: boolean; newPoints: Point[]; newFirst: Point; newLast: Point } | null => {
    const ringPoint = connectToFirst ? ring.first : ring.last;
    const segPoint = connectWithStart ? seg.start : seg.end;
    if (!meetsThreshold(ringPoint, segPoint)) return null;
    
    let newPoints: Point[];
    let newFirst: Point, newLast: Point;
    
    // 如果segment只有一个点，特殊处理
    if (seg.points.length === 1) {
      if (connectToFirst) {
        newPoints = [seg.points[0], ...ring.points];
        newFirst = seg.points[0];
        newLast = ring.last;
      } else {
        newPoints = [...ring.points, seg.points[0]];
        newFirst = ring.first;
        newLast = seg.points[0];
      }
    } else if (connectToFirst) {
      // 连接在环首
      const segmentPoints = connectWithStart ? seg.points : [...seg.points].reverse();
      newPoints = [...segmentPoints, ...ring.points];
      newFirst = segmentPoints[0];
      newLast = ring.last;
    } else {
      // 连接在环尾
      const segmentPoints = connectWithStart ? seg.points.slice(1) : [...seg.points].reverse().slice(1);
      newPoints = [...ring.points, ...segmentPoints];
      newFirst = ring.first;
      newLast = segmentPoints.length > 0 ? segmentPoints[segmentPoints.length - 1] : ring.last;
    }
    return { success: true, newPoints, newFirst, newLast };
  };

  // 主循环：按极角顺序处理每个片段
  for (const seg of sortedSegments) {
    if (used[seg.id]) continue;
    
    let matched = false;
    for (let i = 0; i < openRings.length; i++) {
      const ring = openRings[i];
      const ways = [
        { toFirst: false, withStart: true },  // 尾 + seg起点
        { toFirst: false, withStart: false }, // 尾 + seg终点
        { toFirst: true, withStart: true },   // 首 + seg起点
        { toFirst: true, withStart: false }   // 首 + seg终点
      ];
      
      for (const way of ways) {
        const result = tryConnect(ring, seg, way.toFirst, way.withStart);
        if (result) {
          // 更新开放环
          ring.points = result.newPoints;
          ring.first = result.newFirst;
          ring.last = result.newLast;
          used[seg.id] = true;
          matched = true;
          
          // 检查环是否闭合
          if (meetsThreshold(ring.first, ring.last)) {
            // 闭合：首尾相接，若距离>1e-6则主动闭合
            let closedPoints = [...ring.points];
            const dist = Math.hypot(closedPoints[0].x - closedPoints[closedPoints.length-1].x, 
                                    closedPoints[0].y - closedPoints[closedPoints.length-1].y);
            if (dist > 1e-6) closedPoints.push(closedPoints[0]);
            closedRings.push(closedPoints);
            openRings.splice(i, 1); // 移除已闭合的环
          }
          break;
        }
      }
      if (matched) break;
    }
    
    if (!matched) {
      // 新建开放环
      openRings.push({
        points: [...seg.points],
        first: seg.start,
        last: seg.end
      });
      used[seg.id] = true;
    }
  }

  // 处理剩余未闭合的开放环
  for (const ring of openRings) {
    if (ring.points.length >= 3 && meetsThreshold(ring.first, ring.last)) {
      let closedPoints = [...ring.points];
      const dist = Math.hypot(closedPoints[0].x - closedPoints[closedPoints.length-1].x, 
                              closedPoints[0].y - closedPoints[closedPoints.length-1].y);
      if (dist > 1e-6) closedPoints.push(closedPoints[0]);
      closedRings.push(closedPoints);
    }
  }

  // 处理未使用但自身已闭合的片段
  for (const seg of sortedSegments) {
    if (!used[seg.id] && seg.closed && seg.points.length >= 3) {
      if (meetsThreshold(seg.start, seg.end)) {
        let closedPoints = [...seg.points];
        const dist = Math.hypot(closedPoints[0].x - closedPoints[closedPoints.length-1].x, 
                                closedPoints[0].y - closedPoints[closedPoints.length-1].y);
        if (dist > 1e-6) closedPoints.push(closedPoints[0]);
        closedRings.push(closedPoints);
      }
    }
  }

  // 兜底：若没有生成任何环且只有一个未使用的片段，强制将其作为环
  if (closedRings.length === 0 && validSegments.length === 1 && validSegments[0].points.length >= 3) {
    const seg = validSegments[0];
    let closedPoints = [...seg.points];
    const dist = Math.hypot(closedPoints[0].x - closedPoints[closedPoints.length-1].x, 
                            closedPoints[0].y - closedPoints[closedPoints.length-1].y);
    if (dist > 1e-6) closedPoints.push(closedPoints[0]);
    closedRings.push(closedPoints);
  }

  return closedRings;
}

// ========== 简单成环函数：基于欧式距离的最近邻贪心连接 ==========
/**
 * 将无序点集用最近邻贪心算法连接成闭合环
 * @param points 无序点集
 * @param maxEdgeLength 最大边长阈值，超过则断开
 * @returns 多个环的点序列
 */
export function connectPointsToRingsByDistance(
  points: Point[],
  maxEdgeLength: number
): Point[][] {
  if (points.length < 3) return [];

  const used = new Array(points.length).fill(false);
  const rings: Point[][] = [];

  // 获取未使用的点索引
  const getUnusedIndices = (): number[] => {
    const indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (!used[i]) indices.push(i);
    }
    return indices;
  };

  // 计算两点间欧式距离
  const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

  // 贪心构建一个环
  const buildOneRing = (startIdx: number): Point[] | null => {
    const ring: number[] = [startIdx];
    used[startIdx] = true;
    let currentIdx = startIdx;

    while (true) {
      const current = points[currentIdx];
      let bestIdx = -1;
      let bestDist = Infinity;

      // 找最近邻
      for (let i = 0; i < points.length; i++) {
        if (used[i] || i === currentIdx) continue;
        const d = dist(current, points[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      if (bestIdx === -1 || bestDist > maxEdgeLength) {
        // 无法继续，尝试闭合或放弃
        break;
      }

      // 检查是否回到起点（形成环）
      const distToStart = dist(points[bestIdx], points[startIdx]);
      if (ring.length >= 3 && distToStart < bestDist && distToStart <= maxEdgeLength) {
        // 闭合环
        ring.push(startIdx);
        used[bestIdx] = true;
        return ring.map(i => ({ ...points[i] }));
      }

      ring.push(bestIdx);
      used[bestIdx] = true;
      currentIdx = bestIdx;
    }

    // 无法形成有效环
    for (const idx of ring) {
      used[idx] = false; // 回滚
    }
    return null;
  };

  // 尝试从每个未使用点开始构建环
  while (true) {
    const unused = getUnusedIndices();
    if (unused.length < 3) break;

    let ring: Point[] | null = null;
    // 尝试从未使用点构建环
    for (const startIdx of unused) {
      ring = buildOneRing(startIdx);
      if (ring && ring.length >= 3) {
        rings.push(ring);
        break;
      }
    }

    if (!ring || ring.length < 3) break;
  }

  // 处理剩余孤立点：尝试连接成小环
  const remaining = getUnusedIndices();
  if (remaining.length >= 3) {
    // 简单方法：把剩余点按距离连接成一条链，然后尝试闭合
    const chain: number[] = [remaining[0]];
    used[remaining[0]] = true;
    let currentIdx = remaining[0];

    for (let i = 1; i < remaining.length; i++) {
      const idx = remaining[i];
      const d = dist(points[currentIdx], points[idx]);
      if (d <= maxEdgeLength) {
        chain.push(idx);
        used[idx] = true;
        currentIdx = idx;
      }
    }

    // 尝试闭合
    if (chain.length >= 3) {
      const d = dist(points[currentIdx], points[chain[0]]);
      if (d <= maxEdgeLength) {
        rings.push(chain.map(i => ({ ...points[i] })));
      }
    }
  }

  // 按面积排序
  const withArea = rings.map(ring => ({
    ring,
    area: polygonSignedArea(ring),
    absArea: Math.abs(polygonSignedArea(ring))
  }));
  withArea.sort((a, b) => b.absArea - a.absArea);

  return withArea.map(r => r.ring);
}

/**
 * 计算点集的凸包（Graham scan）
 */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  // 找最下最左的点
  const start = points.reduce((p, q) => p.y < q.y || (p.y === q.y && p.x < q.x) ? p : q);
  const sorted = points.slice();
  sorted.sort((a, b) => {
    const angleA = Math.atan2(a.y - start.y, a.x - start.x);
    const angleB = Math.atan2(b.y - start.y, b.x - start.x);
    if (angleA !== angleB) return angleA - angleB;
    return (Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
  });
  const stack: Point[] = [];
  for (const p of sorted) {
    while (stack.length >= 2 && cross(stack[stack.length-2], stack[stack.length-1], p) <= 0) {
      stack.pop();
    }
    stack.push(p);
  }
  return stack;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * 计算点集的凹包（通过凸包 + 边长阈值内插）
 */
function concaveHull(points: Point[], maxEdgeLength: number): Point[] {
  if (points.length < 3) return points.slice();
  let hull = convexHull(points);
  if (hull.length < 3) return hull;
  
  let changed = true;
  const maxIter = 10;
  let iter = 0;
  while (changed && iter < maxIter) {
    changed = false;
    const newHull: Point[] = [];
    for (let i = 0; i < hull.length - 1; i++) {
      const a = hull[i];
      const b = hull[i+1];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > maxEdgeLength) {
        let bestPoint: Point | null = null;
        let maxDist = 0;
        for (const p of points) {
          const t = ((p.x - a.x)*(b.x - a.x) + (p.y - a.y)*(b.y - a.y)) / (dist * dist);
          if (t < 0 || t > 1) continue;
          const projX = a.x + t * (b.x - a.x);
          const projY = a.y + t * (b.y - a.y);
          const d = Math.hypot(p.x - projX, p.y - projY);
          if (d > maxDist && d < dist * 0.8) {
            maxDist = d;
            bestPoint = p;
          }
        }
        if (bestPoint) {
          newHull.push(a, bestPoint);
          changed = true;
        } else {
          newHull.push(a);
        }
      } else {
        newHull.push(a);
      }
    }
    newHull.push(hull[hull.length-1]);
    if (changed) {
      hull = convexHull(newHull);
    }
    iter++;
  }
  if (hull.length >= 2 && (hull[0].x !== hull[hull.length-1].x || hull[0].y !== hull[hull.length-1].y)) {
    hull.push(hull[0]);
  }
  return hull;
}

/**
 * 判断点是否在多边形内部（包括边界）
 */
function isPointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n-1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  for (let i = 0; i < n-1; i++) {
    const a = polygon[i], b = polygon[i+1];
    const dist = Math.abs((b.y - a.y)*p.x - (b.x - a.x)*p.y + b.x*a.y - b.y*a.x) / Math.hypot(b.y - a.y, b.x - a.x);
    if (dist < 1e-6 && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
        Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)) {
      return true;
    }
  }
  return inside;
}

/**
 * 计算多边形的有向面积（正为逆时针，负为顺时针）
 */
function polygonSignedArea(polygon: Point[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0, j = n-1; i < n; j = i++) {
    area += (polygon[j].x * polygon[i].y - polygon[j].y * polygon[i].x);
  }
  return area / 2;
}

/**
 * 主函数：从无序边界点集中提取多个闭合环（外环+内环）
 */
export function extractClosedRingsFromPoints(
  allPoints: Point[],
  maxEdgeLength: number
): Point[][] {
  if (allPoints.length < 3) return [];
  
  const used = new Array(allPoints.length).fill(false);
  const rings: Point[][] = [];
  
  const getUnusedPointIndex = () => {
    for (let i = 0; i < allPoints.length; i++) {
      if (!used[i]) return i;
    }
    return -1;
  };
  
  let seedIdx = getUnusedPointIndex();
  while (seedIdx !== -1) {
    const remainingPoints = allPoints.filter((_, idx) => !used[idx]);
    if (remainingPoints.length < 3) break;
    
    let hull = concaveHull(remainingPoints, maxEdgeLength);
    if (hull.length < 3) {
      hull = convexHull(remainingPoints);
      if (hull.length < 3) break;
      if (hull[0] !== hull[hull.length-1]) hull.push(hull[0]);
    }
    
    for (let i = 0; i < allPoints.length; i++) {
      if (!used[i] && isPointInPolygon(allPoints[i], hull)) {
        used[i] = true;
      }
    }
    
    rings.push(hull);
    seedIdx = getUnusedPointIndex();
  }
  
  if (rings.length === 0) return [];
  
  const withArea = rings.map(ring => ({
    ring,
    area: polygonSignedArea(ring),
    absArea: Math.abs(polygonSignedArea(ring))
  }));
  withArea.sort((a, b) => b.absArea - a.absArea);
  
  const outer = withArea[0].ring;
  if (polygonSignedArea(outer) < 0) outer.reverse();
  const innerRings = withArea.slice(1).map(r => {
    if (polygonSignedArea(r.ring) > 0) r.ring.reverse();
    return r.ring;
  });
  
  return [outer, ...innerRings];
}
