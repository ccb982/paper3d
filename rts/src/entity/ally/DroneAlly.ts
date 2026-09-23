// ============================================================
// DroneAlly —— 飞天跟随友军（原 DroneEntity 的无人机段）
// ============================================================
// follow（跟随玩家侧上方）→ 周期锁定此刻距离最近的敌人 →
// approach（攻击范围小 → 飞到敌人身边）→ attack（贴脸近战挥击）→
// 目标被击倒 或 与玩家距离非常远 → return（返回玩家）→ 重新锁定。
// 复用 AirAlly 的 3D 平滑追踪 + AllyBase 的世界端口/光束。
// ============================================================

import { AirAlly } from './AirAlly';

/** ★ 无人机战斗参数（可调） */
const LOCK_RANGE = 12;      // 锁定最近敌人的搜索半径（米，绕玩家）
const ATTACK_RANGE = 3.6;   // 攻击范围（米；攻击范围小 → 必须贴脸）
const RETURN_DIST = 30;     // 与玩家距离非常远 → 强制返回（米）
const RETURN_OK_DIST = 2.5; // 返回至多近算归队（米）
const ATTACK_CD = 1.2;      // 挥击冷却（秒）
/** ★ 无人机伤害 = max(下限, 主人攻击力 × 系数)（攻击瞬间 queryFinalStats(owner) 实时查询） */
const DRONE_MIN_DAMAGE = 12;
const DRONE_ATK_RATIO = 1.0;
/** ★ 攻击瞄准高度：敌人身体（脚部 + 0.9m 躯干）由 AllyBase 统一 */

export class DroneAlly extends AirAlly {
  /** 当前 AI 状态（调试/表现可读） */
  aiState: 'follow' | 'approach' | 'attack' | 'return' = 'follow';

  protected think(dt: number): void {
    const p = this.entity.position;
    const distPlayer = Math.hypot(p.x - this.playerPos.x, p.z - this.playerPos.z);

    // ★ 强制返回：与玩家距离非常远（任意非 follow 状态都触发）
    if (this.aiState !== 'follow' && distPlayer > RETURN_DIST) {
      this.aiState = 'return';
      this.target = null;
    }

    switch (this.aiState) {
      case 'follow': {
        // 跟随玩家侧上方
        this.moveTo(dt, this.followTarget.x, this.followTarget.y, this.followTarget.z, 6);
        // 周期扫描：锁定此刻距离最近的敌人
        this.relockTimer -= dt;
        if (this.relockTimer <= 0) {
          this.relockTimer = 0.4;
          const t = this.findNearestEnemy(LOCK_RANGE);
          if (t) { this.target = t; this.aiState = 'approach'; }
        }
        break;
      }
      case 'approach': {
        const t = this.target;
        if (!this.targetAlive(t)) { this.target = null; this.aiState = 'follow'; break; }
        const dx = p.x - t!.position.x, dz = p.z - t!.position.z;
        if (Math.hypot(dx, dz) <= ATTACK_RANGE) { this.aiState = 'attack'; break; }
        // ★ 悬停高度 = 敌人身体（脚部 + 0.9），水平飞近，不俯冲追脚
        this.moveTo(dt, t!.position.x, t!.position.y + 0.9, t!.position.z, 7);
        break;
      }
      case 'attack': {
        const t = this.target;
        if (!this.targetAlive(t)) { this.target = null; this.aiState = 'return'; break; }
        const dx = p.x - t!.position.x, dz = p.z - t!.position.z;
        const d = Math.hypot(dx, dz);
        // 拉近到攻击圈内（攻击范围小 → 必须贴脸；身体高度）
        if (d > ATTACK_RANGE) {
          this.moveTo(dt, t!.position.x, t!.position.y + 0.9, t!.position.z, 8);
        } else {
          // 圈内：绕目标缓慢环绕（不重叠、不静止；身体高度）
          const a = this.phase * 0.6;
          const ox = t!.position.x + Math.cos(a) * 1.0;
          const oz = t!.position.z + Math.sin(a) * 1.0;
          this.moveTo(dt, ox, t!.position.y + 0.9, oz, 2);
        }
        // 挥击冷却
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          this.attackCd = ATTACK_CD;
          this.swing(t!, ATTACK_RANGE, DRONE_MIN_DAMAGE, DRONE_ATK_RATIO);
        }
        break;
      }
      case 'return': {
        // 返回玩家（目标已死或离玩家太远）；归队后重新锁定
        this.moveTo(dt, this.followTarget.x, this.followTarget.y, this.followTarget.z, 6);
        const dp = Math.hypot(p.x - this.followTarget.x, p.z - this.followTarget.z);
        if (dp < RETURN_OK_DIST || distPlayer < RETURN_OK_DIST) this.aiState = 'follow';
        break;
      }
    }
  }

  /** 影子：无人机悬浮，给一个小的地面投影剪影（主体轮廓） */
  protected override get shadowShape(): { w: number; h?: number; alpha?: number } | null {
    return { w: 1.1, h: 0.7, alpha: 0.32 };
  }
}
