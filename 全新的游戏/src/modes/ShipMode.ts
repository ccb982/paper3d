// ============================================================
// ShipMode.ts —— 舰船日常模式
// 3D 舰船场景 + UI 三面板（行动/编队/干员）+ 背包对接 + 存档
// 业务逻辑层：ItemManager / CraftingManager / InteractionManager（共享）
// UI 层：ShipUIManager（舰船专属）+ 共享 UI 组件
// ============================================================

import * as THREE from 'three';
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

// ============================================================
// 舰船场景布局（简单占位地图）
// ============================================================

const SHIP_SIZE = 24;
const WALL_HEIGHT = 3;
const ROOM_LAYOUT = {
  rooms: [
    { x: -8, z: -8, w: 6, d: 6, color: 0x4a4a6a, label: 'L1 仓库' },
    { x: 2, z: -8, w: 6, d: 6, color: 0x6a4a4a, label: '出口' },
    { x: -8, z: 2, w: 6, d: 6, color: 0x4a6a4a, label: '招募区' },
    { x: 2, z: 2, w: 6, d: 6, color: 0x6a6a4a, label: '休息区' },
  ],
  center: { x: -3, z: -3 },
};

// ============================================================
// ShipMode 类
// ============================================================

export class ShipMode implements IGameMode {
  // 场景对象
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private shipGroup = new THREE.Group();
  private clock = new THREE.Clock();

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

    // ③ 构建舰船 3D 场景
    this.buildShipScene();
    this.setupCamera();

    // ④ 创建抽卡覆盖层（行动后默认显示）
    this.gachaOverlay = new GachaOverlay(ctx.session);
    this.gachaOverlay.load().then(() => {
      this.gachaOverlay.show(() => this.doDepart());
    });

    // 触发存档事件
    eventBus.emit('save_complete', {});
    console.log('[ShipMode] 舰船场景已加载');
  }

  exit(): void {
    // ① 销毁抽卡覆盖层
    this.gachaOverlay?.dispose();

    // ② 销毁 UI 层
    this.uiManager?.dispose();

    // ③ 销毁 3D 场景
    this.disposeShipScene();

    // ④ 清空引用
    this.session = null;
    this.onDepart = undefined;
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

  update(_dt: number): void {
    // 舰船中不需要每帧更新（UI 为事件驱动）
  }

  render(): void {
    if (this.scene && this.camera && this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ============================================================
  // 3D 舰船场景构建（与重构前一致）
  // ============================================================

  private buildShipScene(): void {
    if (!this.scene) return;
    this.disposeShipScene();

    // 甲板
    const deckGeo = new THREE.PlaneGeometry(SHIP_SIZE, SHIP_SIZE);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3a5a, roughness: 0.8, metalness: 0.3 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.05;
    deck.receiveShadow = true;
    this.shipGroup.add(deck);

    // 网格线
    const gridHelper = new THREE.GridHelper(SHIP_SIZE, 12, 0x6a6a8a, 0x4a4a6a);
    gridHelper.position.y = 0.01;
    this.shipGroup.add(gridHelper);

    // 边界墙
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x4a4a8a, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    for (const wp of [
      { x: 0, z: -SHIP_SIZE / 2, ry: 0 },
      { x: 0, z: SHIP_SIZE / 2, ry: 0 },
      { x: -SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 },
      { x: SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 },
    ]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(SHIP_SIZE, WALL_HEIGHT), wallMat);
      wall.position.set(wp.x, WALL_HEIGHT / 2, wp.z);
      wall.rotation.y = wp.ry;
      this.shipGroup.add(wall);
    }

    // 房间
    for (const room of ROOM_LAYOUT.rooms) {
      this.buildRoom(room.x, room.z, room.w, room.d, room.color, room.label);
    }

    // 全息投影桌
    this.buildCenterTable();

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(0, 10, 0);
    this.shipGroup.add(fillLight);

    this.scene.add(this.shipGroup);
  }

  private buildRoom(x: number, z: number, w: number, d: number, color: number, label: string): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.4, d - 0.4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.02, z);
    this.shipGroup.add(floor);

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

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x4466aa, emissiveIntensity: 0.3, transparent: true, opacity: 0.5 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.5, 8), pillarMat);
    pillar.position.set(x - w / 2 + 0.5, 0.25, z - d / 2 + 0.5);
    this.shipGroup.add(pillar);
  }

  private buildCenterTable(): void {
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x6688cc, emissive: 0x224488, emissiveIntensity: 0.2, metalness: 0.8, roughness: 0.2 });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.3, 24), tableMat);
    table.position.set(ROOM_LAYOUT.center.x, 0.15, ROOM_LAYOUT.center.z);
    this.shipGroup.add(table);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.3, wireframe: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 32), ringMat);
    ring.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    ring.rotation.x = Math.PI / 2;
    this.shipGroup.add(ring);

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 8, 32), ringMat);
    ring2.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    this.shipGroup.add(ring2);
  }

  private setupCamera(): void {
    if (!this.camera) return;
    this.camera.position.set(0, 18, 14);
    this.camera.lookAt(ROOM_LAYOUT.center.x, 0, ROOM_LAYOUT.center.z);
    this.camera.updateProjectionMatrix();
  }

  private disposeShipScene(): void {
    this.scene?.remove(this.shipGroup);
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
}