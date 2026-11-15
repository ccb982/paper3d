/** 小腿/踝命令层：只生成 knee0/foot0/foot1/foot2 目标。 */
export interface ShankPlanInput { knee0: number; foot0: number; foot1: number; foot2: number }
export interface ShankPlan { knee0: number; foot0: number; foot1: number; foot2: number }
export function planShank(i: ShankPlanInput): ShankPlan {
  return { knee0: i.knee0, foot0: i.foot0, foot1: i.foot1, foot2: i.foot2 };
}
