// ============================================================
// ship/ShipPanels.ts —— 舰船三个侧边面板（迁移到 Panel 基类）
// ============================================================
// 行动 / 编队 / 干员 三个侧边面板，继承 SidePanel（Panel 基类子类），
// 仍渲染进 panelContainer 固定容器，但获得统一标题栏与生命周期。
// ============================================================

import { SidePanel } from '../panel/SidePanel';
import type { GameSession } from '../../core/Session';
import { countItemsInGrid } from '../../core/Session';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import { createButton } from '../components/Button';
import { RELIC_ITEM_CONFIG, ownedRelicIds, ownedBossIds } from '../../config/relics';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../shared/ftxFrameToCanvas';

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
        <div>💠 遗物: ${ownedRelicIds(s.outOfRun?.owned).length} 种 | 💀 累计死亡: ${s.meta?.deaths ?? 0} 次</div>
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
//
// ★★ 2026-11-15 用户定调：面板改用新的「遗物显示 UI」素材（/ui/显示遗物.ftx3.gz，
//   1240×228 横向长条）。布局按用户标注「页面布局/遗物显示ui.json」：
//   · 左侧深色槽  = 遗物图标列表（点选切换，竖排可滚）
//   · 中间浅色区  = 选中遗物的介绍
//   · 右上深色块  = 选中遗物的名字 + 数量
// ------------------------------------------------------------

/** 遗物 UI 背景（懒加载一次；模块级缓存，避免每次开面板重复解码） */
let relicUiBgURL: string | null = null;
let relicUiBgPromise: Promise<string | null> | null = null;
/** 隐藏遗物面板内部滚动条（全局注入一次） */
let relicScrollStyleInjected = false;
function injectRelicScrollStyle(): void {
  if (relicScrollStyleInjected) return;
  relicScrollStyleInjected = true;
  const st = document.createElement('style');
  st.textContent = '.ship-relic-scroll::-webkit-scrollbar{width:0;height:0;display:none;}'
    + '.ship-relic-scroll{scrollbar-width:none;-ms-overflow-style:none;}';
  document.head.appendChild(st);
}
function loadRelicUiBg(): Promise<string | null> {
  if (relicUiBgURL) return Promise.resolve(relicUiBgURL);
  if (!relicUiBgPromise) {
    relicUiBgPromise = (async () => {
      try {
        const asset = await FtxAsset.load('/ui/显示遗物.ftx3.gz');
        relicUiBgURL = compositeFrameToCanvas(asset, 0).toDataURL();
        return relicUiBgURL;
      } catch (e) {
        console.warn('[ShipPanels] 遗物 UI 素材载入失败:', e);
        return null;
      }
    })();
  }
  return relicUiBgPromise;
}

