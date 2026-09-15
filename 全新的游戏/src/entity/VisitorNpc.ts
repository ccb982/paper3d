// ============================================================
// VisitorNpcBase —— 访客 NPC 基类（CharacterBase 子类）
// ============================================================
// 访客机制（2026-09-15 设计）：
//   · 每天世界上生成 1~2 名访客（由访客系统按日生成，向舰船位置行进）；
//   · 抵达舰船 → 进入舰内房间（onArrive 回调交给访客系统：提示 + 舰内站位）；
//   · 每名访客独立：纹理（asset/assetUrl）、对话树（dialogue）、事件 id（eventId）。
//
// 基类职责：步行接近（地形跟随/推挤/朝向/步行动画）→ 抵达判定 → 状态机；
//   · 子类可覆写 onVisitorArrive / onVisitorTick 实现独立事件表现；
//   · 每日名额、生成位置、进舰提示、舰内交互站/落账 = 访客系统（上层）装配，基类不碰 UI。
// ============================================================

import type * as THREE from 'three';
import { CharacterBase } from './CharacterBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { CharacterAnimMap } from '../systems/player/CharacterController';
import type { CameraFrame } from '../services/camera/CameraController';
import { FTXQuad } from '../services/render/FTXQuad';

/** 访客状态：接近舰船 → 已抵达（待进舰）→ 已进舰（世界侧退场） */
export type VisitorPhase = 'approaching' | 'arrived' | 'entered';

/** 默认到舰判定半径（世界单位，米） */
export const VISITOR_ARRIVE_RADIUS = 10;
/** 默认步行速度（世界单位/秒） */
export const VISITOR_MOVE_SPEED = 3.2;

/** ★ 访客身份/配置：每名 NPC 一份（纹理 + 对话 + 事件 + 行进参数） */
export interface VisitorDef {
  /** 唯一 id（注册表/存档/事件键） */
  id: string;
  /** 显示名（舰内交互/提示） */
  name: string;
  /** 立绘资产 URL（世界贴片 + 舰内站位 + 对话头像共用） */
  assetUrl: string;
  /** 对话树 id（config/dialogues.json） */
  dialogue: string;
  /** 事件 id（config/events.json；对话结束 → EventSystem 落账；缺省不落账） */
  eventId?: string;
  /** 步行速度覆盖（缺省 VISITOR_MOVE_SPEED） */
  moveSpeed?: number;
  /** 贴片缩放覆盖（世界宽；缺省 2.0，与主角一致） */
  scale?: number;
  /** 到舰半径覆盖（缺省 VISITOR_ARRIVE_RADIUS） */
  arriveRadius?: number;
}

export interface VisitorNpcOptions {
  def: VisitorDef;
  x: number;
  y: number;
  z: number;
  /** ★ 目标点（舰船当前位置）读取器：每帧调用，舰船移动后也能追上 */
  getTarget: () => { x: number; z: number } | null;
  /** ★ 抵达舰船回调（访客系统接管：进舰提示 + 舰内入住 + 世界侧退场） */
  onArrive?: (visitor: VisitorNpcBase) => void;
  /** 相机帧读取器（可选；有则按镜头判定 前/后 帧 + 左右翻转） */
  getCameraFrame?: () => CameraFrame | null;
  /** 动画表覆盖（缺省按纹理帧名推导：前/后 前缀分组；无方向名则整组循环） */
  animMap?: CharacterAnimMap;
}

export class VisitorNpcBase extends CharacterBase {
  readonly def: VisitorDef;
  readonly moveSpeed: number;
  readonly arriveRadius: number;

  private phase: VisitorPhase = 'approaching';
  private readonly getTarget: () => { x: number; z: number } | null;
  private readonly onArriveCb?: (visitor: VisitorNpcBase) => void;
  private readonly getCameraFrame?: () => CameraFrame | null;
  private readonly visitorAnimMap: CharacterAnimMap;
  /** 当前动画态（幂等：状态不变不重播） */
  private animMoving: boolean | null = null;

