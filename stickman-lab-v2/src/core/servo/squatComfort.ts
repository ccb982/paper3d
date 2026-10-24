/** 统一 comfort zone：主动回正的总开关。
 *
 *  死区内只保留 base/passive/damping；
 *  所有主动层共享同一个 gate。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtTarget } from '../court';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface Comfort {
  active: boolean;
  gate: number;
  radius: number;
}

const _state = new WeakMap<CS, Comfort>();

export function updateComfort(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_COMFORT ?? '1') !== '1') return;
  if (!st.released) return;
  const e0 = Math.max(1e-4, Number(env.SQC_COMFORT_E ?? 0.01));
  const v0 = Math.max(1e-4, Number(env.SQC_COMFORT_V ?? 0.05));
  const r0 = Math.max(1e-4, Number(env.SQC_COMFORT_TORSO ?? 2) / 57.3);
  const target = courtTarget(st);
  const ex = (ctl.sensors.com[0]! - target.comX) / e0;
  const ez = (ctl.sensors.com[2]! - target.comZ) / e0;
  const vx = ctl.sensors.comVel[0]! / v0;
  const vz = ctl.sensors.comVel[2]! / v0;
  const tr = (ctl.sensors.torsoTilt[0]! - target.pitch) / r0;
  const rr = (ctl.sensors.torsoTilt[1]! - target.roll) / r0;
  const radius = Math.max(Math.abs(ex), Math.abs(ez), Math.abs(vx), Math.abs(vz), Math.abs(tr), Math.abs(rr));
  const prev = _state.get(st);
  let active = prev?.active ?? false;
  if (radius > 1) active = true;
  else if (radius < 0.6) active = false;
  const targetGate = active ? clamp((radius - 0.6) / 0.4, 0, 1) : 0;
  const gate = (prev?.gate ?? 0) + (targetGate - (prev?.gate ?? 0)) * 0.2;
  _state.set(st, { active, gate, radius });
  if (String(env.SQC_COMFORT_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    console.log(`COMFORT t=${w.clock.toFixed(2)} r=${radius.toFixed(2)} gate=${gate.toFixed(2)} active=${active ? 1 : 0}`);
  }
}

export function comfortGate(st: CS): number {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_COMFORT ?? '1') !== '1') return 1;
  return _state.get(st)?.gate ?? 0;
}
