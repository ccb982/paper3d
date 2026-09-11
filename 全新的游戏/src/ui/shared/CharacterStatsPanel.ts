// ============================================================
// CharacterStatsPanel —— 角色属性栏（背包面板左栏；橘色方舟风）
// ============================================================
// 纯渲染组件：数据由调用方组装成快照（WorldUIManager 打开背包时算一次）。
//   · 属性对比：基础 → 最终（遗物加成后）；有加成时最终值橘色高亮
//   · 实时生命：updateHp(hp, maxHp) 由调用方每帧喂（仅面板打开时写 DOM）
//   · 遗物列表：图标（ItemIconRegistry）+ 件数 + 描述
// ============================================================

import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

/** 遗物展示条目 */
export interface RelicEntry {
  id: string;
  name: string;
  count: number;
  /** 多帧图标帧号（RELIC_ITEM_CONFIG.iconFrame(count)） */
  iconFrame: number;
  description: string;
}

/** 角色属性快照（打开面板时组装；局内天数/死亡/遗物不变） */
export interface StatTriple {
  maxHp: number;
  attackPower: number;
  defense: number;
}

export interface CharacterStatsSnapshot {
  /** 基础（session.player 原始） */
  base: StatTriple;
  /** 永久（基础 + 遗物加成；computeCombatStats） */
  perm: StatTriple;
  /** 局内装备临时加成（出击槽装备 stats 之和） */
  temp: StatTriple;
  /** 当前实际（perm + temp） */
  current: StatTriple;
  day: number;
  deaths: number;
  relics: RelicEntry[];
}

const ORANGE = '#f0a24a';
const ORANGE_BRIGHT = '#ffc06a';
const ORANGE_DIM = 'rgba(240,162,74,0.55)';
/** 局内装备临时加成色（青） */
const TEMP = '#7fd4ff';
const TEXT_DIM = '#b9a58c';

export class CharacterStatsPanel {
  private hpText: HTMLDivElement | null = null;
  private hpFill: HTMLDivElement | null = null;

  /** 组装属性栏（挂到 root；调用方可每帧 updateHp 刷实时血） */
  render(root: HTMLElement, snapshot: CharacterStatsSnapshot, iconRegistry: ItemIconRegistry): void {
    root.innerHTML = '';
    root.style.cssText = [
      'flex:0 0 232px', 'width:232px', 'box-sizing:border-box',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'padding:10px 12px',
      'background:linear-gradient(180deg, rgba(38,25,12,0.96), rgba(22,14,8,0.96))',
      `border:1px solid ${ORANGE_DIM}`, 'border-radius:8px',
      'font-size:12px', 'color:#f2e3d0',
    ].join(';');

    // ---- 标题 ----
    const title = document.createElement('div');
    title.textContent = '角色属性';
    title.style.cssText = [
      `color:${ORANGE_BRIGHT}`, 'font-weight:bold', 'font-size:13px',
      'letter-spacing:1px', 'font-style:italic',
      `border-bottom:1px solid ${ORANGE_DIM}`, 'padding-bottom:6px',
    ].join(';');
    root.appendChild(title);

    // ---- 生命（实时）----
    const hpRow = this.statRow('生命');
    const hpValue = document.createElement('div');
    hpValue.style.cssText = `color:${ORANGE_BRIGHT};font-weight:bold;`;
    this.hpText = hpValue;
    hpRow.value.appendChild(hpValue);
    root.appendChild(hpRow.el);
    const bar = document.createElement('div');
    bar.style.cssText = 'height:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(240,162,74,0.35);border-radius:3px;overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:100%;background:linear-gradient(180deg,${ORANGE_BRIGHT},#d97d24);`;
    bar.appendChild(fill);
    this.    hpFill = fill;
    root.appendChild(bar);
    this.updateHp(snapshot.current.maxHp, snapshot.current.maxHp);

    // ---- 数值属性（直接显示叠加遗物后的永久值；局内装备临时用青色 +N 标注）----
    root.appendChild(this.statRowComp('生命上限', snapshot.perm.maxHp, snapshot.current.maxHp).el);
    root.appendChild(this.statRowComp('攻击力', snapshot.perm.attackPower, snapshot.current.attackPower).el);
    root.appendChild(this.statRowComp('防御', snapshot.perm.defense, snapshot.current.defense).el);
    // 图例：青色 = 局内装备临时（会随穿脱消失）
    const legend = document.createElement('div');
    legend.style.cssText = `color:${TEXT_DIM};font-size:10px;`;
    legend.innerHTML = `已含遗物永久加成；<span style="color:${TEMP}">+N</span> 为局内装备临时（卸载消失）`;
    root.appendChild(legend);

    // ---- 局内进度 ----
    const sep = document.createElement('div');
    sep.style.cssText = `border-top:1px solid ${ORANGE_DIM};margin:2px 0;`;
    root.appendChild(sep);
    root.appendChild(this.plainRow('天数', String(snapshot.day)));
    root.appendChild(this.plainRow('累计死亡', String(snapshot.deaths)));

    // ---- 遗物 ----
    const relicTitle = document.createElement('div');
    relicTitle.textContent = '遗物';
    relicTitle.style.cssText = [
      `color:${ORANGE_BRIGHT}`, 'font-weight:bold', 'font-style:italic',
      `border-bottom:1px solid ${ORANGE_DIM}`, 'padding-bottom:4px', 'margin-top:2px',
    ].join(';');
    root.appendChild(relicTitle);
    if (snapshot.relics.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '尚未拥有遗物';
      empty.style.cssText = `color:${TEXT_DIM};`;
      root.appendChild(empty);
    } else {
      for (const r of snapshot.relics) {
        root.appendChild(this.relicRow(r, iconRegistry));
      }
    }
  }

