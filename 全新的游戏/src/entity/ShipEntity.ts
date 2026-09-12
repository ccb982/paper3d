// ============================================================
// ShipEntity —— 舰船（世界内实体，占位版）
// ============================================================
// 阶段语义（WorldMode）：
//   sail    ：玩家操控的移动体（悬浮航行，输入驱动；只对停靠点做坑判定）
//   explore ：停靠后静止，作为敌人**优先攻击目标**（camp='player'）；
//             受击走 ShipState.applyShipDamage（护盾→装甲→HP）。
// 视觉：占位盒子（船体+舱室+船首），美术到位后只换渲染器。
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

const SAIL_SPEED = travelConfig.sailSpeed;
/** 停靠后舰体离地高度（贴地摆放视觉用） */
const LANDED_HEIGHT = 1.0;

/** 占位渲染器：船体 + 舱室 + 船首（MeshBasicMaterial，不参与光照/影子） */
class ShipPlaceholderRenderer extends FxRendererBase {
  private group: THREE.Group;
  constructor(scene: THREE.Scene) {
    super();
    const g = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.1, 2.2),
      new THREE.MeshBasicMaterial({ color: 0x8794a6 }),
    );
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.9, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x5f6c7d }),
    );
    cabin.position.set(0.7, 0.95, 0);
    const bow = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.8, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x9aa7b8 }),
    );
    bow.position.set(-2.6, 0.05, 0);
    g.add(hull, cabin, bow);
    scene.add(g);
    this.group = g;
    this.mesh = g as unknown as THREE.Mesh;
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
  /** ★ 飞行高度（离地净空；航行期鼠标俯仰控制，停靠时忽略） */
  private flyHeight = travelConfig.sailStartHeight;
  private readonly session: GameSession;

  constructor(em: EntityManager, scene: THREE.Scene, session: GameSession, x: number, z: number) {
    super(em, {
      kind: 'ship',
      x,
      y: (RasterMap.current?.surfaceHeightAt(x, z) ?? 0) + travelConfig.sailStartHeight,
      z,
    });
    this.session = session;
    this.camp = 'player';   // 敌方索敌/受击；同阵营过滤保证玩家子弹不伤舰船
    this.lodExempt = true;  // 始终更新/渲染（全图唯一舰船）
    this.attachToScene(scene);
    this.hp = session.ship.hp;
    this.maxHp = session.ship.maxHp;
  }

  protected override createRenderer(scene: THREE.Scene): FxRendererBase {
    return new ShipPlaceholderRenderer(scene);
  }

  override get minimapInfo(): { kind: string; moving: boolean } {
    return { kind: 'ship', moving: this.sailable };
  }

  /** ★ 飞行高度控制（WorldMode 每帧按相机俯仰映射；停靠时无效） */
  setFlyHeight(h: number): void {
    this.flyHeight = h;
  }

  /** ★ 停靠：转为静止目标（位置由 WorldMode 设为安全落点） */
  land(): void {
    this.sailable = false;
    const p = this.entity.position;
    p.y = (RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0) + LANDED_HEIGHT;
  }

  /** ★ 航行操控：相机系移动 + 悬浮贴地（不做地形碰撞；停靠时才判定坑） */
  protected override onUpdate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    const p = this.entity.position;
    if (this.sailable && input && cameraFrame) {
      const ax = input.moveAxis.x, ay = input.moveAxis.y;
      if (Math.hypot(ax, ay) > 0.2) {
        // ★ 与 CharacterController 同口径：世界方向 = right*x + forward*(-y)
        let mx = cameraFrame.right.x * ax + cameraFrame.forward.x * (-ay);
        let mz = cameraFrame.right.z * ax + cameraFrame.forward.z * (-ay);
        const l = Math.hypot(mx, mz) || 1;
        mx /= l; mz /= l;
        p.x += mx * SAIL_SPEED * dt;
        p.z += mz * SAIL_SPEED * dt;
      }
    }
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    p.y = gy + (this.sailable ? this.flyHeight : LANDED_HEIGHT);
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
