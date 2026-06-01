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

// ========== 2. 连通区域识别（BFS） ==========
export interface GridRegion {
  id: number;
  cells: { i: number; j: number }[];
  bounds: { minI: number; maxI: number; minJ: number; maxJ: number };
  seed: Point;
  touchesEdge: boolean;
}

export interface GridData {
  regionIdGrid: number[][];
  regions: GridRegion[];
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
  return { regionIdGrid, regions, stepX, stepY, xMin, yMin, resolution };
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
      if (nid === rid || nid === -1) continue;

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

// ========== 核心：收集边界点（8方向 + 多数投票） ==========
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
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;

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

// ========== 4. 多边形构建（极角排序） ==========
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

/**
 * 基于极角排序和距离突变的分组构建环（改进版）
 * @param points 无序点集
 * @param distanceThresholdFactor 距离突变阈值因子（相对于平均距离的比例，默认0.3）
 * @returns 闭合环数组
 */
function buildClosedRingsByDistanceGrouping(points: Point[], distanceThresholdFactor: number = 0.3): Point[][] {
  if (points.length < 3) return [];

  // 1. 去重（基于坐标精度）
  const uniqueMap = new Map<string, Point>();
  for (const p of points) {
    const key = `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }
  const unique = Array.from(uniqueMap.values());
  if (unique.length < 3) return [];

  // 2. 计算重心
  let cx = 0, cy = 0;
  for (const p of unique) { cx += p.x; cy += p.y; }
  cx /= unique.length; cy /= unique.length;

  // 3. 计算每个点的极角和距离
  const pointsWithInfo = unique.map(p => ({
    point: p,
    angle: Math.atan2(p.y - cy, p.x - cx),
    dist: Math.hypot(p.x - cx, p.y - cy)
  }));

  // 4. 按极角排序
  pointsWithInfo.sort((a, b) => a.angle - b.angle);

  // 5. 计算平均距离，设定突变阈值
  const avgDist = pointsWithInfo.reduce((sum, p) => sum + p.dist, 0) / pointsWithInfo.length;
  const distThreshold = avgDist * distanceThresholdFactor;

  // 6. 根据距离突变分组（注意环形首尾）
  const groups: Point[][] = [];
  let currentGroup: Point[] = [pointsWithInfo[0].point];
  const n = pointsWithInfo.length;

  for (let i = 1; i < n; i++) {
    const prevDist = pointsWithInfo[i - 1].dist;
    const currDist = pointsWithInfo[i].dist;
    const distDiff = Math.abs(currDist - prevDist);

    if (distDiff > distThreshold && currentGroup.length >= 3) {
      // 突变且当前组足够大，保存当前组并开始新组
      groups.push(currentGroup);
      currentGroup = [pointsWithInfo[i].point];
    } else {
      currentGroup.push(pointsWithInfo[i].point);
    }
  }
  // 添加最后一组
  if (currentGroup.length >= 3) groups.push(currentGroup);
  else if (currentGroup.length > 0 && groups.length > 0) {
    // 若最后一组太小，合并到前一组
    groups[groups.length - 1].push(...currentGroup);
  }

  // 7. 对每个组调用 buildClosedRing 生成闭合环
  const rings: Point[][] = [];
  for (const group of groups) {
    const ring = buildClosedRing(group);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += points[j].x * points[i].y - points[j].y * points[i].x;
  }
  return area / 2;
}

// ========== 5. 主函数：计算所有封闭区域（每个区域一个外环 + 多个内环） ==========
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
export interface DebugRegionData {
  id: number; cellCount: number; bounds: any; seed: Point;
  boundaryPolygon: Point[]; rays: DebugRay[];
  boundaryPoints: BoundaryPoint[];
  clusteredBoundaryPoints?: BoundaryPoint[];
  rings?: Point[][];
}

export function getDebugRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 300
): DebugRegionData[] {
  const gridData = computeGridRegions(shapes, worldBounds, resolution);
  const debug: DebugRegionData[] = [];
  for (const region of gridData.regions) {
    if (region.touchesEdge) continue;
    const boundaryPoints = collectBoundaryPointsForMainRegion(region.id, gridData, shapes);

    const step = Math.min(gridData.stepX, gridData.stepY);
    const threshold = step * 1.5;

    // 使用距离分组算法直接从所有边界点识别多个环（外框和孔洞）
    const allBoundaryPoints = boundaryPoints.map(bp => bp.point);
    
    // 全局去重
    const uniqueMap = new Map<string, Point>();
    for (const p of allBoundaryPoints) {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, p);
    }
    const uniquePoints: Point[] = Array.from(uniqueMap.values());
    
    // 使用距离分组算法构建环（可识别孔洞）
    const ringsFromSegments = buildClosedRingsByDistanceGrouping(uniquePoints, 0.5);
    console.log(`[调试] 区域 ${region.id} 距离分组成环数量: ${ringsFromSegments.length}`);
    ringsFromSegments.forEach((ring, idx) => {
      console.log(`  环${idx}: ${ring.length} 个顶点`);
    });

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
    });
  }
  return debug;
}

// 保留兼容旧代码的空函数
// ========== 新增：点集排序与聚类（仅用于调试验证） ==========

function orderPointsByAdjacency(points: Point[], threshold: number): Point[] {
  if (points.length <= 1) return points;
  const n = points.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const threshSq = threshold * threshold;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (dx * dx + dy * dy <= threshSq) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  let start = 0;
  let foundEndpoint = false;
  for (let i = 0; i < n; i++) {
    if (adj[i].length === 1) { start = i; foundEndpoint = true; break; }
  }
  if (!foundEndpoint) {
    for (let i = 0; i < n; i++) {
      if (adj[i].length === 0) return [points[i]];
    }
    if (n > 0 && adj[0].length > 1) start = 0;
    else return points;
  }

  const path: number[] = [start];
  let prev = -1;
  let cur = start;
  for (let iter = 0; iter < n * 2; iter++) {
    const nexts = adj[cur].filter(nb => nb !== prev);
    if (nexts.length === 0) break;
    const next = nexts[0];
    if (next === start && path.length > 1) break;
    path.push(next);
    prev = cur;
    cur = next;
  }
  if (path.length > 2 && points[path[0]] === points[path[path.length-1]]) path.pop();
  return path.map(idx => points[idx]);
}

export function sortAndClusterBoundaryPoints(
  boundaryPoints: BoundaryPoint[],
  threshold: number
): BoundaryPoint[] {
  if (boundaryPoints.length === 0) return [];

  const groupsByOriginalId = new Map<number, BoundaryPoint[]>();
  for (const bp of boundaryPoints) {
    if (!groupsByOriginalId.has(bp.outsideId)) {
      groupsByOriginalId.set(bp.outsideId, []);
    }
    groupsByOriginalId.get(bp.outsideId)!.push(bp);
  }

  const newBoundaryPoints: BoundaryPoint[] = [];
  let nextNewId = 1;

  for (const [, pointsInGroup] of groupsByOriginalId) {
    const rawPoints = pointsInGroup.map(bp => bp.point);
    const n = rawPoints.length;
    if (n < 3) continue;

    const adjLocal: number[][] = Array.from({ length: n }, () => []);
    const threshSq = threshold * threshold;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = rawPoints[i].x - rawPoints[j].x;
        const dy = rawPoints[i].y - rawPoints[j].y;
        if (dx * dx + dy * dy <= threshSq) {
          adjLocal[i].push(j);
          adjLocal[j].push(i);
        }
      }
    }

    const visited = new Array(n).fill(false);
    const components: number[][] = [];

    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        const queue: number[] = [i];
        visited[i] = true;
        const comp: number[] = [i];
        while (queue.length) {
          const cur = queue.shift()!;
          for (const nb of adjLocal[cur]) {
            if (!visited[nb]) {
              visited[nb] = true;
              queue.push(nb);
              comp.push(nb);
            }
          }
        }
        components.push(comp);
      }
    }

    for (const comp of components) {
      if (comp.length < 3) continue;
      const compPoints = comp.map(idx => rawPoints[idx]);
      const orderedPoints = orderPointsByAdjacency(compPoints, threshold);
      if (orderedPoints.length < 3) continue;

      const newId = nextNewId++;
      for (let idx = 0; idx < orderedPoints.length; idx++) {
        const pt = orderedPoints[idx];
        const origBp = pointsInGroup.find(bp => Math.hypot(bp.point.x - pt.x, bp.point.y - pt.y) < 1e-6);
        if (origBp) {
          newBoundaryPoints.push({
            point: pt,
            insideId: origBp.insideId,
            outsideId: newId,
          });
        }
      }
    }
  }

  console.log(`[sortAndClusterBoundaryPoints] 生成了 ${nextNewId - 1} 个有序片段`);
  return newBoundaryPoints;
}

export interface ScanlineSpan { y: number; xMin: number; xMax: number; }
export type ScanlineCache = Record<number, ScanlineSpan[]>;
export function computeScanlineIntervals(gridData: GridData): ScanlineCache { return {}; }

// ============================================================================
// 新增：基于 insideId 的边界点聚类与排序（用于调试验证，不影响原有区域构建）
// ============================================================================

function splitAndSortPointsInGroup(pointsInGroup: BoundaryPoint[], threshold: number): Point[][] {
  if (pointsInGroup.length < 3) return [];

  const rawPoints = pointsInGroup.map(bp => bp.point);
  const n = rawPoints.length;

  const adj: number[][] = Array.from({ length: n }, () => []);
  const threshSq = threshold * threshold;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = rawPoints[i].x - rawPoints[j].x;
      const dy = rawPoints[i].y - rawPoints[j].y;
      if (dx * dx + dy * dy <= threshSq) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Array(n).fill(false);
  const components: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!visited[i]) {
      const queue: number[] = [i];
      visited[i] = true;
      const comp: number[] = [i];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const nb of adj[cur]) {
          if (!visited[nb]) {
            visited[nb] = true;
            queue.push(nb);
            comp.push(nb);
          }
        }
      }
      components.push(comp);
    }
  }

  const result: Point[][] = [];
  for (const comp of components) {
    if (comp.length < 3) continue;
    const compPoints = comp.map(idx => rawPoints[idx]);
    const ordered = orderPointsByAdjacency(compPoints, threshold);
    if (ordered.length >= 3) {
      result.push(ordered);
    }
  }
  return result;
}

function getNextAvailableId(usedIds: Set<number>, start: number): number {
  let id = start;
  while (usedIds.has(id)) {
    id++;
  }
  return id;
}

function splitByPolarAngleAndDistance(points: Point[], gapFactor: number): Point[][] {
  if (points.length <= 2) return [points];

  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  const sorted = [...points];
  sorted.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  const n = sorted.length;
  const dists: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dists.push(Math.hypot(sorted[i+1].x - sorted[i].x, sorted[i+1].y - sorted[i].y));
  }
  const lastDist = Math.hypot(sorted[n-1].x - sorted[0].x, sorted[n-1].y - sorted[0].y);

  const allDists = [...dists, lastDist];
  allDists.sort((a,b) => a-b);
  const median = allDists[Math.floor(allDists.length / 2)];
  const threshold = Math.max(median * gapFactor, 1e-6);

  const cuts: number[] = [];
  for (let i = 0; i < dists.length; i++) {
    if (dists[i] > threshold) cuts.push(i + 1);
  }

  const segments: Point[][] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut > start) {
      segments.push(sorted.slice(start, cut));
      start = cut;
    }
  }
  if (start < n) {
    segments.push(sorted.slice(start, n));
  }

  return segments;
}

/**
 * 对点集进行距离去重
 * @param points 原始点数组
 * @param threshold 距离阈值，小于此值的点被视为重复
 * @returns 去重后的点数组（保持原顺序，保留第一个遇到的点）
 */
function deduplicatePointsByDistance(points: Point[], threshold: number): Point[] {
  if (points.length <= 1) return points.slice();

  const result: Point[] = [];
  const threshSq = threshold * threshold;

  for (const p of points) {
    let isDuplicate = false;
    for (const kept of result) {
      const dx = p.x - kept.x;
      const dy = p.y - kept.y;
      if (dx * dx + dy * dy < threshSq) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      result.push(p);
    }
  }
  return result;
}

export function reclusterBoundaryPointsByPolarAngle(
  boundaryPoints: BoundaryPoint[],
  gapFactor: number = 2.5,
  dedupThreshold: number = 5.0
): BoundaryPoint[] {
  if (boundaryPoints.length === 0) return [];

  const byInside = new Map<number, BoundaryPoint[]>();
  for (const bp of boundaryPoints) {
    if (!byInside.has(bp.insideId)) byInside.set(bp.insideId, []);
    byInside.get(bp.insideId)!.push(bp);
  }

  const newBoundaryPoints: BoundaryPoint[] = [];
  let nextId = 1;

  for (const [insideId, insidePoints] of byInside) {
    const byOriginalOutside = new Map<number, BoundaryPoint[]>();
    for (const bp of insidePoints) {
      const oid = bp.outsideId;
      if (!byOriginalOutside.has(oid)) byOriginalOutside.set(oid, []);
      byOriginalOutside.get(oid)!.push(bp);
    }

    for (const [origOutsideId, group] of byOriginalOutside) {
      const points = group.map(bp => bp.point);
      const segments = splitByPolarAngleAndDistance(points, gapFactor);

      for (const seg of segments) {
        if (seg.length === 0) continue;
        // 对每个片段内的点去重
        const dedupedSeg = deduplicatePointsByDistance(seg, dedupThreshold);
        if (dedupedSeg.length === 0) continue;
        
        const newOutsideId = nextId++;
        for (const pt of dedupedSeg) {
          const orig = group.find(bp => Math.hypot(bp.point.x - pt.x, bp.point.y - pt.y) < 1e-6);
          if (orig) {
            newBoundaryPoints.push({
              point: pt,
              insideId: insideId,
              outsideId: newOutsideId,
            });
          } else {
            newBoundaryPoints.push({ point: pt, insideId: insideId, outsideId: newOutsideId });
          }
        }
      }
    }
  }

  console.log(`[reclusterBoundaryPointsByPolarAngle] 新生成片段数量: ${nextId - 1}`);
  return newBoundaryPoints;
}

interface RingSegment {
  id: number;
  points: Point[];
  start: Point;
  end: Point;
}

interface RingEndpoint {
  segId: number;
  isStart: boolean;
  point: Point;
}

/**
 * 从新的分组（每个 outsideId 对应一个有序片段）构建完整的闭合环
 * @param groupedPoints Map<outsideId, Point[]> 每个 outsideId 内的点已经按顺序排列
 * @param distanceThreshold 端点匹配的距离阈值（世界单位）
 * @returns 闭合环列表，每个环是 Point[]（首尾闭合）
 */
export function buildRingsFromSegments(
  groupedPoints: Map<number, Point[]>,
  distanceThreshold: number = 0.1
): Point[][] {
  const segments: RingSegment[] = [];
  for (const [id, points] of groupedPoints) {
    if (points.length < 2) continue;
    segments.push({
      id,
      points: points,
      start: points[0],
      end: points[points.length - 1],
    });
  }

  if (segments.length === 0) return [];

  const endpoints: RingEndpoint[] = [];
  for (const seg of segments) {
    endpoints.push({ segId: seg.id, isStart: true, point: seg.start });
    endpoints.push({ segId: seg.id, isStart: false, point: seg.end });
  }

  const usedEndpoint = new Set<number>();
  const matchMap = new Map<number, number>();
  const threshSq = distanceThreshold * distanceThreshold;

  for (let i = 0; i < endpoints.length; i++) {
    if (usedEndpoint.has(i)) continue;
    let bestIdx = -1;
    let bestDistSq = Infinity;
    for (let j = 0; j < endpoints.length; j++) {
      if (i === j || usedEndpoint.has(j)) continue;
      if (endpoints[i].segId === endpoints[j].segId) continue;
      const dx = endpoints[i].point.x - endpoints[j].point.x;
      const dy = endpoints[i].point.y - endpoints[j].point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq && distSq <= threshSq) {
        bestDistSq = distSq;
        bestIdx = j;
      }
    }
    if (bestIdx !== -1) {
      matchMap.set(i, bestIdx);
      matchMap.set(bestIdx, i);
      usedEndpoint.add(i);
      usedEndpoint.add(bestIdx);
    }
  }

  const usedSegment = new Set<number>();
  const rings: Point[][] = [];

  for (const seg of segments) {
    if (usedSegment.has(seg.id)) continue;

    let startEndpointIdx = endpoints.findIndex(
      ep => ep.segId === seg.id && ep.isStart === true
    );
    if (startEndpointIdx === -1) continue;

    const ringPoints: Point[] = [];
    let currentIdx = startEndpointIdx;

    while (!usedSegment.has(endpoints[currentIdx].segId)) {
      const ep = endpoints[currentIdx];
      const currentSeg = segments.find(s => s.id === ep.segId)!;
      usedSegment.add(currentSeg.id);

      if (ep.isStart) {
        for (let i = 0; i < currentSeg.points.length; i++) {
          ringPoints.push(currentSeg.points[i]);
        }
      } else {
        for (let i = currentSeg.points.length - 1; i >= 0; i--) {
          ringPoints.push(currentSeg.points[i]);
        }
      }

      const matchedIdx = matchMap.get(currentIdx);
      if (matchedIdx === undefined) break;
      currentIdx = matchedIdx;
      if (currentIdx === startEndpointIdx) break;
    }

    if (ringPoints.length >= 3) {
      const firstPt = ringPoints[0];
      const lastPt = ringPoints[ringPoints.length - 1];
      if (Math.hypot(firstPt.x - lastPt.x, firstPt.y - lastPt.y) > distanceThreshold) {
        ringPoints.push(firstPt);
      }
      rings.push(ringPoints);
    }
  }

  return rings;
}

/**
 * 鲁棒的最近邻生长环构建算法
 * @param allPoints 所有点（已去重）
 * @param distanceThreshold 最近邻距离阈值（世界单位）
 * @returns 闭合环数组
 */
export function buildRingsByPointWalking(
  allPoints: Point[],
  distanceThreshold: number = 0.1
): Point[][] {
  if (allPoints.length < 3) return [];

  let remainingIndices = new Set<number>(allPoints.map((_, idx) => idx));
  const rings: Point[][] = [];

  const distSq = (a: Point, b: Point) => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  while (remainingIndices.size >= 3) {
    let startIdx: number | null = null;
    for (const idx of remainingIndices) {
      startIdx = idx;
      break;
    }
    if (startIdx === null) break;

    const pathIndices: number[] = [startIdx];
    remainingIndices.delete(startIdx);

    let currentIdx = startIdx;
    let closed = false;
    let maxAttempts = remainingIndices.size + 10;
    let attempts = 0;

    while (!closed && attempts < maxAttempts && remainingIndices.size > 0) {
      let bestIdx: number | null = null;
      let bestDistSq = Infinity;
      const currentPoint = allPoints[currentIdx];
      for (const idx of remainingIndices) {
        const d2 = distSq(currentPoint, allPoints[idx]);
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }

      if (bestIdx === null) break;
      const nearestDist = Math.sqrt(bestDistSq);
      const startPoint = allPoints[startIdx];
      const toStart = Math.hypot(allPoints[bestIdx].x - startPoint.x, allPoints[bestIdx].y - startPoint.y);

      if (toStart <= distanceThreshold && pathIndices.length >= 2) {
        closed = true;
        break;
      } else if (nearestDist <= distanceThreshold) {
        pathIndices.push(bestIdx);
        remainingIndices.delete(bestIdx);
        currentIdx = bestIdx;
      } else {
        break;
      }
      attempts++;
    }

    if (!closed && pathIndices.length >= 3) {
      const lastPoint = allPoints[pathIndices[pathIndices.length - 1]];
      const startPoint = allPoints[startIdx];
      if (Math.hypot(lastPoint.x - startPoint.x, lastPoint.y - startPoint.y) <= distanceThreshold) {
        closed = true;
      }
    }

    if (closed && pathIndices.length >= 3) {
      const ringPoints = pathIndices.map(idx => allPoints[idx]);
      const last = ringPoints[ringPoints.length - 1];
      const first = ringPoints[0];
      if (Math.hypot(last.x - first.x, last.y - first.y) > distanceThreshold) {
        ringPoints.push(first);
      }
      rings.push(ringPoints);
    } else {
      for (let i = 1; i < pathIndices.length; i++) {
        remainingIndices.add(pathIndices[i]);
      }
    }
  }

  return rings;
}