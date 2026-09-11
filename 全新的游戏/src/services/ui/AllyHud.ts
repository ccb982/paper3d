// ============================================================
// AllyHud —— 左侧友军编队列表（明日方舟风：头像 + 血条）
// ============================================================
// 数据 = WorldUIState.allies（WorldMode 每帧从编队实体构造）；
// 只做表现：按 id diff 复用行节点，逐帧仅改血条宽度/颜色与数字。
// 视觉（方舟风）：
//   · 深色斜切卡片（右缘切角）+ 金色左描边；
//   · 方框金边像素头像（复用 ItemIconRegistry）；
//   · 细血条（浅绿→深绿渐变、白描边）；低血量（≤35%）转红并呼吸闪烁；
//   · 编队槽号角标（slot 有效时显示 1-based 序号）。
// ============================================================

import type { ItemManager } from '../../systems/inventory/ItemManager';
import { ItemIconRegistry } from '../item/ItemIconRegistry';
import { eventBus } from '../../core/EventBus';

export interface AllyHudEntry {
  /** 稳定身份（编队实体 entity.id，帧间不变） */
  id: string;
  itemId: string;
  hp: number;
  maxHp: number;
  /** 出击槽位（-1 = 道具召唤不入槽；≥0 显示 1-based 角标） */
  slot?: number;
}

interface Row {
  el: HTMLDivElement;
  fill: HTMLDivElement;
  hpText: HTMLDivElement;
  /** 槽号角标（左下序号；仅该行槽位值变化时重算） */
  badge: HTMLDivElement;
  /** 上一次写入的槽位（差值同步依据；-1 = 不入槽） */
  lastSlot: number;
}

export class AllyHud {
  private root: HTMLDivElement;
  private rows = new Map<string, Row>();
  private iconRegistry: ItemIconRegistry;
  /** 待播放的装备变动闪效槽位（deployment_changed 事件驱动；每帧应用一次即清，绝不会循环闪） */
  private flashSlots = new Set<number>();
  private flashUnsub: (() => void) | null = null;
  /** 上一帧列表是否为空（构造时为 true）→ 空→有行 = 入场，播一次进入动画 */
  private lastWasEmpty = true;

