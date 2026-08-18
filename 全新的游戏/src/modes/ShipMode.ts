// ============================================================
// ShipMode.ts —— 舰船日常模式
// 3D 舰船场景 + UI 三面板（行动/编队/干员）+ 背包对接 + 存档
// ============================================================

import * as THREE from 'three';
import type { Mode } from '../core/ModeManager';
import type { GameSession, InventoryGrid, PlayerCombatStats } from '../core/Session';
import { createEmptyGrid, countItemsInGrid, addItemToGrid, computeCombatStats } from '../core/Session';
import { SaveSystem } from '../core/SaveSystem';
import { eventBus } from '../core/EventBus';
import { RELIC_CONFIG } from '../config/relics';

// ============================================================
// 类型定义
// ============================================================

type ShipPanel = 'action' | 'formation' | 'operator' | 'inventory' | 'gacha' | 'none';

interface ShipModeContext {
  session: GameSession;
  onDepart: (day: number, combatStats: any) => void;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}

// ============================================================
// 舰船场景布局（简单占位地图）
// ============================================================

const SHIP_SIZE = 24; // 舰船区域大小
const WALL_HEIGHT = 3;
const ROOM_LAYOUT = {
  // 布局: [x, z, width, depth, color, label]
  rooms: [
    { x: -8, z: -8, w: 6, d: 6, color: 0x4a4a6a, label: 'L1 仓库' },
    { x: 2, z: -8, w: 6, d: 6, color: 0x6a4a4a, label: '出口' },
    { x: -8, z: 2, w: 6, d: 6, color: 0x4a6a4a, label: '招募区' },
    { x: 2, z: 2, w: 6, d: 6, color: 0x6a6a4a, label: '休息区' },
  ],
  center: { x: -3, z: -3 }, // 舰船中心区域
};

// ============================================================
// ShipMode 类
// ============================================================

export class ShipMode implements Mode {
  readonly id = 'ship' as const;

  // 场景对象
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private shipGroup = new THREE.Group();
  private uiRoot: HTMLElement | null = null;

  // 数据
  private session: GameSession | null = null;
  private onDepart: ((day: number, combatStats: any) => void) | null = null;

  // UI 状态
  private currentPanel: ShipPanel = 'none';
  private panelContainer: HTMLElement | null = null;
  private clock = new THREE.Clock();

  // ============================================================
  // Mode 接口实现
  // ============================================================

  onEnter(ctx: ShipModeContext): void {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.session = ctx.session;
    this.onDepart = ctx.onDepart;

    // 构建舰船场景
    this.buildShipScene();

    // 设置相机（俯视视角）
    this.setupCamera();

    // 创建 UI
    this.createUI();

    // 触发存档事件
    eventBus.emit('save_complete', {});
    console.log('[ShipMode] 舰船场景已加载');
  }

  onExit(): void {
    this.disposeShipScene();
    this.disposeUI();
    this.session = null;
    this.onDepart = null;
    console.log('[ShipMode] 舰船场景已卸载');
  }

  /** 出击：计算战斗属性并回调主流程 */
  private doDepart(): void {
    if (!this.session || !this.onDepart) return;
    const combatStats = computeCombatStats(this.session, RELIC_CONFIG);
    this.session.dayProgress.hasDepartedToday = true;
    SaveSystem.save(this.session);
    this.onDepart(this.session.meta.day, combatStats);
  }

  update(dt: number): void {
    // 缓慢旋转舰船灯光/装饰 (可选)
  }

