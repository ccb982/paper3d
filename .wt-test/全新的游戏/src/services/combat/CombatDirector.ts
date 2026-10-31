// ============================================================
// CombatDirector —— 战斗导演（战斗手感的唯一编排者）
// ============================================================
// ⚠️ 边界红线（违反即架构腐化）：
//   - 只听事件、只出表现：不碰伤害数值、不持有血量、不知道敌人 AI
//     ——战斗逻辑归 DamagePipeline/BulletEntity，本类是纯事件消费者
//   - 所有手感强度集中在 FEEL 规则表：调参不翻逻辑，新武器/技能
//     永远不写特效代码，只加配置行
//
// 效果通道：
//   时间 → renderManager.hitstop()   全局顿帧（时间归渲染管理器管）
//   镜头 → camera.addKick()          冲击晃动（指数衰减冲量）
//   粒子 → 复用子弹命中特效（BulletManager.attachHitEffect 已挂）
//   音频 → playSfx 占位钩子           音频系统未来的接入点
// ============================================================

import { eventBus } from '../../core/EventBus';
import { renderManager } from '../render/RenderManager';
import type { CameraController } from '../camera/CameraController';
import type { EntityBase } from '../../entity/EntityBase';

/** ★ 手感规则表（唯一的调参入口；hitstop=顿帧秒数 scale=时间缩放 camKick=镜头冲击）
 *  ★ 2026-09-11：命中/击杀镜头抖动过强 → camKick 整体下调（约原值 40%）
 *  ★ 2026-09-13（用户定调）：大批量敌人下镜头摇晃影响操作 →
 *    · 命中反馈再削（camKick ≈ 减半）
 *    · 友军（无人机/祖宗）击中/击杀敌人 → 完全无反馈
 *    · 仅玩家来源的命中/击杀有反馈；玩家受击不变 */
const FEEL = {
  normalHit:  { hitstop: 0.03, scale: 0.12, camKick: 0.012 },
  critHit:    { hitstop: 0.06, scale: 0.05, camKick: 0.03 },
  killEnemy:  { hitstop: 0.08, scale: 0.00, camKick: 0.045 },
  playerHurt: { hitstop: 0.06, scale: 0.05, camKick: 0.05 },
};

interface DamagePayload {
  target: EntityBase;
  /** ★ 伤害来源（玩家方子弹 camp='player' / 友军 'ally' / 敌人 'enemy'；可为 null） */
  source: EntityBase | null;
  damage: number;
  crit: boolean;
  dodged: boolean;
  blocked: boolean;
}

export class CombatDirector {
  private unsubs: (() => void)[] = [];

  constructor(private camera: CameraController | null) {
    this.unsubs.push(eventBus.on('damage', (p) => this.onDamage(p)));
    this.unsubs.push(eventBus.on('killed', (p) => this.onKilled(p.target, p.source)));
  }

  private onDamage(p: DamagePayload): void {
    if (p.dodged) return; // 闪避 = 完全落空，无打击反馈（浮动文字已有 Miss）
    if (p.target.entity.kind === 'ship') return; // ★ 舰船受击不走打击手感（防持续 hitstop）
    // 玩家受击：任何来源都保留（且强度不变）
    if (p.target.entity.kind === 'player') {
      const r = FEEL.playerHurt;
      renderManager.hitstop(r.hitstop, r.scale);
      this.camera?.addKick(r.camKick);
      this.playSfx('hurt');
      return;
    }
    // ★ 非玩家目标：只有玩家来源才有打击反馈（友军击中 / 敌方互击 → 无反馈）
    if (p.source?.camp !== 'player') return;
    const r = p.crit ? FEEL.critHit : FEEL.normalHit;
    renderManager.hitstop(r.hitstop, r.scale);
    this.camera?.addKick(r.camKick);
    this.playSfx(p.crit ? 'crit' : 'hit');
  }

  private onKilled(target: EntityBase, source: EntityBase | null): void {
    if (target.entity.kind === 'player') return; // 玩家死亡走自己的结算演出
    // ★ 只有玩家来源的击杀才有反馈（友军击杀无反馈；环境死亡同样静默）
    if (source?.camp !== 'player') return;
    const r = FEEL.killEnemy;
    renderManager.hitstop(r.hitstop, r.scale);
    this.camera?.addKick(r.camKick);
    this.playSfx('kill');
  }

  /** 音频钩子（占位）：音频系统落地后在此接 WebAdapter.playSfx */
  private playSfx(_name: string): void {}

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
