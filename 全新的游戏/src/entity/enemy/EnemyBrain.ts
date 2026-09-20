// ============================================================
// EnemyBrain —— 敌人行为器（E5 组合件；纯搬运，行为零变化）
// ============================================================
// 眩晕 / 保底攻击（近战/远程/自爆）/ 指令→原子（两级掷的执行侧）。
// 只读写宿主（EnemyBase）的公开载体字段，不反向依赖表现/移动实现细节。
// ============================================================

import type { AIConfig } from '../../systems/ai/aiconfig';
import { ENEMY_ENGAGE_FLOOR } from '../../systems/ai/aiconfig';
import type { BehaviorContext } from '../../systems/ai/behaviors';
import type { EnemyBase } from '../EnemyBase';
import {
  MOVE_ATOMS, atomDirection, AtomExecutor, runDirective, fireProfile,
  type DirectiveRun,
} from '../AtomExecutor';
import { roleBucket } from '../SwarmUnit';

const _atomDir = { x: 0, z: 0 };

/** ★ 统一决策内核输出 scratch（零分配；与代理共用同一条管线） */
const _run: DirectiveRun = { moveIdx: 255, move: 'hold', fire: false, inRange: false };

export class EnemyBrain {
  // ---- 原子承诺状态（与代理同源：AtomExecutor 的承诺窗） ----
  private readonly atoms = new AtomExecutor();
  /** 当前移动原子下标（255 = 无覆盖） */
  atomMove = 255;
  /** 本段开火门控（true = 本段不开火；meleeSwing/rangedShot 消费） */
  fireHold = false;

  // ---- 保底攻击参数（构造期从 AI 配置解析一次） ----
  private fbKind: 'none' | 'melee' | 'ranged' | 'suicide' = 'none';
  private fbRadius = 3;
  private fbRange = 1.8;
  private fbDamage = 8;
  private fbSpeed = 26;
  private fbLifetime = 2.4;
  private fbAim = 0;
  private fbMuzzle = 0;
  private fbSpread = 0.05;
  private fbSkin = 'arrow';
  private fbCd = 0;

  // ---- 眩晕 ----
  private stunUntil = 0;
  private stunImmuneUntil = 0;
  /** 眩晕时长（秒）/ 眩晕结束后的免疫时长（秒）——防连续锁死 */
  private static readonly STUN_SECONDS = 1.0;
  private static readonly STUN_IMMUNE_AFTER = 2.0;

  /** 是否眩晕中（祖宗激光；眩晕期间 AI 完全停摆） */
  get isStunned(): boolean {
    return performance.now() / 1000 < this.stunUntil;
  }

  /** ★ 每帧：执行层（原子覆盖移动 + 开火门控）→ 保底攻击（顺序与原实现一致） */
  tick(entity: EnemyBase, dt: number, ctx: BehaviorContext): void {
    this.applyDirectiveAtoms(entity, dt, ctx);
    this.fallbackAttack(entity, dt, ctx);
  }

  /** ★ 施加眩晕（祖宗激光命中）：免疫期内/已死亡 → 不生效。
   *  眩晕同时打断当前挥击（可读性：被打断即中止）。返回是否实际眩晕。 */
  applyStun(entity: EnemyBase): boolean {
    const now = performance.now() / 1000;
    if (entity.hp <= 0 || now < this.stunImmuneUntil) return false;
    this.stunUntil = now + EnemyBrain.STUN_SECONDS;
    this.stunImmuneUntil = now + EnemyBrain.STUN_SECONDS + EnemyBrain.STUN_IMMUNE_AFTER;
    entity.aiAttackTimer = 0; // 打断当前挥击
    entity.aiSwingDone = true;
    return true;
  }

