import type { FootSensorReading } from './footContact';

export interface FootControlTarget {
  foot0: number;
  foot1: number;
  foot2: number;
}

export interface FootControlOutput extends FootControlTarget {
  enabled: boolean;
}

/** 脚局部闭环：只把 CoP 误差转换成脚关节目标，不直接发力。 */
export function computeFootControl(sample: FootSensorReading, base: FootControlTarget): FootControlOutput {
  if (!sample.contact || !sample.copInside) {
    return { enabled: false, ...base };
  }
  const k = 0.8;
  return {
    enabled: true,
    foot0: base.foot0 - k * sample.copErrorZ,
    foot1: base.foot1,
    foot2: base.foot2 - k * sample.copErrorX,
  };
}
