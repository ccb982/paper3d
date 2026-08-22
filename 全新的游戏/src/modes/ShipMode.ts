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
import { FtxAsset } from '../vendor/player/FtxAsset';

// ============================================================
// 主页面按钮标注（屏幕坐标 0-1，Y=0 底部，Y=1 顶部）
// ============================================================
interface ButtonAnno {
  id: 'operator' | 'formation' | 'action';
  label: string;
  /** 梯形四顶点：TL, TR, BL, BR */
  corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } };
  /** 在 FTX 中的帧索引（假设 3 帧，每帧一个按钮） */
  frameIndex: number;
}

const BUTTON_ANNOTATIONS: ButtonAnno[] = [
  {
    id: 'operator', label: '干员', frameIndex: 0,
    corners: {
      tl: { x: 0.750, y: 0.570 }, tr: { x: 0.931, y: 0.578 },
      bl: { x: 0.750, y: 0.436 }, br: { x: 0.931, y: 0.426 },
    },
  },
  {
    id: 'formation', label: '编队', frameIndex: 1,
    corners: {
      tl: { x: 0.581, y: 0.573 }, tr: { x: 0.740, y: 0.566 },
      bl: { x: 0.581, y: 0.447 }, br: { x: 0.740, y: 0.451 },
    },
  },
  {
    id: 'action', label: '行动', frameIndex: 2,
    corners: {
      tl: { x: 0.600, y: 0.591 }, tr: { x: 1.000, y: 0.600 },
      bl: { x: 0.600, y: 0.785 }, br: { x: 1.000, y: 0.835 },
    },
  },
];

// ============================================================
// HSL 合成着色器（与 GachaOverlay 一致）
// ============================================================
const HSL_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HSL_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBase;
  uniform sampler2D uResidual;
  uniform float uAlpha;
  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }
  void main() {
    vec4 base = texture2D(uBase, vUv);
    if (base.a < 0.5) discard;
    vec4 res = texture2D(uResidual, vUv);
    float dH = (res.r * 2.0 - 1.0) * 0.5;
    float dS = (res.g * 2.0 - 1.0) * 0.5;
    float dL = (res.b * 2.0 - 1.0) * 0.5;
    float h = fract(base.r + dH);
    float s = clamp(base.g + dS, 0.0, 1.0);
    float l = clamp(base.b + dL, 0.0, 1.0);
    gl_FragColor = vec4(hsl2rgb(vec3(h, s, l)), base.a * uAlpha);
  }
