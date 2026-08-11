// ============================================================
// behaviors —— AI 行为注册表（名字 → 函数）
// ============================================================
// 行为只操作实体公开接口（移动/朝向/攻击），不碰内部。
// 加新行为 = 写函数 + 注册，敌人配置直接引用。

import type { EnemyBase } from '../../entity/EnemyBase';

export interface BehaviorContext {
  /** 当前帧步长 */
  dt: number;
  /** 累计时间（秒，行为节奏用） */
  time: number;
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

/**
 * 游走：Reynolds Wander Steering（AI 教科书标准）
 *   - 当前前进方向 + 随机平滑转向（每帧小偏角 → 自然弯弯绕绕）
 *   - 速度波动（走走停停感，非匀速直线）
 */
registerBehavior('wander', (entity, ctx, params) => {
  const baseSpeed = params.speed ?? 2;
  const turnRate = params.turnRate ?? 0.5; // 每帧最大转向（rad）
  const turnInterval = params.turnInterval ?? 0.4; // 转向频率（秒）

  // 当前方向（无 → 初始随机方向）
  if (entity.aiMoveDir.x === 0 && entity.aiMoveDir.z === 0) {
    const a = Math.random() * Math.PI * 2;
    entity.aiMoveDir = { x: Math.cos(a), z: Math.sin(a) };
  }
  // 周期随机转向（平滑，非每帧抖动）
  entity.aiTurnTimer -= ctx.dt;
  if (entity.aiTurnTimer <= 0) {
    entity.aiTurnTimer = turnInterval * (0.6 + Math.random() * 0.8);
    const angle = (Math.random() - 0.5) * 2 * turnRate;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dx = entity.aiMoveDir.x * cosA - entity.aiMoveDir.z * sinA;
    const dz = entity.aiMoveDir.x * sinA + entity.aiMoveDir.z * cosA;
    entity.aiMoveDir = { x: dx, z: dz };
  }
  // 速度波动（走走停停的自然节奏）
  const speed = baseSpeed * (0.5 + 0.5 * Math.abs(Math.sin(ctx.time * 2.5 + entity.entity.id * 1.7)));
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
