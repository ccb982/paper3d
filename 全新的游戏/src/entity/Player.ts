// ============================================================
// Player —— 主角实体（CharacterBase 子类：输入驱动）
// ============================================================
// 渲染：FTXQuad（纯纹理贴片，billboard 面相机）

import * as THREE from 'three';
import { CharacterBase, type CharacterBaseOptions } from './CharacterBase';
import type { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';
import { VehicleRide } from '../systems/itemPlayback/VehicleRide';
import { createInputActions, type InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';

export class Player extends CharacterBase {
  /** ★ 载具乘骑播放（圆凳）：躺乘姿态 + 载具贴片跟随 */
  readonly vehicleRide: VehicleRide;
  /** ★ 是否在乘骑载具（装备 stats.vehicle 决定；爬坡/过坑读取） */
  rideVehicle = false;

  constructor(
    em: EntityManager,
    scene: THREE.Scene,
    asset: FrameAssetSource,
    opts: Omit<CharacterBaseOptions, 'kind' | 'asset'>,
  ) {
    super(em, { ...opts, kind: 'player', asset });
    this.camp = 'player';
    // ★ 主角豁免视锥裁剪 + 距离 LOD：动画永不因远距离/出视野冻结
    this.lodExempt = true;
    this.attachToScene(scene);
    // bbox 映射（帧数据 → quad；★ 纹理已按 bbox 裁剪，尺寸 = bbox 尺寸，偏移归零，与 EnemyBase 一致）
    const source = asset as unknown as { frames: Array<{ bbox: { x: number; y: number; w: number; h: number } }> };
    const frame0 = source.frames[0];
    const b = frame0.bbox;
    (this.renderer as FTXQuad).setFrameMapping(
      { width: b.w, height: b.h },
      { x: 0, y: 0, w: b.w, h: b.h },
    );
    // ★ 按纹理宽高比缩放（角色站立比例）
    // ★ 贴片宽 1.0（与碰撞胶囊 1.0 直径对齐）→ 2.0（2026-09-06 用户：纹理大小增大一倍；
    //   仅视觉放大，碰撞体仍为 1.0 胶囊）
    this.applyRenderScale(2.0);
    // ★ 载具乘骑播放（基准尺寸 = 贴片世界高 2.0）
    this.vehicleRide = new VehicleRide(
      scene,
      this.rendererMesh ?? new THREE.Object3D(),
      this.renderer as FTXQuad,
      2.0,
    );
  }

  /** ★ 载具模式开关（equipment 属性变化时由 WorldMode 调用）：
   *  躺乘姿态 + 无视地形落差（爬坡/过坑；过坑的贴地桥接在 WorldMode.clampCharacter） */
  setVehicleMode(on: boolean): void {
    if (on === this.rideVehicle) return;
    this.rideVehicle = on;
    this.climbAnyTerrain = on;
    this.vehicleRide.setActive(on);
  }

  override dispose(): void {
    this.vehicleRide.dispose();
    super.dispose();
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad {
    // anim.source = 传入的 FrameAssetSource（FrameAnimatorBase 公共字段）
    const source = this.anim!.source;
    return new FTXQuad(scene, source);
  }


  /** 攻击（消费式按键由模式层转发） */
  attack(): void {
    this.controller.attack();
  }

  /** ★ 贴片 mesh（装备贴片子节点宿主；表现层只读引用） */
  get rendererMesh(): THREE.Mesh | null {
    return (this.renderer as unknown as { mesh?: THREE.Mesh | null })?.mesh ?? null;
  }

  /** ★ 当前朝向（前=脸朝相机 / 后=背向相机）；装备前后纹理展示判定用。
   *   判定以"当前真实绘制帧的帧名前缀"为准（如 前_xxx / 后_xxx），
   *   与按键无关——站定时跟随最后一帧实绘纹理，斜向/攻击亦如实。 */
  get facing(): '前' | '后' {
    const name = this.controller.anim.currentFrameName();
    return name.startsWith('后') ? '后' : '前';
  }

  /** ★ 致死前血量（复活回半用；掉坑等无伤致死时由 onDeath 现场补记） */
  preDeathHp = 0;
  /** ★ 操作锁（航行阶段由舰船操控；锁定时输入清零，位置随舰船同步） */
  controlLocked = false;

  /** ★ 受击：记录致死前血量（复活 = 死前一半，保底 10% 上限） */
  override onTakeDamage(dmg: number, source: EntityBase | null): void {
    if (this.dead) return; // 死亡等待复活：免伤
    if (this.hp > 0) this.preDeathHp = this.hp;
    super.onTakeDamage(dmg, source);
  }

  /** ★ 玩家死亡（不销毁主角；死亡动画 + 等待 WorldMode 倒计时复活）
   *   不再即时回血——复活血量/时机由 WorldMode 统一结算 */
  override onDeath(source: EntityBase | null): void {
    this.playDeathAnim();
    if (this.preDeathHp <= 0) this.preDeathHp = this.hp > 0 ? this.hp : this.maxHp * 0.5;
    this.dead = true;
  }

  /** ★ 复活（WorldMode 倒计时结束时调用）：复位死亡状态并设置血量 */
  revive(hp: number): void {
    this.hp = Math.max(1, Math.min(this.maxHp, hp));
    this.preDeathHp = 0;
    this.dead = false;
  }

  /** ★ 死亡等待期 / 航行操船期：锁操作（输入清零；位置/物理骨架照常），恢复后接管 */
  private static _deadInput: InputActions | null = null;
  protected override onUpdate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    if (this.dead || this.controlLocked) {
      if (!Player._deadInput) Player._deadInput = createInputActions();
      super.onUpdate(dt, Player._deadInput, cameraFrame);
      return;
    }
    super.onUpdate(dt, input, cameraFrame);
  }
}
