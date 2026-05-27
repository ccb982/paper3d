import { Point, Shape } from '../types';

/**
 * 判断图形是否闭合（首尾点距离小于阈值）
 */
function isClosedShape(shape: Shape): boolean {
  if (shape.type === 'rectangle' || shape.type === 'circle' || shape.type === 'triangle') {
    return true;
  }
  if (shape.type === 'quadratic' || shape.type === 'brush') {
    if (shape.points.length < 3) return false;
    const first = shape.points[0];
    const last = shape.points[shape.points.length - 1];
    return Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
  }
  return false;
}

export function computeApproximatePolygon(shape: Shape): Point[] {
  if (!isClosedShape(shape)) return [];

  switch (shape.type) {
    case 'rectangle': {
      const [p1, p2] = shape.points;
      return [
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p1.y },
        { x: p2.x, y: p2.y },
        { x: p1.x, y: p2.y },
        { x: p1.x, y: p1.y },
      ];
    }
    case 'circle': {
      const center = shape.points[0];
      const radius = Math.hypot(shape.points[1].x - center.x, shape.points[1].y - center.y);
      const segments = 48;
      const points: Point[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        });
      }
      return points;
    }
    case 'triangle': {
      const [p1, p2, p3] = shape.points;
      return [p1, p2, p3, p1];
    }
    case 'quadratic': {
      const [p0, p1, ctrl] = shape.points;
      const segments = 40;
      const points: Point[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const mt = 1 - t;
        const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
        const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
        points.push({ x, y });
      }
      return points;
    }
    case 'brush': {
      const points = [...shape.points];
      if (points.length < 3) return [];
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) {
        points.push(first);
      }
      return points;
    }
    default:
      return [];
  }
}