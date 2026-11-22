/**
 * ContactDamper —— 脚-地接触层的法向阻尼。
 *
 * 不替代 Rapier 接触弹簧；只补一个法向速度阻尼冲量。
 * 仅在脚接触且向下运动时工作，静态/离地不产生力。
 */
import type { World } from '../world';
import { sampleFootContact } from './footContact';

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};

export function applyContactDamper(w: World): void {
  if (num('SQC_CONTACT_DAMP_ON', 1) !== 1) return;
  const c = Math.max(0, num('SQC_CONTACT_DAMP_C', 800));
  const vMin = Math.max(0, num('SQC_CONTACT_DAMP_VMIN', 0.01));
  const cap = Math.max(0, num('SQC_CONTACT_DAMP_CAP', 6));
  const out: Array<{ side: 'l' | 'r'; vy: number; impulse: number; contact: boolean }> = [];
  for (const side of ['l', 'r'] as const) {
    const fc = sampleFootContact(w, side);
    const bi = w.body.indexByKey.get(`foot_${side}`);
    if (bi === undefined) { out.push({ side, vy: 0, impulse: 0, contact: fc.contact }); continue; }
    const rb = w.body.bodies[bi]!;
    const vy = rb.linvel().y;
    let impulse = 0;
    if (fc.contact && vy < -vMin) {
      impulse = Math.max(-cap, Math.min(cap, -c * vy * w.dt));
      if (Math.abs(impulse) > 1e-6) rb.applyImpulse({ x: 0, y: impulse, z: 0 }, true);
    }
    out.push({ side, vy, impulse, contact: fc.contact });
  }
  (globalThis as { __CONTACT_DAMP?: typeof out }).__CONTACT_DAMP = out;
}
