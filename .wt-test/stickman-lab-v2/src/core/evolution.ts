/**
 * evolution.ts —— ★ 最小 stub（v2 暂不做进化训练）
 *
 * 为什么存在：`viewer.ts`（原样搬自 v1）的 `syncGhost(trainer)` 只用到
 *   `trainer.sims[i].doll`（整代骨架线框）。v2 当前只跑**单个**实体，
 *   所以这里给一个满足该形状的空壳，让渲染层零改动即可编译/运行。
 *
 * ⚠ 真正做进化训练时应替换为完整实现（见 v1 `core/evolution.ts`）。
 */

import type { World } from './world';

export interface TrainerSim {
  doll: World;
}

export class Trainer {
  readonly sims: TrainerSim[] = [];
}
