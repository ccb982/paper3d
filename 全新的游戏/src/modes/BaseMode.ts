// ============================================================
// BaseMode.ts —— 基地模式（纯组装器；2026-09-12 从 ShipMode 独立归属）
// ============================================================
// 职责边界（2026-09-12 独立归属后）：
//   - IGameMode 生命周期实现（enter/exit/update/render）
//   - 组装协作者：BaseScene（基地 3D 剖切空间）/ MainButtons / ShipUIManager /
//     GachaOverlay / CraftingOverlay
//   - 业务装配：ItemManager / CraftingManager / InteractionManager
//   - 出击结算（doDepart）+ 按钮业务路由（onButtonPress）
// 不做的：
//   - 基地空间与角色行走细节 → ui/base/BaseScene
//   - 按钮覆盖层子系统 → ui/base/MainButtons
//   - 面板内部逻辑 → ui/base/ShipUIManager
//   - 抽卡/加工内部逻辑 → ui/base/GachaOverlay / CraftingOverlay
// 路由：main.ts（enterBaseMode）；WorldMode 返回 → BaseMode。
// ============================================================

import type { IGameMode, IGameModeContext } from '../core/IGameMode';
import { SaveSystem } from '../core/SaveSystem';
import { eventBus } from '../core/EventBus';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { ItemIconRegistry } from '../services/item/ItemIconRegistry';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { ShipUIManager } from '../ui/base/ShipUIManager';
import { GachaOverlay } from '../ui/base/GachaOverlay';
import { CraftingOverlay } from '../ui/base/CraftingOverlay';
import { BaseScene } from '../ui/base/BaseScene';
import { MainButtons, type ButtonId } from '../ui/base/MainButtons';
import { createButton } from '../ui/components/Button';
import { DialogueView } from '../ui/shared/DialogueView';
import { DialogueSystem } from '../systems/dialogue/DialogueSystem';
import { EventSystem } from '../systems/events/EventSystem';

export class BaseMode implements IGameMode {
  // 场景对象（由 ctx 注入，模式内只读）
  private scene: IGameModeContext['scene'] | null = null;
  private camera: IGameModeContext['camera'] | null = null;
  private renderer: IGameModeContext['renderer'] | null = null;

  // 数据
  private session: IGameModeContext['session'] | null = null;
  private onDepart: IGameModeContext['onDepart'] = undefined;

  // ★ 业务逻辑层（共享模块）
  private itemManager!: ItemManager;
  private craftingManager!: CraftingManager;
  private iconRegistry!: ItemIconRegistry;
  private interactionManager!: InteractionManager;

  // ★ UI 层（舰船专属）
  private uiManager!: ShipUIManager;

  // ★ 抽卡覆盖层（行动后默认显示）
  private gachaOverlay!: GachaOverlay;

  // ★ 加工台覆盖层（基地入口：编队面板 → 合成台）
  private craftingOverlay: CraftingOverlay | null = null;

  // ★ 基地内部 3D 剖切空间（固定侧视；返回后的界面）与主按钮
  private baseScene: BaseScene | null = null;
  private mainButtons: MainButtons | null = null;
  /** ★ 出击槽变动订阅（基地内换装：装备贴片/无人机即时刷新） */
  private deploymentUnsub: (() => void) | null = null;
  /** ★ 删档按钮（基地右上角；确认后清 localStorage 并重开） */
  private wipeBtn: HTMLButtonElement | null = null;

  // ★ 事件 / 对话模块（2026-09-14；基地与战斗共用同一套系统与 UI）
  private eventSystem!: EventSystem;
  private dialogue!: DialogueSystem;
  private dialogueView: DialogueView | null = null;

  // ============================================================
  // IGameMode 接口实现
  // ============================================================

