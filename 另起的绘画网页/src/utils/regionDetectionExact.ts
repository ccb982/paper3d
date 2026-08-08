import type { Point, Shape } from '../types';

// ========== 新增：Douglas-Peucker 多边形简化 ==========
function perpendicularDistance(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
}

function simplifyPolygonDP(points: Point[], epsilon: number): Point[] {
    if (points.length <= 2) return points;
    const isClosed = Math.hypot(points[0].x - points[points.length - 1].x,
                               points[0].y - points[points.length - 1].y) < 1e-6;
    const pts = isClosed ? points.slice(0, -1) : points;
    if (pts.length <= 2) return points;

    let dmax = 0;
    let index = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(pts[i], pts[0], pts[end]);
        if (d > dmax) {
            dmax = d;
            index = i;
        }
    }

    let result: Point[];
    if (dmax > epsilon) {
        const left = simplifyPolygonDP(pts.slice(0, index + 1), epsilon);
        const right = simplifyPolygonDP(pts.slice(index), epsilon);
        result = left.slice(0, -1).concat(right);
    } else {
        result = [pts[0], pts[end]];
    }

    if (isClosed && result.length > 0) {
        result.push(result[0]);
    }
    return result;
}

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
        // 检测是否近似闭合（起点和终点距离小于最小步长的2倍）
        const start = pts[0], end = pts[pts.length - 1];
        const dist = Math.hypot(end.x - start.x, end.y - start.y);
        if (dist < maxSegLen * 2) {
          segments.push([end, start]); // 闭合路径
        }
      } break;
    case 'polygon': if (pts.length >= 3) {
        for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
        segments.push([pts[pts.length - 1], pts[0]]); // 闭合多边形
      } break;
    case 'polyline': if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
        // polyline 不闭合，只连接连续的点
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

/**
 * 从缓存的 GridData 中高效获取指定世界坐标的区域ID
 * @param worldX 世界坐标 X
 * @param worldY 世界坐标 Y
 * @param gridData 缓存的网格数据
 * @returns 区域ID，如果不在任何区域内则返回 null
 */
export function getRegionIdAtPoint(worldX: number, worldY: number, gridData: GridData): number | null {
  const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
  
  // 将世界坐标转换为网格坐标
  const j = Math.floor((worldX - xMin) / stepX);
  const i = Math.floor((worldY - yMin) / stepY);
  
  // 检查是否在网格范围内
  if (i < 0 || i >= resolution || j < 0 || j >= resolution) {
    return null;
  }
  
  // 获取区域ID
  const regionId = regionIdGrid[i][j];
  return regionId > 0 ? regionId : null;
}

/**
 * ★ BFS 光栅化 / 区域注释的世界坐标范围。
 * 比画布 [0,1] 向外扩 10% margin，避免贴近画布边缘的闭合环触碰网格边缘
 * 被 computeRegionsExact 的 touchesEdge 过滤丢弃（"贴近边缘的图形不能正常执行区域注释算法"）。
 * 所有 computeGridRegions / computeRegionsExact / getDebugRegions 调用应统一使用此常量，
 * 保证调试模式与区域注释算法范围一致。
 * 注意：坐标转换（worldToCanvas/canvasToWorld）仍用 [0,1]，此常量仅用于 BFS 网格边界。
 */
export const BFS_WORLD_BOUNDS = {
  xMin: -0.1,
  xMax: 1.1,
  yMin: -0.1,
  yMax: 1.1,
};

