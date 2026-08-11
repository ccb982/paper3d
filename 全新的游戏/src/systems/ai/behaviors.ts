// ============================================================
// behaviors —— AI 行为注册表（名字 → 函数）
// ============================================================
// 行为只操作实体公开接口（移动/朝向/攻击），不碰内部。
// 加新行为 = 写函数 + 注册，敌人配置直接引用。

import type { EnemyBase } from '../../entity/EnemyBase';

export interface BehaviorContext {
  /** 当前帧步长 */
  dt: number;
  /** 索敌目标（世界 x/z） */
  target: { x: number; z: number } | null;
  /** 索敌回调（camp → 目标位置；WorldMode 注入：敌人找玩家） */
  findTarget: (camp: string) => { x: number; z: number } | null;
}

export type BehaviorFn = (entity: EnemyBase, ctx: BehaviorContext, params: Record<string, number>) => void;

/** 行为注册表 */
export const behaviorTable: Record<string, BehaviorFn> = {};

export function registerBehavior(name: string, fn: BehaviorFn): void {
  behaviorTable[name] = fn;
}

/** 游走：随机方向缓行，定期换方向 */
registerBehavior('wander', (entity, ctx, params) => {
  const speed = params.speed ?? 1.2;
  entity.aiTurnTimer -= ctx.dt;
  if (entity.aiTurnTimer <= 0) {
    // 随机方向（八方向）
    const angle = Math.floor(Math.random() * 8) * (Math.PI / 4);
    entity.aiMoveDir = { x: Math.cos(angle), z: Math.sin(angle) };
    entity.aiTurnTimer = 2 + Math.random() * 2;
  }
  entity.moveBy(entity.aiMoveDir.x, entity.aiMoveDir.z, ctx.dt, speed);
});

/** 追击：朝目标直线移动 */
registerBehavior('moveToTarget', (entity, ctx, params) => {
  const speed = params.speed ?? 2.5;
  const t = ctx.target;
  if (!t) return;
  const dx = t.x - entity.entity.position.x;
  const dz = t.z - entity.entity.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  entity.moveBy(dx / len, dz / len, ctx.dt, speed);
});

/** 近战攻击：原地停顿（挥砍动画由攻击帧/扭曲表现） */
registerBehavior('meleeSwing', (entity, ctx, params) => {
  const duration = params.duration ?? 0.6;
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0) {
    entity.aiAttackTimer = duration;
  }
});