  enter(ctx: IGameModeContext): void {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.session = ctx.session;
    this.onDepart = ctx.onDepart;

    // ① 初始化业务逻辑层（共享模块）
    this.itemManager = new ItemManager(ctx.session);
    this.craftingManager = new CraftingManager(ctx.session, this.itemManager);
    this.iconRegistry = new ItemIconRegistry(this.itemManager);
    this.interactionManager = new InteractionManager({
      session: ctx.session,
      itemManager: this.itemManager,
    });

    // ② 初始化 UI 层（舰船专属；图标服务与加工台/背包共享同一实例）
    this.uiManager = new ShipUIManager(
      ctx.session,
      this.itemManager,
      this.craftingManager,
      this.interactionManager,
      this.iconRegistry,
      () => this.doDepart(),
    );

    // ③ 基地内部 3D 剖切空间（三间打通 + 维维美行走 + 镜头跟随/缩放）
    //    角色身上绘制装备贴片（黍姐的XX/鱼生萌萌香…），出击槽里的无人机三帧合成跟随
    //    （祖宗是弹药消耗品，不在基地绘制）
    this.baseScene = new BaseScene(ctx.scene!, {
      protagonistAsset: ctx.protagonistAsset,
      droneAsset: ctx.droneAsset,
      itemManager: this.itemManager,
      renderer: ctx.renderer,
    });
    this.baseScene.setupCamera(ctx.camera!);
    // ★ 加工台入口（2026-09-12 用户定调）：走到"加工站"房间按 F（原编队面板入口已移除）
    this.baseScene.onCraftStation(() => this.uiManager.openCrafting('ship'));
    // ★ UI 遮挡：抽卡页/加工台/背包等任何覆盖层打开时，不绘制加工站提示且 F 不响应
    this.baseScene.setUiBlocking(() => this.isUiBlocking());
    // ★ 出击槽变动（背包页穿脱/互换）：装备贴片与无人机三帧合成即时刷新
    this.deploymentUnsub = eventBus.on('deployment_changed', () => {
      this.baseScene?.refreshDeployment();
    });

    // ★ 事件 / 对话（基地固定位；锚点每天确定性轮换，站着的角色 F 交谈）
    this.eventSystem = new EventSystem(ctx.session, 10007);
    this.dialogueView = new DialogueView(document.body);
    this.dialogue = new DialogueSystem({
      session: ctx.session,
      itemManager: this.itemManager,
      view: this.dialogueView,
      onEnd: (eventId) => {
        if (eventId) {
          this.eventSystem.complete(eventId);
          SaveSystem.save(ctx.session);
        }
        this.refreshBaseEvents();
      },
    });
    this.refreshBaseEvents();

    // ④ 加载主页面按钮（FTX 纹理，梯形透视；异步不阻塞进入）
    this.mainButtons = new MainButtons();
    this.mainButtons.onPress(id => this.onButtonPress(id));
    this.mainButtons.init(ctx.renderer!).catch(err => {
      console.error('[BaseMode] 主页面按钮加载失败:', err);
    });
    // ★ 删档按钮（右上角小按钮 → 确认面板 → 清档重开）
    this.createWipeButton();

    // ⑤ 创建抽卡覆盖层（行动后触发；与背包/加工台共享图标服务）
    this.gachaOverlay = new GachaOverlay(ctx.session, this.iconRegistry);
    this.gachaOverlay.load().then(() => {
      // 将抽卡覆盖层传递给 UI 管理器，点在"行动"时显示
      this.uiManager.setGachaOverlay(this.gachaOverlay);
    });

    // ⑥ 创建加工台覆盖层（基地入口：编队面板 → 合成台；与背包共享图标服务）
    this.craftingOverlay = new CraftingOverlay(
      this.craftingManager,
      this.itemManager,
      this.iconRegistry,
    );
    this.craftingOverlay.load().then(() => {
      this.uiManager.setCraftingOverlay(this.craftingOverlay!);
    });

    // 触发存档事件
    eventBus.emit('save_complete', {});
  }

  exit(): void {
    // ⓪ 退订出击槽变动
    this.deploymentUnsub?.();
    this.deploymentUnsub = null;

    // ① 销毁主页面按钮 + 删档按钮
    this.mainButtons?.dispose();
    this.mainButtons = null;
    this.wipeBtn?.remove();
    this.wipeBtn = null;

    // ② 销毁抽卡覆盖层
    this.gachaOverlay?.dispose();

    // ③ 销毁加工台覆盖层
    this.craftingOverlay?.dispose();
    this.craftingOverlay = null;

    // ③.5 销毁对话模块
    this.dialogue?.close();
    this.dialogueView?.dispose();
    this.dialogueView = null;

    // ③ 销毁 UI 层
    this.uiManager?.dispose();

    // ④ 销毁基地 3D 空间
    this.baseScene?.dispose();
    this.baseScene = null;

    // ⑤ 清空引用
    this.session = null;
    this.onDepart = undefined;
  }

  update(dt: number): void {
    // 基地：角色行走 + 帧动画 + 镜头跟随/缩放（UI 仍为事件驱动）
    this.baseScene?.update(dt);
  }

