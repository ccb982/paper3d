// ============================================================
// ShipEntity —— 舰船（世界内实体，占位版）
// ============================================================
// 阶段语义（WorldMode）：
//   sail    ：**飞行驾驶**——鼠标 = 姿态（俯仰/转向），W/S = 油门，A/D = 方向舵；
//             机体永远沿机头方向前进（真正飞行手感），不做地形碰撞，
//             仅对停靠点做坑判定（飞行中地形只提供最低净空限制）。
//   explore ：停靠后静止，作为敌人**优先攻击目标**（camp='player'）；
//             受击走 ShipState.applyShipDamage（护盾→装甲→HP）。
// 视觉：ShipRenderer（GLB `public/models/ship.glb` 优先 + 程序化军武运输舰兜底；
//       机头朝 +Z，姿态 YXZ，喷口随油门增亮）。
// 物理：fixed 刚体（圆柱碰撞体横放对齐机身，机翼不参与物理）；停靠时挡人走 JS 静态障碍索引。
//       敌人近战经 querySphere（空间索引）命中。

import * as THREE from 'three';
import { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { GameSession } from '../core/Session';
import { applyShipDamage, isShipDestroyed } from '../systems/ship/ShipState';
import { RasterMap } from '../services/map/RasterMap';
import { addStaticObstacle, removeStaticObstacle } from '../services/physics/StaticObstacleRegistry';
import { FxRendererBase } from '../services/render/FxRendererBase';
import { ShipRenderer } from './ship/ShipRenderer';
import { eventBus } from '../core/EventBus';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';
import travelConfig from '../config/travel.json';

/** 停靠后舰体中心离地高度（贴地摆放视觉用；= 船底局部 -0.99 × MODEL_SCALE 的一半量级）
 *  ★ 4× 模型：船底局部 ≈ -1.98 → 中心 2.0 时船底贴地 */
export const SHIP_LANDED_HEIGHT = 2.0;
const LANDED_HEIGHT = SHIP_LANDED_HEIGHT;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 姿态同步临时对象（避免每次 setFromEuler 分配） */
const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();

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
      // ★ 船体实体（2026-09-12 用户点题：舰船必须有实体）：fixed 刚体，
      //   碰撞体抽象成【圆柱】（半径 3.6 / 全長 25，绕 X 转 90° 横放对齐机头方向）；
      //   机翼不参与物理（无碰撞体）。子弹命中船体；航行期物理步不跑（停靠/落稳时同步位置）。
      physics: {
        type: 'fixed',
        options: {
          shape: { type: 'cylinder', halfHeight: 12.5, radius: 3.6 }, // 4× 船体 ≈25m 长
          rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, // Y 轴 → Z 轴（绕 X +90°）
        },
      },
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
    return new ShipRenderer(scene);
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

  /** ★ 停靠：转为静止目标（位置由 WorldMode 设为安全落点）；
   *  同步刚体位置 + 登记船体挡人索引（仅停靠期） */
  land(): void {
    this.sailable = false;
    const p = this.entity.position;
    p.y = (RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0) + LANDED_HEIGHT;
    this.renderer?.setPosition(p.x, p.y, p.z); // 停靠当帧就位（下一帧起骨架接管同步）
    this.syncBody();
    this.registerHullBlock();
  }

  /** 同步 fixed 刚体到当前船体位置与姿态（停靠/落稳；航行期物理步不跑无需逐帧） */
  private syncBody(): void {
    const rb = this.entity.rigidBody;
    const p = this.entity.position;
    const phys = this.em.physics;
    if (!rb || !phys) return;
    phys.setPosition(rb.handle, p.x, p.y, p.z);
    // ★ 圆柱碰撞体随姿态（与 ShipRenderer 同序 YXZ：航向→俯仰→滚转）
    _tmpEuler.set(-this.pitch, this.heading, this.roll, 'XYZ');
    _tmpQuat.setFromEuler(_tmpEuler);
    phys.setRotation(rb.handle, { x: _tmpQuat.x, y: _tmpQuat.y, z: _tmpQuat.z, w: _tmpQuat.w });
  }

  /** ★ 船体挡人（静态障碍 JS 索引；仅停靠期）：机身三圆近似圆柱（机翼不挡人） */
  private hullBlockIds: number[] = [];
  private registerHullBlock(): void {
    this.clearHullBlock();
    const p = this.entity.position;
    const f = this.forward;
    const spots: [number, number][] = [
      [0, -8], [0, 0], [0, 8], // 机身（沿机头方向）
    ];
    for (let k = 0; k < spots.length; k++) {
      const id = -(this.entity.id * 16 + k + 1); // 负 id：与实体/地面/装饰 id 不冲突
      const x = p.x + f.x * spots[k][1];
      const z = p.z + f.z * spots[k][1];
      addStaticObstacle(id, x, p.y, z, 3.6, 2.0);
      this.hullBlockIds.push(id);
    }
  }

  private clearHullBlock(): void {
    for (const id of this.hullBlockIds) removeStaticObstacle(id);
    this.hullBlockIds.length = 0;
  }

  override dispose(): void {
    this.clearHullBlock();
    super.dispose();
  }

  /** ★ 降落进近步进（WorldMode 降落状态机驱动）：
   *  · 保留前进速度（自动收油到 `flightLandingSpeed`），继续向前飞；
   *  · 操控权限低（25%），但**角度/方向只由玩家输入决定**——不做自动回正/限幅；
   *  · **只自动固定高度**（`flightLandingSink` 指数贴向落点高度，不适用最低净空）；
   *  返回 true = 已触地（WorldMode 进入落稳段）。 */
  landingStep(dt: number, lookX: number, lookY: number, moveX: number): boolean {
    const k = 0.25; // 低操控权限
    this.pitch = clamp(
      this.pitch - lookY * k * travelConfig.flightMouseSens,
      -travelConfig.flightPitchMax,
      travelConfig.flightPitchMax,
    );
    this.heading -= lookX * k * travelConfig.flightMouseSens;
    this.heading -= moveX * k * travelConfig.flightRudderRate * dt;
    // 自动收油到进近速度（保留前进动量）
    this.speed = Math.max(travelConfig.flightLandingSpeed, this.speed - 16 * dt);
    const p = this.entity.position;
    const f = this.forward;
    p.x += f.x * this.speed * dt;
    p.z += f.z * this.speed * dt;
    p.y += f.y * this.speed * dt;
    // 只固定高度：高时快、近地慢（alt×0.4，夹在 [Sink, SinkMax]）——软着地
    // ★ 落体目标同样低通地形高度，末端不随逐块高差抖
    const rawGy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const gy = this.smoothGround(rawGy, dt, 12, 6);
    const target = gy + LANDED_HEIGHT;
    if (p.y > target) {
      const alt = p.y - target;
      const sink = Math.min(
        travelConfig.flightLandingSinkMax,
        Math.max(travelConfig.flightLandingSink, alt * 0.4),
      );
      p.y = Math.max(target, p.y - sink * dt);
    } else if (target - p.y > 1e-3) {
      // ★ 地形抬升：限速爬升（原先 p.y=target 会瞬间弹起 → 玩家体感"卡一下就落地"）
      p.y = Math.min(target, p.y + travelConfig.flightLandingSinkMax * dt);
    }
    this.renderer?.setPosition(p.x, p.y, p.z);
    const sr = this.renderer as ShipRenderer | null;
    sr?.setAttitude?.(this.heading, this.pitch, this.roll);
    sr?.setThrottle?.(0.35);
    // ★ 到位收敛才判触地（消除"瞬移接地"的跳变）
    return Math.abs(p.y - target) <= 0.15;
  }

  /** ★ 起飞前设定（登船后调用）：恢复可操控、水平姿态、进近速度起步 */
  beginTakeoff(): void {
    this.sailable = true;
    this.pitch = 0;
    this.roll = 0;
    this.speed = travelConfig.flightLandingSpeed;
    this.groundSmY = NaN; // 起飞重置低通（立即贴合当前地形）
    this.clearHullBlock(); // 起飞：船体挡人索引撤除（航行期不挡路）
  }

  /** 当前速度（m/s；降落预测/镜头调度用） */
  get speedValue(): number { return this.speed; }

  /** ★ 地形高度低通值（贴下限巡航/落体目标防抖：地形逐块高差噪声不直接进高度） */
  private groundSmY = NaN;
  /** 低通：上升跟手（防穿地）、下降更缓（防掉高抖动）；rate 单位 m/s */
  private smoothGround(raw: number, dt: number, upRate = 10, downRate = 5): number {
    if (Number.isNaN(this.groundSmY)) this.groundSmY = raw;
    const lim = (raw > this.groundSmY ? upRate : downRate) * dt;
    this.groundSmY += Math.max(-lim, Math.min(lim, raw - this.groundSmY));
    return this.groundSmY;
  }

  /** ★ 起飞段步进（WorldMode 状态机驱动）：自动爬升到最低净空 + 油门渐增；
   *  姿态/航向保持不动；到位返回 true（交还驾驶） */
  takeoffStep(dt: number): boolean {
    const p = this.entity.position;
    const f = this.forward;
    this.speed = Math.min(travelConfig.flightThrottleStart, this.speed + 18 * dt);
    p.x += f.x * this.speed * dt;
    p.z += f.z * this.speed * dt;
    p.y += travelConfig.flightTakeoffClimb * dt;
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const minY = gy + travelConfig.flightMinClearance;
    const arrived = p.y >= minY;
    if (arrived) p.y = minY;
    this.renderer?.setPosition(p.x, p.y, p.z);
    const sr = this.renderer as ShipRenderer | null;
    sr?.setAttitude?.(this.heading, this.pitch, this.roll);
    sr?.setThrottle?.(0.85);
    return arrived;
  }

  /** ★ 落稳段步进：只固定位置（贴地 + 水平滑向安全点），**姿态角度保持玩家操作结果**；
   *  同步刚体（落稳结束时刚体正好在最终落点） */
  settleStep(x: number, y: number, z: number): void {
    const p = this.entity.position;
    p.x = x; p.y = y; p.z = z;
    this.renderer?.setPosition(x, y, z);
    this.syncBody();
    const sr = this.renderer as ShipRenderer | null;
    sr?.setAttitude?.(this.heading, this.pitch, this.roll);
    sr?.setThrottle?.(0.15);
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
    // ★ 下限用低通后的地形高度：贴下限巡航时不再随逐块高差"台阶式"抖动
    const rawGy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const gy = this.smoothGround(rawGy, dt);
    p.y = clamp(p.y, gy + travelConfig.flightMinClearance, rawGy + travelConfig.flightMaxClearance);
    this.renderer?.setPosition(p.x, p.y, p.z);
    const sr = this.renderer as ShipRenderer | null;
    sr?.setAttitude?.(this.heading, this.pitch, this.roll);
    // ★ 喷口随油门（0..1 归一化）
    const span = Math.max(1e-3, travelConfig.flightThrottleMax - travelConfig.flightThrottleMin);
    sr?.setThrottle?.((this.speed - travelConfig.flightThrottleMin) / span);
  }

  /** 每帧（探索期实体管线会调用；航行期由 stepFlight 接管） */
  protected override onUpdate(_dt: number, _input?: InputActions, _cameraFrame?: CameraFrame): void {
    const p = this.entity.position;
    if (this.sailable) return;
    p.y = (RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0) + LANDED_HEIGHT;
    const sr = this.renderer as ShipRenderer | null;
    sr?.setAttitude?.(this.heading, 0, 0);
    sr?.setThrottle?.(0); // 停靠：喷口熄灭
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
