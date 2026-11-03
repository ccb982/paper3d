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
}

export function planRighting(s: ChainSense): RightingPlan {
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
    };
  }
  return { active: false, source: 'none', direction: 0, urgency: 0, region: '', confidence: 0, reason: '稳定' };
}
