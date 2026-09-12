// ============================================================
// ShipEntity —— 舰船（世界内实体，占位版）
// ============================================================
// 阶段语义（WorldMode）：
//   sail    ：**飞行驾驶**——鼠标 = 姿态（俯仰/转向），W/S = 油门，A/D = 方向舵；
//             机体永远沿机头方向前进（真正飞行手感），不做地形碰撞，
//             仅对停靠点做坑判定（飞行中地形只提供最低净空限制）。
//   explore ：停靠后静止，作为敌人**优先攻击目标**（camp='player'）；
//             受击走 ShipState.applyShipDamage（护盾→装甲→HP）。
// 视觉：占位盒子（船体+舱室+船首，机头朝 +Z），美术到位后只换渲染器。
// 无物理刚体：敌人近战经 querySphere（空间索引）命中，不依赖 rapier。

import * as THREE from 'three';
import { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { GameSession } from '../core/Session';
import { applyShipDamage, isShipDestroyed } from '../systems/ship/ShipState';
import { RasterMap } from '../services/map/RasterMap';
import { FxRendererBase } from '../services/render/FxRendererBase';
import { eventBus } from '../core/EventBus';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';
import travelConfig from '../config/travel.json';

/** 停靠后舰体离地高度（贴地摆放视觉用） */
const LANDED_HEIGHT = 1.0;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 占位渲染器：船体 + 舱室 + 船首（MeshBasicMaterial，机头朝 +Z；支持姿态旋转） */
class ShipPlaceholderRenderer extends FxRendererBase {
  private group: THREE.Group;
  constructor(scene: THREE.Scene) {
    super();
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.1, 4.6),
      new THREE.MeshBasicMaterial({ color: 0x8794a6 }),
    );
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.9, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x5f6c7d }),
    );
    cabin.position.set(0, 0.95, 0.7);
    const bow = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.8, 0.9),
      new THREE.MeshBasicMaterial({ color: 0x9aa7b8 }),
    );
    bow.position.set(0, 0.05, 2.6);
    g.add(hull, cabin, bow);
    scene.add(g);
    this.group = g;
    this.mesh = g as unknown as THREE.Mesh;
  }

  /** ★ 飞行姿态（YXZ：先航向、再俯仰、后滚转） */
  setAttitude(heading: number, pitch: number, roll: number): void {
    this.group.rotation.y = heading;
    this.group.rotation.x = -pitch;
    this.group.rotation.z = roll;
  }

  override dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.parent?.remove(this.group);
    this.mesh = null;
  }
}

export class ShipEntity extends EntityBase {
  /** ★ 是否处于可操控航行（false = 已停靠，静止目标） */
  sailable = true;
  /** ★ 飞行姿态：航向 / 俯仰 / 滚转（弧度） */
  private heading = 0;
  private pitch = 0;
  private roll = 0;
  /** ★ 油门（当前速度 m/s） */
  private speed = travelConfig.flightThrottleStart;
  /** 转向角速度平滑（滚转视觉用） */
  private yawVelSmoothed = 0;
  private readonly session: GameSession;

  constructor(em: EntityManager, scene: THREE.Scene, session: GameSession, x: number, z: number) {
    super(em, {
      kind: 'ship',
      x,
      y: (RasterMap.current?.surfaceHeightAt(x, z) ?? 0) + travelConfig.flightStartClearance,
      z,
    });
    this.session = session;
    this.camp = 'player';   // 敌方索敌/受击；同阵营过滤保证玩家子弹不伤舰船
    this.lodExempt = true;  // 始终更新/渲染（全图唯一舰船）
    this.attachToScene(scene);
    this.hp = session.ship.hp;
    this.maxHp = session.ship.maxHp;
  }

