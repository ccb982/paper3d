// ============================================================
// WorldUIManager.ts —— 世界 UI 管理器
// 封装 HUD、小地图、准星、交互提示、浮动文字、对话气泡。
// 继承 BaseInteractionUI 统一管理弹窗栈。
// 对应原 services/ui/UILayer + Crosshair，合并为一个统一 UI 管理器。
// ============================================================

import { BaseInteractionUI } from '../BaseInteractionUI';
import type { GameSession } from '../../core/Session';
import type { WorldUIState } from '../../core/WorldUIState';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryPanel } from '../shared/InventoryPanel';
import { Minimap } from '../../services/ui/Minimap';
import { PlayerHud } from '../../services/ui/PlayerHud';
import { Crosshair } from '../../services/ui/Crosshair';
import { RasterMap } from '../../services/map/RasterMap';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import { CSS } from '../shared/UIConstants';

export type FloatingTextType = 'normal' | 'crit' | 'heal' | 'miss' | 'pickup';

export class WorldUIManager extends BaseInteractionUI {
  private minimap: Minimap;
  private hud: PlayerHud;
  private crosshair: Crosshair;
  private interactPrompt: HTMLDivElement;
  private floatingTexts: {
    el: HTMLDivElement;
    life: number;
    maxLife: number;
    type: FloatingTextType;
    startY: number;   // 初始 Y 坐标（屏幕像素）
    speed: number;    // 上浮速度
  }[] = [];
  private inventoryPanel: InventoryPanel;
  private eventUnsub?: () => void;
  private flashItemId: string | null = null;
  private flashTimer: number | undefined = undefined;
  private mapStyleBtn: HTMLButtonElement | null = null;

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    private interactionManager: InteractionManager,
    raster: RasterMap,
  ) {
    super();
    // ★ 独立背包模块：地图模式只暴露玩家背包 + 飞船仓库（隐藏基地层）
    this.inventoryPanel = new InventoryPanel({
      session,
      itemManager,
      layers: [
        { key: 'player', label: '🎒 玩家背包' },
        { key: 'ship', label: '🚀 飞船仓库' },
      ],
      // 地图模式：玩家↔飞船 互通
      transferTargets: {
        player: ['ship'],
        ship: ['player'],
      },
      openPanel: (def) => this.openPanel(def),
      closePanel: (id) => this.closePanel(id),
      onDataChanged: () => {
        if (this.isInventoryOpen) this.renderInventoryPanel();
      },
    });

    // ★ 模态面板栈挂载到 body（新 PanelManager 拥有遮罩层）
    this.panels.mount(document.body);

    this.minimap = new Minimap(raster);
    this.hud = new PlayerHud();
    this.crosshair = new Crosshair();

    // 交互提示
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.className = CSS.interactPrompt;
    this.interactPrompt.textContent = '按 E 拾取';
    document.body.appendChild(this.interactPrompt);

    // ★ 订阅伤害事件（显示浮动数字）
    import('../../core/EventBus').then(({ eventBus }) => {
      this.eventUnsub = eventBus.on('damage', (payload) => {
        // 这里只负责显示，位置计算由调用方传入，但我们需要获取坐标
        // 由于 WorldMode 会负责投影并调用 showFloatingText，所以这里只做展示
        // 但为了解耦，我们也可以在内部直接调用 showFloatingText，但需要传递屏幕坐标
        // 这里我们暴露一个方法给 WorldMode 调用，不在此处直接处理事件
        // 我们将事件绑定移到 WorldMode 中，以便拥有相机进行投影
        // 因此这个订阅仅为占位，实际由 WorldMode 调用 showFloatingText
      });
    });
  }

  /** 每帧更新（高频调用） */
  update(dt: number, ctx: WorldUIState): void {
    this.minimap.update(ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw, ctx.entities);
    this.hud.update(ctx.playerStats.hp, ctx.playerStats.maxHp);

    // 交互提示
    if (ctx.nearbyItem && ctx.nearbyItem.distance < 2) {
      this.interactPrompt.textContent = `按 E 拾取 ${ctx.nearbyItem.itemId}`;
      this.interactPrompt.style.display = 'block';
    } else {
      this.interactPrompt.style.display = 'none';
    }

    // 浮动文字更新
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.el.remove();
        this.floatingTexts.splice(i, 1);
      } else {
        const progress = 1 - ft.life / ft.maxLife;
        ft.el.style.opacity = String(ft.life / ft.maxLife);
        // 上浮：修改 top 值，同时水平居中保持不变
        const offset = ft.speed * progress;
        ft.el.style.top = (ft.startY - offset) + 'px';
      }
    }
  }

  /** 显示浮动文字（屏幕坐标，单位 px，相对于视口左上角） */
  showFloatingText(
    screenX: number,
    screenY: number,
    text: string,
    type: FloatingTextType = 'normal',
  ): void {
    const el = document.createElement('div');
    el.className = CSS.floatingText;
    el.textContent = type === 'miss' ? 'Miss' : text;
    // 定位到屏幕坐标，水平居中
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.transform = 'translateX(-50%)';
    el.style.margin = '0';

    // 按类型设置样式
    switch (type) {
      case 'crit':
        el.style.color = '#ff8800';
        el.style.fontSize = '22px';
        el.style.fontWeight = 'bold';
        break;
      case 'heal':
        el.style.color = '#44dd88';
        break;
      case 'miss':
        el.style.color = '#888';
        el.style.fontSize = '14px';
        break;
      case 'pickup':
        el.style.color = text.startsWith('拾取了') ? '#44dd88' : '#ff4444';
        break;
      default:
        el.style.color = '#fff';
        break;
    }

    const speed = type === 'crit' ? 90 : 60;
    document.body.appendChild(el);
    this.floatingTexts.push({
      el,
      life: 1.5,
      maxLife: 1.5,
      type,
      startY: screenY,
      speed,
    });
  }

  /** 显示拾取结果（简化调用）：显示物品显示名 + 数量；背包满提示失败 */
  showPickupResult(itemId: string, success: boolean, count = 1): void {
    const name = this.itemManager.getArchetype(itemId)?.name ?? itemId;
    const label = success
      ? count > 1 ? `拾取了 ${name} ×${count}` : `拾取了 ${name}`
      : `背包已满，无法拾取 ${name}`;
    // 屏幕中央偏下显示
    this.showFloatingText(window.innerWidth / 2, window.innerHeight / 2 - 50, label, 'pickup');
    // ★ 记录闪烁物品 ID，下次渲染背包时格子闪黄光
    if (success) {
      this.flashItemId = itemId;
      // 动画完成后清除
      setTimeout(() => { this.flashItemId = null; }, 700);
    }
  }

  /** 打开对话（世界轻量版，非模态 HUD 小部件） */
  openDialogue(npcId: string, text: string): void {
    const bubble = renderDialogBubble({ speaker: npcId, text, autoCloseMs: 3000 });
    this.widgets.add(bubble);
  }

  /** 准星显隐 */
  setCrosshairVisible(v: boolean): void {
    this.crosshair.setVisible(v);
  }

  /** 打开/关闭背包面板（以弹窗栈内是否含 inventory-panel 为准） */
  toggleInventory(): void {
    if (this.isInventoryOpen) {
      this.closePanel('inventory-panel');
    } else {
      this.renderInventoryPanel();
    }
  }

  /** 背包面板是否打开（由弹窗栈实际状态推导，与手动关闭按钮保持同步） */
  get isInventoryOpen(): boolean {
    return this.panels.isOpen('inventory-panel');
  }

  private renderInventoryPanel(): void {
    const content = document.createElement('div');
    content.className = 'ui-panel-inner';

    // 标题 + 手动关闭按钮
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
    const title = document.createElement('div');
    title.className = CSS.panelTitle;
    title.style.marginBottom = '0';
    title.textContent = '背包';
    head.appendChild(title);
    const closeBtn = createButton({
      label: '✕ 关闭', size: 'sm', style: 'ghost',
      onClick: () => this.closePanel('inventory-panel'),
    });
    head.appendChild(closeBtn);
    content.appendChild(head);

    // ★ 独立背包模块渲染（标签页 + 网格）—— 渲染进独立子容器，避免清空标题栏
    const gridRoot = document.createElement('div');
    content.appendChild(gridRoot);
    this.inventoryPanel.render(gridRoot, this.flashItemId ?? undefined);

    this.openPanel({
      id: 'inventory-panel',
      onOpen: () => {},
      onClose: () => {},
      render: () => content,
    });
  }

  /** ★ 地图风格切换按钮（右上角悬浮；标签由外部状态刷新） */
  addMapStyleButton(getLabel: () => string, onToggle: () => void): void {
    const btn = document.createElement('button');
    btn.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:50',
      'padding:6px 14px', 'font-size:12px', 'font-weight:bold',
      'background:#1a2238cc', 'color:#9cf',
      'border:1px solid #4466aa', 'border-radius:6px', 'cursor:pointer',
    ].join(';');
    const refresh = () => { btn.textContent = getLabel(); };
    refresh();
    btn.addEventListener('click', () => { onToggle(); refresh(); });
    document.body.appendChild(btn);
    this.mapStyleBtn = btn;
  }

  /** 刷新背包面板（如果已打开） */
  refreshIfOpen(): void {
    if (this.isInventoryOpen) {
      this.renderInventoryPanel();
    }
  }

  /** 拾取反馈：标记新增格子闪烁 + 刷新背包（若已打开）——子弹掉落直塞背包时保证实时可见 */
  flashItemAndRefresh(itemId: string): void {
    this.flashItemId = itemId;
    this.refreshIfOpen();
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { this.flashItemId = null; }, 600);
  }

  override dispose(): void {
    super.dispose();
    this.eventUnsub?.();
    this.minimap.dispose();
    this.hud.dispose();
    this.crosshair.dispose();
    this.interactPrompt.remove();
    this.mapStyleBtn?.remove();
    this.mapStyleBtn = null;
    for (const ft of this.floatingTexts) ft.el.remove();
    this.floatingTexts = [];
  }
}