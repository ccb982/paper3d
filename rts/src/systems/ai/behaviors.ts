// ============================================================
// behaviors —— AI 行为注册表（名字 → 函数）
// ============================================================
// 行为只操作实体公开接口（移动/朝向/攻击），不碰内部。
// 加新行为 = 写函数 + 注册，敌人配置直接引用。

import type { EnemyBase } from '../../entity/EnemyBase';
import type { AttackOptions } from '../../services/combat/Attack';

/** ★ 候选目标：坐标 + 自身有效索敌半径（缺省 = 通用视野半径） */
export interface TargetCandidate {
  x: number;
  z: number;
  /** 该候选自身的有效索敌半径（米）；如祖宗嘲讽半径。缺省用条件传入的 radius（见 seePlayer / retarget） */
  radius?: number;
}

export interface BehaviorContext {
  /** 当前帧步长 */
  dt: number;
  /** 累计时间（秒，行为节奏用） */
  time: number;
  /** 索敌目标（世界 x/z） */
  target: { x: number; z: number } | null;
  /** 索敌回调（camp → 目标位置；WorldMode 注入：敌人找玩家） */
  findTarget: (camp: string) => { x: number; z: number } | null;
  /** ★ 候选目标（按优先级从高到低；如 祖宗[吸仇恨] > 玩家 > 友军）。
   *  条件按序取第一个"在有效半径内"的候选；未提供时回退 findTarget。 */
  targetCandidates?: (entity: EnemyBase) => TargetCandidate[];
  /** ★ 攻击意图入口（模式层注入 = executeAttack——近战/远程/范围统一分派） */
  attack: (opts: AttackOptions) => void;
  /** ★ 玩家世界坐标（AI 距离分级/波次生成用） */
  focusX?: number;
  focusZ?: number;
  /** ★ 焦点（玩家）的世界高度 y —— 远程弹道瞄准用（focusX/Z 是无高度的平面坐标） */
  focusY?: number;
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
  if (entity.fireHold) return;   // ★ 执行层：本段禁火（开火掷为假）
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

/**
 * ★ 远程射击：一次性发射真弹道（计时播完 → attackFinished，下一轮由状态机重新进入）。
 *   与 meleeSwing 同构（同一 aiAttackTimer / aiSwingDone 契约），差别只在意图类型：
 *     meleeSwing → type:'melee'（原地范围瞬时判定）
 *     rangedShot → type:'projectile'（飞到接触才命中 → 有可见弹道 + 飞行时间）
 *   ★ 发射点 = 自身受击锚点（`hitAnchorY()` = 贴片 65% 胸口）+ muzzleHeight；
 *     瞄准点 = 目标受击锚点（ctx.focusY）+ aimHeight。
 *     ★ 别用 position.y + 固定值：贴片单位的身高差异极大（1.9 与 4.2 缩放差 2 倍），
 *       固定值对小兵是头顶、对大个子是膝盖。
 *   ★ 阵营给 'enemy'：模式层据此把弹道路由到"敌方子弹池"（程序化箭矢视觉）。
 */
/**
 * ★ 自爆（爆炸飞行怪）2026-09-19：进入 attack → 引信（fuse）→
 *   范围爆炸（aoe）+ **自身死亡**（走统一 onDeath → 击杀统计/掉落管线）。
 *   参数：radius 爆炸半径 / damage 伤害 / fuse 引信时长（秒）
 */
registerBehavior('selfDestruct', (entity, ctx, params) => {
  if (entity.fireHold) return;   // ★ 执行层：本段禁火
  const radius = pnum(params, 'radius', 3);
  const damage = pnum(params, 'damage', 26);
  const fuse = pnum(params, 'fuse', 0.25);
  if (entity.aiAttackTimer <= 0 && !entity.aiSwingDone) {
    entity.aiAttackTimer = fuse;
  }
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0 && !entity.aiSwingDone) {
    entity.aiSwingDone = true;
    ctx.attack({
      type: 'aoe',
      source: entity,
      x: entity.position.x,
      y: entity.position.y + 0.8,
      z: entity.position.z,
      radius,
      damage,
      camp: 'enemy',
    });
    entity.onDeath(null);   // 自爆 = 自身死亡
  }
});

registerBehavior('rangedShot', (entity, ctx, params) => {
  const duration = pnum(params, 'duration', 0.8);
  const damage = pnum(params, 'damage', 8);
  const speed = pnum(params, 'speed', 26);
  const lifetime = pnum(params, 'lifetime', 2.4);
  const aimHeight = pnum(params, 'aimHeight', 0);
  const muzzleHeight = pnum(params, 'muzzleHeight', 0);
  const spread = pnum(params, 'spread', 0.05);
  // ★ 弹种标签：模式层据此选子弹池（箭 / 法球）——行为层只透传，不认识池
  const bulletSkin = pstr(params, 'skin', 'arrow');
  if (entity.fireHold) return;   // ★ 执行层：本段禁火（开火揗为假）
  const t0 = ctx.target;
  const dist0 = t0 ? Math.hypot(t0.x - entity.position.x, t0.z - entity.position.z) : 0;
  // ★ 远距 = 掩护性零星散射（慢 + 大散布）；近距（<20m）= 疯狂精准射击
  const near = dist0 > 0 && dist0 < 20;
  const dur = near ? duration * 0.55 : duration * 1.6;
  const sp = near ? 0.012 : Math.max(spread, 0.15);
  if (entity.aiAttackTimer <= 0) {
    entity.aiAttackTimer = dur;
    entity.aiSwingDone = false;
    const t = ctx.target;
    if (t) {
      const ox = entity.position.x;
      const oy = entity.hitAnchorY() + muzzleHeight;
      const oz = entity.position.z;
      const ty = (ctx.focusY ?? entity.hitAnchorY()) + aimHeight;
      let dx = t.x - ox, dy = ty - oy, dz = t.z - oz;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      // ★ 散布：绕竖直轴随机偏转 + 轻微俯仰抖动（远散近准）
      if (sp > 0) {
        const a = (Math.random() - 0.5) * 2 * sp;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = dx * ca - dz * sa;
        const nz = dx * sa + dz * ca;
        dx = nx; dz = nz;
        dy += (Math.random() - 0.5) * sp;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      // 出膛前移：避免与自身碰撞体重叠（同阵营本来也不判定，但物理体不应生在体内）
      const muzzle = 0.7;
      ctx.attack({
        type: 'projectile',
        source: entity,
        x: ox + dx * muzzle, y: oy + dy * muzzle, z: oz + dz * muzzle,
        dirX: dx, dirY: dy, dirZ: dz,
        speed, camp: 'enemy', lifetime, damage, bulletSkin,
      });
    }
  }
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0) entity.aiSwingDone = true;
});
