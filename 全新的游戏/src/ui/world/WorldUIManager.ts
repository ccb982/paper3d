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
import { AmmoHud } from '../../systems/itemPlayback/AmmoHud';
import { AllyHud } from '../../services/ui/AllyHud';
import { RasterMap } from '../../services/map/RasterMap';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import { CSS } from '../shared/UIConstants';
import { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

export type FloatingTextType = 'normal' | 'crit' | 'heal' | 'miss' | 'pickup';

export class WorldUIManager extends BaseInteractionUI {
  private minimap: Minimap;
  private hud: PlayerHud;
  private crosshair: Crosshair;
  private ammoHud: AmmoHud;
  /** ★ 左侧友军编队列表（方舟风：图标 + 血条） */
  private allyHud: AllyHud;
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
  private flashItemId: string | null = null;
  private flashTimer: number | undefined = undefined;
  private mapStyleBtn: HTMLButtonElement | null = null;
  /** ★ 获得物品播报栈（用户手绘 JSON《页面布局/获得物品.json》右上区域）：
   *  每次拾取生成一条面板向下堆叠；到期向下滑动 + 淡出后移除（播报式）。 */
  private pickupStack: HTMLDivElement | null = null;
  private pickupToasts: { el: HTMLDivElement; timer: number; dying: boolean }[] = [];
  /** 同屏最多保留条数（超出时最早的一条立即退场） */
  private static readonly PICKUP_TOAST_MAX = 5;
  /** 单条停留时长（ms） */
  private static readonly PICKUP_TOAST_LIFE_MS = 1800;
  private iconRegistry: ItemIconRegistry | null = null;

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
      isPanelOpen: (id) => this.panels.isOpen(id),
      onDataChanged: () => {
        if (this.isInventoryOpen) this.renderInventoryPanel();
      },
    });

    // ★ 模态面板栈挂载到 body（新 PanelManager 拥有遮罩层）
    this.panels.mount(document.body);

    this.minimap = new Minimap(raster);
    this.hud = new PlayerHud();
    this.crosshair = new Crosshair();
    // ★ 弹药 HUD（战斗道具播放 · 弹药类）：数据每帧经 update 传入
    this.ammoHud = new AmmoHud(itemManager);
    // ★ 左侧友军编队列表（图标 + 血条）
    this.allyHud = new AllyHud(itemManager);

    // 交互提示
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.className = CSS.interactPrompt;
    this.interactPrompt.textContent = '按 E 拾取';
    document.body.appendChild(this.interactPrompt);
  }

  /** 每帧更新（高频调用） */
  update(dt: number, ctx: WorldUIState): void {
    this.minimap.update(ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw, ctx.entities);
    this.hud.update(ctx.playerStats.hp, ctx.playerStats.maxHp);
    this.ammoHud.update(ctx.ammo);
    this.allyHud.update(ctx.allies);

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

  /** 显示拾取结果：右上角"获得物品"面板（手绘 JSON 布局，左图标 + 右文字）；
   *  背包满 → 失败文案（图标淡化）。可叠加：每次生成一条，向下堆叠、到期下滑淡出。 */
  showPickupResult(itemId: string, success: boolean, count = 1): void {
    const name = this.itemManager.getArchetype(itemId)?.name ?? itemId;
    const label = success
      ? count > 1 ? `获得了 ${name} ×${count}` : `获得了 ${name}`
      : `背包已满，无法拾取 ${name}`;
    const toast = this.buildPickupToast(itemId, success, label);
    const stack = this.ensurePickupStack();
    // 超过上限：最早的一条立即进入退场（保持播报流不堆满屏）
    while (this.pickupToasts.length >= WorldUIManager.PICKUP_TOAST_MAX) {
      const oldest = this.pickupToasts[0];
      this.dismissPickupToast(oldest);
    }
    stack.appendChild(toast);
    // 入场：下一帧切终态触发过渡（上方 10px 滑入 + 淡入）
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    const rec = { el: toast, timer: 0, dying: false };
    rec.timer = window.setTimeout(() => this.dismissPickupToast(rec), WorldUIManager.PICKUP_TOAST_LIFE_MS);
    this.pickupToasts.push(rec);
    // ★ 记录闪烁物品 ID，下次渲染背包时格子闪黄光
    if (success) {
      this.flashItemId = itemId;
      // 动画完成后清除
      setTimeout(() => { this.flashItemId = null; }, 700);
    }
  }

  /** 退场：向下滑动 + 淡出 → 移除（幂等） */
  private dismissPickupToast(rec: { el: HTMLDivElement; timer: number; dying: boolean }): void {
    if (rec.dying) return;
    rec.dying = true;
    clearTimeout(rec.timer);
    const i = this.pickupToasts.indexOf(rec);
    if (i >= 0) this.pickupToasts.splice(i, 1);
    rec.el.style.transform = 'translateY(19px)';
    rec.el.style.opacity = '0';
    setTimeout(() => rec.el.remove(), 300);
  }

  /** 单条播报面板：灰黑半透明，左 = 物品图标，右 = 文字（失败红字 + 图标淡化）；
   *  ★ 用户定调：先按手绘面板放大 2×，再缩小 1/3（净 ≈1.33×）。 */
  private buildPickupToast(itemId: string, success: boolean, label: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:100%', 'min-height:59px', 'display:flex', 'align-items:center', 'gap:11px',
      'padding:8px 13px', 'box-sizing:border-box',
      'background:rgba(18,20,24,0.72)', 'border:1px solid rgba(255,255,255,0.10)',
      'border-radius:11px', 'pointer-events:none',
      // 入场起点：上方 13px + 全透明；位移动画统一由 transform/opacity 过渡驱动
      'transform:translateY(-13px)', 'opacity:0',
      'transition:transform .22s ease,opacity .22s ease',
    ].join(';');
    const icon = document.createElement('div');
    icon.style.cssText = 'flex:0 0 auto;width:48px;height:48px;display:flex;align-items:center;justify-content:center;';
    this.iconRegistry ??= new ItemIconRegistry(this.itemManager);
    const el = this.iconRegistry.createIconElement(itemId);
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'contain';
    el.style.imageRendering = 'pixelated';
    el.style.opacity = success ? '1' : '0.35';
    icon.appendChild(el);
    const text = document.createElement('div');
    text.textContent = label;
    text.style.cssText = [
      'flex:1 1 auto', 'font-size:17px', 'line-height:1.35',
      'text-shadow:0 1px 2px rgba(0,0,0,.6)',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      `color:${success ? '#e8ecf2' : '#ff9a9a'}`,
    ].join(';');
    panel.appendChild(icon);
    panel.appendChild(text);
    return panel;
  }

  /** 惰性建播报栈容器：位置按手绘 JSON 归一化坐标换算；宽度 12.18% × 2 × (2/3) = 16.24%
   *  （用户定调：放大 2× 后再缩 1/3）；叠加为列，单条高度取内容高度 59px 起。 */
  private ensurePickupStack(): HTMLDivElement {
    if (this.pickupStack) return this.pickupStack;
    const stack = document.createElement('div');
    stack.style.cssText = [
      'position:fixed', 'top:8.97%', 'right:0.16%', 'width:16.24%',
      'z-index:70', 'display:flex', 'flex-direction:column', 'gap:8px',
      'align-items:stretch', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(stack);
    this.pickupStack = stack;
    return stack;
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

  /** 刷新背包面板（如果已打开）；★ 正在查看物品详情时就地刷新详情，不打断——
   *  详情关闭时（onClose → onDataChanged）再整面板刷新，把期间拾取的物品补上格子 */
  refreshIfOpen(): void {
    if (!this.isInventoryOpen) return;
    if (this.inventoryPanel.refreshOpenDetail()) return;
    this.renderInventoryPanel();
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
    this.minimap.dispose();
    this.hud.dispose();
    this.crosshair.dispose();
    this.ammoHud.dispose();
    this.allyHud.dispose();
    this.interactPrompt.remove();
    this.mapStyleBtn?.remove();
    this.mapStyleBtn = null;
    for (const ft of this.floatingTexts) ft.el.remove();
    this.floatingTexts = [];
    // ★ 获得物品播报栈
    for (const rec of this.pickupToasts) clearTimeout(rec.timer);
    this.pickupToasts = [];
    this.pickupStack?.remove();
    this.pickupStack = null;
    this.iconRegistry = null;
  }
}