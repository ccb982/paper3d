/**
 * 回正方案：只生成“给 PD 执行的目标/方向”，不直接写执行器。
 * 输入是实际力链、皮肤扰动、全身残差；IK 不参与判定。
 */
import type { ChainSense } from './chainSense';

export interface RightingPlan {
  active: boolean;
  source: 'skin' | 'whole' | 'foot' | 'none';
  direction: -1 | 0 | 1;
  urgency: number;
  region: string;
  confidence: number;
  reason: string;
  eCopZ: number;
  eFz: number;
  lateralOnly: true;
}

export interface RightingTarget { copZ: number; fz: number }

export function planRighting(s: ChainSense, target?: RightingTarget): RightingPlan {
  const eCopZ = target ? target.copZ - ((s.chain.l.cop.z * Math.max(0, s.chain.l.F.y) + s.chain.r.cop.z * Math.max(0, s.chain.r.F.y)) / Math.max(1e-9, Math.max(0, s.chain.l.F.y) + Math.max(0, s.chain.r.F.y))) : 0;
  const eFz = target ? target.fz - (s.chain.l.F.y + s.chain.r.F.y) : 0;
  const ev = s.skin.events[0];
  if (ev && ev.magnitude > 30 && Math.abs(ev.df.z) > 8) {
    const d: -1 | 0 | 1 = ev.df.z > 0 ? 1 : -1;
    return {
      active: true,
      source: 'skin',
      direction: d,
      urgency: Math.min(1, ev.magnitude / 200),
      region: ev.region,
      confidence: Math.min(1, ev.magnitude / 100),
      reason: `皮肤 ${ev.region} ΔF=${ev.magnitude.toFixed(0)}N`,
      eCopZ, eFz, lateralOnly: true,
    };
  }
  if (s.whole.valid && s.whole.direction.direction !== 0) {
    return {
      active: true,
      source: 'whole',
      direction: s.whole.direction.direction,
      urgency: Math.min(1, s.whole.direction.confidence),
      region: 'whole',
      confidence: s.whole.direction.confidence,
      reason: `全身 vz=${s.whole.direction.velZ.toFixed(2)}m/s`,
      eCopZ, eFz, lateralOnly: true,
    };
  }
  if (s.direction.direction !== 0 && (Math.abs(s.direction.loadDiff) > 0.12 || Math.abs(s.direction.comRel) > 0.012)) {
    return {
      active: true,
      source: 'foot',
      direction: s.direction.direction,
      urgency: Math.min(1, s.direction.confidence),
      region: s.direction.support,
      confidence: s.direction.confidence,
      reason: `脚载差=${s.direction.loadDiff.toFixed(2)}`,
      eCopZ, eFz, lateralOnly: true,
    };
  }
  return { active: false, source: 'none', direction: 0, urgency: 0, region: '', confidence: 0, reason: '稳定', eCopZ, eFz, lateralOnly: true };
}