  /** ★ 解析保底攻击参数（构造期一次；从 AI 配置的 inRange 转移 + 攻击行为取值） */
  parse(entity: EnemyBase, cfg: AIConfig): void {
    // ★ 标签兜底：自爆单位即使 AI 没配 selfDestruct 也保底自爆
    if (entity.suicide) this.fbKind = 'suicide';
    for (const st of Object.values(cfg.states)) {
      for (const tr of st.transitions) {
        if (tr.cond === 'inRange' && tr.params?.radius !== undefined) {
          this.fbRange = Number(tr.params.radius);
        }
      }
    }
    for (const st of Object.values(cfg.states)) {
      for (const b of st.behaviors) {
        const p = b.params ?? {};
        if (b.name === 'meleeSwing') {
          this.fbKind = 'melee';
          this.fbDamage = Number(p.damage ?? 8);
          if (p.range !== undefined) this.fbRange = Math.max(this.fbRange, Number(p.range));
          return;
        }
        if (b.name === 'selfDestruct') {
          this.fbKind = 'suicide';
          this.fbDamage = Number(p.damage ?? 26);
          this.fbRadius = Number(p.radius ?? 3);
          return;
        }
        if (b.name === 'rangedShot') {
          this.fbKind = 'ranged';
          // ★ 远程保底射程：不小于视野保底（先手开火，而非等到 AI inRange 的 9~10m）
          this.fbRange = Math.max(this.fbRange, ENEMY_ENGAGE_FLOOR);
          this.fbDamage = Number(p.damage ?? 8);
          this.fbSpeed = Number(p.speed ?? 26);
          this.fbLifetime = Number(p.lifetime ?? 2.4);
          this.fbAim = Number(p.aimHeight ?? 0);
          this.fbMuzzle = Number(p.muzzleHeight ?? 0);
          this.fbSpread = Number(p.spread ?? 0.05);
          this.fbSkin = String(p.skin ?? 'arrow');
          return;
        }
      }
    }
  }

  /** ★ 本地目标解析：候选列表（祖宗/舰船/玩家/友军）中第一个在保底射程内的 → `ctx.target` 兜底。
   *  ★ 不依赖状态机是否评估过 seePlayer（patrol minStay 期间 ctx.target 可能为空）。 */
  private resolveLocalTarget(entity: EnemyBase, ctx: BehaviorContext): { x: number; z: number } | null {
    const cands = ctx.targetCandidates?.(entity);
    if (cands && cands.length > 0) {
      const r2 = this.fbRange * this.fbRange;
      for (const c of cands) {
        const d2 = (c.x - entity.position.x) ** 2 + (c.z - entity.position.z) ** 2;
        if (d2 <= r2) return c;
      }
    }
    return ctx.target;
  }

  /** ★ 保底攻击：本段开火掷为真（fireHold=false）+ 状态机未在 attack → 目标在射程内直接开火。
   *  命令优先由开火掷体现（禁火段不打）——不再“有指令就彻底不打”。 */
  private fallbackAttack(entity: EnemyBase, dt: number, ctx: BehaviorContext): void {
    if (this.fbKind === 'none') return;
    this.fbCd -= dt;
    if (this.fbCd > 0) return;
    if (this.fireHold) return;                                  // ★ 执行层开火掷为假 → 本段不开火
    if (entity.aiStateMachine?.currentState === 'attack') return; // 状态机在打 → 让位（防双开火）
    const t = this.resolveLocalTarget(entity, ctx);
    if (!t) return;
    const d = Math.hypot(t.x - entity.position.x, t.z - entity.position.z);
    if (d > this.fbRange) return;
    // ★ 远距 = 掩护性零星散射（慢 + 大散布）；近距（<20m）= 疯狂精准（统一节拍表）
    const prof = fireProfile(d);
    this.fbCd = prof.cd;
    if (this.fbKind === 'suicide') {
      // ★ 自爆保底：范围爆炸 + 自身死亡（与 selfDestruct 行为同口径）
      ctx.attack({
        type: 'aoe',
        source: entity,
        x: entity.position.x,
        y: entity.position.y + 0.8,
        z: entity.position.z,
        radius: this.fbRadius,
        damage: this.fbDamage,
        camp: 'enemy',
      });
      entity.onDeath(null);
      return;
    }
    if (this.fbKind === 'melee') {
      ctx.attack({
        type: 'melee',
        source: entity,
        x: entity.position.x,
        y: entity.position.y + 1.0,
        z: entity.position.z,
        range: this.fbRange,
        damage: this.fbDamage,
        camp: 'enemy',
      });
      return;
    }
    // 远程：真弹道（与 rangedShot 同构：出膛点/瞄准点/散布/出膛前移）
    const ox = entity.position.x;
    const oy = entity.hitAnchorY() + this.fbMuzzle;
    const oz = entity.position.z;
    const ty = (ctx.focusY ?? entity.hitAnchorY()) + this.fbAim;
    let dx = t.x - ox, dy = ty - oy, dz = t.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const sp = prof.spread;
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
    const muzzle = 0.7;
    ctx.attack({
      type: 'projectile',
      source: entity,
      x: ox + dx * muzzle, y: oy + dy * muzzle, z: oz + dz * muzzle,
      dirX: dx, dirY: dy, dirZ: dz,
      speed: this.fbSpeed, camp: 'enemy', lifetime: this.fbLifetime,
      damage: this.fbDamage, bulletSkin: this.fbSkin,
    });
  }

