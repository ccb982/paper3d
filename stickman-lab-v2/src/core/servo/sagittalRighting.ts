/** 矢状回正（方向）：只输出 knee2 关节角修正。
 *  hip2 由 hipRightingStrategy 出；踝不归矢状（只保力链/抓地）。 */
export interface SagittalRightingInput {
  eSag: number;
  leanKneeK?: number;
  enabled?: boolean;
}

export interface SagittalRightingOutput {
  knee2Delta: number;
}

export function computeSagittalRighting(i: SagittalRightingInput): SagittalRightingOutput {
  const eSag = (i.enabled ?? true) ? i.eSag : 0;
  return {
    knee2Delta: (i.leanKneeK ?? -4) * eSag,
  };
}