/** 遗物 / BOSS 统一条目（左侧列表项） */
interface OutRunEntry {
  id: string;
  count: number;
  kind: 'relic' | 'boss';
}

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
    const owned = this.props.session.outOfRun?.owned ?? {};
    // ★ 遗物 + BOSS 一起进左侧列表（BOSS 用红色系区分），中间/右上显示选中项详情
    const entries: OutRunEntry[] = [
      ...ownedRelicIds(owned).map((id) => ({ id, count: owned[id] ?? 0, kind: 'relic' as const })),
      ...ownedBossIds(owned).map((id) => ({ id, count: owned[id] ?? 0, kind: 'boss' as const })),
    ];
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '还没有遗物，去招募池抽取吧';
      empty.style.cssText = 'color:#888;font-size:12px;padding:10px;';
      div.appendChild(empty);
      return div;
    }
    div.appendChild(this.buildRelicDisplay(entries));
    return div;
  }

  /** ★ 新版遗物展示：**每个遗物一条**（素材整条当底），竖着往下排，条目多了内部滚动 */
  private buildRelicDisplay(entries: OutRunEntry[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;';
    wrap.className = 'ship-relic-scroll';
    injectRelicScrollStyle();

    const cards: HTMLElement[] = [];
    for (const e of entries) {
      const card = this.makeRelicCard(e);
      cards.push(card);
      wrap.appendChild(card);
    }
    // 素材懒加载（模块级缓存）：拿到后统一铺到每张卡片上
    void loadRelicUiBg().then((url) => {
      if (!url) return;
      for (const c of cards) c.style.backgroundImage = `url(${url})`;
    });
    return wrap;
  }

  /** 单条遗物卡（素材 1240×228 等比缩到 568 宽 ⇒ 高 104px） */
  private makeRelicCard(e: OutRunEntry): HTMLElement {
    const cfg = RELIC_ITEM_CONFIG[e.id];
    const isBoss = e.kind === 'boss';
    const accent = isBoss ? '#ff5640' : ((cfg?.rarity ?? 0) >= 6 ? '#ffd700' : '#c8a0ff');
    const card = document.createElement('div');
    card.style.cssText = 'position:relative;height:104px;border-radius:6px;overflow:hidden;'
      + 'background:rgba(28,28,48,0.6) center/100% 100% no-repeat;color:#e6e8f0;';

    // ---- 左侧：图标（素材左槽 0~15%；★ 整体右移 4%）----
    const iconBox = document.createElement('div');
    iconBox.style.cssText = 'position:absolute;left:1%;top:0;bottom:0;width:15%;box-sizing:border-box;'
      + 'display:flex;align-items:center;justify-content:center;padding:6px;';
    try {
      // ★ 多帧纹理：按拥有数选帧（如砾小姐的爱：1件=帧1、≥2件=帧2）
      const frame = cfg?.iconFrame ? cfg.iconFrame(e.count) : 0;
      const icon = this.props.iconRegistry.createIconElement(e.id, frame);
      icon.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      iconBox.appendChild(icon);
    } catch {
      iconBox.textContent = (cfg?.name ?? e.id).slice(0, 2);
      iconBox.style.cssText += 'font-size:12px;color:#eee;';
    }
    card.appendChild(iconBox);

    // ---- 中间：介绍（★ 跟着图标一起右移 4%：left 20%、右缘仍 70%；★ 再上移 + 放大字体）----
    const descEl = document.createElement('div');
    descEl.className = 'ship-relic-scroll';
    descEl.style.cssText = 'position:absolute;left:20%;right:30%;top:6%;bottom:4%;box-sizing:border-box;'
      + 'display:flex;align-items:flex-start;overflow-y:auto;font-size:14px;line-height:1.5;color:#1c1c22;'
      + 'white-space:pre-wrap;text-shadow:0 1px 3px rgba(0,0,0,0.9);';
    descEl.textContent = cfg?.description ?? '';
    card.appendChild(descEl);

    // ---- 右上：名字（★ 放大）+ 数量挪到下面那块空区域 ----
    const head = document.createElement('div');
    head.style.cssText = 'position:absolute;right:0;top:0;width:29%;height:29%;box-sizing:border-box;'
      + 'display:flex;align-items:center;justify-content:center;padding:0 6px;';
    const nameEl = document.createElement('div');
    nameEl.textContent = isBoss ? `BOSS · ${cfg?.name ?? e.id}` : (cfg?.name ?? e.id);
    nameEl.style.cssText = `font-size:16px;font-weight:bold;text-align:center;white-space:nowrap;`
      + `overflow:hidden;text-overflow:ellipsis;max-width:100%;color:${accent};`
      + 'text-shadow:0 1px 2px rgba(0,0,0,0.85);';
    head.appendChild(nameEl);
    card.appendChild(head);

    // 数量（★/☆ ×N）→ 卡片右下那块空区域（按标注 y≈0.41~0.47 处）
    const countEl = document.createElement('div');
    countEl.textContent = `${(cfg?.rarity ?? 0) >= 6 ? '★' : '☆'} ×${e.count}`;
    countEl.style.cssText = 'position:absolute;right:0;top:40%;width:29%;height:14%;box-sizing:border-box;'
      + 'display:flex;align-items:center;justify-content:center;font-size:13px;color:#5a5f6b;';
    card.appendChild(countEl);

    return card;
  }
}
