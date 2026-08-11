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

/** 游走：目标点巡逻（大步走向随机远处目标点，走完再选新目标——明显移动） */
registerBehavior('wander', (entity, ctx, params) => {
  const speed = params.speed ?? 2.5;
  // 无目标 → 选随机远点（距当前 5~12 单位）
  if (!entity.aiWaypoint) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 7;
    entity.aiWaypoint = {
      x: entity.entity.position.x + Math.cos(angle) * dist,
      z: entity.entity.position.z + Math.sin(angle) * dist,
    };
  }
  const dx = entity.aiWaypoint.x - entity.entity.position.x;
  const dz = entity.aiWaypoint.z - entity.entity.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) {
    // 到达目标点 → 清除，下帧选新目标
    entity.aiWaypoint = null;
    return;
  }
  entity.moveBy(dx / len, dz / len, ctx.dt, speed);
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
