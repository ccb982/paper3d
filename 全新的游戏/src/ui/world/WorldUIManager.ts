// ============================================================
// WorldUIManager.ts —— 世界 UI 管理器
// 封装 HUD、小地图、准星、交互提示、浮动文字、对话气泡。
// 继承 BaseInteractionUI 统一管理弹窗栈。
// ★ 它取代了旧的 services/ui/UILayer（那份已随重构删除，不再保留空壳）。
// ============================================================

import { BaseInteractionUI } from '../BaseInteractionUI';
import type { GameSession } from '../../core/Session';
import { computeCombatStats } from '../../core/Session';
import { RELIC_ITEM_CONFIG, relicKindOf } from '../../config/relics';
import type { WorldUIState } from '../../core/WorldUIState';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryPanel } from '../shared/InventoryPanel';
import { CharacterStatsPanel, type CharacterStatsSnapshot } from '../shared/CharacterStatsPanel';
import { Minimap } from '../../services/ui/Minimap';
import { MapPanel } from './MapPanel';
import { MapMarkers } from '../../services/ui/MapMarkers';
import { NavHints } from '../../services/ui/NavHints';
import { PlayerHud } from '../../services/ui/PlayerHud';
import { Crosshair } from '../../services/ui/Crosshair';
import { AmmoPanel } from '../../services/ui/AmmoPanel';
import { AllyHud } from '../../services/ui/AllyHud';
import { EnemyKillHud } from '../../services/ui/EnemyKillHud';
import { RasterMap } from '../../services/map/RasterMap';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import { createBackButton } from '../components/BackButton';
import { CSS } from '../shared/UIConstants';
import { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import type { FinalStats } from '../../services/combat/FinalStats';

export type FloatingTextType = 'normal' | 'crit' | 'heal' | 'miss' | 'pickup';

export class WorldUIManager extends BaseInteractionUI {
  private minimap: Minimap;
  /** ★ 世界地图面板（M 键；读地形记录表，chunk 卸载不丢） */
  private mapPanel: MapPanel | null = null;
  /** ★ 玩家标记点（大地图放置；小地图 + 场景方位提示共用同一份实例） */
  private mapMarkers = new MapMarkers();
  /** ★ 地图数据变更回调（标记增删 → 世界状态立即落盘） */
  onMapChanged: (() => void) | null = null;
  /** ★ 场景方位提示（右下角：舰船 / 标记点的方向 + 距离） */
  private navHints = new NavHints();
  private hud: PlayerHud;
  private crosshair: Crosshair;
  private ammoPanel: AmmoPanel;
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
  /** ★ 角色属性栏（背包面板左栏；橘色方舟风） */
  private characterStatsPanel = new CharacterStatsPanel();
  private flashItemId: string | null = null;
  private flashTimer: number | undefined = undefined;
  /** ★ 获得物品播报栈（用户手绘 JSON《页面布局/获得物品.json》右上区域）：
   *  每次拾取生成一条面板向下堆叠；到期向下滑动 + 淡出后移除（播报式）。 */
  private pickupStack: HTMLDivElement | null = null;
  private pickupToasts: { el: HTMLDivElement; timer: number; dying: boolean }[] = [];
  /** 同屏最多保留条数（超出时最早的一条立即退场） */
  private static readonly PICKUP_TOAST_MAX = 5;
  /** 单条停留时长（ms） */
  private static readonly PICKUP_TOAST_LIFE_MS = 1800;
  private iconRegistry: ItemIconRegistry | null = null;

  /** ★ 注入共享图标服务（背包/加工台等复用同一份缓存） */
  setIconRegistry(reg: ItemIconRegistry): void {
    this.iconRegistry = reg;
  }
  /** ★ 死亡复活倒计时（屏幕中央；null = 隐藏） */
  private respawnEl: HTMLDivElement | null = null;
  /** ★ 玩家最终属性提供者（WorldMode 注入 queryFinalStats；面板实时显示含限时 buff） */
  private playerStatsProvider: (() => FinalStats) | null = null;
  /** ★ 航行期停靠按钮 */
  private dockBtn: HTMLButtonElement | null = null;
  /** ★ 顶部状态条：左 = 敌人数量（击杀/当天总数），右 = 舰船生命（红字纯数字）
   *  素材《敌人数量和舰船生命》（644×68）等比缩到 46px 高、水平居中于屏幕最顶部。
   *  旧版"舰船 HP/油量"单行文本已废弃；油量改在舰内面板（ShipPanels）查看。 */
  private enemyKillHud = new EnemyKillHud();
  /** ★ 舰船受击报警：顶部大横幅 + 全屏红晕（脉冲闪烁；剩余秒数） */
  private shipAlertEl: HTMLDivElement | null = null;
  private shipVignetteEl: HTMLDivElement | null = null;
  /** ★ 自爆单位逼近提醒（边框红晕；强度 0~1 驱动 + 脉冲） */
  private dangerVignetteEl: HTMLDivElement | null = null;
  /** ★ 爆炸闪光（近处爆炸全屏橙白闪） */
  private explosionFlashEl: HTMLDivElement | null = null;
  private shipAlertTimer = 0;
  /** ★ 敌袭预警/战报横幅（顶部居中；《Director》节奏播报） */
  private assaultBannerEl: HTMLDivElement | null = null;
  /** ★ 访客到访提示（金色横幅；独立于敌袭横幅，到时自动隐藏） */
  private visitorNoticeEl: HTMLDivElement | null = null;
  private visitorNoticeTimer = 0;
  /** ★ 通用临时通知（自动淡出；与敌袭横幅 / 访客提示三通道互不干扰） */
  private noticeEl: HTMLDivElement | null = null;
  private noticeTimer = 0;
  /** ★ 敌军攻势档位（顶部小字；EnemyScaling） */
  private enemyScaleEl: HTMLDivElement | null = null;
  /** ★ 舰船遇围警示横幅（顶部红色播报；WorldMode 统计近舰敌军数驱动） */
  private enemyGroupWarnEl: HTMLDivElement | null = null;
  private lastEnemyGroupWarnText = '';
  /** ★ 进舰提示（靠近舰船按 E） */
  private boardPromptEl: HTMLDivElement | null = null;
  /** ★ 战斗 HUD 显隐（航行操船期隐藏：血条/准星/快捷栏/友军列表） */
  private combatHudVisible = true;

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    _interactionManager: InteractionManager,
    private raster: RasterMap,
    /** ★ 当前出生点（世界持久化后每天随机；小地图预热中心校验用） */
    spawn?: { x: number; z: number },
    /** ★ 持久化探索记忆（2026-09-19 重构：小地图单一恢复路径） */
    initialExplored?: import('../../services/map/ExploredMask').ExploredMaskState | null,
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

    this.mapMarkers.onChange = () => this.onMapChanged?.();
    this.minimap = new Minimap(
      raster, undefined, undefined, undefined, undefined, undefined,
      spawn ? Math.floor(spawn.x) : undefined,
      spawn ? Math.floor(spawn.z) : undefined,
      initialExplored ?? null,
    );
    this.hud = new PlayerHud();
    this.crosshair = new Crosshair();
    // ★ 左下角弹药栏（显示背包弹药类型/数量；点击切换当前弹药）
    this.ammoPanel = new AmmoPanel(itemManager);
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
    this.minimap.update(
      ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw,
      ctx.entities, ctx.swarm, this.mapMarkers, ctx.shipPosition ?? null,
    );
    // ★ 场景方位提示（右下角）：舰船 + 标记点的方向/距离；与地图同源、零分配
    this.navHints.update(
      ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw,
      ctx.shipPosition ?? null, this.mapMarkers,
    );
    // ★ 舰船受击报警：横幅脉冲闪烁 + 红晕随剩余时间渐隐
    if (this.shipAlertTimer > 0) {
      this.shipAlertTimer -= dt;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 1000 * 9));
      if (this.shipAlertEl) this.shipAlertEl.style.opacity = String(pulse);
      if (this.shipVignetteEl) {
        const fade = Math.max(0, Math.min(1, this.shipAlertTimer / 1.8));
        this.shipVignetteEl.style.opacity = String(fade * (0.35 + 0.45 * pulse));
      }
      if (this.shipAlertTimer <= 0) {
        if (this.shipAlertEl) this.shipAlertEl.style.display = 'none';
        if (this.shipVignetteEl) this.shipVignetteEl.style.display = 'none';
      }
    }
    // ★ 访客到访提示：到时淡出（最后一秒渐隐）
    if (this.visitorNoticeTimer > 0) {
      this.visitorNoticeTimer -= dt;
      const el = this.visitorNoticeEl;
      if (el) {
        if (this.visitorNoticeTimer <= 0) el.style.display = 'none';
        else if (this.visitorNoticeTimer < 1) el.style.opacity = String(Math.max(0, this.visitorNoticeTimer));
      }
    }
    // ★ 通用临时通知：到时淡出（最后一秒渐隐）
    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      const el = this.noticeEl;
      if (el) {
        if (this.noticeTimer <= 0) el.style.display = 'none';
        else if (this.noticeTimer < 1) el.style.opacity = String(Math.max(0, this.noticeTimer));
      }
    }
    // ★ 世界地图面板（打开时才重绘）
    if (this.mapPanel?.isOpen) {
      this.mapPanel.update(dt, ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw, ctx.entities, ctx.swarm);
    }
    // ★ 航行操船期：战斗 HUD（血条/快捷栏/友军列表）不绘制也不更新
    if (this.combatHudVisible) {
      this.hud.update(ctx.playerStats.hp, ctx.playerStats.maxHp);
      this.ammoPanel.update(ctx.ammoEntries);
      this.allyHud.update(ctx.allies);
    }
    // ★ 背包打开时：实时刷新属性栏生命（关着零开销）
    if (this.isInventoryOpen) {
      this.characterStatsPanel.updateHp(ctx.playerStats.hp, ctx.playerStats.maxHp);
    }

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

  /** ★ 注入玩家最终属性提供者（打开属性面板时实时取；缺省回退装备配置计算） */
  setPlayerStatsProvider(fn: (() => FinalStats) | null): void {
    this.playerStatsProvider = fn;
  }

  /** ★ 航行期停靠按钮（点击/按 F 停靠） */
  setDockButton(onDock: () => void): void {
    if (this.dockBtn) return;
    const btn = document.createElement('button');
    btn.textContent = '停靠 (F)';
    btn.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
      'z-index:60', 'padding:10px 34px', 'font-size:16px', 'font-weight:bold',
      'color:#eaf6ff', 'background:rgba(24,44,72,0.85)',
      'border:2px solid #6ab0ff', 'border-radius:10px', 'cursor:pointer',
      'letter-spacing:2px', 'text-shadow:0 1px 3px #000',
      'box-shadow:0 0 14px rgba(106,176,255,0.35)',
    ].join(';');
    btn.addEventListener('click', () => onDock());
    document.body.appendChild(btn);
    this.dockBtn = btn;
  }

  setDockButtonVisible(v: boolean): void {
    if (this.dockBtn) this.dockBtn.style.display = v ? 'block' : 'none';
  }

  /** ★ 顶部状态条刷新（左：敌人数量 击杀/当天总数；右：舰船生命红字纯数字）
   *  —— 用户定调 2026-09-16：素材图放在屏幕最顶部；舰船生命**不要血条**、只显示数字，
   *     ≥90% 白 / ≥30% 黄 / 更低红橙。旧版"舰船 HP/油量"单行文本已废弃（油量仍由独立渠道展示）。 */
  setShipStatus(
    hp: number, maxHp: number,
    kills: number, total: number,
  ): void {
    this.enemyKillHud.update(kills, total, hp, maxHp);
  }

  /** ★ 顶部状态条显隐（舰内/结算时可收起） */
  setShipStatusVisible(v: boolean): void {
    this.enemyKillHud.setVisible(v);
  }

  /** ★ 舰船受击：明显 UI 报警（顶部大横幅 + 全屏红晕脉冲 + 状态条闪红）——
   *  持续 ~1.8s（摧毁时 3s）；每次受击刷新计时与伤害数字。
   *  由 WorldMode 订阅 `ship_damaged` 事件调用；与"敌袭预警横幅"分层（top 不同）。 */
  triggerShipAlert(damage: number, destroyed = false): void {
    if (!this.shipAlertEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:66px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:70', 'pointer-events:none', 'text-align:center', 'white-space:nowrap',
        'font-size:22px', 'font-weight:bold', 'letter-spacing:3px',
        'padding:8px 26px', 'border-radius:6px',
        'background:rgba(60,6,6,0.72)', 'border:2px solid rgba(255,70,70,0.85)',
        'color:#ffd9d0', 'text-shadow:0 2px 4px #000, 0 0 16px rgba(255,60,50,0.85)',
      ].join(';');
      document.body.appendChild(el);
      this.shipAlertEl = el;
    }
    if (!this.shipVignetteEl) {
      const v = document.createElement('div');
      v.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:69', 'pointer-events:none',
        'box-shadow:inset 0 0 140px rgba(255,30,30,0.85)',
      ].join(';');
      document.body.appendChild(v);
      this.shipVignetteEl = v;
    }
    this.shipAlertTimer = destroyed ? 3.0 : 1.8;
    this.shipAlertEl.textContent = destroyed
      ? '⚠ 舰船已被摧毁！'
      : `⚠ 舰船正在遭受攻击！  -${Math.ceil(damage)}`;
    this.shipAlertEl.style.display = 'block';
    this.shipVignetteEl.style.display = 'block';
    this.shipAlertEl.style.opacity = '1';
    this.shipVignetteEl.style.opacity = '0.75';
  }

  /** ★ 自爆危急提醒（2026-09-19）：屏幕边框发红（强度 0~1，随距离逐强）。
   *  与舰船受击红晕分层（z-index 68 < 69）；intensity ≤ 0 → 隐藏。 */
  setDangerVignette(intensity: number): void {
    if (intensity <= 0.01) {
      if (this.dangerVignetteEl) this.dangerVignetteEl.style.opacity = '0';
      return;
    }
    if (!this.dangerVignetteEl) {
      const v = document.createElement('div');
      v.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:68', 'pointer-events:none',
        'box-shadow:inset 0 0 120px 28px rgba(255,20,20,0.92)',
        'opacity:0', 'transition:opacity 0.12s linear',
      ].join(';');
      document.body.appendChild(v);
      this.dangerVignetteEl = v;
    }
    // 脉冲（时间正弦：不依赖 CSS 关键帧注入，与舰船预警同节奏感）
    const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 90);
    this.dangerVignetteEl.style.opacity = String(Math.min(1, intensity * pulse));
  }

  /** ★ 爆炸闪光（2026-09-19）：近处爆炸→全屏橙白闪（强度 0~1，随距离衰减）。
   *  实现：立即上到 intensity → 下一帧起 0.28s 淡出。 */
  flashExplosion(intensity: number): void {
    if (intensity <= 0.02) return;
    if (!this.explosionFlashEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:67', 'pointer-events:none',
        'background:radial-gradient(circle at 50% 55%, rgba(255,240,200,0.95) 0%, ' +
          'rgba(255,140,40,0.55) 35%, rgba(255,60,20,0) 70%)',
        'opacity:0', 'transition:opacity 0.28s ease-out',
      ].join(';');
      document.body.appendChild(el);
      this.explosionFlashEl = el;
    }
    const el = this.explosionFlashEl;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(0.85, intensity));
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.28s ease-out';
      el.style.opacity = '0';
    });
  }

  /** ★ 敌袭预警/战报横幅（顶部居中，打字机感描边；null = 隐藏）
   *  用法：倒计时期间每秒更新文案；开战换成"敌军来袭！"；结束传 null 清除。 */
  setAssaultBanner(text: string | null, danger = true): void {
    if (text === null) {
      if (this.assaultBannerEl) this.assaultBannerEl.style.display = 'none';
      return;
    }
    if (!this.assaultBannerEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:38px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:65', 'pointer-events:none', 'text-align:center', 'white-space:nowrap',
        'font-size:17px', 'font-weight:bold', 'letter-spacing:2px',
        'padding:6px 18px', 'border-radius:4px',
        'background:rgba(30,10,10,0.55)',
        'color:#ffb3a0', 'text-shadow:0 1px 3px #000, 0 0 10px rgba(255,80,60,0.55)',
      ].join(';');
      document.body.appendChild(el);
      this.assaultBannerEl = el;
    }
    const el = this.assaultBannerEl;
    el.style.display = 'block';
    el.style.color = danger ? '#ffb3a0' : '#cfe8ff';
    el.style.background = danger ? 'rgba(30,10,10,0.55)' : 'rgba(10,16,26,0.55)';
    el.textContent = text;
  }

  /** ★ 访客到访提示（金色大横幅：停留 seconds 秒后淡出；与敌袭横幅互不干扰） */
  showVisitorNotice(text: string, seconds = 14): void {
    if (!this.visitorNoticeEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:84px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:65', 'pointer-events:none', 'text-align:center', 'white-space:nowrap',
        'font-size:20px', 'font-weight:bold', 'letter-spacing:3px',
        'padding:9px 27px', 'border-radius:7px',
        'background:rgba(28,21,7,0.78)', 'color:#ffd87a',
        'border:1px solid rgba(255,216,122,0.45)',
        'text-shadow:0 2px 8px #000, 0 0 22px rgba(255,210,120,0.9)',
        'transition:opacity 0.4s',
      ].join(';');
      document.body.appendChild(el);
      this.visitorNoticeEl = el;
    }
    this.visitorNoticeEl.textContent = text;
    this.visitorNoticeEl.style.display = 'block';
    this.visitorNoticeEl.style.opacity = '1';
    this.visitorNoticeTimer = seconds;
  }

  /** ★ 通用临时通知（青色横幅，停 seconds 秒后 1s 渐隐）
   *  用途：非战斗、非访客的状态播报，如「今日敌军已肃清」。
   *  通道独立于 setAssaultBanner（敌袭）与 showVisitorNotice（访客），三者互不覆盖。 */
  showNotice(text: string, seconds = 8): void {
    if (!this.noticeEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:124px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:65', 'pointer-events:none', 'text-align:center', 'white-space:nowrap',
        'font-size:18px', 'font-weight:bold', 'letter-spacing:2px',
        'padding:8px 22px', 'border-radius:6px',
        'background:rgba(12,20,30,0.74)', 'color:#bfe0ff',
        'border:1px solid rgba(150,200,255,0.40)',
        'text-shadow:0 2px 6px #000, 0 0 16px rgba(140,200,255,0.75)',
        'transition:opacity 0.4s',
      ].join(';');
      document.body.appendChild(el);
      this.noticeEl = el;
    }
    this.noticeEl.textContent = text;
    this.noticeEl.style.display = 'block';
    this.noticeEl.style.opacity = '1';
    this.noticeTimer = seconds;
  }

  /** 隐藏访客到访提示（进舰/谈完/访客离开时调用） */
  clearVisitorNotice(): void {
    this.visitorNoticeTimer = 0;
    if (this.visitorNoticeEl) this.visitorNoticeEl.style.display = 'none';
  }

  /** ★ 敌军攻势档位（顶部小字；《EnemyScaling.ts》统一口径：低/较低/中/较高/极高） */
  setThreatLabel(text: string, color = '#ffcf9a'): void {
    if (!this.enemyScaleEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:28px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:60', 'pointer-events:none', 'text-align:center',
        'font-size:12px', 'letter-spacing:1px',
        'color:#ffcf9a', 'text-shadow:0 1px 2px #000',
      ].join(';');
      document.body.appendChild(el);
      this.enemyScaleEl = el;
    }
    this.enemyScaleEl.textContent = text;
    this.enemyScaleEl.style.color = color;
  }

  /** ★ 舰船遇围警示播报（顶部红色横幅，独立于敌袭预警/访客横幅）：
   *   count = 近舰敌军数；文本不变不重写（WorldMode 每帧驱动）；clear 隐藏。 */
  showEnemyGroupWarning(count: number): void {
    const text = `⚠ 大量敌人正在逼近舰船！　当前 ${count} 名接近中`;
    if (text === this.lastEnemyGroupWarnText) return;
    this.lastEnemyGroupWarnText = text;
    if (!this.enemyGroupWarnEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:112px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:65', 'pointer-events:none', 'text-align:center', 'white-space:nowrap',
        'font-size:18px', 'font-weight:bold', 'letter-spacing:2px',
        'padding:7px 20px', 'border-radius:5px',
        'background:rgba(46,10,8,0.82)', 'border:1px solid rgba(255,96,70,0.85)',
        'color:#ffc9a0', 'text-shadow:0 1px 3px #000, 0 0 12px rgba(255,70,40,0.8)',
      ].join(';');
      document.body.appendChild(el);
      this.enemyGroupWarnEl = el;
    }
    const el = this.enemyGroupWarnEl;
    el.textContent = text;
    el.style.display = 'block';
  }

  /** 隐藏舰船遇围警示（敌军散去 / 离探索 / 舰船被毁） */
  clearEnemyGroupWarning(): void {
    this.lastEnemyGroupWarnText = '';
    if (this.enemyGroupWarnEl) this.enemyGroupWarnEl.style.display = 'none';
  }

  /** ★ 小地图显隐（舰内房间隐藏；世界/航行保持显示）—— 场景方位提示同步收起 */
  /** ★ 小地图探索记忆（世界状态持久化用） */
  getMinimapExploredState(): import('../../services/map/ExploredMask').ExploredMaskState | null {
    return this.minimap?.exportExploredState() ?? null;
  }

  /** ★ 地图标记持久化面（世界状态持久化用） */
  getMapMarkersState(): import('../../core/WorldStateCache').MarkerRec[] {
    return this.mapMarkers.exportState();
  }

  /** ★ 恢复地图标记（进入世界时调用；替代"每天清空"） */
  loadMapMarkersState(list: import('../../core/WorldStateCache').MarkerRec[]): void {
    this.mapMarkers.importState(list);
  }

  setMinimapVisible(v: boolean): void {
    this.minimap.setVisible(v);
    this.navHints.setVisible(v);
  }

  /** ★ 世界地图面板是否打开（输入门控：打开时丢弃视角/缩放） */
  get isMapPanelOpen(): boolean {
    return this.panels.isOpen('map-panel');
  }

  /** ★ 开关世界地图面板（M 键；地形记录表 + 探索记忆，chunk 卸载不丢） */
  toggleMapPanel(): void {
    if (this.panels.isOpen('map-panel')) {
      this.closePanel('map-panel');
      return;
    }
    this.mapPanel ??= new MapPanel(this.raster, this.minimap, this.mapMarkers);
    const panel = this.mapPanel;
    // ★ 面板遮罩是半透明 → 航行期停靠按钮（z60）会透出来；记下开图前的显隐，
    //   开图时藏掉、关图时恢复（2026-09-16 修复）
    const dockWasVisible = !!this.dockBtn && this.dockBtn.style.display !== 'none';
    this.openPanel({
      id: 'map-panel',
      onOpen: () => {
        if (this.dockBtn) this.dockBtn.style.display = 'none';
        panel.open(() => this.closePanel('map-panel'));
      },
      onClose: () => {
        if (this.dockBtn) this.dockBtn.style.display = dockWasVisible ? 'block' : 'none';
        panel.close();
      },
      render: () => panel.root,
    });
  }

  /** ★ 交互提示（靠近舰船/事件 NPC 按 E；探索期显示，其余隐藏；文案由调用方给） */
  setBoardPrompt(visible: boolean, text = 'E · 进入舰船'): void {
    if (!visible) {
      if (this.boardPromptEl) this.boardPromptEl.style.display = 'none';
      return;
    }
    if (!this.boardPromptEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:16%', 'transform:translateX(-50%)',
        'z-index:65', 'pointer-events:none', 'white-space:pre',
        'color:#cfe8ff', 'background:rgba(12,20,34,0.88)',
        'border:1px solid rgba(106,176,255,0.7)', 'border-radius:8px',
        'padding:6px 16px', 'font:14px "Microsoft YaHei",sans-serif',
        'text-shadow:0 1px 3px #000',
      ].join(';');
      el.textContent = text;
      document.body.appendChild(el);
      this.boardPromptEl = el;
    }
    if (this.boardPromptEl.textContent !== text) this.boardPromptEl.textContent = text;
    this.boardPromptEl.style.display = 'block';
  }

  /** ★ 舰船被摧毁面板（真结局触发；按钮"复活"回调，暂不删档） */
  showShipDestroyedPanel(onRevive: () => void): void {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:26px 40px;color:#f2e3d0;font-size:14px;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '舰船已被摧毁';
    title.style.cssText = 'font-size:22px;font-weight:bold;color:#ff8a8a;letter-spacing:3px;text-shadow:0 0 12px rgba(255,80,80,0.5);';
    const body = document.createElement('div');
    body.textContent = '本次航行到此为止。';
    body.style.cssText = 'color:#c9b8a2;';
    const btn = createButton({ label: '复活', size: 'md', onClick: () => {
      this.closePanel('ship-destroyed');
      onRevive();
    } });
    content.append(title, body, btn);
    this.openPanel({ id: 'ship-destroyed', onOpen: () => {}, onClose: () => {}, render: () => content });
  }

  /** ★ 通关面板（击败普瑞赛斯；按钮回调 = 返回基地） */
  showVictoryPanel(onConfirm: () => void): void {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 44px;color:#f6ecd8;font-size:14px;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '普瑞赛斯已被击败';
    title.style.cssText = 'font-size:24px;font-weight:bold;color:#ffd87a;letter-spacing:4px;text-shadow:0 0 14px rgba(255,200,90,0.55);';
    const body = document.createElement('div');
    body.textContent = '四维空间归于沉寂。这一切，结束了。';
    body.style.cssText = 'color:#d8c8a8;line-height:1.8;';
    const btn = createButton({ label: '返回基地', size: 'md', onClick: () => {
      this.closePanel('victory');
      onConfirm();
    } });
    content.append(title, body, btn);
    this.openPanel({ id: 'victory', onOpen: () => {}, onClose: () => {}, render: () => content });
  }

  /** ★ 死亡复活倒计时（屏幕中央大字；null = 隐藏） */
  setRespawnCountdown(seconds: number | null): void {
    if (seconds === null) {
      if (this.respawnEl) this.respawnEl.style.display = 'none';
      return;
    }
    if (!this.respawnEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'left:50%', 'top:38%', 'transform:translate(-50%,-50%)',
        'z-index:400', 'pointer-events:none', 'text-align:center',
        'color:#ff6b6b', 'font-size:30px', 'font-weight:bold', 'font-style:italic',
        'letter-spacing:2px',
        'text-shadow:0 0 12px rgba(255,60,60,0.8),1px 1px 3px #000',
      ].join(';');
      document.body.appendChild(el);
      this.respawnEl = el;
    }
    this.respawnEl.style.display = 'block';
    this.respawnEl.textContent = `复活倒计时 ${seconds.toFixed(1)}s`;
  }

  /** 显示拾取结果：右上角"获得物品"面板（手绘 JSON 布局，左图标 + 右文字）；
   *  背包满 → 失败文案（图标淡化）。可叠加：每次生成一条，向下堆叠、到期下滑淡出。 */
  showPickupResult(itemId: string, success: boolean, count = 1): void {
    const name = this.displayNameOf(itemId);
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

  /** ★ 播报显示名：普通物品走 archetype；**遗物不在 items.json**（getArchetype 返回 null），
   *  回退查 relics.ts —— 否则对话给遗物会播报成 `获得了 black_crown` 这种原始 id。 */
  private displayNameOf(itemId: string): string {
    const arch = this.itemManager.getArchetype(itemId);
    if (arch) return arch.name;
    return RELIC_ITEM_CONFIG[itemId]?.name ?? itemId;
  }

  /** 退场：向下滑动 + 淡出 → 移除（幂等） */
  private dismissPickupToast(rec: { el: HTMLDivElement; timer: number; dying: boolean }): void {
    if (rec.dying) return;
    rec.dying = true;
    clearTimeout(rec.timer);
    const i = this.pickupToasts.indexOf(rec);
    if (i >= 0) this.pickupToasts.splice(i, 1);
    rec.el.style.transform = 'translateY(23px)';
    rec.el.style.opacity = '0';
    setTimeout(() => rec.el.remove(), 300);
  }

  /** 单条播报面板：灰黑半透明，左 = 物品图标，右 = 文字（失败红字 + 图标淡化）；
   *  ★ 用户定调：先按手绘面板放大 2×，再缩小 1/3（净 ≈1.33×）；
   *  2026-09-14 两次"面积 +25%"→ 线性累计 ×1.25（面积 ×1.5625）。 */
  private buildPickupToast(itemId: string, success: boolean, label: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:100%', 'min-height:74px', 'display:flex', 'align-items:center', 'gap:13px',
      'padding:10px 17px', 'box-sizing:border-box',
      'background:rgba(18,20,24,0.72)', 'border:1px solid rgba(255,255,255,0.10)',
      'border-radius:13px', 'pointer-events:none',
      // 入场起点：上方 17px + 全透明；位移动画统一由 transform/opacity 过渡驱动
      'transform:translateY(-17px)', 'opacity:0',
      'transition:transform .22s ease,opacity .22s ease',
    ].join(';');
    const icon = document.createElement('div');
    icon.style.cssText = 'flex:0 0 auto;width:60px;height:60px;display:flex;align-items:center;justify-content:center;';
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
      'flex:1 1 auto', 'font-size:21px', 'line-height:1.35',
      'text-shadow:0 1px 2px rgba(0,0,0,.6)',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      `color:${success ? '#e8ecf2' : '#ff9a9a'}`,
    ].join(';');
    panel.appendChild(icon);
    panel.appendChild(text);
    return panel;
  }

  /** 惰性建播报栈容器：位置按手绘 JSON 归一化坐标换算；
   *  宽度 12.18% × 2 × (2/3) = 16.24%，两次"面积 +25%"后 ≈ 20.3%；
   *  叠加为列，单条高度取内容高度 74px 起。 */
  private ensurePickupStack(): HTMLDivElement {
    if (this.pickupStack) return this.pickupStack;
    const stack = document.createElement('div');
    stack.style.cssText = [
      'position:fixed', 'top:8.97%', 'right:0.16%', 'width:20.3%',
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

  /** ★ 战斗 HUD 整体显隐（航行操船期 false；停靠进入探索后 true） */
  setCombatHudVisible(v: boolean): void {
    if (this.combatHudVisible === v) return;
    this.combatHudVisible = v;
    this.hud.setVisible(v);
    this.ammoPanel.setVisible(v);
    this.allyHud.setVisible(v);
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

  /** ★ 弹药栏：点击切换回调（WorldMode 注入 → 更新当前弹药） */
  setAmmoSelector(cb: (id: string) => void): void {
    this.ammoPanel.setSelector(cb);
  }

  /** 背包面板是否打开（由弹窗栈实际状态推导，与手动关闭按钮保持同步） */
  get isInventoryOpen(): boolean {
    return this.panels.isOpen('inventory-panel');
  }

  private renderInventoryPanel(): void {
    const content = document.createElement('div');
    content.className = 'ui-panel-inner';

    // ★ 标题栏：统一返回按钮（左上角）+ 标题
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;';
    head.appendChild(createBackButton({
      onClick: () => this.closePanel('inventory-panel'),
    }));
    const title = document.createElement('div');
    title.className = CSS.panelTitle;
    title.style.marginBottom = '0';
    title.textContent = '背包';
    head.appendChild(title);
    content.appendChild(head);

    // ★ 独立背包模块渲染（标签页 + 网格）—— 渲染进独立子容器，避免清空标题栏
    const gridRoot = document.createElement('div');
    // ★ 无横向滚动条：宽度交给分栏总宽，纵向可滚
    gridRoot.style.cssText = 'flex:1 1 auto;min-width:0;overflow-y:auto;overflow-x:hidden;';

    // ★ 左右分栏：左 = 角色属性（橘色），右 = 背包；总宽加宽，避免横向滑块
    const columns = document.createElement('div');
    columns.style.cssText = [
      'display:flex', 'gap:12px', 'align-items:flex-start',
      'width:min(94vw,1120px)', 'box-sizing:border-box',
    ].join(';');
    const statsRoot = document.createElement('div');
    this.iconRegistry ??= new ItemIconRegistry(this.itemManager);
    this.characterStatsPanel.render(statsRoot, this.buildStatsSnapshot(), this.iconRegistry);
    columns.appendChild(statsRoot);
    columns.appendChild(gridRoot);
    content.appendChild(columns);

    this.inventoryPanel.render(gridRoot, this.flashItemId ?? undefined);

    this.openPanel({
      id: 'inventory-panel',
      onOpen: () => {},
      onClose: () => {},
      render: () => content,
    });
  }

  /** ★ 角色属性快照（打开背包时组装一次；局内天数/死亡/遗物不变，生命由 update 实时刷）
   *  三段语义：base（原始）→ perm（基础+遗物，永久）→ current（+装备，临时） */
  private buildStatsSnapshot(): CharacterStatsSnapshot {
    const base = this.session.player;
    const perm = computeCombatStats(this.session, RELIC_ITEM_CONFIG);
    const temp = this.itemManager.getEquipmentStats();
    const owned = this.session.outOfRun?.owned ?? {};
    const relics = Object.entries(owned)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([id, count]) => {
        const cfg = RELIC_ITEM_CONFIG[id];
        return {
          id,
          name: cfg?.name ?? id,
          count,
          // ★ BOSS（普瑞赛斯）不算遗物 → 面板单独挂「BOSS」区块
          kind: relicKindOf(id),
          iconFrame: cfg?.iconFrame ? cfg.iconFrame(count) : 0,
          description: cfg?.description ?? '',
        };
      });
    // ★ 优先用实时最终属性（含限时 buff/遗物变化）；无提供者时回退装备配置计算
    const live = this.playerStatsProvider?.() ?? null;
    const curAtk = live ? live.attackPower : Math.floor(perm.attackPower * (1 + temp.attackPct)) + temp.attackPower;
    const curDef = live ? live.defense : Math.floor(perm.defense * (1 + temp.defensePct)) + temp.defense;
    const curMaxHp = live ? live.maxHp : perm.maxHp + temp.maxHp;
    const extras: { label: string; perm: number; temp: number; suffix?: string }[] = live
      ? [
          { label: '攻击速度', perm: 100, temp: live.attackSpeed },
          { label: '伤害减免', perm: 0, temp: Math.round(live.damageReduction * 100), suffix: '%' },
          { label: '生命回复', perm: 0, temp: +live.hpRegen.toFixed(2), suffix: '/s' },
        ]
      : [
          { label: '攻击速度', perm: 100, temp: temp.attackSpeed },
          { label: '伤害减免', perm: 0, temp: Math.round(temp.damageReduction * 100), suffix: '%' },
          { label: '生命回复', perm: 0, temp: temp.hpRegen, suffix: '/s' },
        ];
    if (live) {
      if (live.critRate > 0) extras.push({ label: '暴击率', perm: 0, temp: Math.round(live.critRate * 100), suffix: '%' });
      if (live.dodgeRate > 0) extras.push({ label: '闪避率', perm: 0, temp: Math.round(live.dodgeRate * 100), suffix: '%' });
      if (live.blockRate > 0) extras.push({ label: '格挡率', perm: 0, temp: Math.round(live.blockRate * 100), suffix: '%' });
    }
    if (temp.allyRegen > 0) extras.push({ label: '友军回复', perm: 0, temp: +temp.allyRegen.toFixed(2), suffix: '/s' });
    return {
      base: { maxHp: base.maxHp, attackPower: base.attackPower, defense: base.defense },
      perm: { maxHp: perm.maxHp, attackPower: perm.attackPower, defense: perm.defense },
      temp: { maxHp: curMaxHp - perm.maxHp, attackPower: curAtk - perm.attackPower, defense: curDef - perm.defense },
      current: {
        maxHp: curMaxHp,
        attackPower: curAtk,
        defense: curDef,
      },
      extras,
      day: this.session.meta.day,
      deaths: this.session.meta.deaths ?? 0,
      relics,
    };
  }

  /** ★ 地图风格切换按钮（右上角悬浮；标签由外部状态刷新） */
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
    this.mapPanel?.dispose();
    this.mapPanel = null;
    this.navHints.dispose();
    this.mapMarkers.clear();
    this.hud.dispose();
    this.crosshair.dispose();
    this.ammoPanel.dispose();
    this.allyHud.dispose();
    // ★ 舰船相关 DOM（停靠按钮/状态条/复活倒计时）跨局防残留
    this.dockBtn?.remove();
    this.dockBtn = null;
    // ★ 顶部状态条（敌人数量 / 舰船生命）跨局防残留
    this.enemyKillHud.dispose();
    // ★ 舰船受击报警 DOM（横幅 + 红晕）跨局防残留
    this.shipAlertEl?.remove();
    this.shipAlertEl = null;
    this.shipVignetteEl?.remove();
    this.shipVignetteEl = null;
    // ★ 自爆危急提醒（边框红晕）跨局防残留
    this.dangerVignetteEl?.remove();
    this.dangerVignetteEl = null;
    this.explosionFlashEl?.remove();
    this.explosionFlashEl = null;
    this.shipAlertTimer = 0;
    this.assaultBannerEl?.remove();
    this.assaultBannerEl = null;
    this.visitorNoticeEl?.remove();
    this.visitorNoticeEl = null;
    this.visitorNoticeTimer = 0;
    this.noticeEl?.remove();
    this.noticeEl = null;
    this.noticeTimer = 0;
    this.enemyScaleEl?.remove();
    this.enemyScaleEl = null;
    this.boardPromptEl?.remove();
    this.boardPromptEl = null;
    this.respawnEl?.remove();
    this.respawnEl = null;
    this.interactPrompt.remove();
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