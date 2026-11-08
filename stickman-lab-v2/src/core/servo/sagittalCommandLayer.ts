/**
 * 矢状命令层最小骨架：HipHub。
 *
 * 只做“局部共收缩/阻尼”，不改 hip 目标、不改 base、不改侧向。
 * 目标：大腿根速度/骨盆 roll 上升时，hip 局部刚度自动上升，
 * 先让骨盆不被大腿反作用带跑；ThighPower/ShankGuard 后续再接入。
 */
export interface HipHubInput {
  side: 'l' | 'r';
  hipQ: [number, number, number];
  hipV: [number, number, number];
  pelvisRoll: number;
  contact: boolean;
  enabled: boolean;
  kMove: number;
  kPelvis: number;
  maxScale: number;
}

export interface HipHubOutput {
  stiffnessScale: number;
  dampingScale: number;
  hipMove: number;
  pelvisRollAbs: number;
  active: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHipHub(i: HipHubInput): HipHubOutput {
  const hipMove = Math.abs(i.hipV[0]) + Math.abs(i.hipV[1]) + Math.abs(i.hipV[2]);
  const rollAbs = Math.abs(i.pelvisRoll);
  const raw = 1 + Math.abs(i.kMove) * hipMove + Math.abs(i.kPelvis) * rollAbs;
  const scale = i.enabled && i.contact ? clamp(raw, 1, Math.max(1, i.maxScale)) : 1;
  return {
    stiffnessScale: scale,
    dampingScale: scale,
    hipMove,
    pelvisRollAbs: rollAbs,
    active: i.enabled && i.contact,
  };
}

/**
 * ThighPower：大腿主扰动抵抗。
 *
 * 只出力，不改 hip2 目标；CoM AP 误差 → 沿腿轴力 → hip2 ff。
 * 不碰 hip0/hip1 的侧向，也不碰 knee2 的角度回正。
 */
export interface ThighPowerInput {
  eSag: number;
  eSagV: number;
  contact: boolean;
  enabled: boolean;
  kSag: number;
  dSag: number;
  forceCap: number;
  lever: number;
  torqueCap: number;
}

export interface ThighPowerOutput {
  force: number;
  hip2Ff: number;
  active: boolean;
}

export function computeThighPower(i: ThighPowerInput): ThighPowerOutput {
  const raw = i.kSag * i.eSag + i.dSag * i.eSagV;
  const force = clamp(raw, -Math.abs(i.forceCap), Math.abs(i.forceCap));
  const hip2Ff = clamp(force * Math.abs(i.lever), -Math.abs(i.torqueCap), Math.abs(i.torqueCap));
  const active = i.enabled && i.contact;
  return {
    force: active ? force : 0,
    hip2Ff: active ? hip2Ff : 0,
    active,
  };
}


/**
 * ShankGuard：小腿稳定杆。
 *
 * 只放大 knee2 / foot2 的局部刚度/阻尼，不改目标、不产生主动回正；
 * 大腿根速度上升时，先让膝关节/踝关节把小钢结构稳住。
 */
export interface ShankGuardInput {
  hipMove: number;
  kneeV: number;
  ankleV: number;
  contact: boolean;
  enabled: boolean;
  kMove: number;
  maxScale: number;
}

export interface ShankGuardOutput {
  scale: number;
  active: boolean;
}

export function computeShankGuard(i: ShankGuardInput): ShankGuardOutput {
  const move = Math.abs(i.hipMove) + Math.abs(i.kneeV) + Math.abs(i.ankleV);
  const raw = 1 + Math.abs(i.kMove) * move;
  return {
    scale: i.enabled && i.contact ? clamp(raw, 1, Math.max(1, i.maxScale)) : 1,
    active: i.enabled && i.contact,
  };
}
