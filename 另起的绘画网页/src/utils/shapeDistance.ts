import type { Point, Shape } from '../types';

function distanceToLineSegment(p: Point, a: Point, b: Point): number {
  const ax = p.x - a.x, ay = p.y - a.y;
  const bx = b.x - a.x, by = b.y - a.y;
  const dot = ax * bx + ay * by;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(ax, ay);
  let t = dot / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * bx;
  const projY = a.y + t * by;
  return Math.hypot(p.x - projX, p.y - projY);
}

function pointToQuadraticDistance(p: Point, p0: Point, p1: Point, ctrl: Point, segments = 30): number {
  let minDist = Infinity;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export function pointToShapeDistance(point: Point, shape: Shape): number {
  const pts = shape.points;
  switch (shape.type) {
    case 'point':
      return pts.length > 0 ? Math.hypot(point.x - pts[0].x, point.y - pts[0].y) : Infinity;
    case 'line':
      if (pts.length >= 2) return distanceToLineSegment(point, pts[0], pts[1]);
      return Infinity;
    case 'rectangle':
      if (pts.length >= 2) {
        const p1 = pts[0], p2 = pts[1];
        const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
        const bottom = Math.min(p1.y, p2.y), top = Math.max(p1.y, p2.y);
        const dx = Math.max(left - point.x, 0, point.x - right);
        const dy = Math.max(bottom - point.y, 0, point.y - top);
        return Math.hypot(dx, dy);
      }
      return Infinity;
    case 'circle':
      if (pts.length >= 2) {
        const center = pts[0];
        const radius = Math.hypot(pts[1].x - center.x, pts[1].y - center.y);
        return Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius);
      }
      return Infinity;
    case 'triangle':
      if (pts.length >= 3) {
        const [a, b, c] = pts;
        const d1 = distanceToLineSegment(point, a, b);
        const d2 = distanceToLineSegment(point, b, c);
        const d3 = distanceToLineSegment(point, c, a);
        return Math.min(d1, d2, d3);
      }
      return Infinity;
    case 'quadratic':
      if (pts.length >= 3) {
        return pointToQuadraticDistance(point, pts[0], pts[1], pts[2]);
      }
      return Infinity;
    case 'brush':
      if (pts.length >= 2) {
        let minDist = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const dist = distanceToLineSegment(point, pts[i], pts[i + 1]);
          if (dist < minDist) minDist = dist;
        }
        return minDist;
      } else if (pts.length === 1) {
        return Math.hypot(point.x - pts[0].x, point.y - pts[0].y);
      }
      return Infinity;
    default:
      return Infinity;
  }
}