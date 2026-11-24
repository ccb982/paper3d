import type { Body } from '../body';

/** 命令层对单关节肌肉阻抗的直接命令；未设置的字段由局部自主控制器补。 */
export interface MuscleImpedanceCmd {
  /** 目标刚度（N·m/rad），undefined = 用 wn/ζ 生成 */
  k?: number;
  /** 目标阻尼（N·m·s/rad），undefined = 用 wn/ζ 生成 */
  d?: number;
  /** 软硬覆盖：0=全软，1=全硬；undefined = 由运动量 softGate 决定 */
  soft?: number;
  /** 期望关节加速度（rad/s²），默认 0 */
  accRef?: number;
  /** 加速度反馈增益覆盖 */
  accGain?: number;
}

const _bus = new WeakMap<Body, Map<string, MuscleImpedanceCmd>>();

const keyOf = (name: string, axis: number): string => `${name}/${axis}`;

export function setMuscleImpedance(body: Body, name: string, axis: number, cmd: MuscleImpedanceCmd): void {
  let m = _bus.get(body);
  if (!m) { m = new Map(); _bus.set(body, m); }
  m.set(keyOf(name, axis), cmd);
}

export function getMuscleImpedance(body: Body, name: string, axis: number): MuscleImpedanceCmd | undefined {
  return _bus.get(body)?.get(keyOf(name, axis));
}

export function clearMuscleImpedance(body: Body, name?: string, axis?: number): void {
  const m = _bus.get(body);
  if (!m) return;
  if (name === undefined || axis === undefined) { m.clear(); return; }
  m.delete(keyOf(name, axis));
}
