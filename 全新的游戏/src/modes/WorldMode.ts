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
import type { InputActions } from '../platform/input/InputActions';
import { drainInteractions } from '../platform/input/InputActions';

/** 世界尺寸（0..WORLD_SIZE，玩家在其中移动，相机跟随） */
const WORLD_SIZE = 10;
/** 相机视锥尺寸（世界单位，正交） */
const VIEW_SIZE = 2.2;

export class WorldMode {
  private anim: FrameAnimatorBase;
  private quad: FTXQuad;
  private controller: CharacterController;
  private cameraTarget = new THREE.Vector3(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
  private lastTapWorld: { x: number; y: number } | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.OrthographicCamera,
    private asset: FtxAsset,
  ) {
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
    this.controller.position = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };

    // ---- 相机初始化（跟随玩家） ----
    this.syncCamera(1);

    // ---- 世界网格（参考系） ----
    const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE, 0x333355, 0x222244);
    grid.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, -0.5);
    scene.add(grid);
  }

  /** 每帧驱动（输入 → 控制 → 动画 → 相机） */
  update(dt: number, input: InputActions, attackPressed: boolean): void {
    // ---- 控制层（消费抽象输入，不碰按键） ----
    if (attackPressed) this.controller.attack();
    this.controller.update(dt, input);
    const p = this.controller.position;

    // ---- 钳制在世界范围 ----
    this.controller.position.x = Math.max(0, Math.min(WORLD_SIZE, p.x));
    this.controller.position.y = Math.max(0, Math.min(WORLD_SIZE, p.y));

    // ---- 动画时间轴推进 ----
    this.anim.update(dt);

    // ---- 相机跟随（lerp 平滑） ----
    this.syncCamera(Math.min(1, dt * 5));

    // ---- 交互消费（屏幕→世界换算，与设备无关） ----
    for (const it of drainInteractions(input)) {
      if (it.type === 'tap') {
        this.lastTapWorld = this.screenToWorld(it.x, it.y);
        console.log('[WorldMode] tap 世界坐标:', this.lastTapWorld);
      }
    }
  }

  /** 渲染：读 FrameState → 纹理 → quad → 画面 */
  render(renderer: THREE.WebGLRenderer): void {
    const p = this.controller.position;
    this.quad.setPosition(p.x, p.y);
    this.quad.setScale(VIEW_SIZE * 0.3, VIEW_SIZE * 0.3);
    this.quad.setFlip(this.anim.state.flipX, this.anim.state.flipY);
    this.quad.render(this.anim.state);
    renderer.render(this.scene, this.camera);
  }

  /** 正交相机跟随：视锥中心 = 玩家位置（lerp） */
  private syncCamera(alpha: number): void {
    const p = this.controller.position;
    this.cameraTarget.lerp(new THREE.Vector3(p.x, p.y, 0), alpha);
    // 正交相机视锥：中心跟随（position 平移 = 视锥平移）
    const half = VIEW_SIZE / 2;
    this.camera.left = this.cameraTarget.x - half;
    this.camera.right = this.cameraTarget.x + half;
    this.camera.top = this.cameraTarget.y + half;
    this.camera.bottom = this.cameraTarget.y - half;
    this.camera.updateProjectionMatrix();
  }

  /** 屏幕归一化坐标（0..1，左上原点）→ 世界坐标（相机视锥内换算） */
  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const x = this.camera.left + sx * (this.camera.right - this.camera.left);
    const y = this.camera.top - sy * (this.camera.top - this.camera.bottom);
    return { x, y };
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
  }
}
