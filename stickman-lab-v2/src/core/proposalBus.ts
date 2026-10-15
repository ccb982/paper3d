/**
 * proposalBus.ts —— 提案总线（2026-10-15 用户定调："所有的写手都是提案制"）
 *
 * 任何写手（动作层/反射弧/伺服/基建）不再直接写 drive/manual/executor——
 * 只向本总线提交"逐轴提案"；由 `ControlModule.step` 在整合期**逐轴仲裁**
 * （同轴同通道：高优先级胜；同优先级：后提交覆盖先提交）并按优先级
 * 从低到高施加（最后写的=最终命令），实现"收进来 → 逐轴整合 → 发出去"。
 *
 * 优先级（PRI）：直控=100（最高）＞反射=60＞动作=40＞伺服/基建=20。
 */
export interface DofProposal {
  dof: number;
  kind: 'pair' | 'angle' | 'torque' | 'motor' | 'clear';
  pri: number;
  /** pair：共激活 C 与目标角 λ；angle/motor：目标角 */
  c?: number;
  rad?: number;
  /** angle：刚度/阻尼（可省）；motor：刚度/阻尼（800/60 默认） */
  kp?: number;
  kd?: number;
  /** torque：力矩 */
  tau?: number;
  src: string;
}

export const PROPOSALS: DofProposal[] = [];

export function propose(p: DofProposal): void {
  PROPOSALS.push(p);
  // ★ 提案日志（探针回读用；仅 __PROPLOG 打开时记录）
  const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };
  if (g.__PROPLOG) g.__PROPLOG.push([p.dof, p.kind, p.rad ?? p.tau ?? p.c ?? 0, p.src]);
}

export const PRI = {
  direct: 100,
  reflex: 60,
  action: 40,
  servo: 20,
} as const;
