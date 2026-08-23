// ============================================================
// ShipMode.ts —— 舰船日常模式（纯组装器）
// ============================================================
// 职责边界（2026-08-23 拆分后）：
//   - IGameMode 生命周期实现（enter/exit/update/render）
//   - 组装协作者：ShipScene / MainButtons / ShipUIManager / GachaOverlay
//   - 业务装配：ItemManager / CraftingManager / InteractionManager
//   - 出击结算（doDepart）+ 按钮业务路由（onButtonPress）
// 不做的：
//   - 3D 场景构建细节 → ui/ship/ShipScene
//   - 按钮覆盖层子系统 → ui/ship/MainButtons
//   - 面板内部逻辑 → ui/ship/ShipUIManager
//   - 抽卡内部逻辑 → ui/ship/GachaOverlay
// ============================================================

import type { IGameMode, IGameModeContext } from '../core/IGameMode';
import type { PlayerCombatStats } from '../core/Session';
import { computeCombatStats } from '../core/Session';
import { SaveSystem } from '../core/SaveSystem';
import { eventBus } from '../core/EventBus';
import { RELIC_CONFIG } from '../config/relics';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { ShipUIManager } from '../ui/ship/ShipUIManager';
import { GachaOverlay } from '../ui/ship/GachaOverlay';
import { ShipScene } from '../ui/ship/ShipScene';
import { MainButtons, type ButtonId } from '../ui/ship/MainButtons';

export class ShipMode implements IGameMode {
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
  private interactionManager!: InteractionManager;

  // ★ UI 层（舰船专属）
  private uiManager!: ShipUIManager;

  // ★ 抽卡覆盖层（行动后默认显示）
  private gachaOverlay!: GachaOverlay;

  // ★ 场景与按钮（拆分后的自治组件）
  private shipScene: ShipScene | null = null;
  private mainButtons: MainButtons | null = null;

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
    this.interactionManager = new InteractionManager({
      session: ctx.session,
      itemManager: this.itemManager,
    });

    // ② 初始化 UI 层（舰船专属）
    this.uiManager = new ShipUIManager(
      ctx.session,
      this.itemManager,
      this.craftingManager,
      this.interactionManager,
      () => this.doDepart(),
    );

    // ③ 构建舰船 3D 场景 + 机位
    this.shipScene = new ShipScene(ctx.scene!);
    this.shipScene.setupCamera(ctx.camera!);

    // ④ 加载主页面按钮（FTX 纹理，梯形透视；异步不阻塞进入）
    this.mainButtons = new MainButtons();
    this.mainButtons.onPress(id => this.onButtonPress(id));
    this.mainButtons.init(ctx.renderer!).catch(err => {
      console.error('[ShipMode] 主页面按钮加载失败:', err);
    });

    // ⑤ 创建抽卡覆盖层（行动后触发）
    this.gachaOverlay = new GachaOverlay(ctx.session);
    this.gachaOverlay.load().then(() => {
      // 将抽卡覆盖层传递给 UI 管理器，点在"行动"时显示
      this.uiManager.setGachaOverlay(this.gachaOverlay);
    });

    // 触发存档事件
    eventBus.emit('save_complete', {});
    console.log('[ShipMode] 舰船场景已加载');
  }

  exit(): void {
    // ① 销毁主页面按钮
    this.mainButtons?.dispose();
    this.mainButtons = null;

    // ② 销毁抽卡覆盖层
    this.gachaOverlay?.dispose();

    // ③ 销毁 UI 层
    this.uiManager?.dispose();

    // ④ 销毁 3D 场景
    this.shipScene?.dispose();
    this.shipScene = null;

    // ⑤ 清空引用
    this.session = null;
    this.onDepart = undefined;
    console.log('[ShipMode] 舰船场景已卸载');
  }

  update(_dt: number): void {
    // 舰船中不需要每帧更新（UI 为事件驱动）
  }

  render(): void {
    if (this.scene && this.camera && this.renderer) {
      this.renderer.render(this.scene, this.camera);
      // 主页面按钮覆盖层（不清除背景；autoClear 配对在组件内部）
      this.mainButtons?.render(this.renderer);
    }
  }

  /** 出击：计算战斗属性并回调主流程 */
  private doDepart(): void {
    if (!this.session || !this.onDepart) return;
    const combatStats = computeCombatStats(this.session, RELIC_CONFIG);
    this.session.dayProgress.hasDepartedToday = true;
    SaveSystem.save(this.session);
    this.onDepart(this.session.meta.day, combatStats);
  }

  /** 主页面按钮业务路由（action→抽卡覆盖层；其余→面板开关） */
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