  /** ★ 执行层（§5.13）：指令活跃 → 原子掷覆盖移动 + 开火门控（危险地形绕行仍生效） */
  private applyDirectiveAtoms(entity: EnemyBase, dt: number, ctx: BehaviorContext): void {
    const now = performance.now() / 1000;
    const dk = entity.directiveKind;
    // 无指令 / 指令过期 → 回落本地自主（旧行为）
    if (dk === 'none' || !(entity.directiveUntil === 0 || now < entity.directiveUntil)) {
      this.atomMove = 255;         // 无指令 → 本地自主（旧行为）
      this.fireHold = false;
      entity.directiveSpeedMul = 1;
      return;
    }
    const t = this.resolveLocalTarget(entity, ctx);
    const dist = t ? Math.hypot(t.x - entity.position.x, t.z - entity.position.z) : 0;
    const range = this.fbRange > 0 ? this.fbRange : (entity.attackType === 'ranged' ? 12 : 2.2);
    // ★ 统一决策内核（与代理同一份：指令×命令×角色×情境 → 两层掷 → 原子/开火）
    runDirective(this.atoms, entity.swarmUid, now, dk, entity.orderKind,
      roleBucket(entity.role), entity.directiveSeq, {
        dist, range,
        hpRatio: entity.maxHp > 0 ? entity.hp / entity.maxHp : 1,
        flash: 0,                  // 实体受击时间戳后续接入
        hasTarget: !!t,
        firePolicy: entity.directiveFire,
      }, _run);
    this.atomMove = _run.moveIdx;
    this.fireHold = !_run.fire;
    // 方向：指令目标点 > 当前目标 > 不移动
    let tx = 0, tz = 0;
    const dtx = entity.directiveTargetX - entity.position.x;
    const dtz = entity.directiveTargetZ - entity.position.z;
    const td = Math.hypot(dtx, dtz);
    if (td > 0.5) { tx = dtx / td; tz = dtz / td; }
    else if (t && dist > 1e-3) { tx = (t.x - entity.position.x) / dist; tz = (t.z - entity.position.z) / dist; }
    if (tx !== 0 || tz !== 0) {
      atomDirection(MOVE_ATOMS[_run.moveIdx], tx, tz, _atomDir);
      if (_atomDir.x !== 0 || _atomDir.z !== 0) {
        // 近似基础速度（2.5 m/s；精确移速后续配置化）× 指令限速
        entity.moveBy(_atomDir.x, _atomDir.z, dt, 2.5 * entity.directiveSpeedMul);
      }
    }
  }
}
