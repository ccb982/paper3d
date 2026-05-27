import type { Point, Shape } from '../types';
import { pointToShapeDistance } from './shapeDistance';

interface GridPoint {
  i: number;
  j: number;
}

function extractRawBoundary(
  points: Point[],
  stepX: number,
  stepY: number,
  xMin: number,
  yMin: number
): Point[] {
  if (points.length < 3) return [];

  const foregroundSet = new Set<string>();
  const gridPoints: GridPoint[] = [];

  for (const p of points) {
    let i = Math.round((p.y - yMin) / stepY);
    let j = Math.round((p.x - xMin) / stepX);
    const key = `${i},${j}`;
    if (!foregroundSet.has(key)) {
      foregroundSet.add(key);
      gridPoints.push({ i, j });
    }
  }

  if (gridPoints.length < 3) return [];

  let start: GridPoint | null = null;
  for (const gp of gridPoints) {
    const isBoundary =
      !foregroundSet.has(`${gp.i - 1},${gp.j}`) ||
      !foregroundSet.has(`${gp.i + 1},${gp.j}`) ||
      !foregroundSet.has(`${gp.i},${gp.j - 1}`) ||
      !foregroundSet.has(`${gp.i},${gp.j + 1}`);
    if (!isBoundary) continue;
    if (start === null || gp.i > start.i || (gp.i === start.i && gp.j < start.j)) {
      start = gp;
    }
  }
  if (!start) return [];

  const dirs = [
    { di: -1, dj: 0 },
    { di: -1, dj: 1 },
    { di: 0, dj: 1 },
    { di: 1, dj: 1 },
    { di: 1, dj: 0 },
    { di: 1, dj: -1 },
    { di: 0, dj: -1 },
    { di: -1, dj: -1 },
  ];

  const boundary: GridPoint[] = [];
  let current = start;
  let prevDir = 6;
  do {
    boundary.push(current);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dirIdx = (prevDir + 7 + k) % 8;
      const nb = { i: current.i + dirs[dirIdx].di, j: current.j + dirs[dirIdx].dj };
      if (foregroundSet.has(`${nb.i},${nb.j}`)) {
        const isNbBoundary =
          !foregroundSet.has(`${nb.i - 1},${nb.j}`) ||
          !foregroundSet.has(`${nb.i + 1},${nb.j}`) ||
          !foregroundSet.has(`${nb.i},${nb.j - 1}`) ||
          !foregroundSet.has(`${nb.i},${nb.j + 1}`);
        if (isNbBoundary) {
          current = nb;
          prevDir = dirIdx;
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  } while (!(current.i === start.i && current.j === start.j) && boundary.length < 10000);

  if (boundary.length < 3) return [];

  const worldBoundary = boundary.map(gp => ({
    x: xMin + gp.j * stepX,
    y: yMin + gp.i * stepY,
  }));

  return worldBoundary;
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();

  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const area = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : area / len;
}

export function detectClosedRegionsBySampling(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 150,
  wallDistanceThreshold?: number
): Point[][] {
  console.log('[detectClosedRegionsBySampling] 开始检测封闭区域...');
  console.log('[detectClosedRegionsBySampling] 图形数量:', shapes.length);
  console.log('[detectClosedRegionsBySampling] 采样分辨率:', resolution);

  const { xMin, xMax, yMin, yMax } = worldBounds;
  const width = xMax - xMin;
  const height = yMax - yMin;
  const diag = Math.hypot(width, height);
  const threshold = wallDistanceThreshold ?? diag * 0.005;

  const stepX = width / (resolution - 1);
  const stepY = height / (resolution - 1);

  const gridToWorld = (i: number, j: number): Point => ({
    x: xMin + j * stepX,
    y: yMin + i * stepY,
  });

  const wallGrid: boolean[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(false));
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const worldPoint = gridToWorld(i, j);
      let minDist = Infinity;
      for (const shape of shapes) {
        const dist = pointToShapeDistance(worldPoint, shape);
        if (dist < minDist) minDist = dist;
        if (minDist < threshold) break;
      }
      if (minDist < threshold) wallGrid[i][j] = true;
    }
  }

  const visited: boolean[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(false));
  const regionsPoints: Point[][] = [];

  const bfs = (startI: number, startJ: number): Point[] => {
    const queue: [number, number][] = [[startI, startJ]];
    visited[startI][startJ] = true;
    const points: Point[] = [];

    while (queue.length) {
      const [i, j] = queue.shift()!;
      points.push(gridToWorld(i, j));

      const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [di, dj] of neighbors) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution && !visited[ni][nj] && !wallGrid[ni][nj]) {
          visited[ni][nj] = true;
          queue.push([ni, nj]);
        }
      }
    }
    return points;
  };

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      if (!wallGrid[i][j] && !visited[i][j]) {
        const regionPoints = bfs(i, j);

        let touchesBoundary = false;
        for (const p of regionPoints) {
          if (Math.abs(p.x - xMin) < stepX * 0.5 ||
              Math.abs(p.x - xMax) < stepX * 0.5 ||
              Math.abs(p.y - yMin) < stepY * 0.5 ||
              Math.abs(p.y - yMax) < stepY * 0.5) {
            touchesBoundary = true;
            break;
          }
        }
        if (!touchesBoundary && regionPoints.length >= 10) {
          regionsPoints.push(regionPoints);
        }
      }
    }
  }

  console.log('[detectClosedRegionsBySampling] 发现连通区域数量:', regionsPoints.length);

  const polygons: Point[][] = [];
  const simplifyEpsilon = Math.min(stepX, stepY) * 1.5;

  for (let idx = 0; idx < regionsPoints.length; idx++) {
    const regionPoints = regionsPoints[idx];
    let boundary = extractRawBoundary(regionPoints, stepX, stepY, xMin, yMin);
    if (boundary.length < 3) continue;

    if (Math.hypot(boundary[0].x - boundary[boundary.length - 1].x, boundary[0].y - boundary[boundary.length - 1].y) > stepX * 0.5) {
      boundary.push(boundary[0]);
    }

    const simplified = douglasPeucker(boundary, simplifyEpsilon);
    if (simplified.length >= 3) {
      console.log(`[detectClosedRegionsBySampling] 区域${idx}: 简化前${boundary.length}点, 简化后${simplified.length}点`);
      polygons.push(simplified);
    }
  }

  console.log('[detectClosedRegionsBySampling] 最终封闭区域数量:', polygons.length);
  return polygons;
}

export function computeRegionsWithHoles(
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  resolution: number = 150
): Point[][][] {
  console.log('[computeRegionsWithHoles] 开始计算带孔区域...');

  const closedRegions = detectClosedRegionsBySampling(shapes, worldBounds, resolution);
  if (closedRegions.length === 0) {
    console.log('[computeRegionsWithHoles] 未发现封闭区域');
    return [];
  }

  const regions: Point[][][] = closedRegions.map(poly => [poly]);
  console.log('[computeRegionsWithHoles] 生成区域数量:', regions.length);
  return regions;
}