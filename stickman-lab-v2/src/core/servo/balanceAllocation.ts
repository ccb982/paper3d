/** 蹲姿控制权重表：工程 baseline，不是论文精确数值。
 *  比例是控制权重，不是力矩百分比；最终受 CoP/力矩 cap 限制。
 */
export type AllocMode = 'normal' | 'small' | 'hipAssist' | 'trunkRecover' | 'fall';

export interface AllocWeights { ankle: number; hip: number; trunk: number; }
export interface AllocState {
  mode: AllocMode;
  w: AllocWeights;
  ankleScale: number;
  trunkScale: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function allocateSquat(input: {
  copMargin: number;
  trunkScore: number;
  comErr: number;
  fall: boolean;
}): AllocState {
  if (input.fall) return { mode: 'fall', w: { ankle: 0, hip: 0, trunk: 0 }, ankleScale: 0, trunkScale: 0 };
  const mode: AllocMode = input.trunkScore > 2 ? 'trunkRecover'
    : Math.abs(input.copMargin) > 0.04 ? 'hipAssist'
      : Math.abs(input.copMargin) > 0.03 || Math.abs(input.comErr) > 0.005 ? 'small'
        : 'normal';
  const w: AllocWeights = mode === 'trunkRecover' ? { ankle: 0.05, hip: 0.20, trunk: 0.75 }
    : mode === 'hipAssist' ? { ankle: 0.05, hip: 0.55, trunk: 0.40 }
      : mode === 'small' ? { ankle: 0.15, hip: 0.30, trunk: 0.55 }
        : { ankle: 0.10, hip: 0.30, trunk: 0.60 };
  return {
    mode,
    w,
    // 以 NORMAL 为 1.0 的缩放；只调权重，不直接给绝对值
    // 髋执行器尚未接入：hipAssist 不削减背肌；只有 trunkRecover 才加权
    ankleScale: mode === 'trunkRecover' ? clamp(w.ankle / 0.10, 0, 1) : 1,
    trunkScale: mode === 'trunkRecover' ? clamp(w.trunk / 0.60, 1, 2) : 1,
  };
}
