// ============================================================
// behaviors —— AI 行为注册表（名字 → 函数）
// ============================================================
// 行为只操作实体公开接口（移动/朝向/攻击），不碰内部。
// 加新行为 = 写函数 + 注册，敌人配置直接引用。

import type { EnemyBase } from '../../entity/EnemyBase';
import type { AttackOptions } from '../../services/combat/Attack';

export interface BehaviorContext {
  /** 当前帧步长 */
  dt: number;
  /** 累计时间（秒，行为节奏用） */
  time: number;
  /** 索敌目标（世界 x/z） */
  target: { x: number; z: number } | null;
  /** 索敌回调（camp → 目标位置；WorldMode 注入：敌人找玩家） */
  findTarget: (camp: string) => { x: number; z: number } | null;
  /** ★ 攻击意图入口（模式层注入 = executeAttack——近战/远程/范围统一分派） */
  attack: (opts: AttackOptions) => void;
}

export type BehaviorFn = (entity: EnemyBase, ctx: BehaviorContext, params: Record<string, string | number>) => void;

/** 参数取值工具：数值（不存在 → 默认） */
export function pnum(p: Record<string, string | number> | undefined, key: string, def: number): number {
  const v = p?.[key];
  return v === undefined ? def : Number(v);
}
/** 参数取值工具：字符串（不存在 → 默认） */
export function pstr(p: Record<string, string | number> | undefined, key: string, def: string): string {
  const v = p?.[key];
  return v === undefined ? def : String(v);
}

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
  const baseSpeed = pnum(params, 'speed', 2);
  const turnRate = pnum(params, 'turnRate', 0.5); // 每帧最大转向（rad）
  const turnInterval = pnum(params, 'turnInterval', 0.4); // 转向频率（秒）
  // ★ 通用参数：游走转向时略微偏向某阵营（0 = 纯随机；'' = 不偏）
  const targetBias = pnum(params, 'targetBias', 0.04);
  const biasCamp = pstr(params, 'biasCamp', 'player');

  // 当前方向（无 → 初始随机方向）
  if (entity.aiMoveDir.x === 0 && entity.aiMoveDir.z === 0) {
    const a = Math.random() * Math.PI * 2;
    entity.aiMoveDir = { x: Math.cos(a), z: Math.sin(a) };
  }
  // 周期随机转向（平滑，非每帧抖动）
  entity.aiTurnTimer -= ctx.dt;
  if (entity.aiTurnTimer <= 0) {
    entity.aiTurnTimer = turnInterval * (0.6 + Math.random() * 0.8);
    // 随机转向角
    const rand = (Math.random() - 0.5) * 2 * turnRate;
    let angle = rand;
    // ★ 转向时略微偏向指定阵营目标（只拉一部分夹角，不逐帧追）
    const t = biasCamp ? ctx.findTarget(biasCamp) : null;
    if (t && targetBias > 0) {
      const toTarget = Math.atan2(t.z - entity.entity.position.z, t.x - entity.entity.position.x);
      let diff = toTarget - Math.atan2(entity.aiMoveDir.z, entity.aiMoveDir.x);
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angle = rand + diff * targetBias;
    }
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
  const speed = pnum(params, 'speed', 2.5);
  const t = ctx.target;
  if (!t) return;
  const dx = t.x - entity.entity.position.x;
  const dz = t.z - entity.entity.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  entity.moveBy(dx / len, dz / len, ctx.dt, speed);
});

/** 近战攻击：一次性挥击（计时播完 → attackFinished 条件退出，不再循环）；
 *   ★ 挥击 = 攻击意图（type:'melee'）→ 执行器做范围判定 → 伤害管线 */
registerBehavior('meleeSwing', (entity, ctx, params) => {
  const duration = pnum(params, 'duration', 0.6);
  const range = pnum(params, 'range', 1.8);
  const damage = pnum(params, 'damage', 8);
  // 挥击未开始/已播完（含首次进入）→ 重新开始一轮挥击
  if (entity.aiAttackTimer <= 0) {
    entity.aiAttackTimer = duration;
    entity.aiSwingDone = false;
    // ★ 挥击瞬间：发出近战攻击意图（以自身为挥击中心，范围内目标才命中）
    if (ctx.target) {
      ctx.attack({
        type: 'melee',
        source: entity,
        x: entity.position.x,
        y: entity.position.y + 1.0,
        z: entity.position.z,
        range,
        damage,
        camp: 'enemy',
      });
    }
  }
  // 倒计时；播完 → 标记完成（状态机据此退出 attack）
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0) entity.aiSwingDone = true;
});
