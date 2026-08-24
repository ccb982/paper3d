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

/** ★ 手感规则表（唯一的调参入口；hitstop=顿帧秒数 scale=时间缩放 camKick=镜头冲击） */
const FEEL = {
  normalHit:  { hitstop: 0.04, scale: 0.10, camKick: 0.06 },
  critHit:    { hitstop: 0.09, scale: 0.02, camKick: 0.16 },
  killEnemy:  { hitstop: 0.11, scale: 0.00, camKick: 0.22 },
  playerHurt: { hitstop: 0.06, scale: 0.05, camKick: 0.12 },
};

interface DamagePayload {
  target: EntityBase;
  damage: number;
  crit: boolean;
  dodged: boolean;
  blocked: boolean;
}

export class CombatDirector {
  private unsubs: (() => void)[] = [];

  constructor(private camera: CameraController | null) {
    this.unsubs.push(eventBus.on('damage', (p) => this.onDamage(p)));
    this.unsubs.push(eventBus.on('killed', (p) => this.onKilled(p.target)));
  }

  private onDamage(p: DamagePayload): void {
    if (p.dodged) return; // 闪避 = 完全落空，无打击反馈（浮动文字已有 Miss）
    const isPlayer = p.target.entity.kind === 'player';
    const r = isPlayer ? FEEL.playerHurt : p.crit ? FEEL.critHit : FEEL.normalHit;
    renderManager.hitstop(r.hitstop, r.scale);
    this.camera?.addKick(r.camKick);
    this.playSfx(isPlayer ? 'hurt' : p.crit ? 'crit' : 'hit');
  }

  private onKilled(target: EntityBase): void {
    if (target.entity.kind === 'player') return; // 玩家死亡走自己的结算演出
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
