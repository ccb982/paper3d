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
  private moveSpeed: number;
  private currentState: 'idle' | 'walk' | 'attack' = 'idle';

  /** 世界位置（渲染管线/逻辑层读取） */
  position = { x: 0, y: 0 };

  constructor(anim: FrameAnimatorBase, animMap: CharacterAnimMap, moveSpeed = 60) {
    this.anim = anim;
    this.animMap = animMap;
    this.moveSpeed = moveSpeed;
  }

  /**
   * 每帧驱动：输入 + 相机坐标系 → 相机相对移动 / 朝向判定 / 动画状态。
   * ★ 主流第三人称做法：W 永远朝画面深处，A/D 永远屏幕左右，
   *   角色朝向 = 移动方向相对相机的判定（视角转，角色跟着转）。
   */
  update(dt: number, input: InputActions, frame: CameraFrame): void {
    const axis = normalizeAxis(input.moveAxis);
    const moving = hasMovement(axis);

    // ---- 相机相对移动（世界方向 = right*x + forward*(-y)） ----
    const mvX = frame.right.x * axis.x + frame.forward.x * (-axis.y);
    const mvZ = frame.right.z * axis.x + frame.forward.z * (-axis.y);
    if (moving) {
      this.position.x += mvX * this.moveSpeed * dt;
      this.position.y += mvZ * this.moveSpeed * dt; // 玩法 y ↔ 世界 z
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
}
