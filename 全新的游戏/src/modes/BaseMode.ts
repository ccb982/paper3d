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
import { RoomPostFx } from '../services/render/RoomPostFx';
import { MainButtons, type ButtonId } from '../ui/base/MainButtons';
import { DialogueView } from '../ui/shared/DialogueView';
import { DialogueSystem } from '../systems/dialogue/DialogueSystem';
import { EventSystem } from '../systems/events/EventSystem';
import { getPlatformAdapter } from '../platform';

/**
 * ★ 出击提示音（点击「开始行动」/「开始突袭」后播放）
 *   素材：public/music/哈吉马路由.mp3。
 *   文件名含中文 → 先 encodeURI 再交给 Audio，避免个别服务器/小程序
 *   对未编码路径的解析差异（本地 vite dev 与 build 产物都走这一条）。
 */
const DEPART_SFX = encodeURI('/music/哈吉马路由.mp3');

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
  /** ★ 房间屏幕叠加（暗角；在场景直渲之后叠加） */
  private roomFx: RoomPostFx | null = null;
  /** ★ 出击槽变动订阅（基地内换装：装备贴片/无人机即时刷新） */
  private deploymentUnsub: (() => void) | null = null;

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
      spaceBackdrop: true,        // ★ 基地背景：星空 + 自转地球
      bossAsset: ctx.bossAsset,   // ★ 彩蛋：地球转满 100 圈 → 普瑞赛斯出现
    });
    this.baseScene.setupCamera(ctx.camera!);
    // ★ 房间屏幕叠加（暗角；在场景渲染之后叠一层，不改色彩管线/深度关系）
    this.roomFx = new RoomPostFx();
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

    // ③.5 销毁对话模块
    this.dialogue?.close();
    this.dialogueView?.dispose();
    this.dialogueView = null;

    // ③ 销毁 UI 层
    this.uiManager?.dispose();

    // ④ 销毁基地 3D 空间（含暗角叠加层）
    this.roomFx?.dispose();
    this.roomFx = null;
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
    if (this.uiManager?.craftingOpen) return true;   // ★ 改查 ShipUIManager 的加工台实例
    if (this.craftingOverlay?.isOpen()) return true; // 兜底：本地另建的那份
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
      // ★ 场景照旧直渲（材质色彩空间 / 立绘深度关系零改动），随后叠暗角
      this.renderer.render(this.scene, this.camera);
      this.roomFx?.render(this.renderer);
      // 主页面按钮覆盖层（不清除背景；autoClear 配对在组件内部）
      this.mainButtons?.render(this.renderer);
    }
  }

  /**
   * 出击：回调主流程（战斗属性由 WorldMode 进图时统一刷新）
   * ★ 出击提示音在这里播（一次性，不循环）：抽卡页的行动按钮有
   *   「开始行动」/「开始突袭」两张脸，但点击后都汇到本方法，
   *   所以只需挂这一处就同时覆盖两者（含素材缺失时的「确定」兜底路径）。
   */
  private doDepart(): void {
    if (!this.session || !this.onDepart) return;
    // 音频统一走平台适配器（业务层不直接 new Audio）；无适配器时静默跳过
    getPlatformAdapter()?.audio.playSfx(DEPART_SFX);
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
