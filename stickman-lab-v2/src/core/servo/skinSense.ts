/**
 * 皮肤感受：逐接触点/逐身体区域的受力变化。
 * 只报“哪里、哪个方向突然受力”，不修正。
 */
import type { World } from '../world';

export interface SkinEvent {
  region: string;
  x: number; y: number; z: number;
  f: { x: number; y: number; z: number };
  df: { x: number; y: number; z: number };
  magnitude: number;
}

export interface SkinSense {
  events: SkinEvent[];
  total: { x: number; y: number; z: number };
  delta: { x: number; y: number; z: number };
  direction: -1 | 0 | 1;
  confidence: number;
}

interface Base { x: number; y: number; z: number }
const base = new WeakMap<World, Map<number, Base>>();

export function senseSkin(w: World): SkinSense {
  let m = base.get(w);
  if (!m) { m = new Map(); base.set(w, m); }
  const cur = new Map<number, { f: Base; x: number; y: number; z: number; n: number }>();
  for (const c of w.body.allContactSamples(w.dt)) {
    let a = cur.get(c.body);
    if (!a) { a = { f: { x: 0, y: 0, z: 0 }, x: 0, y: 0, z: 0, n: 0 }; cur.set(c.body, a); }
    a.f.x += c.fx; a.f.y += c.fy; a.f.z += c.fz;
    a.x += c.x; a.y += c.y; a.z += c.z; a.n++;
  }
  const events: SkinEvent[] = [];
  let dx = 0, dy = 0, dz = 0;
  for (const [bi, a] of cur) {
    const key = w.body.sk.bodies[bi]?.key ?? String(bi);
    const b = m.get(bi) ?? { x: 0, y: 0, z: 0 };
    const df = { x: a.f.x - b.x, y: a.f.y - b.y, z: a.f.z - b.z };
    const mag = Math.hypot(df.x, df.y, df.z);
    if (mag > 10) events.push({ region: key, x: a.x / a.n, y: a.y / a.n, z: a.z / a.n, f: { ...a.f }, df, magnitude: mag });
    dx += df.x; dy += df.y; dz += df.z;
    const k = 1 - Math.exp(-w.dt / 0.05);
    b.x += (a.f.x - b.x) * k; b.y += (a.f.y - b.y) * k; b.z += (a.f.z - b.z) * k;
    m.set(bi, b);
  }
  for (const bi of m.keys()) if (!cur.has(bi)) m.delete(bi);
  events.sort((a, b) => b.magnitude - a.magnitude);
  const dir: -1 | 0 | 1 = Math.abs(dz) > 8 ? (dz > 0 ? 1 : -1) : 0;
  return {
    events,
    total: { x: 0, y: 0, z: 0 },
    delta: { x: dx, y: dy, z: dz },
    direction: dir,
    confidence: dir === 0 ? 0 : Math.min(1, Math.abs(dz) / 60),
  };
}