  /** ★ 机头方向单位向量（相机/推进用） */
  get forward(): { x: number; y: number; z: number } {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.heading) * cp, y: Math.sin(this.pitch), z: Math.cos(this.heading) * cp };
  }

  protected override createRenderer(scene: THREE.Scene): FxRendererBase {
    return new ShipPlaceholderRenderer(scene);
  }

  override get minimapInfo(): { kind: string; moving: boolean } {
    return { kind: 'ship', moving: this.sailable };
  }

  /** ★ 飞行驾驶输入（WorldMode 每帧在实体管线前调用；look 为消费前的鼠标增量）
   *   鼠标 = 姿态杆：上下 = 俯仰（抬头爬升/低头俯冲），左右 = 转向；
   *   W/S = 油门加/减（moveY），A/D = 方向舵（moveX）。 */
  steer(lookX: number, lookY: number, moveX: number, moveY: number, dt: number): void {
    if (!this.sailable) return;
    const sens = travelConfig.flightMouseSens;
    // 姿态：鼠标直接驱动（与 FPS look 同量纲）
    // ★ 转向符号：相机在机后看向 +forward，屏幕右 = 机体右侧（-X 系）→ 鼠标右应减小 heading
    this.pitch = clamp(this.pitch - lookY * sens, -travelConfig.flightPitchMax, travelConfig.flightPitchMax);
    const prevHeading = this.heading;
    this.heading -= lookX * sens;
    this.heading -= moveX * travelConfig.flightRudderRate * dt; // 方向舵（与鼠标同向）
    // 油门：W 加速 / S 减速
    this.speed = clamp(
      this.speed + (-moveY) * travelConfig.flightAccel * dt,
      travelConfig.flightThrottleMin,
      travelConfig.flightThrottleMax,
    );
    // 滚转视觉：跟随转向角速度（平滑），松手自动回正
    // ★ 右转 = yawVel 负 → 需要正 roll（右翼下沉视觉），故取反
    const yawRate = dt > 0 ? (this.heading - prevHeading) / dt : 0;
    this.yawVelSmoothed += (yawRate - this.yawVelSmoothed) * Math.min(1, dt * 6);
    const targetRoll = clamp(-this.yawVelSmoothed * travelConfig.flightRollGain, -travelConfig.flightRollMax, travelConfig.flightRollMax);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
  }

  /** ★ 停靠：转为静止目标（位置由 WorldMode 设为安全落点） */
  land(): void {
    this.sailable = false;
    const p = this.entity.position;
    p.y = (RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0) + LANDED_HEIGHT;
    this.renderer?.setPosition(p.x, p.y, p.z); // 停靠当帧就位（下一帧起骨架接管同步）
  }

  /** ★ 航行推进（WorldMode 航行帧直接调用——航行期实体管线全免，不进 EntityBase.update）
   *  ★ 注意：跳过了骨架的 syncRender，必须自己同步网格位置（否则船体网格留在世界原点） */
  stepFlight(dt: number): void {
    if (!this.sailable) return;
    const p = this.entity.position;
    const f = this.forward;
    p.x += f.x * this.speed * dt;
    p.z += f.z * this.speed * dt;
    p.y += f.y * this.speed * dt;
    // 地形净空（不撞地：最低离地；上限防飞出天外）
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    p.y = clamp(p.y, gy + travelConfig.flightMinClearance, gy + travelConfig.flightMaxClearance);
    this.renderer?.setPosition(p.x, p.y, p.z);
    (this.renderer as ShipPlaceholderRenderer | null)?.setAttitude?.(this.heading, this.pitch, this.roll);
  }

  /** 每帧（探索期实体管线会调用；航行期由 stepFlight 接管） */
  protected override onUpdate(_dt: number, _input?: InputActions, _cameraFrame?: CameraFrame): void {
    const p = this.entity.position;
    if (this.sailable) return;
    p.y = (RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0) + LANDED_HEIGHT;
    (this.renderer as ShipPlaceholderRenderer | null)?.setAttitude?.(this.heading, 0, 0);
  }

  /** ★ 受击：舰船结算（护盾→装甲→HP）；同步实体血量 + 发事件。
   *  不调用 super（避免走通用 killed/onDeath 流程） */
  override onTakeDamage(dmg: number, _source: EntityBase | null): void {
    const actual = applyShipDamage(this.session, dmg);
    this.hp = this.session.ship.hp;
    if (actual > 0) {
      eventBus.emit('ship_damaged', {
        damage: actual,
        destroyed: isShipDestroyed(this.session),
      });
    }
  }
}
