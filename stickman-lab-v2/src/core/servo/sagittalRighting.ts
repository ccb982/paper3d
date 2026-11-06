export interface SagittalRightingInput {
  eSag: number;
  leanKneeK?: number;
  leanAnkleK?: number;
  enabled?: boolean;
}

export interface SagittalRightingOutput {
  knee2Delta: number;
  foot2Delta: number;
}

export function computeSagittalRighting(i: SagittalRightingInput): SagittalRightingOutput {
  const eSag = (i.enabled ?? true) ? i.eSag : 0;
  return {
    knee2Delta: (i.leanKneeK ?? -4) * eSag,
    foot2Delta: (i.leanAnkleK ?? -2) * eSag,
  };
}