  constructor(em: EntityManager, scene: THREE.Scene, asset: FrameAssetSource, opts: VisitorNpcOptions) {
    const animMap = opts.animMap ?? deriveVisitorAnimMap(asset);
    super(em, {
      kind: 'npc',
      x: opts.x,
      y: opts.y,
      z: opts.z,
      asset,
      animMap,
      moveSpeed: opts.def.moveSpeed ?? VISITOR_MOVE_SPEED,
      facing: '前',
    });
    this.def = opts.def;
    this.moveSpeed = opts.def.moveSpeed ?? VISITOR_MOVE_SPEED;
    this.arriveRadius = opts.def.arriveRadius ?? VISITOR_ARRIVE_RADIUS;
    this.getTarget = opts.getTarget;
    this.onArriveCb = opts.onArrive;
    this.getCameraFrame = opts.getCameraFrame;
    this.visitorAnimMap = animMap;
    this.camp = 'neutral';
    // ★ 访客不参战、不爬崖：贴地步行 + 地形立面阻挡（与敌人同款限制）
    this.blockCliffClimb = true;
    this.attachToScene(scene);
    const scale = opts.def.scale ?? 2.0;
    if (this.renderer && 'setScaleKeepAspect' in this.renderer) {
      (this.renderer as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(scale);
    }
    this.playVisitorAnim(true); // 生成即行进 → 走入步行动画
  }

  /** 当前状态（访客系统读取：approaching 世界侧活跃 / arrived 待进舰 / entered 已退场） */
  get visitPhase(): VisitorPhase {
    return this.phase;
  }

  /** 渲染器：FTXQuad billboard 贴片（与 NPC / 主角同管线） */
  protected createRenderer(scene: THREE.Scene): FTXQuad | null {
    if (!this.anim) return null;
    return new FTXQuad(scene, this.anim.source);
  }

  protected override onUpdate(dt: number): void {
    if (this.phase !== 'approaching') {
      this.stopMove();
      return;
    }
    const target = this.getTarget();
    if (!target) {
      this.stopMove();
      this.playVisitorAnim(false);
      return;
    }
    const p = this.entity.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    if (dx * dx + dz * dz <= this.arriveRadius * this.arriveRadius) {
      this.arrive();
      return;
    }
    this.controller.moveToward(dx, dz, dt, this.moveSpeed);
    this.updateFacing(dx, dz);
    this.playVisitorAnim(true);
    super.onUpdate(dt);
    this.onVisitorTick(dt);
  }

  /** ★ 访客系统调用：标记已进舰（世界侧退场；dispose 时机由系统决定） */
  markEntered(): void {
    if (this.phase === 'entered') return;
    this.phase = 'entered';
    this.stopMove();
    this.visible = false;
  }

  /** 子类钩子：抵达舰船（独立事件表现；进舰逻辑由访客系统接管） */
  protected onVisitorArrive(): void {}

  /** 子类钩子：接近阶段每帧（独立表现/事件判定） */
  protected onVisitorTick(_dt: number): void {}

  private arrive(): void {
    this.phase = 'arrived';
    this.stopMove();
    this.playVisitorAnim(false);
    this.onVisitorArrive();
    this.onArriveCb?.(this);
  }

  private stopMove(): void {
    this.controller.moveDir.x = 0;
    this.controller.moveDir.y = 0;
  }

  /** 朝向：按相机帧判定 前/后 帧组 + 左右镜像（无相机读取器则保持 前 + 不翻转） */
  private updateFacing(dx: number, dz: number): void {
    const frame = this.getCameraFrame?.() ?? null;
    if (!frame || !this.anim) return;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = dx / len;
    const nz = dz / len;
    const fDot = nx * frame.forward.x + nz * frame.forward.z;
    if (fDot > 0.35) this.anim.setFacing('后');
    else if (fDot < -0.35) this.anim.setFacing('前');
    const rDot = nx * frame.right.x + nz * frame.right.z;
    if (rDot < -0.35) this.anim.setFlipX(true);
    else if (rDot > 0.35) this.anim.setFlipX(false);
  }

  /** 步行/待机动画（幂等；帧组取当前朝向） */
  private playVisitorAnim(walking: boolean): void {
    if (this.animMoving === walking) return;
    this.animMoving = walking;
    if (!this.anim) return;
    const facing = this.anim.state.facing;
    const group = this.visitorAnimMap.states[walking ? 'walk' : 'idle'][facing];
    if (!group || group.length === 0) return;
    this.anim.playFrames(walking ? group : [group[0]], {
      loop: true,
      fps: walking ? (this.visitorAnimMap.fps?.walk ?? 5) : 1,
    });
  }
}

/** ★ 默认动画表：帧名以 前/后 开头 → 分朝向；无方向名 → 整组帧按 前 循环
 *  （单帧资产退化为站姿；具体访客可用 animMap 覆盖） */
export function deriveVisitorAnimMap(source: FrameAssetSource): CharacterAnimMap {
  const names = source.frameNames();
  const fallback = names.length > 0 ? names : ['前'];
  const pick = (facing: '前' | '后'): string[] => {
    const hit = names.filter((n) => n.startsWith(facing));
    return hit.length > 0 ? hit : fallback;
  };
  const front = pick('前');
  const back = pick('后');
  return {
    states: {
      idle: { 前: [front[0]], 后: [back[0]] },
      walk: { 前: front, 后: back },
      attack: { 前: [front[0]], 后: [back[0]] },
    },
    fps: { idle: 2, walk: 5, attack: 6 },
  };
}