  /** 实时生命刷新（面板打开时每帧调用；无 DOM 写入时也零分配） */
  updateHp(hp: number, maxHp: number): void {
    const h = Math.max(0, Math.min(maxHp, hp));
    if (this.hpText) this.hpText.textContent = `${Math.ceil(h)} / ${Math.ceil(maxHp)}`;
    if (this.hpFill) this.hpFill.style.width = `${maxHp > 0 ? (h / maxHp) * 100 : 0}%`;
  }

  /** 单行基础结构：左标签 + 右值容器 */
  private statRow(label: string): { el: HTMLDivElement; value: HTMLDivElement } {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = `color:${TEXT_DIM};`;
    const value = document.createElement('div');
    el.appendChild(l);
    el.appendChild(value);
    return { el, value };
  }

  /** 直接显示叠加遗物后的永久值；局内装备临时追加青色 `+N = 当前` */
  private statRowComp(label: string, perm: number, current: number): { el: HTMLDivElement } {
    const row = this.statRow(label);
    const p = document.createElement('span');
    p.textContent = String(perm);
    p.style.cssText = 'color:#f2e3d0;font-weight:bold;';
    row.value.appendChild(p);
    const temp = current - perm;
    if (temp > 0) {
      const t = document.createElement('span');
      t.textContent = ` +${temp}`;
      t.style.cssText = `color:${TEMP};font-weight:bold;`;
      row.value.appendChild(t);
      const c = document.createElement('span');
      c.textContent = ` = ${current}`;
      c.style.cssText = 'color:#e8f6ff;font-weight:bold;';
      row.value.appendChild(c);
    }
    return { el: row.el };
  }

  private plainRow(label: string, value: string): HTMLDivElement {
    const row = this.statRow(label);
    const v = document.createElement('span');
    v.textContent = value;
    v.style.cssText = `color:${ORANGE_BRIGHT};font-weight:bold;`;
    row.value.appendChild(v);
    return row.el;
  }

  /** 遗物行：图标 + 名称×件数 + 描述 */
  private relicRow(r: RelicEntry, iconRegistry: ItemIconRegistry): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:5px 7px', `background:${'rgba(240,162,74,0.08)'}`,
      `border:1px solid rgba(240,162,74,0.30)`, 'border-radius:5px',
    ].join(';');
    const iconBox = document.createElement('div');
    iconBox.style.cssText = [
      'width:32px', 'height:32px', 'flex:none', 'display:flex',
      'align-items:center', 'justify-content:center',
      'background:rgba(12,10,6,0.8)', `border:1px solid ${ORANGE_DIM}`,
      'border-radius:5px', 'overflow:hidden',
    ].join(';');
    try {
      const icon = iconRegistry.createIconElement(r.id, r.iconFrame);
      icon.style.width = '100%';
      icon.style.height = '100%';
      icon.style.objectFit = 'contain';
      iconBox.appendChild(icon);
    } catch {
      iconBox.textContent = r.name.slice(0, 2);
    }
    row.appendChild(iconBox);
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';
    const name = document.createElement('div');
    name.textContent = `${r.name} ×${r.count}`;
    name.style.cssText = `color:${ORANGE_BRIGHT};font-weight:bold;`;
    const desc = document.createElement('div');
    desc.textContent = r.description;
    desc.style.cssText = `color:${TEXT_DIM};font-size:11px;margin-top:2px;line-height:1.35;`;
    text.appendChild(name);
    text.appendChild(desc);
    row.appendChild(text);
    return row;
  }
}
