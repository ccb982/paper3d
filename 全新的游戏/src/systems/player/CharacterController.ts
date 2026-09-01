// ============================================================
// CharacterController —— 角色控制层（输入解耦）
// ============================================================
// 消费抽象输入（InputActions.moveAxis），驱动：
//   - 移动（位置更新）
//   - 动画状态（walk/idle/attack）
//   - 朝向（facing 帧组：前/后）+ 左右反转（flipX）
// 不碰具体按键（键盘/触屏由 Binding 层翻译）。
//
// 朝向约定（与帧名语义一致）：
//   moveAxis.y > 0（向下/S）→ facing = '前'（脸朝相机帧组）
//   moveAxis.y < 0（向上/W）→ facing = '后'
//   moveAxis.x < 0（向左） → flipX = true（脸朝左）
//   moveAxis.x > 0（向右） → flipX = false
// ★ flipX 状态延续：切换动画状态（idle↔walk）不重置，只由新输入方向修改。

import type { FrameAnimatorBase } from '../../services/fx/FrameAnimatorBase';
import type { InputActions } from '../../platform/input/InputActions';
import type { CameraFrame } from '../../services/camera/CameraController';
import { normalizeAxis, hasMovement } from '../../platform/input/InputActions';

export interface CharacterAnimMap {
  /** 动画状态 → 帧名序列（按朝向分组的帧组） */
  states: {
    idle: Record<string, string[]>;
    walk: Record<string, string[]>;
    attack: Record<string, string[]>;
  };
  /** 各状态帧率 */
  fps?: { idle?: number; walk?: number; attack?: number };
}

export class CharacterController {
  readonly anim: FrameAnimatorBase;
  private animMap: CharacterAnimMap;
  /** 移动速度（世界单位/秒；速度驱动用） */
  moveSpeed: number;
  private currentState: 'idle' | 'walk' | 'attack' = 'idle';

  /** ★ 期望移动方向（世界系 x/z，已归一化；0 = 静止）——速度驱动/朝向判定用 */
  moveDir = { x: 0, y: 0 };

  // ---- 跳跃状态（简单抛物线，与移动/物理解耦） ----
  private jumpVel = 0;
  private jumpOffset = 0;
  private onGround = true;
  /** ★ 跳跃初速 / 重力。★ 空格跳跃真实高度 = jumpSpeed²/(2·gravity) = 0.6
   *   （2026-08-31 用户定：爬阶梯 0.35 / 空格跳跃 0.6 → 可跳上 0.5 高差） */
  jumpSpeed = 0;
  gravity = 12;
  /** ★ 真实贴地（世界每帧回填：角色脚底已贴合地表）。false = 悬空/未落地。
   *   真实落地模式（boss4D 玩家）用它作为跳跃资格判定——只有在地面上才允许起跳，
   *   长按跳跃每帧检查、踩实瞬间立即自动再跳（连跳手感保留）。
   *   标准世界/敌人不使用（保持旧 onGround 抛物线连跳行为）。 */
  onFloor = true;
  /** ★ 真实落地模式（boss4D 玩家专属，标准世界/敌人 false）：只有真实贴地
   *   （onFloor）才允许起跳 ⇒ 空中/虚空长按不会跳，杜绝穿墙/悬浮连跳。 */
  requireRealLanding = false;

  constructor(anim: FrameAnimatorBase, animMap: CharacterAnimMap, moveSpeed = 60) {
    this.anim = anim;
    this.animMap = animMap;
    this.moveSpeed = moveSpeed;
    this.jumpSpeed = Math.sqrt(2 * this.gravity * 0.6); // 峰值 = 0.6
  }

  /** ★ 空中？（跳跃点起跳 → 落地复位）。运动层据此给真实 y 升降 */
  isAirborne(): boolean {
    return !this.onGround;
  }

