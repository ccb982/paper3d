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
import { MapQuery } from '../services/map/MapQuery';
import { MapRender } from '../services/map/MapRender';
import type { InputActions } from '../platform/input/InputActions';
import { drainInteractions } from '../platform/input/InputActions';

/** 相机斜俯视参数（透视） */
const CAM_HEIGHT = 6;
const CAM_DISTANCE = 6;
const CAM_FOV = 50;

export class WorldMode {
  private anim: FrameAnimatorBase;
  private quad: FTXQuad;
  private controller: CharacterController;
  private mapRender: MapRender;
  private map: MapQuery;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
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

    // ---- 玩家出生在地图中心（玩法坐标 x/z 平面） ----
    const b = map.getBounds();
    const center = (b.min + b.max) / 2;
    this.controller.position = { x: center, y: center };

    // ---- 相机初始化（斜俯视跟随玩家） ----
    this.syncCamera(1);
  }

  /** 每帧驱动（输入 → 控制 → 动画 → 相机） */
  update(dt: number, input: InputActions, attackPressed: boolean): void {
    // ---- 控制层（消费抽象输入，不碰按键） ----
    if (attackPressed) this.controller.attack();
    this.controller.update(dt, input);
    const p = this.controller.position;

    // ---- 地图边界钳制（玩法坐标 x/z 平面，经 MapQuery） ----
    const b = this.map.getBounds();
    this.controller.position.x = Math.max(b.min, Math.min(b.max, p.x));
    this.controller.position.y = Math.max(b.min, Math.min(b.max, p.y));

    // ---- 动画时间轴推进 ----
    this.anim.update(dt);

    // ---- 相机跟随（lerp 平滑） ----
    this.syncCamera(Math.min(1, dt * 5));

    // ---- 交互消费（屏幕→世界换算在游戏层，与设备无关） ----
    const rayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rayNdc = new THREE.Vector2();
    const raycast = new THREE.Raycaster();
    for (const it of drainInteractions(input)) {
      if (it.type === 'tap') {
        rayNdc.set(it.x * 2 - 1, -(it.y * 2 - 1));
        raycast.setFromCamera(rayNdc, this.camera);
        const hit = new THREE.Vector3();
        if (raycast.ray.intersectPlane(rayPlane, hit)) {
          this.lastTapWorld = { x: hit.x, y: hit.z };
          console.log('[WorldMode] tap 世界坐标:', this.lastTapWorld);
        }
      }
    }
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

  /** 透视相机斜俯视跟随玩家（lerp 平滑） */
  private syncCamera(alpha: number): void {
    const p = this.controller.position;
    const groundY = this.map.getHeight(p.x, p.y);
    const targetPos = new THREE.Vector3(p.x, groundY + CAM_HEIGHT, p.y + CAM_DISTANCE);
    this.cameraTarget.lerp(targetPos, alpha);
    this.camera.position.copy(this.cameraTarget);
    this.camera.lookAt(p.x, groundY, p.y);
  }

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
  }
}