  render(): void {
    if (this.scene && this.camera && this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ============================================================
  // 3D 舰船场景构建
  // ============================================================

  private buildShipScene(): void {
    if (!this.scene) return;

    // 清除旧场景
    this.disposeShipScene();

    // ---- 地面（舰船甲板） ----
    const deckGeo = new THREE.PlaneGeometry(SHIP_SIZE, SHIP_SIZE);
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a5a,
      roughness: 0.8,
      metalness: 0.3,
    });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.05;
    deck.receiveShadow = true;
    this.shipGroup.add(deck);

    // ---- 甲板网格线（装饰） ----
    const gridHelper = new THREE.GridHelper(SHIP_SIZE, 12, 0x6a6a8a, 0x4a4a6a);
    gridHelper.position.y = 0.01;
    this.shipGroup.add(gridHelper);

    // ---- 边界墙（半透明，标记舰船范围） ----
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x4a4a8a,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const wallPositions = [
      { x: 0, z: -SHIP_SIZE / 2, ry: 0 },   // 前
      { x: 0, z: SHIP_SIZE / 2, ry: 0 },     // 后
      { x: -SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 }, // 左
      { x: SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 },  // 右
    ];
    for (const wp of wallPositions) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(SHIP_SIZE, WALL_HEIGHT), wallMat);
      wall.position.set(wp.x, WALL_HEIGHT / 2, wp.z);
      wall.rotation.y = wp.ry;
      this.shipGroup.add(wall);
    }

    // ---- 房间区域 ----
    for (const room of ROOM_LAYOUT.rooms) {
      this.buildRoom(room.x, room.z, room.w, room.d, room.color, room.label);
    }

    // ---- 舰船中心装饰（全息投影桌） ----
    this.buildCenterTable();

    // ---- 添加环境光（补充舰船内照明） ----
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(0, 10, 0);
    this.shipGroup.add(fillLight);

    this.scene.add(this.shipGroup);
  }

  private buildRoom(x: number, z: number, w: number, d: number, color: number, label: string): void {
    // 地板（房间高亮）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.4, d - 0.4),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.02, z);
    this.shipGroup.add(floor);

    // 房间边框发光条
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.5 });
    const edgePoints = [
      new THREE.Vector3(x - w / 2, 0.05, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.05, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.05, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.05, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.05, z - d / 2),
    ];
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edgeLine = new THREE.Line(edgeGeo, edgeMat);
    this.shipGroup.add(edgeLine);

    // 标签柱（发光柱体作为交互提示）
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x88aaff,
      emissive: 0x4466aa,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.5,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.5, 8), pillarMat);
    pillar.position.set(x - w / 2 + 0.5, 0.25, z - d / 2 + 0.5);
    this.shipGroup.add(pillar);
  }

  private buildCenterTable(): void {
    // 全息投影桌
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x6688cc,
      emissive: 0x224488,
      emissiveIntensity: 0.2,
      metalness: 0.8,
      roughness: 0.2,
    });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.3, 24), tableMat);
    table.position.set(ROOM_LAYOUT.center.x, 0.15, ROOM_LAYOUT.center.z);
    this.shipGroup.add(table);

    // 全息投影效果（旋转光环）
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      wireframe: true,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 32), ringMat);
    ring.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    ring.rotation.x = Math.PI / 2;
    this.shipGroup.add(ring);

    // 第二个环（垂直）
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 8, 32), ringMat);
    ring2.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    this.shipGroup.add(ring2);
  }

  private setupCamera(): void {
    if (!this.camera) return;
    // 俯视角度，看到整个舰船
    this.camera.position.set(0, 18, 14);
    this.camera.lookAt(ROOM_LAYOUT.center.x, 0, ROOM_LAYOUT.center.z);
    this.camera.updateProjectionMatrix();
  }

  private disposeShipScene(): void {
    this.scene?.remove(this.shipGroup);
    // 清理组内所有几何体和材质
    this.shipGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.shipGroup.clear();
  }

  // ============================================================
  // UI 系统
  // ============================================================

  private createUI(): void {
    this.disposeUI();

    // 根容器
    const root = document.createElement('div');
    root.id = 'ship-ui-root';
    root.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; font-family: 'Microsoft YaHei', sans-serif;
      z-index: 100;
    `;
    document.body.appendChild(root);
    this.uiRoot = root;

    // ---- 顶部标题 ----
    const title = document.createElement('div');
    title.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      color: #aac; font-size: 20px; font-weight: bold;
      text-shadow: 0 0 10px rgba(68,136,255,0.5);
      pointer-events: none;
    `;
    title.textContent = `罗德岛本舰 · 第 ${this.session?.meta.day ?? 1} 天`;
    root.appendChild(title);

    // ---- 三面板按钮（底部） ----
    const panelDefs = [
      { id: 'action' as const, label: '行动', icon: '⚔' },
      { id: 'formation' as const, label: '编队', icon: '⚙' },
      { id: 'operator' as const, label: '干员', icon: '👤' },
    ];

    const btnBar = document.createElement('div');
    btnBar.style.cssText = `
      position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 16px; pointer-events: auto;
    `;
    for (const def of panelDefs) {
      const btn = document.createElement('button');
      btn.dataset.panel = def.id;
      btn.style.cssText = `
        padding: 10px 24px; font-size: 16px; font-weight: bold;
        background: rgba(34,34,68,0.85); color: #aac;
        border: 1px solid #4466aa; border-radius: 6px;
        cursor: pointer; transition: all 0.2s;
      `;
      btn.innerHTML = `${def.icon} ${def.label}`;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(68,102,170,0.85)';
        btn.style.color = '#fff';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(34,34,68,0.85)';
        btn.style.color = '#aac';
      });
      btn.addEventListener('click', () => this.togglePanel(def.id));
      btnBar.appendChild(btn);
    }
    root.appendChild(btnBar);

    // ---- 面板容器 ----
    const container = document.createElement('div');
    container.id = 'ship-panel-container';
    container.style.cssText = `
      position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
      width: 600px; max-height: calc(100vh - 160px); overflow-y: auto;
      background: rgba(20,20,40,0.92); border: 1px solid #4466aa;
      border-radius: 8px; padding: 16px; display: none;
      pointer-events: auto; color: #ccc;
    `;
    root.appendChild(container);
    this.panelContainer = container;
  }

  private togglePanel(panel: ShipPanel): void {
    if (this.currentPanel === panel) {
      this.closePanel();
      return;
    }
    this.currentPanel = panel;
    this.renderPanel(panel);
  }

  private closePanel(): void {
    this.currentPanel = 'none';
    if (this.panelContainer) {
      this.panelContainer.style.display = 'none';
    }
  }

  private renderPanel(panel: ShipPanel): void {
    if (!this.panelContainer || !this.session) return;

    const c = this.panelContainer;
    c.style.display = 'block';
    c.innerHTML = '';

    switch (panel) {
      case 'action': this.renderActionPanel(c); break;
      case 'formation': this.renderFormationPanel(c); break;
      case 'operator': this.renderOperatorPanel(c); break;
    }
  }

  // ---- 行动面板 ----
  private renderActionPanel(container: HTMLElement): void {
    const s = this.session!;
    const ship = s.ship;
    const inv = s.inventories;

    container.innerHTML = `
      <h3 style="color:#8af;margin:0 0 12px 0;">行动准备</h3>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>📅 第 ${s.meta.day} 天</div>
        <div>🚢 舰船: HP ${ship.hp}/${ship.maxHp} | 护盾 ${ship.shield} | 装甲 ${ship.armor}</div>
        <div>🛡 炮塔: ${ship.turrets.length} 座</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🎒 背包状态:</div>
        <div>  基地仓库: ${countItemsInGrid(inv.base)} 件</div>
        <div>  飞船仓库: ${countItemsInGrid(inv.ship)} 件</div>
        <div>  玩家背包: ${countItemsInGrid(inv.player)} 件</div>
        <div>  队友背包: ${Object.keys(inv.allies).length} 人</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🏆 藏品: ${s.relics.owned.length} 件 | 干员: ${s.allies.roster.length} 人</div>
        <div>🎰 抽卡保底: ${s.gacha.pityCounter} 抽</div>
      </div>
      ${s.dayProgress.hasDepartedToday
        ? `<div style="color:#fa4;padding:8px;background:rgba(255,170,68,0.15);border-radius:4px;margin-bottom:12px;">今日已出击，休息等明天吧</div>`
        : `<button id="ship-depart-btn" style="padding:10px 24px;font-size:16px;font-weight:bold;background:#4488ff;color:#fff;border:none;border-radius:6px;cursor:pointer;width:100%;">🚀 出击</button>`
      }
    `;

    const departBtn = container.querySelector('#ship-depart-btn');
    if (departBtn) {
      departBtn.addEventListener('click', () => {
        this.doDepart();
      });
    }
  }

  // ---- 编队面板 ----
  private renderFormationPanel(container: HTMLElement): void {
    const s = this.session!;

    container.innerHTML = `
      <h3 style="color:#8af;margin:0 0 12px 0;">编队管理</h3>
      <div style="margin-bottom:12px;">
        <button id="ship-inv-btn" style="padding:8px 16px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-right:8px;">🎒 打开背包</button>
        <button id="ship-relics-btn" style="padding:8px 16px;background:#6644aa;color:#fff;border:none;border-radius:4px;cursor:pointer;">🏆 藏品查看</button>
      </div>
      <div id="ship-inventory-view" style="margin-top:8px;"></div>
    `;

    container.querySelector('#ship-inv-btn')?.addEventListener('click', () => {
      this.renderInventoryView(container.querySelector('#ship-inventory-view')!);
    });
    container.querySelector('#ship-relics-btn')?.addEventListener('click', () => {
      this.renderRelicsView(container.querySelector('#ship-inventory-view')!);
    });
  }

  // ---- 背包视图 ----
  private renderInventoryView(target: HTMLElement): void {
    if (!this.session) return;
    const inv = this.session.inventories;

    target.innerHTML = `
      <div style="padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;margin-bottom:8px;">
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <button class="inv-tab" data-layer="base" style="flex:1;padding:6px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;">🏠 基地仓库</button>
          <button class="inv-tab" data-layer="ship" style="flex:1;padding:6px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;">🚀 飞船仓库</button>
          <button class="inv-tab" data-layer="player" style="flex:1;padding:6px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;">🎒 玩家背包</button>
        </div>
        <div id="inv-grid-view"></div>
      </div>
    `;

    const showGrid = (layer: keyof typeof inv) => {
      const gridView = target.querySelector('#inv-grid-view') as HTMLElement;
      const grid = inv[layer];
      if (Array.isArray(grid)) {
        this.renderGrid(gridView, grid, layer);
      }
    };

    target.querySelectorAll('.inv-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = (btn as HTMLElement).dataset.layer as keyof typeof inv;
        showGrid(layer);
      });
    });

    // 默认显示玩家背包
    showGrid('player');
  }

  /** 渲染网格视图 */
  private renderGrid(container: HTMLElement, grid: InventoryGrid, layer: string): void {
    if (!grid || grid.length === 0) {
      container.innerHTML = '<div style="color:#666;">空网格</div>';
      return;
    }

    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    const cellSize = Math.min(48, Math.floor(540 / cols));

    let html = `<div style="display:grid;grid-template-columns:repeat(${cols},${cellSize}px);gap:2px;justify-content:center;">`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slot = grid[r][c];
        if (slot) {
          html += `<div style="width:${cellSize}px;height:${cellSize}px;background:rgba(68,136,255,0.2);border:1px solid #4466aa;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#8af;overflow:hidden;" title="${slot.itemId} (x${slot.stackSize})">${slot.itemId.slice(0, 6)}</div>`;
        } else {
          html += `<div style="width:${cellSize}px;height:${cellSize}px;background:rgba(255,255,255,0.03);border:1px solid #2a2a4a;border-radius:2px;"></div>`;
        }
      }
    }
    html += '</div>';
    container.innerHTML = html;
  }

  // ---- 藏品视图 ----
  private renderRelicsView(target: HTMLElement): void {
    if (!this.session) return;
    const relics = this.session.relics;

    let html = `
      <div style="padding:8px;background:rgba(102,68,170,0.15);border-radius:4px;">
        <h4 style="color:#a8f;margin:0 0 8px 0;">藏品 (${relics.owned.length} 件)</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
    `;

    for (const id of relics.owned) {
      html += `<span style="padding:4px 10px;background:rgba(102,68,170,0.3);border:1px solid #8866cc;border-radius:4px;font-size:12px;color:#caf;">${id}</span>`;
    }

    html += `</div></div>`;
    target.innerHTML = html;
  }

  // ---- 干员面板 ----
  private renderOperatorPanel(container: HTMLElement): void {
    const s = this.session!;

    container.innerHTML = `
      <h3 style="color:#8af;margin:0 0 12px 0;">干员管理</h3>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>已招募干员: ${s.allies.roster.length} 人</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${s.allies.roster.length === 0
            ? '<span style="color:#666;">还没有干员，去招募吧</span>'
            : s.allies.roster.map(id =>
                `<span style="padding:4px 10px;background:rgba(68,136,255,0.2);border:1px solid #4488ff;border-radius:4px;font-size:12px;color:#8af;">${id}</span>`
              ).join('')
          }
        </div>
      </div>
      <button id="ship-gacha-btn" style="padding:10px 24px;font-size:16px;font-weight:bold;background:#aa44aa;color:#fff;border:none;border-radius:6px;cursor:pointer;width:100%;">🎰 招募（抽卡）</button>
    `;

    container.querySelector('#ship-gacha-btn')?.addEventListener('click', () => {
      this.doGacha();
    });
  }

  // ---- 抽卡逻辑 ----
  private doGacha(): void {
    if (!this.session) return;
    const s = this.session;

    // 简单保底抽卡
    import('../config/gachaPool.json').then((mod) => {
      const pool = mod.default;
      const characters = pool.characters;

      // 计算总权重
      let totalWeight = 0;
      for (const ch of characters) totalWeight += ch.weight;

      // 保底判定
      let poolCopy = [...characters];
      const pullResult: string[] = [];

      // 10 连抽
      for (let i = 0; i < 10; i++) {
        s.gacha.totalPulls++;
        s.gacha.pityCounter++;

        // 保底检查
        let roll = Math.random() * totalWeight;
        let picked = poolCopy[0];

        // 90 抽保底 6星
        if (s.gacha.pityCounter >= 90) {
          const sixStars = poolCopy.filter(ch => ch.rarity === 6);
          if (sixStars.length > 0) {
            picked = sixStars[Math.floor(Math.random() * sixStars.length)];
            s.gacha.pityCounter = 0;
          }
        } else {
          for (const ch of poolCopy) {
            roll -= ch.weight;
            if (roll <= 0) { picked = ch; break; }
          }
        }

        if (picked) {
          pullResult.push(picked.id);
          // 新干员加入
          if (!s.allies.roster.includes(picked.id)) {
            s.allies.roster.push(picked.id);
            // 初始化该干员背包
            if (!s.inventories.allies[picked.id]) {
              s.inventories.allies[picked.id] = createEmptyGrid(3, Math.ceil((picked as any).backpackSlots ?? 6 / 3));
            }
          }
          // 重置保底计数
          if (picked.rarity === 6) s.gacha.pityCounter = 0;
        }
      }

      // 保存
      SaveSystem.save(s);
      eventBus.emit('gacha_result', { result: pullResult });

      // 显示结果
      this.showGachaResult(pullResult);
    });
  }

  private showGachaResult(result: string[]): void {
    if (!this.panelContainer) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); display: flex; align-items: center;
      justify-content: center; z-index: 200; pointer-events: auto;
    `;
    overlay.innerHTML = `
      <div style="background:rgba(20,20,40,0.95);border:2px solid #aa44aa;border-radius:12px;padding:24px;text-align:center;max-width:400px;">
        <h2 style="color:#f8f;margin:0 0 16px 0;">招募结果</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px;">
          ${result.map(id => `<span style="padding:8px 16px;background:rgba(170,68,170,0.3);border:1px solid #aa44aa;border-radius:6px;color:#f8f;font-size:14px;">${id}</span>`).join('')}
        </div>
        <button id="gacha-close-btn" style="padding:8px 20px;background:#4488ff;color:#fff;border:none;border-radius:4px;cursor:pointer;">确定</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#gacha-close-btn')?.addEventListener('click', () => {
      document.body.removeChild(overlay);
      // 刷新面板
      this.renderPanel('operator');
    });
  }

  // ---- UI 清理 ----
  private disposeUI(): void {
    if (this.uiRoot && this.uiRoot.parentNode) {
      this.uiRoot.parentNode.removeChild(this.uiRoot);
    }
    this.uiRoot = null;
    this.panelContainer = null;
  }
}