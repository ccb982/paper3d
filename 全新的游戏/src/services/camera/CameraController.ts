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

  /** 每帧驱动：lookAxis（视角）/ zoom（滚轮缩放）/ target（跟随） */
  update(dt: number, look: { x: number; y: number }, zoom: number, target: CameraTarget): void {
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

    // ---- 球坐标定位（相机在角色后上方；俯仰负（仰视）时相机不低于半高） ----
    const isFirstPerson = this.distance <= this.firstPersonDistance;
    const cp = this.distance * Math.cos(this.pitch);
    const sx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    // 第一人称：眼睛高度（0.9×身高，固定）；第三人称：半高 + 俯仰高度（仰视不低于半高）
    const camY = target.height + this.characterHeight * (isFirstPerson ? 0.9 : 0.6)
      + (isFirstPerson ? 0 : Math.max(0, this.distance * Math.sin(this.pitch)));
    this.camera.position.set(
      target.x + sx * cp,
      camY,
      target.z + cz * cp,
    );

    // ---- ★ 视线方向由 pitch 完全决定（准星 = 屏幕中心 = 视线方向）：
    //      lookAt = 相机位置 + 视线方向 × 前移距离
    //      → 准星从脚下地面（pitch↑）指到头顶天空（pitch↓）全覆盖 ----
    const f = this.getFrame();
    const dir = new THREE.Vector3(
      f.forward.x * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      f.forward.z * Math.cos(this.pitch),
    );
    this.camera.lookAt(
      this.camera.position.x + dir.x * this.lookAhead,
      this.camera.position.y + dir.y * this.lookAhead,
      this.camera.position.z + dir.z * this.lookAhead,
    );
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