  /** 是否有 UI 遮挡（模态面板 / 抽卡 / 加工台 / 全屏背包页 / 对话） */
  private isUiBlocking(): boolean {
    if (this.uiManager?.hasModalOpen) return true;
    if (this.craftingOverlay?.isOpen()) return true;
    if (this.gachaOverlay?.isOpen()) return true;
    if (this.dialogue?.isActive) return true;
    return false;
  }

  /** ★ 事件站点与 NPC 立绘刷新（进入基地 + 每次事件完成后） */
  private refreshBaseEvents(): void {
    if (!this.baseScene || !this.eventSystem || !this.dialogue) return;
    const fixed = this.eventSystem.fixedEvents('base');
    this.baseScene.setEventStations(fixed.map((f) => ({
      x: f.x, z: f.z, rx: 2.4, rz: 2.0,
      label: this.eventSystem.label(f.event),
      cb: () => { this.dialogue.start(f.event.dialogue, { eventId: f.event.id }); },
    })));
    this.baseScene.setEventNpcs(fixed.map((f) => ({ x: f.x, z: f.z, assetUrl: f.event.npc.portrait })));
  }

  render(): void {
    if (this.scene && this.camera && this.renderer) {
      this.renderer.render(this.scene, this.camera);
      // 主页面按钮覆盖层（不清除背景；autoClear 配对在组件内部）
      this.mainButtons?.render(this.renderer);
    }
  }

  /** 出击：回调主流程（战斗属性由 WorldMode 进图时统一刷新） */
  private doDepart(): void {
    if (!this.session || !this.onDepart) return;
    this.session.dayProgress.hasDepartedToday = true;
    SaveSystem.save(this.session);
    this.onDepart(this.session.meta.day);
  }

  /** 主页面按钮业务路由（action→抽卡覆盖层；其余→面板开关）——原逻辑不变 */
  /** ★ 删档按钮（右上角；低调样式） */
  private createWipeButton(): void {
    if (this.wipeBtn) return;
    const btn = document.createElement('button');
    btn.textContent = '删档';
    btn.style.cssText = [
      'position:fixed', 'top:10px', 'right:12px', 'z-index:80',
      'padding:5px 14px', 'border-radius:4px', 'cursor:pointer',
      'font:13px "Microsoft YaHei",sans-serif', 'letter-spacing:2px',
      'color:#c9b8a2', 'background:rgba(20,16,12,0.6)',
      'border:1px solid rgba(160,120,80,0.45)',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.color = '#ff9a8a'; btn.style.borderColor = 'rgba(220,110,90,0.7)'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#c9b8a2'; btn.style.borderColor = 'rgba(160,120,80,0.45)'; });
    btn.addEventListener('click', () => this.openWipeConfirm());
    document.body.appendChild(btn);
    this.wipeBtn = btn;
  }

  /** 删档确认面板（二次确认，防误触） */
  private openWipeConfirm(): void {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;padding:22px 36px;color:#f2e3d0;font-size:14px;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '确认删除存档？';
    title.style.cssText = 'font-size:19px;font-weight:bold;color:#ff8a8a;letter-spacing:2px;';
    const body = document.createElement('div');
    body.textContent = '将清除全部进度（天数/遗物/背包/舰船强化），删除后立即重开，无法恢复。';
    body.style.cssText = 'color:#c9b8a2;line-height:1.7;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;';
    const cancel = createButton({
      label: '取消', style: 'secondary', size: 'md',
      onClick: () => this.uiManager.closePanel('wipe-save'),
    });
    const confirm = createButton({
      label: '确认删档', style: 'danger', size: 'md',
      onClick: () => {
        try {
          localStorage.removeItem('arknights_rogue_save');
        } catch (e) {
          console.error('[删档] 清除失败:', e);
        }
        location.reload();
      },
    });
    row.append(cancel, confirm);
    content.append(title, body, row);
    this.uiManager.openPanel({
      id: 'wipe-save',
      title: '删档',
      render: () => content,
      onClose: () => {},
    });
  }

  private onButtonPress(id: ButtonId): void {
    if (id === 'action') {
      const gacha = this.gachaOverlay;
      if (gacha) {
        gacha.show(() => this.doDepart());
      }
    } else {
      this.uiManager.togglePanel(id as 'operator' | 'formation');
    }
  }
}
