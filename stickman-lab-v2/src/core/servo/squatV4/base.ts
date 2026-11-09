import type { Body } from '../../body';
import { staticBalance } from '../staticBalance';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface StaticBaseOptions {
  gravity?: number;
  copXLimit?: number;
  copZLimit?: number;
  scale?: number;
}

export function captureStaticBase(body: Body, opt: StaticBaseOptions = {}): Float64Array {
  const g = Math.abs(opt.gravity ?? 9.81);
  let mTot = 0;
  for (const rb of body.bodies) mTot += rb.mass();
  const W = mTot * g;
  const com = new Float64Array(3);
  body.com(com);
  const foot = (side: 'l' | 'r'): { x: number; z: number } => {
    const bi = body.indexByKey.get(`foot_${side}`);
    if (bi === undefined) return { x: 0, z: 0 };
    const t = body.bodies[bi]!.translation();
    return { x: t.x, z: t.z };
  };
  const fl = foot('l');
  const fr = foot('r');
  const lx = Math.abs(opt.copXLimit ?? 0.12);
  const lz = Math.abs(opt.copZLimit ?? 0.06);
  const out = new Float64Array(body.dofs.length);
  staticBalance(body, out, {
    l: { N: W * 0.5, copX: clamp(com[0]!, fl.x - lx, fl.x + lx), copZ: clamp(com[2]!, fl.z - lz, fl.z + lz) },
    r: { N: W * 0.5, copX: clamp(com[0]!, fr.x - lx, fr.x + lx), copZ: clamp(com[2]!, fr.z - lz, fr.z + lz) },
  });
  const s = opt.scale ?? 1;
  if (s !== 1) for (let i = 0; i < out.length; i++) out[i] = out[i]! * s;
  return out;
}
