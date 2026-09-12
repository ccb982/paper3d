// ============================================================
// ship/ShipPanels.ts —— 舰船三个侧边面板（迁移到 Panel 基类）
// ============================================================
// 行动 / 编队 / 干员 三个侧边面板，继承 SidePanel（Panel 基类子类），
// 仍渲染进 panelContainer 固定容器，但获得统一标题栏与生命周期。
// ============================================================

import { SidePanel } from '../panel/SidePanel';
import type { PanelRenderOptions } from '../panel/types';
import type { GameSession } from '../../core/Session';
import { countItemsInGrid } from '../../core/Session';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import { createButton } from '../components/Button';
import { RELIC_ITEM_CONFIG } from '../../config/relics';

// ------------------------------------------------------------
// 行动面板
// ------------------------------------------------------------
export interface ActionPanelProps {
  session: GameSession;
  onDepart?: (() => void) | null;
}

export class ActionPanel extends SidePanel<ActionPanelProps> {
  protected title(): string {
    return '行动准备';
  }

  protected body(): HTMLElement {
    const s = this.props.session;
    const ship = s.ship;
    const inv = s.inventories;

    const div = document.createElement('div');
    div.innerHTML = `
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>📅 第 ${s.meta.day} 天</div>
        <div>🚢 舰船: HP ${ship.hp}/${ship.maxHp} | 护盾 ${ship.shield} | 装甲 ${ship.armor} | 油量 ${Math.ceil(ship.fuel ?? 0)}/${ship.fuelMax ?? 60}</div>
        <div>🛡 炮塔: ${ship.turrets.length} 座</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🎒 背包状态:</div>
        <div>  基地仓库: ${countItemsInGrid(inv.base)} 件</div>
        <div>  飞船仓库: ${countItemsInGrid(inv.ship)} 件</div>
        <div>  玩家背包: ${countItemsInGrid(inv.player)} 件</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>💠 遗物: ${Object.keys(s.outOfRun?.owned ?? {}).length} 种 | 💀 累计死亡: ${s.meta?.deaths ?? 0} 次</div>
        <div>🎰 抽卡保底: ${s.gacha.pityCounter} 抽</div>
      </div>
    `;

    if (s.dayProgress.hasDepartedToday) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#fa4;padding:8px;background:rgba(255,170,68,0.15);border-radius:4px;margin-bottom:12px;';
      msg.textContent = '今日已出击，休息等明天吧';
      div.appendChild(msg);
    } else {
      const departBtn = createButton({
        label: '🚀 出击', size: 'lg', fullWidth: true,
        onClick: () => this.props.onDepart?.(),
      });
      departBtn.style.background = '#4488ff';
      div.appendChild(departBtn);
    }
    return div;
  }
}

// ------------------------------------------------------------
// （编队面板已废弃：2026-09-12 用户定调——点击"编队"直接打开完整背包页，
//   出击槽在背包页内；原侧边面板与合成台入口一并移除）
// ------------------------------------------------------------

// ------------------------------------------------------------
// 遗物管理面板（承接原"干员"按钮位；旧的干员招募/藏品代码已彻底废弃）
// 遗物 = 原"藏品/局外道具"统一归类（2026-09-11）
// ------------------------------------------------------------
export interface OperatorPanelProps {
  session: GameSession;
  /** ★ 图标服务（遗物查看与背包同一条绘制 + 播放管线） */
  iconRegistry: ItemIconRegistry;
}

export class OperatorPanel extends SidePanel<OperatorPanelProps> {
  protected title(): string {
    return '遗物';
  }

  protected body(): HTMLElement {
    const div = document.createElement('div');
    div.appendChild(this.renderRelicSection());
    return div;
  }

  /** ★ 遗物（只可抽取、不入背包；拥有即全局永久生效/播放图标纹理） */
  private renderRelicSection(): HTMLElement {
    const outOwned = this.props.session.outOfRun?.owned ?? {};
    const outIds = Object.keys(outOwned);
    const section = document.createElement('div');
    section.style.cssText = 'padding:8px;background:rgba(204,170,68,0.12);border-radius:4px;';
    const heading = document.createElement('h4');
    heading.style.cssText = 'color:#ffc;margin:0 0 8px 0;font-style:italic;';
    heading.textContent = '他们仍愿意帮助你';
    section.appendChild(heading);
    if (outIds.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#665;font-size:12px;';
      empty.textContent = '还没有遗物，去招募池抽取吧';
      section.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      for (const id of outIds) {
        const cfg = RELIC_ITEM_CONFIG[id];
        if (!cfg) continue;
        const count = outOwned[id] ?? 0;
        const stars = cfg.rarity >= 6 ? '★' : '☆';
        const row = document.createElement('div');
        row.style.cssText = `padding:6px 10px;background:rgba(255,215,0,0.08);border:1px solid ${cfg.rarity >= 6 ? '#ffd700' : '#c8a0ff'};border-radius:4px;font-size:12px;display:flex;align-items:center;gap:10px;`;
        const iconBox = document.createElement('div');
        iconBox.style.cssText = 'width:36px;height:36px;border-radius:6px;overflow:hidden;flex:none;background:rgba(15,15,30,0.7);display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,215,0,0.35);';
        // ★ 多帧纹理：按拥有数选帧（如砾小姐的爱：1件=帧1、≥2件=帧2）
        const frame = cfg.iconFrame ? cfg.iconFrame(count) : 0;
        const icon = this.props.iconRegistry.createIconElement(id, frame);
        icon.style.width = '100%';
        icon.style.height = '100%';
        icon.style.objectFit = 'contain';
        iconBox.appendChild(icon);
        row.appendChild(iconBox);
        const text = document.createElement('div');
        text.style.cssText = 'flex:1;';
        text.innerHTML = `<div style="color:#ffd;font-weight:bold;">${cfg.name} ${stars} ×${count}</div>` +
          `<div style="color:#ca9;margin-top:2px;">${cfg.description}</div>`;
        row.appendChild(text);
        list.appendChild(row);
      }
      section.appendChild(list);
    }
    return section;
  }
}
