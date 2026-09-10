// ============================================================
// AmmoStore —— 弹药池（战斗道具播放 · 弹药类）
// ============================================================
// 数据：session.player.ammo: Record<ammoType, number>（跨场保留）。
// 弹药包使用 → ItemEffect 'ammo' 入池；玩家开火 → tryFire() 出池；
// 池空 → 拒发（HUD 红色脉冲提示）。"按子弹处理" = 纯数值 + HUD，无实体。
// ============================================================

import type { GameSession } from '../../core/Session';

export const DEFAULT_AMMO_TYPE = 'default';

export class AmmoStore {
  constructor(private session: GameSession) {
    this.ensure();
  }

  private ensure(): void {
    if (!this.session.player) return;
    if (!this.session.player.ammo || typeof this.session.player.ammo !== 'object') {
      this.session.player.ammo = {};
    }
  }

  /** 当前弹药数（某弹药类型） */
  getCount(ammoType = DEFAULT_AMMO_TYPE): number {
    this.ensure();
    return this.session.player.ammo?.[ammoType] ?? 0;
  }

  /** 入池（弹药包等补给效果调用；ItemEffect 侧直接写也行） */
  add(ammoType = DEFAULT_AMMO_TYPE, count: number): void {
    if (count <= 0) return;
    this.ensure();
    this.session.player.ammo[ammoType] = (this.session.player.ammo[ammoType] ?? 0) + count;
  }

  /** 出池（开火消耗）：不足返回 false（调用方拒发） */
  tryFire(ammoType = DEFAULT_AMMO_TYPE, cost = 1): boolean {
    this.ensure();
    const cur = this.session.player.ammo[ammoType] ?? 0;
    if (cur < cost) return false;
    this.session.player.ammo[ammoType] = cur - cost;
    return true;
  }
}