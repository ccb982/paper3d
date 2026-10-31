import type { Point, MaskEffect } from './types';

function hashCPU(p: number): number {
  const x = Math.sin(p) * 43758.5453;
  return x - Math.floor(x);
}

function smoothNoiseCPU(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hashCPU(ix * 127.1 + iy * 311.7 + seed);
  const n10 = hashCPU((ix + 1) * 127.1 + iy * 311.7 + seed);
  const n01 = hashCPU(ix * 127.1 + (iy + 1) * 311.7 + seed);
  const n11 = hashCPU((ix + 1) * 127.1 + (iy + 1) * 311.7 + seed);
  return n00 * (1 - ux) * (1 - uy) + n10 * ux * (1 - uy) + n01 * (1 - ux) * uy + n11 * ux * uy;
}

function getCentroid(points: Point[]): Point {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}

function applyWaveCPU(points: Point[], op: MaskEffect['distortions'][0], time: number): Point[] {
  const dir = op.direction || 'normal';
  const freq = op.frequency || 1;
  const amp = op.amplitude || 0.05;
  const speed = op.speed || 1;
  const phase = op.phase || 0;
  const n = points.length;

  return points.map((p, i) => {
    if (dir === 'xy') {
      return {
        x: p.x + amp * Math.sin(freq * p.x + speed * time + phase),
        y: p.y + amp * Math.sin(freq * p.y + speed * time + phase * 1.3),
      };
    }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const tangent = { x: next.x - prev.x, y: next.y - prev.y };
    const len = Math.hypot(tangent.x, tangent.y);
    if (len < 0.0001) return p;
    let normal = { x: -tangent.y / len, y: tangent.x / len };
    if (dir === 'tangent') normal = { x: tangent.x / len, y: tangent.y / len };
    const offset = amp * Math.sin(freq * (p.x + p.y) + speed * time + phase);
    return { x: p.x + normal.x * offset, y: p.y + normal.y * offset };
  });
}

function applyTurbulentCPU(points: Point[], op: MaskEffect['distortions'][0], time: number): Point[] {
  const amp = op.amplitude || 0.05;
  const freq = op.frequency || 3;
  const speed = op.speed || 0.5;
  const seed = op.seed || 42;
  const octaves = op.octaves || 3;

  return points.map((p) => {
    let dx = 0, dy = 0;
    for (let o = 0; o < octaves; o++) {
      const f = freq * Math.pow(2, o);
      const a = amp / Math.pow(2, o);
      const nx = p.x * f + time * speed;
      const ny = p.y * f + time * speed * 0.7;
      const n = smoothNoiseCPU(nx, ny, seed + o * 100);
      dx += (n - 0.5) * a * 2;
      dy += (n - 0.5) * a * 2;
    }
    return { x: p.x + dx, y: p.y + dy };
  });
}

function applyTwirlCPU(points: Point[], op: MaskEffect['distortions'][0], time: number): Point[] {
  const center = op.center || { x: 0.5, y: 0.5 };
  const radius = op.falloffRadius || 0.5;
  const angle = op.amplitude || 0.2;
  const speed = op.speed || 0.5;

  return points.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) return p;
    const falloff = Math.exp(-dist / radius);
    const theta = angle * falloff * (1 + Math.sin(time * speed));
    const cosA = Math.cos(theta);
    const sinA = Math.sin(theta);
    return {
      x: center.x + dx * cosA - dy * sinA,
      y: center.y + dx * sinA + dy * cosA,
    };
  });
}

export function applyDistortionCPU(points: Point[], maskEffect: MaskEffect, time: number): Point[] {
  if (!maskEffect?.enabled) return points.slice();

  let pts = points.slice();

  if (maskEffect.transform) {
    const t = maskEffect.transform;
    const anchor = t.anchor || getCentroid(points);

    pts = pts.map((p) => {
      const dx = p.x - anchor.x;
      const dy = p.y - anchor.y;
      const cos = Math.cos(t.rotation || 0);
      const sin = Math.sin(t.rotation || 0);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: rx * (t.scale?.x ?? 1) + (t.position?.x ?? 0) + anchor.x,
        y: ry * (t.scale?.y ?? 1) + (t.position?.y ?? 0) + anchor.y,
      };
    });
  }

  for (const op of maskEffect.distortions) {
    if (!op.enabled) continue;
    switch (op.type) {
      case 'wave': pts = applyWaveCPU(pts, op, time); break;
      case 'turbulent': pts = applyTurbulentCPU(pts, op, time); break;
      case 'twirl': pts = applyTwirlCPU(pts, op, time); break;
    }
  }

  return pts;
}
