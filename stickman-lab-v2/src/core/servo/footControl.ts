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
  // 脚局部环用滤波 CoP；原始 CoP 每帧噪声会把 ankle 目标打成高频
  const ex = sample.copXFiltered - sample.copTargetX;
  const ez = sample.copZFiltered - sample.copTargetZ;
  const dead = 0.004;
  const dx = Math.abs(ex) < dead ? 0 : ex;
  const dz = Math.abs(ez) < dead ? 0 : ez;
  return {
    enabled: true,
    foot0: base.foot0 - k * dz,
    foot1: base.foot1,
    foot2: base.foot2 - k * dx,
  };
}
