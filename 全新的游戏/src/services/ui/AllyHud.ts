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
}

export class AllyHud {
  private root: HTMLDivElement;
  private rows = new Map<string, Row>();
  private iconRegistry: ItemIconRegistry;

  constructor(private itemManager: ItemManager) {
    this.iconRegistry = new ItemIconRegistry(itemManager);
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:8px', 'top:206px', 'z-index:40',
      'display:flex', 'flex-direction:column', 'gap:6px',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.root);
  }

  /** 每帧：按 id 增删/排序行，刷新血条与数值（低血量呼吸） */
  update(allies: AllyHudEntry[]): void {
    // 1) 移除消失的
    for (const [id, r] of this.rows) {
      if (!allies.some((a) => a.id === id)) {
        r.el.remove();
        this.rows.delete(id);
      }
    }
    // 2) 建行 / 刷新（appendChild 把已有节点移到末尾 → 顺序跟随 allies）
    for (const a of allies) {
      let r = this.rows.get(a.id);
      if (!r) {
        r = this.buildRow(a.itemId, a.slot);
        this.rows.set(a.id, r);
      }
      this.root.appendChild(r.el);
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
    if (slot !== undefined && slot >= 0) {
      const badge = document.createElement('div');
      badge.textContent = String(slot + 1);
      badge.style.cssText = [
        'position:absolute', 'right:-4px', 'bottom:-4px',
        'min-width:14px', 'padding:0 2px', 'box-sizing:border-box',
        'font-size:10px', 'line-height:14px', 'text-align:center',
        'color:#0b0e13', 'background:#f0cf74', 'border-radius:2px',
        'font-weight:bold',
      ].join(';');
      iconBox.appendChild(badge);
    }

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
    this.root.appendChild(el);
    return { el, fill, hpText };
  }

  dispose(): void {
    this.rows.clear();
    this.root.remove();
  }
}
