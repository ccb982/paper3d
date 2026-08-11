// ============================================================
// CameraController —— 相机控制（服务层，独立模块）
// ============================================================
// 主流第三人称做法：
//   - 鼠标控制"目标角度"（targetYaw/targetPitch），相机阻尼插值过去
//     （跟手但不瞬跳）
//   - 提供相机坐标系（forward/right 水平投影）——角色移动/朝向用它
//   - 跟随目标（角色位置 + 地形高度）+ 注视点前移（角色在画面下方）
// 解耦：只消费抽象 lookAxis 与目标位置，不碰设备。

import * as THREE from 'three';

export interface CameraTarget {
  x: number;
  y: number; // 目标脚底世界坐标（玩法 x/z 平面）
  z: number;
  height: number; // 目标所处地面高度（地形 y）
  /** 跳跃高度偏移（单独传入，按人称应用增益） */
  jump?: number;
}

/** 相机水平坐标系（供角色移动/朝向判定） */
export interface CameraFrame {
  forward: { x: number; z: number }; // 画面深处方向（W 方向）
  right: { x: number; z: number };   // 画面右侧方向（D 方向）
}

export class CameraController {
  /** 目标角度（鼠标控制） */
  private targetYaw = 0;
  private targetPitch = 0.35;
  /** 实际角度（阻尼插值） */
  private yaw = 0;
  private pitch = 0.35;
  /** ★ 第一人称跳跃增益（跳跃时相机上抬更明显；第三人称 = 1 正常跟随） */
  jumpGainFirstPerson = 2.5;
  /** ★ 平滑聚焦点（标准 TPS：相机围绕 target 旋转 + 视线过 target；
   *      target 用 lerp 跟随角色 → 跳跃跟随 / 抖动过滤） */
  private smoothedTarget = new THREE.Vector3();
  /** target 平滑系数（越大越跟手；跳跃要跟、高频抖动要滤） */
  targetDamp = 12;
  /** ★ 第一人称脚步晃动（head bob，移动时）——行业标准（CS/COD 类）：
   *   步频 3~4Hz，振幅 ~0.04（走路），水平 = 垂直 2 倍频（8 字形步态）；
   *   幅度每步平滑过渡（随机但不跳变） */
  footstepShake = {
    enabled: true,
    /** 基础振幅（世界单位，走路标准） */
    baseAmplitude: 0.04,
    /** 垂直 bob 频率（Hz；步频） */
    bobFrequency: 5.5,
    /** 随机节拍区间（秒）：每步重新随机 */
    beatMin: 0.12,
    beatMax: 0.18,
  };
  /** ★ 静止呼吸（第一人称，不移动时）：低频微幅上下起伏（换气感） */
  breathing = {
    enabled: true,
    /** 幅度（世界单位，轻微） */
    amplitude: 0.08,
    /** 呼吸频率（Hz；正常呼吸 12~20 次/分钟 → 0.2~0.33） */
    frequency: 0.45,
  };
  private shakeTimer = 0;
  private bobTime = 0;
  private shakeAmpX = 0;
  private shakeAmpY = 0;
  private shakeTargetAmp = 0;
  private breathTime = 0;
  /** 相机到目标距离（滚轮缩放，clamp；最小 = 贴脸第一人称） */
  distance = 4.2;
  distanceMin = 0.2;
  distanceMax = 12;
  /** 进入第一人称的距离阈值 */
  firstPersonDistance = 0.6;
  /** 缩放灵敏度（距离单位/滚轮增量） */
  zoomSensitivity = 0.012;
  /** 注视点前移量（前方视野） */
  lookAhead = 1.5;
  /** ★ 角色贴片高度（标准第三人称：lookAt 在头顶之上，角色落画面下方，不挡准星） */
  characterHeight = 1.5;
  /** 灵敏度（弧度/像素） */
  sensitivity = 0.003;
  /** 角度阻尼系数（越大越跟手） */
  damp = 10;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** 每帧驱动：lookAxis（视角）/ zoom（滚轮缩放）/ target（跟随）/ moving（脚步抖动） */
  update(dt: number, look: { x: number; y: number }, zoom: number, target: CameraTarget, moving = false): void {
    // ---- 滚轮缩放（标准第三人称：滚轮 = 相机距离，视觉上高低/远近变化） ----
    this.distance = Math.max(this.distanceMin, Math.min(this.distanceMax, this.distance + zoom * this.zoomSensitivity));

    // ---- 目标角度（鼠标控制；★ 上下 ±88°：准星视线可覆盖天空到地面） ----
    this.targetYaw -= look.x * this.sensitivity;
    const pitchMin = -1.55;
    const pitchMax = 1.55;
    this.targetPitch = Math.max(pitchMin, Math.min(pitchMax, this.targetPitch - look.y * this.sensitivity));

    // ---- 阻尼插值（角度不瞬跳，跟手但平滑） ----
    const k = 1 - Math.exp(-dt * this.damp);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    // ---- ★ 聚焦点平滑跟随（标准 TPS）：
    //      期望聚焦点 = 角色位置 + 肩部高度 + 跳跃偏移（按人称增益）
    //      smoothedTarget lerp → 跳跃跟随 / 抖动过滤 ----
    const isFirstPerson = this.distance <= this.firstPersonDistance;
    const desiredTarget = new THREE.Vector3(
      target.x,
      target.height + this.characterHeight * 0.8 + (target.jump ?? 0) * (isFirstPerson ? this.jumpGainFirstPerson : 1),
      target.z,
    );
    this.smoothedTarget.lerp(desiredTarget, Math.min(1, dt * this.targetDamp));

    // ---- 球坐标定位（相机围绕聚焦点；俯仰负（仰视）时相机不低于半高） ----
    const cp = this.distance * Math.cos(this.pitch);
    const sx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    const t = this.smoothedTarget;
    // 第一人称：相机在眼睛高度（0.9×身高）；第三人称：半高 + 俯仰高度
    const camY = t.y - this.characterHeight * 0.8 + this.characterHeight * (isFirstPerson ? 0.9 : 0.6)
      + (isFirstPerson ? 0 : Math.max(0, this.distance * Math.sin(this.pitch)));
    this.camera.position.set(
      t.x + sx * cp,
      camY,
      t.z + cz * cp,
    );

    // ---- ★ 视线 = 相机位置 + 方向（由 pitch 决定）——准星从脚下到天空全覆盖；
    //      第一人称移动 → head bob 作用于视线目标（画面摆动，sin 对称复原） ----
    const f = this.getFrame();
    const dir = new THREE.Vector3(
      f.forward.x * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      f.forward.z * Math.cos(this.pitch),
    );
    let lookX = this.camera.position.x + dir.x * this.lookAhead;
    let lookY = this.camera.position.y + dir.y * this.lookAhead;
    let lookZ = this.camera.position.z + dir.z * this.lookAhead;

    if (this.footstepShake.enabled && isFirstPerson && moving) {
      // 每步随机节拍 → 步长节奏不规则；幅度目标平滑过渡（不跳变）
      this.shakeTimer -= dt;
      if (this.shakeTimer <= 0) {
        this.shakeTimer = this.footstepShake.beatMin + Math.random() * (this.footstepShake.beatMax - this.footstepShake.beatMin);
        this.shakeTargetAmp = this.footstepShake.baseAmplitude * (0.7 + Math.random() * 0.6);
      }
      // 幅度平滑过渡（避免跳变）；相位完全连续（一个周期：起→落→复原）
      this.shakeAmpY += (this.shakeTargetAmp - this.shakeAmpY) * Math.min(1, dt * 3);
      this.shakeAmpX = this.shakeAmpY * 0.5;
      // bob 相位连续推进（无随机相位）
      this.bobTime += dt * this.footstepShake.bobFrequency;
      // 8 字形步态：垂直 sin(t)（一个完整周期复原）、水平 cos(2t)
      lookY += Math.sin(this.bobTime) * this.shakeAmpY;
      lookX += Math.cos(this.bobTime * 2) * this.shakeAmpX * f.right.x;
      lookZ += Math.cos(this.bobTime * 2) * this.shakeAmpX * f.right.z;
    } else if (this.breathing.enabled && isFirstPerson && !moving) {
      // ★ 静止呼吸（换气感）：低频微幅上下起伏，相位连续
      this.breathTime += dt * this.breathing.frequency;
      lookY += Math.sin(this.breathTime) * this.breathing.amplitude;
    }
    this.camera.lookAt(lookX, lookY, lookZ);
  }

  /** ★ 当前是否第一人称（角色贴片应隐藏） */
  get isFirstPerson(): boolean {
    return this.distance <= this.firstPersonDistance;
  }

  /** ★ 相机水平坐标系（角色移动/朝向用） */
  getFrame(): CameraFrame {
    const sx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    // forward：画面深处 = 相机水平朝向的反方向（相机在角色后上方）
    return {
      forward: { x: -sx, z: -cz },
      right: { x: cz, z: -sx },
    };
  }

  /** 重置视角（模式切换/新场景时调用） */
  reset(yaw = 0, pitch = 0.35): void {
    this.targetYaw = yaw;
    this.targetPitch = pitch;
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
