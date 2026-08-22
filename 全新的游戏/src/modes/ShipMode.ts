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
    id: 'action', label: '行动', frameIndex: 0,
    corners: {
      tl: { x: 0.600, y: 0.591 }, tr: { x: 1.000, y: 0.600 },
      bl: { x: 0.600, y: 0.785 }, br: { x: 1.000, y: 0.835 },
    },
  },
  {
    id: 'operator', label: '干员', frameIndex: 1,
    corners: {
      tl: { x: 0.750, y: 0.570 }, tr: { x: 0.931, y: 0.578 },
      bl: { x: 0.750, y: 0.436 }, br: { x: 0.931, y: 0.426 },
    },
  },
  {
    id: 'formation', label: '编队', frameIndex: 2,
    corners: {
      tl: { x: 0.581, y: 0.561 }, tr: { x: 0.740, y: 0.568 },
      bl: { x: 0.581, y: 0.446 }, br: { x: 0.740, y: 0.442 },
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

// ★ 调试：直接输出 HSL 基础色（跳过残差）
const HSL_FRAG_RAW = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBase;
  uniform float uAlpha;
  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }
  void main() {
    vec4 base = texture2D(uBase, vUv);
    vec3 rgb = hsl2rgb(vec3(base.r, base.g, base.b));
    gl_FragColor = vec4(rgb, base.a * uAlpha);
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
  private _btnLabels: THREE.Sprite[] = [];
  private _btnHitAreas: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private _btnBoundClick: ((e: PointerEvent) => void) | null = null;
  private _debugReadbackDone = false;

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
      // 渲染按钮覆盖层（不自动清除，保留 Three.js 场景背景）
      if (this._btnScene && this._btnCamera) {
        this.renderer.autoClear = false;
        this.renderer.render(this._btnScene, this._btnCamera);
        this.renderer.autoClear = true;
        // 首次渲染后回读行动按钮像素
        if (!this._debugReadbackDone) {
          this._debugReadbackDone = true;
          this.debugReadbackActionButton();
        }
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

    console.log('[ShipMode] 按钮FTX帧数:', btnAsset.frameCount, '帧名:', btnAsset.frameNames());

    for (const anno of BUTTON_ANNOTATIONS) {
      const pair = btnAsset.getFramePair(anno.frameIndex);
      if (!pair) {
        console.warn('[ShipMode] 跳过无纹理按钮:', anno.label, '帧索引:', anno.frameIndex);
        continue;
      }
      // 调试：检查纹理数据
      const baseTex = pair.base;
      const baseData = baseTex.image.data as unknown as Float32Array;
      let alphaMax = 0, alphaCount = 0;
      const step = Math.max(1, Math.floor(baseData.length / 4000)); // 最多采样~1000个像素
      for (let i = 3; i < baseData.length; i += step * 4) {
        if (baseData[i] > alphaMax) alphaMax = baseData[i];
        if (baseData[i] > 0.5) alphaCount++;
      }
      alphaCount *= step; // 估算总数
      console.log(`[ShipMode] ${anno.label} 纹理:`, baseTex.image.width, 'x', baseTex.image.height, `alpha>0.5约:${alphaCount}px, maxAlpha:${alphaMax}`);

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

      const mat = (() => {
        // sRGB → 线性转换
        const srgbToLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        // 将 HSL 数据 + 残差转成 Canvas 纹理（线性空间）
        const baseData = pair.base.image.data as unknown as Float32Array;
        const bw = pair.base.image.width;
        const bh = pair.base.image.height;
        const resTex = pair.residual;
        const resData = resTex.image.data as Uint8Array;
        const rw = resTex.image.width;
        const rh = resTex.image.height;
        // 如果残差尺寸不匹配，打印警告
        if (bw !== rw || bh !== rh) {
          console.warn(`[ShipMode] ${anno.label} 基础色和残差尺寸不匹配: base=${bw}x${bh} residual=${rw}x${rh}`);
        }
        const cvs = document.createElement('canvas');
        cvs.width = bw;
        cvs.height = bh;
        const ctx = cvs.getContext('2d')!;
        const imgData = ctx.createImageData(bw, bh);
        const w = bw, h = bh;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            let hVal = baseData[idx];
            let sVal = baseData[idx + 1];
            let lVal = baseData[idx + 2];
            const aVal = baseData[idx + 3];
            // 应用残差（如果尺寸匹配）
            if (bw === rw && bh === rh) {
              const dH = (resData[idx] / 255 * 2 - 1) * 0.5;
              const dS = (resData[idx + 1] / 255 * 2 - 1) * 0.5;
              const dL = (resData[idx + 2] / 255 * 2 - 1) * 0.5;
              hVal = (hVal + dH) % 1;
              if (hVal < 0) hVal += 1;
              sVal = Math.max(0, Math.min(1, sVal + dS));
              lVal = Math.max(0, Math.min(1, lVal + dL));
            }
            // HSL → RGB
            const c = (1 - Math.abs(2 * lVal - 1)) * sVal;
            const xc = c * (1 - Math.abs((hVal * 6) % 2 - 1));
            const m = lVal - c / 2;
            let r = 0, g = 0, b = 0;
            const hi = Math.floor(hVal * 6);
            switch (hi) {
              case 0: r = c; g = xc; break;
              case 1: r = xc; g = c; break;
              case 2: g = c; b = xc; break;
              case 3: g = xc; b = c; break;
              case 4: r = xc; b = c; break;
              default: r = c; b = xc; break;
            }
            imgData.data[idx] = srgbToLinear(r + m) * 255;
            imgData.data[idx + 1] = srgbToLinear(g + m) * 255;
            imgData.data[idx + 2] = srgbToLinear(b + m) * 255;
            imgData.data[idx + 3] = aVal * 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(cvs);
        // 根据标注坐标判断是否需要翻转 Y
        tex.flipY = anno.corners.tl.y < anno.corners.bl.y;
        // Canvas 数据为 sRGB，但渲染器输出为 LinearSRGBColorSpace，
        // 设 LinearColorSpace 避免渲染器额外 sRGB 编码导致颜色翻倍
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        return new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        });
      })();

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

      // ★ 区域编号标签（已移除）
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

  /** 回读行动按钮区域的像素值（调试用） */
  private debugReadbackActionButton(): void {
    const actionAnno = BUTTON_ANNOTATIONS.find(a => a.id === 'action');
    if (!actionAnno || !this._btnCamera) return;
    const gl = this.renderer!.getContext();
    const canvas = this.renderer!.domElement;
    const cw = canvas.width;
    const ch = canvas.height;
    const aspect = this._btnCamera.right;
    // 行动按钮中心在相机坐标
    const { tl, tr, bl, br } = actionAnno.corners;
    const cx = (tl.x + tr.x + bl.x + br.x) / 4;
    const cy = (tl.y + tr.y + bl.y + br.y) / 4;
    // 相机坐标 → 屏幕像素（readPixels Y=0 底部）
    // 相机: OrthographicCamera(0, aspect, 1, 0)
    // ndcX = camX/aspect*2-1, ndcY = camY*2-1
    // screenX = (ndcX+1)/2*cw, screenY = (ndcY+1)/2*ch
    const sx = Math.round(cx / aspect * cw);
    const sy = Math.round(cy * ch);
    // 读取 3x3 网格
    const pixels = new Uint8Array(9 * 4);
    gl.readPixels(sx - 1, sy - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rows: string[] = [];
    for (let r = 0; r < 3; r++) {
      const cols: string[] = [];
      for (let c = 0; c < 3; c++) {
        const i = (r * 3 + c) * 4;
        cols.push(`(${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]})`);
      }
      rows.push(`  [${cols.join(', ')}]`);
    }
    console.log(`[ShipMode] 行动按钮回读 中心(${cx.toFixed(3)},${cy.toFixed(3)})→屏幕(${sx},${sy}) canvas=${cw}x${ch} aspect=${aspect.toFixed(3)}`);
    console.log(rows.join('\n'));
    // 额外读取干员和编队按钮中心对比
    for (const anno of BUTTON_ANNOTATIONS) {
      if (anno.id === 'action') continue;
      const acx = (anno.corners.tl.x + anno.corners.tr.x + anno.corners.bl.x + anno.corners.br.x) / 4;
      const acy = (anno.corners.tl.y + anno.corners.tr.y + anno.corners.bl.y + anno.corners.br.y) / 4;
      const asx = Math.round(acx / aspect * cw);
      const asy = Math.round(acy * ch);
      const apx = new Uint8Array(4);
      gl.readPixels(asx, asy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, apx);
      console.log(`[ShipMode] ${anno.label} 中心(${acx.toFixed(3)},${acy.toFixed(3)})→(${asx},${asy}): rgba(${apx[0]},${apx[1]},${apx[2]},${apx[3]})`);
    }
  }

  /** 创建文字标签精灵 */
  private createLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    // 边框
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 2;
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.stroke();
    // 文字
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    // 创建纹理
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.1, 1);
    return sprite;
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
    // 清理标签
    for (const sprite of this._btnLabels) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this._btnScene?.remove(sprite);
    }
    this._btnLabels = [];
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