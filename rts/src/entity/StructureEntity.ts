// ============================================================
// StructureEntity —— 工事实体基类（EntityBase 子类；《RTS架构.md》§1.3）
// ============================================================
// 定位（《RTS架构.md》§8）：固定刚体 + 可被 applyDamage + 不参与 AI/编队/存档。
// ★ 不发出通用 `killed` 事件：工事被摧毁不参与击杀统计/遗物 onKill（只发 damage 反馈）。
// 通行/阵营：camp 决定子弹命中过滤（同队免伤）；passFaction 掩码由玩法层使用（§22.3）。
// ============================================================

import type * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';

export interface StructureOptions extends Omit<EntityBaseOptions, 'kind' | 'asset'> {
  /** 阵营（决定子弹命中过滤；缺省 = enemy） */
  camp?: 'player' | 'enemy' | 'neutral';
  /** 生命值（缺省 100；走既有 applyDamage 口径） */
  hp?: number;
  /** 防御（减法减伤） */
  defense?: number;
}

export abstract class StructureEntity extends EntityBase {
  /** ★ 建造进度（0→1；插值长高由渲染器消费；1 = 成型） */
  buildProgress = 1;

  constructor(em: EntityManager, opts: StructureOptions) {
    super(em, { ...opts, kind: 'decoration' });
    this.camp = opts.camp ?? 'enemy';
    this.hp = opts.hp ?? 100;
    this.maxHp = this.hp;
    this.defense = opts.defense ?? 0;
  }

  /** ★ 伤害入口覆写：只扣血 → 0 走 onDeath；**不发 killed 事件**（工事不是击杀） */
  override onTakeDamage(dmg: number, source: EntityBase | null, hitPoint?: { x: number; y: number; z?: number }): void {
    if (this.hp <= 0) return;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.onDeath(source);
    }
    void hitPoint; // 工事无受击染料/命中表现（碎块后续可加）
  }

  /** 工事不上贴片渲染：只画附属特效（血条）；几何由渲染器常驻（位置在 present 同步） */
  override render(camera: THREE.Camera): void {
    if (!this.visible) return;
    this.renderEffects(camera);
  }

  /** 小地图：工事默认不显示（避免把地图画满） */
  override get minimapInfo(): { kind: string; moving: boolean; hideOnMap?: boolean } {
    return { kind: this.entity.kind, moving: false, hideOnMap: true };
  }
}