  /**
   * 每帧驱动：输入 + 相机坐标系 → 相机相对移动 / 朝向判定 / 动画状态。
   * ★ 主流第三人称做法：W 永远朝画面深处，A/D 永远屏幕左右，
   *   角色朝向 = 移动方向相对相机的判定（视角转，角色跟着转）。
   */
  update(dt: number, input: InputActions, frame: CameraFrame): void {
    const axis = normalizeAxis(input.moveAxis);
    const moving = hasMovement(axis);

    // ---- 相机相对移动（世界方向 = right*x + forward*(-y)）----
    const mvX = frame.right.x * axis.x + frame.forward.x * (-axis.y);
    const mvZ = frame.right.z * axis.x + frame.forward.z * (-axis.y);
    // ★ 期望方向（速度驱动：物理按此设速度，位置由 rapier 结算）
    const len = Math.hypot(mvX, mvZ);
    if (len > 0.001) {
      this.moveDir.x = mvX / len;
      this.moveDir.y = mvZ / len;
    } else {
      this.moveDir.x = 0;
      this.moveDir.y = 0;
    }

    // ---- 朝向判定（相对相机） ----
    // facing：移动方向与画面深处的夹角 → 前/后帧组
    const fDot = mvX * frame.forward.x + mvZ * frame.forward.z;
    if (fDot > 0.35) {
      this.anim.setFacing('后'); // 朝画面深处 = 背对相机
    } else if (fDot < -0.35) {
      this.anim.setFacing('前'); // 朝相机 = 脸朝玩家
    }
    // flipX：移动方向与画面右侧的夹角 → 左右反转
    const rDot = mvX * frame.right.x + mvZ * frame.right.z;
    if (rDot < -0.35) this.anim.setFlipX(true);
    else if (rDot > 0.35) this.anim.setFlipX(false);

    // ---- 动画状态 ----
    const nextState = moving ? 'walk' : 'idle';
    if (nextState !== this.currentState) {
      this.currentState = nextState;
      this.playState(nextState);
    }

    // ---- 跳跃物理（抛物线：高度偏移，落地复位；★ 按住跳跃 = 落地自动连跳） ----
    if (!this.onGround) {
      this.jumpVel -= this.gravity * dt;
      this.jumpOffset += this.jumpVel * dt;
      if (this.jumpOffset <= 0) {
        this.jumpOffset = 0;
        this.onGround = true;
      }
    }
    // 长按跳跃（held，非边沿）：每帧检查跳跃资格，命中即起跳（落地瞬间自动再跳）。
    // ★ 真实落地模式（boss4D 玩家）：跳跃资格 = 真实贴地 onFloor（世界每帧回填）——
    //   只有在地面上才允许起跳，空中/虚空长按无效；踩实地面帧恢复 onFloor → 立即再跳。
    //   默认（标准世界/敌人）：requireRealLanding=false → 用旧 onGround（抛物线复位即跳）。
    if (
      input.held.jump &&
      (this.requireRealLanding ? this.onFloor : this.onGround)
    ) {
      this.jumpVel = this.jumpSpeed;
      this.onGround = false;
    }
  }

  /** 触发跳跃（仅在地面时；空跳无效） */
  jump(): void {
    if (!this.onGround) return;
    this.jumpVel = this.jumpSpeed;
    this.onGround = false;
  }

  /** 当前高度偏移（渲染层：角色 y = 地形高度 + 贴片偏移 + 跳高） */
  getHeightOffset(): number {
    return this.jumpOffset;
  }

  /**
   * ★ AI 定向移动（无输入）：设置期望方向（速度驱动，物理结算位置）。
   * 供敌人/AI 行为调用（玩家走 update 输入驱动）。
   */
  moveToward(dx: number, dz: number, dt: number, speed: number): void {
    const len = Math.hypot(dx, dz);
    if (len > 0.001) {
      this.moveDir.x = dx / len;
      this.moveDir.y = dz / len; // 玩法 y ↔ 世界 z
    } else {
      this.moveDir.x = 0;
      this.moveDir.y = 0;
    }
    this.moveSpeed = speed;
  }

  /** 攻击（单次，播完自动回 idle——由 FrameAnimator 回调驱动） */
  attack(): void {
    if (this.currentState === 'attack') return;
    this.currentState = 'attack';
    this.anim.onAnimationComplete = () => {
      this.currentState = 'idle';
      this.playState('idle');
    };
    this.playState('attack');
  }

  private playState(state: 'idle' | 'walk' | 'attack'): void {
    if (state === 'idle') {
      // ★ 静止：不播放动画，冻结在当前帧（延续上一帧的朝向/翻转）
      this.anim.hold();
      return;
    }
    const facing = this.anim.state.facing;
    const frames = this.animMap.states[state][facing];
    if (!frames || frames.length === 0) return;
    const fps = this.animMap.fps?.[state] ?? 3;
    this.anim.playFrames(frames, { loop: state !== 'attack', fps });
  }

  get state(): 'idle' | 'walk' | 'attack' {
    return this.currentState;
  }

  /** 是否在移动（相机脚步抖动用） */
  get isMoving(): boolean {
    return this.currentState === 'walk';
  }
}