  constructor(private itemManager: ItemManager) {
    this.iconRegistry = new ItemIconRegistry(itemManager);
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:8px', 'top:206px', 'z-index:40',
      // ★ 两列 × 六行：column 自动流 → 槽位号自上而下、每列 6 个（列1 = 槽1-6，列2 = 槽7-12）
      'display:grid', 'grid-auto-flow:column', 'grid-auto-columns:172px',
      'grid-template-rows:repeat(6,auto)', 'gap:6px 8px',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.root);
    // ★ 出击槽位变动（拖入/拖出/互换）→ 一次性角标弹跳 + 卡片亮闪（仅真实变动，不会每帧循环）
    //   ★ 静态 import 同步注册（动态 import().then 可能在 dispose 之后才挂载 → 订阅泄漏）
    this.flashUnsub = eventBus.on('deployment_changed', (payload) => {
      this.flashSlots.add(payload.slotIndex);
    });
  }

  /** 每帧：按 id 增删/排序行，刷新血条与数值（低血量呼吸） */
  update(allies: AllyHudEntry[]): void {
    // ★ 入场判定：空列表 → 出现行 = 进入地图，该批新建行各播一次入场动画；其余增删不播
    const entering = allies.length > 0 && this.lastWasEmpty;
    // 1) 移除消失的（★ 退场动画：淡出 + 左滑，播完再摘 DOM；换装/换槽后列表不乱跳）
    let dirty = false;
    for (const [id, r] of this.rows) {
      if (!allies.some((a) => a.id === id)) {
        this.rows.delete(id);
        dirty = true;
        const anim = r.el.animate(
          [
            { opacity: '1', transform: 'translateX(0)' },
            { opacity: '0', transform: 'translateX(-14px)' },
          ],
          { duration: 180, easing: 'ease-in' },
        );
        anim.onfinish = () => r.el.remove();
        anim.oncancel = () => r.el.remove();
      }
    }
    // 2) 建行 / 刷新（新行按 allies 顺序追加 → 两列网格按槽位号排布）
    for (const a of allies) {
      let r = this.rows.get(a.id);
      if (!r) {
        r = this.buildRow(a.itemId, a.slot);
        this.rows.set(a.id, r);
        this.root.appendChild(r.el);
        if (entering) this.playEnter(r.el);
        dirty = true;
      }
      // ★ 槽号角标：把"当前条目"的槽位写给它自己的角标；只有槽位值变化时才重算
      //   （进图首帧算一次；槽位交换/拖入/拖出时才变 → 恰好交换时重算，稳态零 DOM 写）
      const slot = a.slot ?? -1;
      if (r.lastSlot !== slot) {
        r.lastSlot = slot;
        r.badge.textContent = String(slot + 1);
        r.badge.style.display = slot >= 0 ? 'block' : 'none';
      }
      // ★ 装备变动动画：事件驱动（deployment_changed），命中该槽位行时播放一次即清
      if (this.flashSlots.delete(slot)) {
        this.playFlash(r);
        // ★ 物品替换：同槽位新行带偏移入场（滑动进入），与亮闪叠加
        this.playEnter(r.el);
      }
      const ratio = a.maxHp > 0 ? Math.max(0, Math.min(1, a.hp / a.maxHp)) : 0;
      const low = ratio <= 0.35;
      r.fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      r.fill.style.background = low
        ? 'linear-gradient(180deg,#ffd9d9,#e05555)'
        : 'linear-gradient(180deg,#eaffd2,#77cf47)';
      // 低血量呼吸（透明度脉冲；正常态恒定 1）
      r.fill.style.opacity = low
        ? (0.6 + 0.4 * Math.abs(Math.sin(performance.now() * 0.006))).toFixed(2)
        : '1';
      r.hpText.textContent = `${Math.ceil(Math.max(0, a.hp))}/${Math.ceil(a.maxHp)}`;
      r.hpText.style.color = low ? '#ff9c9c' : 'rgba(214,226,238,.88)';
    }
    // 3) 仅在有增删当帧收敛一次 DOM 顺序（按 allies 槽位序；稳态零写入，不产生列表级动画）
    if (dirty) {
      for (const a of allies) {
        const r = this.rows.get(a.id);
        if (r) this.root.appendChild(r.el);
      }
    }
    this.flashSlots.clear();
    this.lastWasEmpty = allies.length === 0;
  }

  /** 入场动画：新批同行淡入 + 左侧滑入（进入地图播一次；稳态/替换不播） */
  private playEnter(el: HTMLElement): void {
    el.animate(
      [
        { opacity: '0', transform: 'translateX(-14px)' },
        { opacity: '1', transform: 'translateX(0)' },
      ],
      { duration: 320, easing: 'ease-out' },
    );
  }

  /** 装备变动：角标弹跳缩放 + 卡片金色亮闪（一次性，事件驱动，绝不循环） */
  private playFlash(r: Row): void {
    r.badge.animate(
      [
        { transform: 'scale(1.7)', backgroundColor: '#ffe9a8' },
        { transform: 'scale(1)', backgroundColor: '#f0cf74' },
      ],
      { duration: 200, easing: 'ease-out' },
    );
    r.el.animate(
      [
        { filter: 'brightness(1.8)' },
        { filter: 'brightness(1)' },
      ],
      { duration: 480, easing: 'ease-out' },
    );
  }

  /** 单行：斜切卡片 + 金边头像（含槽号角标）+ 名称/血条/数值 */
  private buildRow(itemId: string, slot?: number): Row {
    const name = this.itemManager.getArchetype(itemId)?.name ?? itemId;

    const el = document.createElement('div');
    el.style.cssText = [
      'width:172px', 'display:flex', 'align-items:center', 'gap:8px',
      'padding:5px 16px 5px 7px', 'box-sizing:border-box',
      'background:linear-gradient(90deg, rgba(9,13,19,0.90) 0%, rgba(9,13,19,0.68) 72%, rgba(9,13,19,0.10) 100%)',
      'border-left:3px solid #f0cf74',
      'box-shadow:0 1px 4px rgba(0,0,0,.45)',
      // 右缘斜切（方舟式卡片）
      'clip-path:polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
    ].join(';');

    // ---- 头像框：金边 + 内阴影 + 像素化图标 ----
    const iconBox = document.createElement('div');
    iconBox.style.cssText = [
      'position:relative', 'flex:0 0 auto', 'width:38px', 'height:38px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#0c1117', 'border:1px solid rgba(240,207,116,.78)',
      'box-shadow:inset 0 0 7px rgba(0,0,0,.85)',
    ].join(';');
    const iconEl = this.iconRegistry.createIconElement(itemId);
    iconEl.style.width = '100%';
    iconEl.style.height = '100%';
    iconEl.style.objectFit = 'contain';
    iconEl.style.imageRendering = 'pixelated';
    iconBox.appendChild(iconEl);
    // ★ 槽号角标：建行即算一次（进入地图/换行时生效；后续仅出击槽变动时重算）
    const badge = document.createElement('div');
    badge.style.cssText = [
      'position:absolute', 'right:-4px', 'bottom:-4px',
      'min-width:14px', 'padding:0 2px', 'box-sizing:border-box',
      'font-size:10px', 'line-height:14px', 'text-align:center',
      'color:#0b0e13', 'background:#f0cf74', 'border-radius:2px',
      'font-weight:bold',
    ].join(';');
    const slotNow = slot ?? -1;
    badge.textContent = String(slotNow + 1);
    badge.style.display = slotNow >= 0 ? 'block' : 'none';
    iconBox.appendChild(badge);

    // ---- 右侧：名称 + 血条 + 数值 ----
    const col = document.createElement('div');
    col.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;gap:3px;min-width:0;';
    const nameEl = document.createElement('div');
    nameEl.textContent = name;
    nameEl.style.cssText = [
      'font-size:11px', 'line-height:1', 'letter-spacing:.5px',
      'color:#d6dee8', 'text-shadow:0 1px 2px rgba(0,0,0,.7)',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';');
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'display:flex;align-items:center;gap:5px;';
    const bar = document.createElement('div');
    bar.style.cssText = [
      'flex:1 1 auto', 'height:7px', 'position:relative', 'overflow:hidden',
      'background:rgba(0,0,0,.66)', 'border:1px solid rgba(255,255,255,.22)',
      'box-sizing:border-box',
    ].join(';');
    const fill = document.createElement('div');
    fill.style.cssText = [
      'position:absolute', 'left:0', 'top:0', 'bottom:0', 'width:100%',
      'background:linear-gradient(180deg,#eaffd2,#77cf47)',
      'transition:width .12s linear',
    ].join(';');
    bar.appendChild(fill);
    const hpText = document.createElement('div');
    hpText.style.cssText = 'flex:0 0 auto;min-width:52px;font-size:10px;line-height:1;text-align:right;';
    barWrap.appendChild(bar);
    barWrap.appendChild(hpText);
    col.appendChild(nameEl);
    col.appendChild(barWrap);

    el.appendChild(iconBox);
    el.appendChild(col);
    const slotNum = slot ?? -1;
    return { el, fill, hpText, badge, lastSlot: slotNum };
  }

  dispose(): void {
    this.flashUnsub?.();
    this.flashUnsub = null;
    this.rows.clear();
    this.root.remove();
  }
}
