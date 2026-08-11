// ============================================================
// WorldMode —— 大世界模式（最简版：播放器管线验证）
// ============================================================
// 内容：
//   - 加载主角 ftx3 纹理包 → FrameAnimatorBase 动画管线
//   - FTXQuad 渲染管线 + 角色控制（CharacterController，输入解耦）
//   - ★ 正交相机跟随玩家（lerp 平滑）
//   - 交互事件消费（屏幕归一化 → 世界坐标换算在游戏层，与设备无关）
//
// 输入流：Binding(设备) → InputActions(语义) → 本模式消费
// 交互流：InputActions.interactions(tap/hold/drag) → 屏幕→世界换算 → 游戏逻辑

import * as THREE from 'three';
import { FtxAsset } from '../vendor/player/FtxAsset';
import { FrameAnimatorBase } from '../services/fx/FrameAnimatorBase';
import { FTXQuad } from '../services/render/FTXQuad';
import { CharacterController } from '../systems/player/CharacterController';
import { CameraController } from '../services/camera/CameraController';
import { Crosshair } from '../services/ui/Crosshair';
import { MapQuery } from '../services/map/MapQuery';
import { MapRender } from '../services/map/MapRender';
import type { InputActions } from '../platform/input/InputActions';
import { drainInteractions } from '../platform/input/InputActions';

export class WorldMode {
  private anim: FrameAnimatorBase;
  private quad: FTXQuad;
  private controller: CharacterController;
  private cameraCtrl: CameraController;
  private mapRender: MapRender;
  private map: MapQuery;
  private crosshair: Crosshair;
  private lastTapWorld: { x: number; y: number } | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private asset: FtxAsset,
    map: MapQuery,
  ) {
    this.map = map;
    // ---- 地图视觉（3D 地形网格，当前平地占位） ----
    this.mapRender = new MapRender(scene, map);
    // ---- 动画管线 ----
    this.anim = new FrameAnimatorBase(asset);
    // ---- 渲染管线 ----
    this.quad = new FTXQuad(scene, asset);
    const frame0 = asset.frames[0];
    this.quad.setFrameMapping({ width: frame0.width, height: frame0.height }, frame0.bbox);
    // ---- 控制层（输入解耦） ----
    this.controller = new CharacterController(this.anim, {
      states: {
        idle: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
        walk: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
        attack: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
      },
      fps: { idle: 2, walk: 6, attack: 8 },
    }, 2.5);

    // ---- 相机（独立模块：环绕/俯仰/跟随） ----
    this.cameraCtrl = new CameraController(camera);

    // ---- 准星（固定屏幕中心，瞄准/交互基准） ----
    this.crosshair = new Crosshair();

    // ---- 玩家出生在地图中心（玩法坐标 x/z 平面） ----
    const b = map.getBounds();
    const center = (b.min + b.max) / 2;
    this.controller.position = { x: center, y: center };
  }

  /** 每帧驱动（输入 → 相机 → 控制 → 动画 → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }): void {
    const p = this.controller.position;

    // ---- 相机（鼠标视角控制，先更新 → 提供坐标系给角色移动/朝向） ----
    this.cameraCtrl.update(dt, look, {
      x: p.x,
      y: 0,
      z: p.y,
      height: this.map.getHeight(p.x, p.y),
    });

    // ---- 控制层（相机相对移动 + 朝向判定，输入解耦） ----
    if (attackPressed) this.controller.attack();
    this.controller.update(dt, input, this.cameraCtrl.getFrame());

    // ---- 地图边界钳制（玩法坐标 x/z 平面，经 MapQuery） ----
    const p2 = this.controller.position;
    const b = this.map.getBounds();
    this.controller.position.x = Math.max(b.min, Math.min(b.max, p2.x));
    this.controller.position.y = Math.max(b.min, Math.min(b.max, p2.y));

    // ---- 动画时间轴推进 ----
    this.anim.update(dt);

    // ---- 交互消费（★ 以准星为基准：射线固定从屏幕中心发出，
    //      与鼠标设备位置解耦——触屏/手柄同样以中心为准） ----
    const rayNdc = new THREE.Vector2(0, 0);
    const raycast = new THREE.Raycaster();
    for (const it of drainInteractions(input)) {
      if (it.type === 'tap') {
        raycast.setFromCamera(rayNdc, this.camera);
        const hit = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycast.ray.intersectPlane(plane, hit)) {
          this.lastTapWorld = { x: hit.x, y: hit.z };
          console.log('[WorldMode] 准星目标:', this.lastTapWorld);
        }
      }
    }
  }

  /** 屏幕归一化坐标 → 世界（raycaster 与地形平面求交） */
  private screenToWorld(sx: number, sy: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) {
      return { x: hit.x, z: hit.z };
    }
    return null;
  }

  /** 渲染：读 FrameState → 纹理 → quad（billboard 立在地形上） → 画面 */
  render(renderer: THREE.WebGLRenderer): void {
    const p = this.controller.position;
    // ★ 玩法坐标 x/z → 世界坐标；y = 地形高度（与地形架构交互点）
    const groundY = this.map.getHeight(p.x, p.y);
    this.quad.setPosition(p.x, groundY + 0.75, p.y);
    this.quad.setScale(1.5, 1.5);
    this.quad.setFlip(this.anim.state.flipX, this.anim.state.flipY);
    this.quad.setBillboard(this.camera);
    this.quad.render(this.anim.state);
    renderer.render(this.scene, this.camera);
  }

  /** 透视相机斜俯视跟随玩家（由 CameraController 负责） */

  get playerPosition(): { x: number; y: number } {
    return { ...this.controller.position };
  }

  get playerState(): string {
    return this.controller.state;
  }

  get playerFacing(): string {
    return this.anim.state.facing;
  }

  get playerFlipX(): boolean {
    return this.anim.state.flipX;
  }

  get frameIndex(): number {
    return this.anim.state.frameIndex;
  }

  get lastTap(): { x: number; y: number } | null {
    return this.lastTapWorld;
  }

  dispose(): void {
    this.anim.dispose();
    this.quad.dispose();
    this.mapRender.dispose();
    this.crosshair.dispose();
  }
}