export function computeGridRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 500,
  excludeColor?: string  // 排除的颜色，传入 '#ffaa00' 则排除虚线
): GridData {
  const { xMin, xMax, yMin, yMax } = worldBounds;
  const stepX = (xMax - xMin) / resolution;
  const stepY = (yMax - yMin) / resolution;

  const wallGrid: boolean[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(false));
  
  // 根据 excludeColor 过滤要光栅化的形状
  for (const shape of shapes) {
    if (excludeColor && shape.color === excludeColor) {
      continue; // 跳过指定颜色的形状
    }
    rasterizeShape(shape, stepX, stepY, xMin, yMin, resolution, wallGrid);
  }

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
  let regions: GridRegion[] = [];
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

  // ========== 后处理：合并小区域（<=2格）到相邻大区域（8邻域） ==========
  // 1. 统计每个区域的格子数
  const regionCellCounts = new Map<number, number>();
  for (const region of regions) {
    regionCellCounts.set(region.id, region.cells.length);
  }

  // 2. 找出小区域（格子数 <= 2）
  const smallIds = new Set<number>();
  for (const [id, count] of regionCellCounts) {
    if (count <= 2) {
      smallIds.add(id);
    }
  }

  // 3. 如果有小区域，执行合并
  if (smallIds.size > 0) {
    const mergeMap = new Map<number, number>(); // smallId -> targetId

    for (const smallId of smallIds) {
      // 找到该小区域的所有格子
      const cells: [number, number][] = [];
      for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
          if (regionIdGrid[i][j] === smallId) {
            cells.push([i, j]);
          }
        }
      }

      // ★★★ 使用8邻域检测相邻区域 ★★★
      const neighborIds = new Set<number>();
      const dirs8 = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [ci, cj] of cells) {
        for (const [di, dj] of dirs8) {
          const ni = ci + di, nj = cj + dj;
          if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution) {
            const nid = regionIdGrid[ni][nj];
            // 只考虑正ID区域，排除自身和小区域
            if (nid >= 0 && nid !== smallId && !smallIds.has(nid)) {
              neighborIds.add(nid);
            }
          }
        }
      }

      // 找格子数最多的相邻区域作为目标（只找大区域，格子数 > 2）
      let targetId: number | null = null;
      let maxCount = 2;
      for (const nid of neighborIds) {
        const count = regionCellCounts.get(nid) || 0;
        if (count > maxCount) {
          maxCount = count;
          targetId = nid;
        }
      }

      if (targetId !== null) {
        mergeMap.set(smallId, targetId);
      }
    }

    // 4. 执行合并：更新 regionIdGrid
    for (const [smallId, targetId] of mergeMap) {
      for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
          if (regionIdGrid[i][j] === smallId) {
            regionIdGrid[i][j] = targetId;
          }
        }
      }
    }

    // 5. 重新构建 regions（基于更新后的 regionIdGrid）
    const newRegions: GridRegion[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const rid = regionIdGrid[i][j];
        if (rid >= 0 && !processed.has(rid)) {
          processed.add(rid);

          // BFS 收集该区域所有格子（使用4邻域，因为此时ID已正确连续）
          const cells: { i: number; j: number }[] = [];
          const queue: [number, number][] = [[i, j]];
          const visited = new Set<string>();
          visited.add(`${i},${j}`);
          let minI = i, maxI = i, minJ = j, maxJ = j;
          let touchesEdge = false;

          while (queue.length) {
            const [ci, cj] = queue.shift()!;
            cells.push({ i: ci, j: cj });
            if (ci === 0 || ci === resolution - 1 || cj === 0 || cj === resolution - 1) {
              touchesEdge = true;
            }
            minI = Math.min(minI, ci);
            maxI = Math.max(maxI, ci);
            minJ = Math.min(minJ, cj);
            maxJ = Math.max(maxJ, cj);

            for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              const ni = ci + di, nj = cj + dj;
              if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution) {
                if (regionIdGrid[ni][nj] === rid && !visited.has(`${ni},${nj}`)) {
                  visited.add(`${ni},${nj}`);
                  queue.push([ni, nj]);
                }
              }
            }
          }

          // 计算种子（重心）
          let sumX = 0, sumY = 0;
          for (const cell of cells) {
            sumX += xMin + (cell.j + 0.5) * stepX;
            sumY += yMin + (cell.i + 0.5) * stepY;
          }
          const seed = { x: sumX / cells.length, y: sumY / cells.length };

          newRegions.push({
            id: rid,
            cells,
            bounds: { minI, maxI, minJ, maxJ },
            seed,
            touchesEdge,
          });
        }
      }
    }

    regions = newRegions;
  }
  // ========== 后处理结束 ==========

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
      case 'polyline':
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

  for (const [, points] of groups) {
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

// ========== 5. 主函数：计算所有封闭区域 ==========
/**
 * ★ 合并函数：一次 BFS 同时产出 regions（多边形）+ gridData（网格数据）+ regionGridIds。
 * 避免 computeRegionsExact 内部调用 computeGridRegions 后，主线程又调一次 computeGridRegions 的重复计算。
 * Worker 迁移专用：Worker 内调此函数，一次 BFS 把 regions 和 gridData 都拿到。
 *
 * regionGridIds[i] = result[i] 对应的 BFS GridRegion.id（原始 gridId）。
 * 主线程据此把 flatRegionGrid 的原始 gridId 重映射为 i+1（与旧 generateRegionIdTexture 的 i+1 方案一致，
 * 保证 regionPixelsMap 键、colorExtractRegionId 比较不回归）。
 */
export function computeRegionsAndGrid(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 600,
  excludeColor?: string  // 排除的颜色，传入 '#ffaa00' 则排除虚线
): { regions: Point[][][]; gridData: GridData; regionGridIds: number[] } {
  const gridData = computeGridRegions(shapes, worldBounds, resolution, excludeColor);
  const mainRegions = gridData.regions.filter(r => !r.touchesEdge && r.cells.length >= 10);

  const result: Point[][][] = [];
  const regionGridIds: number[] = [];
  const { stepX, stepY } = gridData;
  const step = Math.min(stepX, stepY);

  for (const region of mainRegions) {
    // 1. 收集边界点
    const boundaryPoints = collectBoundaryPointsForMainRegion(region.id, gridData, shapes);
    if (boundaryPoints.length < 3) continue;

    // 2. 降采样（减少点密度）
    const downsampleThres = step * 10 * 0.5; // 增大降采样距离，减少点数
    const downsampledPoints = downsampleBoundaryPointsByOutsideId(boundaryPoints, downsampleThres);
    if (downsampledPoints.length < 3) continue;

    // 3. 提取所有边界点的坐标用于成环
    const allBoundaryPoints = downsampledPoints.map(bp => bp.point);

    // 4. 使用简单的欧式距离成环算法
    const maxEdgeLength = step * 6 * 3.5; // 使用固定环拼接阈值 3.5
    const rings = connectPointsToRingsByDistance(allBoundaryPoints, maxEdgeLength);

    if (rings.length === 0) continue;

    // 5. 确定外环和内环（按面积排序，最大的为外环）
    const withArea = rings.map(ring => ({
      ring,
      area: polygonSignedArea(ring),
      absArea: Math.abs(polygonSignedArea(ring))
    }));
    withArea.sort((a, b) => b.absArea - a.absArea);

    // 外环应为正面积（逆时针），如果不是则反转
    const outer = withArea[0].ring;
    if (polygonSignedArea(outer) < 0) outer.reverse();

    // 内环应为负面积（顺时针），如果不是则反转
    const innerRings = withArea.slice(1).map(r => {
      if (polygonSignedArea(r.ring) > 0) r.ring.reverse();
      return r.ring;
    });

    const regionPolygon: Point[][] = [outer, ...innerRings];

    // 对每个区域的所有环进行 Douglas-Peucker 简化
    const simplifyEpsilon = step * 1.0;
    for (let ri = 0; ri < regionPolygon.length; ri++) {
        regionPolygon[ri] = simplifyPolygonDP(regionPolygon[ri], simplifyEpsilon);
    }

    result.push(regionPolygon);
    regionGridIds.push(region.id); // 记录此 result 项对应的原始 BFS gridId
  }

  return { regions: result, gridData, regionGridIds };
}

export function computeRegionsExact(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 600,
  excludeColor?: string  // 排除的颜色，传入 '#ffaa00' 则排除虚线
): Point[][][] {
  // ★ 复用 computeRegionsAndGrid，避免重复 BFS（向后兼容旧调用方）
  return computeRegionsAndGrid(shapes, worldBounds, resolution, excludeColor).regions;
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

// ========== 调试主函数 getDebugRegions（与正式算法一致）==========
export function getDebugRegions(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 1000
): DebugRegionData[] {
  const regions = computeRegionsExact(shapes, worldBounds, resolution, '#ffaa00');

  const debugData: DebugRegionData[] = [];
  for (let idx = 0; idx < regions.length; idx++) {
    const region = regions[idx];
    const outerRing = region[0] || [];
    const boundaryPoints: BoundaryPoint[] = outerRing.map(p => ({
      point: p,
      insideId: idx,
      outsideId: -1,
    }));

    const rings = region;

    let cx = 0, cy = 0;
    for (const p of outerRing) {
      cx += p.x;
      cy += p.y;
    }
    cx /= outerRing.length || 1;
    cy /= outerRing.length || 1;

    debugData.push({
      id: idx,
      cellCount: 0,
      bounds: { minI: 0, maxI: 0, minJ: 0, maxJ: 0 },
      seed: { x: cx, y: cy },
      boundaryPolygon: outerRing,
      rays: [],
      boundaryPoints: boundaryPoints,
      clusteredBoundaryPoints: [],
      rings: rings,
      centroid: { x: cx, y: cy },
      uniqueBoundaryPoints: boundaryPoints.map(bp => ({ ...bp })),
      pointGroups: [],
      outsideIdEndpoints: [],
      originalOutsideIdEndpoints: [],
      segments: [],
      wallGroupedPoints: new Map(),
    });
  }

  return debugData;
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

/**
 * 获取世界坐标点所在的 BFS 区域 ID（正数）
 * 注意：此函数每次都会重新计算网格，性能较低。建议使用 getRegionIdAtPoint 从缓存的 GridData 中查询。
 * @returns 区域ID，如果点不在任何有效区域（墙区域或外部）则返回 null
 */
export function computeRegionIdAtPoint(
  point: Point,
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 200,
  excludeColor?: string  // 排除的颜色，传入 '#ffaa00' 则排除虚线
): number | null {
  const gridData = computeGridRegions(shapes, worldBounds, resolution, excludeColor);
  const { stepX, stepY, xMin, yMin, resolution: res, regionIdGrid } = gridData;
  const j = Math.floor((point.x - xMin) / stepX);
  const i = Math.floor((point.y - yMin) / stepY);
  if (i >= 0 && i < res && j >= 0 && j < res) {
    const rid = regionIdGrid[i][j];
    // 返回非负区域ID（墙区域为负数，外部未填充的为 -1，均忽略）
    if (rid >= 0) return rid;
  }
  return null;
}