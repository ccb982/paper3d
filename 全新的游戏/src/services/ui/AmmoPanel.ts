// ============================================================
// AmmoPanel —— 左下角弹药栏（真正的弹药类 UI）
// ============================================================
// 数据由 WorldMode 每帧组装（WorldUIState.ammoEntries）：
//   · 显示背包中的可发射弹药类型 + 数量（default = 普通弹药，∞）
//   · 点击切换当前弹药（切换后普通攻击即发射该弹药并消耗）
//   · 选中高亮；数量变化只改文本（DOM diff，稳态零重排）
// ============================================================

import type { ItemManager } from '../../systems/inventory/ItemManager';
import { ItemIconRegistry } from '../item/ItemIconRegistry';

export interface AmmoEntryView {
  id: string;
  name: string;
  /** -1 = 无限（普通弹药） */
  count: number;
  /** 图标物品 id */
  iconId: string;
  selected: boolean;
}

interface RowView {
  el: HTMLDivElement;
  iconBox: HTMLDivElement;
  countEl: HTMLSpanElement;
  iconId: string;
}

export class AmmoPanel {
  private root: HTMLDivElement;
  private rows = new Map<string, RowView>();
  private iconRegistry: ItemIconRegistry;
  private onSelect: ((id: string) => void) | null = null;

  constructor(itemManager: ItemManager) {
    this.iconRegistry = new ItemIconRegistry(itemManager);
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:12px', 'z-index:998',
      // ★ 每列 4 个（column 自动流）：第 1 列自上而下 = 前 4 项，超出向右开新列
      'display:grid', 'grid-auto-flow:column', 'grid-auto-columns:168px',
      'grid-template-rows:repeat(4,auto)', 'gap:4px 6px',
      'pointer-events:auto',
    ].join(';');
    document.body.appendChild(this.root);
  }

  /** 由模式层注入切换回调（点击行 → 切换当前弹药） */
  setSelector(cb: (id: string) => void): void {
    this.onSelect = cb;
  }

  /** ★ 显隐（航行操船期隐藏快捷栏） */
  setVisible(v: boolean): void {
    this.root.style.display = v ? 'grid' : 'none';
  }

  /** 每帧更新（DOM diff：数量/选中态变化才写） */
  update(entries: AmmoEntryView[]): void {
    // 移除消失的类型
    for (const [id, r] of this.rows) {
      if (!entries.some((e) => e.id === id)) {
        r.el.remove();
        this.rows.delete(id);
      }
    }
    for (const e of entries) {
      let r = this.rows.get(e.id);
      if (!r) {
        r = this.buildRow(e);
        this.rows.set(e.id, r);
        this.root.appendChild(r.el);
      }
      // 选中态
      const selected = e.selected;
      r.el.style.background = selected ? 'rgba(60,44,16,0.92)' : 'rgba(9,13,19,0.82)';
      r.el.style.borderLeftColor = selected ? '#ffd87a' : 'rgba(240,207,116,0.45)';
      r.el.style.boxShadow = selected ? '0 0 8px rgba(240,207,116,0.45)' : 'none';
      // 数量
      const text = e.count < 0 ? '∞' : `× ${e.count}`;
      if (r.countEl.textContent !== text) r.countEl.textContent = text;
      r.countEl.style.color = e.count === 0 ? '#ff6666' : selected ? '#ffd87a' : '#d6dee8';
    }
  }

  private buildRow(e: AmmoEntryView): RowView {
    const el = document.createElement('div');
    el.style.cssText = [
      'display:flex', 'align-items:center', 'gap:7px',
      'padding:3px 10px 3px 4px', 'border-left:3px solid rgba(240,207,116,0.45)',
      'background:rgba(9,13,19,0.82)', 'border-radius:2px',
      'cursor:pointer', 'user-select:none',
    ].join(';');
    const iconBox = document.createElement('div');
    iconBox.style.cssText = [
      'position:relative', 'width:26px', 'height:26px', 'flex:none',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#0c1117', 'border:1px solid rgba(240,207,116,.6)',
    ].join(';');
    try {
      const icon = this.iconRegistry.createIconElement(e.iconId);
      icon.style.width = '100%';
      icon.style.height = '100%';
      icon.style.objectFit = 'contain';
      iconBox.appendChild(icon);
    } catch {
      iconBox.textContent = e.name.slice(0, 2);
    }
    el.appendChild(iconBox);
    const name = document.createElement('span');
    name.textContent = e.name;
    name.style.cssText = 'font-size:11px;color:#d6dee8;text-shadow:0 1px 2px rgba(0,0,0,.7);';
    el.appendChild(name);
    const countEl = document.createElement('span');
    countEl.textContent = e.count < 0 ? '∞' : `× ${e.count}`;
    countEl.style.cssText = 'font-size:12px;font-weight:bold;color:#d6dee8;margin-left:4px;';
    el.appendChild(countEl);
    el.addEventListener('click', () => this.onSelect?.(e.id));
    return { el, iconBox, countEl, iconId: e.iconId };
  }

  dispose(): void {
    this.rows.clear();
    this.root.remove();
  }
}
