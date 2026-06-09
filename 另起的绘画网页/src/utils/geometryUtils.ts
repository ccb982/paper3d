import type { Point } from '../types';

/**
 * 计算两点之间的垂直单位向量（左法线）
 */
function getLeftNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  // 垂直向量 ( -dy, dx ) 并归一化
  return { x: -dy / len, y: dx / len };
}

/**
 * 根据涂抹路径生成多边形（所有圆盘的并集近似）
 * @param points 涂抹路径点集
 * @param radius 圆盘半径（世界坐标单位）
 * @returns 多边形顶点
 */
export function generatePolygonFromPoints(points: Point[], radius: number): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    // 单个点：生成一个正多边形近似圆
    const center = points[0];
    const sides = 16;
    const hull: Point[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      hull.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }
    return hull;
  }

  // 对路径点进行平滑（可选：去除过近的点）
  const simplified: Point[] = [points[0]];
  const minDist = radius * 0.5;
  for (let i = 1; i < points.length; i++) {
    const last = simplified[simplified.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) > minDist) {
      simplified.push(points[i]);
    }
  }
  // 如果简化后只剩下一个点，转为圆形
  if (simplified.length === 1) {
    return generatePolygonFromPoints([simplified[0]], radius);
  }

  const path = simplified;
  const leftPoints: Point[] = [];
  const rightPoints: Point[] = [];

  // 对每个线段计算左右偏移点
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const normal = getLeftNormal(a, b);
    // 左侧偏移点（相对前进方向的左侧）
    const leftA = { x: a.x + normal.x * radius, y: a.y + normal.y * radius };
    const leftB = { x: b.x + normal.x * radius, y: b.y + normal.y * radius };
    // 右侧偏移点（反向法线）
    const rightA = { x: a.x - normal.x * radius, y: a.y - normal.y * radius };
    const rightB = { x: b.x - normal.x * radius, y: b.y - normal.y * radius };
    
    leftPoints.push(leftA, leftB);
    rightPoints.push(rightB, rightA); // 注意顺序（反向收集，便于后续连接）
  }

  // 处理首尾端点：添加半圆帽
  const first = path[0];
  const second = path[1];
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  
  const firstDir = getLeftNormal(first, second);
  const lastDir = getLeftNormal(secondLast, last);
  
  // 首端半圆（从右侧偏移点逆时针到左侧偏移点）
  const startCap: Point[] = [];
  const startRight = { x: first.x - firstDir.x * radius, y: first.y - firstDir.y * radius };
  const startLeft = { x: first.x + firstDir.x * radius, y: first.y + firstDir.y * radius };
  const angleStart = Math.atan2(startRight.y - first.y, startRight.x - first.x);
  const angleEnd = Math.atan2(startLeft.y - first.y, startLeft.x - first.x);
  const steps = 12;
  const delta = (angleEnd - angleStart + 2 * Math.PI) % (2 * Math.PI);
  for (let i = 0; i <= steps; i++) {
    const a = angleStart + delta * (i / steps);
    startCap.push({
      x: first.x + radius * Math.cos(a),
      y: first.y + radius * Math.sin(a),
    });
  }
  
  // 尾端半圆
  const endCap: Point[] = [];
  const endRight = { x: last.x - lastDir.x * radius, y: last.y - lastDir.y * radius };
  const endLeft = { x: last.x + lastDir.x * radius, y: last.y + lastDir.y * radius };
  const angleStartEnd = Math.atan2(endLeft.y - last.y, endLeft.x - last.x);
  const angleEndEnd = Math.atan2(endRight.y - last.y, endRight.x - last.x);
  let deltaEnd = (angleEndEnd - angleStartEnd + 2 * Math.PI) % (2 * Math.PI);
  if (deltaEnd < 0.01) deltaEnd = 2 * Math.PI; // 防止方向错误
  for (let i = 0; i <= steps; i++) {
    const a = angleStartEnd + deltaEnd * (i / steps);
    endCap.push({
      x: last.x + radius * Math.cos(a),
      y: last.y + radius * Math.sin(a),
    });
  }

  // 组装多边形：从右侧偏移点链 -> 首端半圆 -> 左侧偏移点链（反向） -> 尾端半圆
  const polygon: Point[] = [];
  // 右侧偏移点（按路径顺序）
  for (let i = 0; i < rightPoints.length; i++) {
    polygon.push(rightPoints[i]);
  }
  // 首端半圆（已经是从右到左的顺序）
  polygon.push(...startCap);
  // 左侧偏移点（反向，保持多边形顶点顺序一致）
  for (let i = leftPoints.length - 1; i >= 0; i--) {
    polygon.push(leftPoints[i]);
  }
  // 尾端半圆
  polygon.push(...endCap);
  
  // 可选：简化多边形（使用 Douglas-Peucker 或简单的移除共线点）
  return simplifyPolygon(polygon, radius * 0.1);
}

/**
 * 简化多边形，移除过于接近的点
 */
function simplifyPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > epsilon) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * 计算多边形有向面积（用于判断顶点顺序）
 * @param polygon 多边形顶点
 * @returns 有向面积（正值为逆时针，负值为顺时针）
 */
export function polygonSignedArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return area / 2;
}

/**
 * 计算多边形绝对面积
 * @param polygon 多边形顶点
 * @returns 绝对面积
 */
export function polygonArea(polygon: Point[]): number {
  return Math.abs(polygonSignedArea(polygon));
}