`;

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

  // ★ 主页面按钮系统
  private _btnScene: THREE.Scene | null = null;
  private _btnCamera: THREE.OrthographicCamera | null = null;
  private _btnMeshes: THREE.Mesh[] = [];
  private _btnDebugLines: THREE.LineLoop[] = [];
  private _btnHitAreas: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private _btnBoundClick: ((e: PointerEvent) => void) | null = null;

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

    // ④ 加载主页面按钮（FTX 纹理，梯形透视）
    this.loadMainButtons();

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
    this.disposeMainButtons();

    // ② 销毁抽卡覆盖层
    this.gachaOverlay?.dispose();

    // ③ 销毁 UI 层
    this.uiManager?.dispose();

    // ④ 销毁 3D 场景
    this.disposeShipScene();

    // ⑤ 清空引用
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
      // 渲染按钮覆盖层
      if (this._btnScene && this._btnCamera) {
        this.renderer.render(this._btnScene, this._btnCamera);
      }
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

  // ============================================================
  // 主页面按钮（FTX 纹理，梯形透视）
  // ============================================================

  private async loadMainButtons(): Promise<void> {
    if (!this.renderer) return;
    this.disposeMainButtons();

    const btnAsset = await FtxAsset.load('/ui/主界面三个按钮.ftx3.gz');
    if (!btnAsset || btnAsset.frameCount === 0) return;

    const aspect = window.innerWidth / window.innerHeight;

    // 创建覆盖层场景和相机
    this._btnScene = new THREE.Scene();
    this._btnCamera = new THREE.OrthographicCamera(0, aspect, 1, 0, -1, 1);

    this._btnHitAreas = [];

    for (const anno of BUTTON_ANNOTATIONS) {
      const pair = btnAsset.getFramePair(anno.frameIndex);
      if (!pair) continue;

      // 创建梯形几何体
      const { tl, tr, bl, br } = this.screenToThree(anno.corners, aspect);
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        // 两个三角形组成梯形
        bl.x, bl.y, 0,   br.x, br.y, 0,   tr.x, tr.y, 0,
        bl.x, bl.y, 0,   tr.x, tr.y, 0,   tl.x, tl.y, 0,
      ]);
      const uvs = new Float32Array([
        0, 1,   1, 1,   1, 0,
        0, 1,   1, 0,   0, 0,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uBase: { value: pair.base },
          uResidual: { value: pair.residual },
          uAlpha: { value: 1.0 },
        },
        vertexShader: HSL_VERT,
        fragmentShader: HSL_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = 0.1;
      this._btnScene.add(mesh);
      this._btnMeshes.push(mesh);

      // ★ 调试：绘制梯形轮廓线
      const debugColor = anno.id === 'operator' ? 0xff4444 : anno.id === 'formation' ? 0x44ff44 : 0x4444ff;
      const linePoints = [
        new THREE.Vector3(tl.x, tl.y, 0.15),
        new THREE.Vector3(tr.x, tr.y, 0.15),
        new THREE.Vector3(br.x, br.y, 0.15),
        new THREE.Vector3(bl.x, bl.y, 0.15),
        new THREE.Vector3(tl.x, tl.y, 0.15),
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
      const lineMat = new THREE.LineBasicMaterial({ color: debugColor, linewidth: 2 });
      const lineLoop = new THREE.LineLoop(lineGeo, lineMat);
      this._btnScene.add(lineLoop);
      this._btnDebugLines.push(lineLoop);

      // 点击区域（用梯形包围盒）
      const minX = Math.min(tl.x, tr.x, bl.x, br.x);
      const maxX = Math.max(tl.x, tr.x, bl.x, br.x);
      const minY = Math.min(tl.y, tr.y, bl.y, br.y);
      const maxY = Math.max(tl.y, tr.y, bl.y, br.y);
      this._btnHitAreas.push({ id: anno.id, x: minX, y: minY, w: maxX - minX, h: maxY - minY });

      // ★ 调试：点击区域包围盒（虚线效果用半透明线）
      const hitPoints = [
        new THREE.Vector3(minX, minY, 0.16),
        new THREE.Vector3(maxX, minY, 0.16),
        new THREE.Vector3(maxX, maxY, 0.16),
        new THREE.Vector3(minX, maxY, 0.16),
        new THREE.Vector3(minX, minY, 0.16),
      ];
      const hitGeo = new THREE.BufferGeometry().setFromPoints(hitPoints);
      const hitMat = new THREE.LineBasicMaterial({ color: debugColor, transparent: true, opacity: 0.4 });
      const hitLine = new THREE.LineLoop(hitGeo, hitMat);
      this._btnScene.add(hitLine);
      this._btnDebugLines.push(hitLine);
    }

    // 点击事件
    const onClick = (e: PointerEvent) => this.handleButtonClick(e);
    this._btnBoundClick = onClick;
    this.renderer.domElement.addEventListener('pointerdown', onClick);
  }

  /** 将屏幕标注坐标（0-1，Y=0 底部）转为 Three.js 正交相机坐标（Y=0 底部） */
  private screenToThree(
    c: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } },
    aspect: number,
  ): { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } } {
    return {
      tl: { x: c.tl.x * aspect, y: c.tl.y },
      tr: { x: c.tr.x * aspect, y: c.tr.y },
      bl: { x: c.bl.x * aspect, y: c.bl.y },
      br: { x: c.br.x * aspect, y: c.br.y },
    };
  }

  private handleButtonClick(e: PointerEvent): void {
    if (!this.renderer || !this._btnCamera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const aspect = window.innerWidth / window.innerHeight;
    // 转为 Three.js 正交相机坐标（Y=0 底部）
    const px = (e.clientX / rect.width) * aspect;
    const py = 1 - (e.clientY / rect.height); // Y=0 底部，与相机一致

    for (const hit of this._btnHitAreas) {
      if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) {
        this.onButtonClick(hit.id);
        break;
      }
    }
  }

  private onButtonClick(id: string): void {
    if (id === 'action') {
      // 行动 → 显示抽卡覆盖层
      const gacha = this.gachaOverlay;
      if (gacha) {
        gacha.show(() => this.doDepart());
      }
    } else {
      // 干员/编队 → 打开对应面板
      this.uiManager.togglePanel(id as 'operator' | 'formation');
    }
  }

  private disposeMainButtons(): void {
    if (this._btnBoundClick && this.renderer) {
      this.renderer.domElement.removeEventListener('pointerdown', this._btnBoundClick);
      this._btnBoundClick = null;
    }
    for (const mesh of this._btnMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
      this._btnScene?.remove(mesh);
    }
    this._btnMeshes = [];
    // 清理调试线
    for (const line of this._btnDebugLines) {
      line.geometry.dispose();
      const mat = line.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m.dispose());
      } else {
        mat.dispose();
      }
      this._btnScene?.remove(line);
    }
    this._btnDebugLines = [];
    this._btnHitAreas = [];
    this._btnScene = null;
    this._btnCamera = null;
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