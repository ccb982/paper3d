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

    // ④ 加载主页面按钮（FTX 纹理，梯形透视；异步不阻塞进入）
    this.mainButtons = new MainButtons();
    this.mainButtons.onPress(id => this.onButtonPress(id));
    this.mainButtons.init(ctx.renderer!).catch(err => {
      console.error('[BaseMode] 主页面按钮加载失败:', err);
    });

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

    // ① 销毁主页面按钮
    this.mainButtons?.dispose();
    this.mainButtons = null;

    // ② 销毁抽卡覆盖层
    this.gachaOverlay?.dispose();

    // ③ 销毁加工台覆盖层
    this.craftingOverlay?.dispose();
    this.craftingOverlay = null;

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

  /** 是否有 UI 遮挡（模态面板 / 抽卡 / 加工台 / 全屏背包页） */
  private isUiBlocking(): boolean {
    if (this.uiManager?.hasModalOpen) return true;
    if (this.craftingOverlay?.isOpen()) return true;
    if (this.gachaOverlay?.isOpen()) return true;
    return false;
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
