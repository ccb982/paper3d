// ============================================================
// VisitorBodyRenderer —— 访客程序化身体（Q 版小人）
// ============================================================
// 用户定调（2026-09-15 四/五版"彻底重做"）：不要"球上糊一张脸"的人——
//   看起来不吉利；要**顺眼的 Q 版小人**：
//   · 圆润豆形身体（不是方盒）+ 中头圆脸 + 围脖 + 短粗四肢、
//     连指手套手 + 圆头鞋 —— 整体圆润、无棱角、无裸露关节缝；**不要头发**；
//   · 脸纹理= 头球正面的**球面补丁**（"糊在脸上"、微下沉），
//     只有脸用纹理，其余全是纯色几何 —— 一眼是"角色"，不是"面具"；
//   · 卡通着色 `MeshToonMaterial` + 4 阶梯度 + 反向壳描边；三色配色
//     （身体 / 四肢 / 点缀：围脖+鞋），每人一组；
//   · 剪影优先：四肢分开、手脚收口、脚下接触影；
//   · 动作带戏：速度越大摆幅越大、前倾、头部反向稳定、手臂外展、待机呼吸；
//   · ★ **待机随机小动作**（舰内/路上站立时）：张望 / 点头 / 挥手 / 挪重心 /
//     伸懒腰 / 原地小跳，随机间隔 2.5~6.5s 触发一次（包络淡入淡出）。
//
// 步态参数（2026-09-15 网上调研，可在 VisitorBodyStyle 覆盖）：正常成人步幅 1.4~1.6m、
//   步频 100~130 步/分；髋摆 ±0.45 rad、摆动相膝屈 0.9 rad、肩摆 ±0.4 rad、
//   肘屈 0.18 rad、躯干扭转 0.08 / 侧摆 0.05 rad、垂直起伏 0.025m（每周期两次）。
// ============================================================

import * as THREE from 'three';
import type { FrameAssetSource } from '../fx/AssetSource';
import { FxRendererBase } from './FxRendererBase';
import { compositeFrameToCanvas } from '../../ui/shared/ftxFrameToCanvas';
import type { FtxAsset } from '../../vendor/player/FtxAsset';

/** ★ 访客身体外观/步态参数（每名访客一份；不填用默认值） */
export interface VisitorBodyStyle {
  /** 身高（米；缺省 1.8） */
  height?: number;
  /** 整体尺寸倍率（缺省 1.8） */
  scale?: number;
  /** 躯干/头颜色（hex 或 CSS；缺省米灰 #d8d2c6） */
  bodyColor?: number | string;
  /** 四肢颜色（缺省 = bodyColor 略深） */
  limbColor?: number | string;
  /** 点缀色（围脖 + 鞋；缺省 = bodyColor 深调） */
  accentColor?: number | string;
  /** 脸纹理取第几帧（缺省：优先"前"帧，否则 0） */
  faceFrame?: number;
  /** 步幅（米/整周期；缺省 1.3——Q 版短腿小碎步）——决定步频 = 速度 / 步幅 */
  strideLength?: number;
  /** 髋摆动幅度（rad；缺省 0.45 ≈ 26°） */
  legSwing?: number;
  /** 膝摆动屈曲峰值（rad；缺省 0.9 ≈ 52°） */
  kneeBend?: number;
  /** 肩摆动幅度（rad；缺省 0.4 ≈ 23°） */
  armSwing?: number;
  /** 肘基础屈曲（rad；缺省 0.18 ≈ 10°） */
  elbowBend?: number;
  /** 躯干扭转幅度（rad；缺省 0.08） */
  torsoTwist?: number;
  /** 躯干侧摆幅度（rad；缺省 0.05） */
  torsoSway?: number;
  /** 垂直起伏幅度（米 @ 基准身高；缺省 0.025） */
  bobAmp?: number;
}

const TAU = Math.PI * 2;
/** 脸贴片横向张角（弧度；≈109°） */
const FACE_PHI_SPAN = 1.9;
/** 脸贴片纵向张角上限（弧度） */
const FACE_THETA_SPAN = 1.6;
/** 脸贴片整体下移（弧度；略微压低，额头留白） */
const FACE_TILT = 0.12;
/** 步频夹取（整周期/秒）：慢走下限 / 小跑上限 */
const MIN_CYCLE_HZ = 0.5;
const MAX_CYCLE_HZ = 2.4;
/** 关节趋近速率（1/s；指数阻尼） */
const JOINT_EASE = 12;
/** 摆幅全开参考速度（米/秒；访客基础步速 3.2 → 越大摆得越夸张） */
const WALK_REF_SPEED = 3.2;
/** 反向壳描边外扩比例 */
const OUTLINE_SCALE = 1.05;
/** 基准身高（bobAmp 等按此缩放；= 1.8 × 默认 1.8 倍率） */
const BASE_H = 3.24;

/** 卡通梯度（4 阶明暗；模块级共享，勿释放） */
let _toonGradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (_toonGradient) return _toonGradient;
  const steps = new Uint8Array([70, 140, 210, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _toonGradient = tex;
  return tex;
}

export class VisitorBodyRenderer extends FxRendererBase {
  private root: THREE.Group;
  private body: THREE.Group;
  private headPivot!: THREE.Group;
  private hipL!: THREE.Group;
  private hipR!: THREE.Group;
  private kneeL!: THREE.Group;
  private kneeR!: THREE.Group;
  private shoulderL!: THREE.Group;
  private shoulderR!: THREE.Group;
  private elbowL!: THREE.Group;
  private elbowR!: THREE.Group;
  private faceMesh: THREE.Mesh | null = null;
  private faceTex: THREE.Texture | null = null;
  private materials: THREE.Material[] = [];
  private outlineMat: THREE.MeshBasicMaterial;

  /** 髋高（body 组基准 y；起伏在其上叠加） */
  private hipY: number;
  /** 头球半径（脸贴片按它定尺寸） */
  private headR = 0;
  private strideLength: number;
  private legSwing: number;
  private kneeBend: number;
  private armSwing: number;
  private elbowBend: number;
  private torsoTwist: number;
  private torsoSway: number;
  private bobAmp: number;

  /** 步态相位（rad，整周期 2π） */
  private phase = 0;
  /** 当前速度（米/秒；0 = 待机） */
  private speed = 0;
  /** 待机计时（呼吸/张望用） */
  private idleT = 0;
  /** ★ 待机随机小动作（站立等待时）：look/nod/wave/shift/stretch/hop */
  private idleAction: 'none' | 'look' | 'nod' | 'wave' | 'shift' | 'stretch' | 'hop' = 'none';
  private idleActionT = 0;
  private idleActionDur = 0;
  private idleActionNext = 2 + Math.random() * 3;
  private idleSide: 1 | -1 = 1;
  /** 已销毁（异步脸纹理迟到 → 直接释放） */
  private disposed = false;

  constructor(scene: THREE.Scene, faceAsset: FrameAssetSource | null, style: VisitorBodyStyle = {}) {
    super();
    const H = (style.height ?? 1.8) * (style.scale ?? 1.8);
    const sizeK = H / BASE_H;
    this.strideLength = style.strideLength ?? 1.3;
    this.legSwing = style.legSwing ?? 0.45;
    this.kneeBend = style.kneeBend ?? 0.9;
    this.armSwing = style.armSwing ?? 0.4;
    this.elbowBend = style.elbowBend ?? 0.18;
    this.torsoTwist = style.torsoTwist ?? 0.08;
    this.torsoSway = style.torsoSway ?? 0.05;
    this.bobAmp = (style.bobAmp ?? 0.025) * sizeK;

    // ★ 配色：主色（身体/头）/ 次色（四肢）/ 点缀（围脖+鞋）
    const bodyColor = new THREE.Color(style.bodyColor ?? 0xd8d2c6);
    const limbColor = new THREE.Color(style.limbColor ?? bodyColor.clone().multiplyScalar(0.82));
    const accentColor = new THREE.Color(style.accentColor ?? bodyColor.clone().multiplyScalar(0.55));
    const grad = toonGradient();
    const bodyMat = new THREE.MeshToonMaterial({ color: bodyColor, gradientMap: grad });
    const limbMat = new THREE.MeshToonMaterial({ color: limbColor, gradientMap: grad });
    const accentMat = new THREE.MeshToonMaterial({ color: accentColor, gradientMap: grad });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x10151b, side: THREE.BackSide });
    const faceMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.materials.push(bodyMat, limbMat, accentMat, this.outlineMat, faceMat);

    // ---- ★ Q 版比例（圆润豆身 + 中头，无头发）：头直径 ≈ 0.34H、总高 ≈ H ----
    const legLen = H * 0.33;
    const bodyH = H * 0.36;     // 身体胶囊总高
    const bodyR = H * 0.13;     // 身体横半径
    const bodyFlat = 0.78;      // 前后压扁（椭圆截面）
    const headR = H * 0.17;
    const armR = H * 0.032;
    const legR = H * 0.05;
    const upperArm = H * 0.1;
    const foreArm = H * 0.09;
    const thigh = H * 0.165;
    const shin = H * 0.165;
    this.hipY = legLen;
    this.headR = headR;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.position.y = this.hipY;
    this.root.add(this.body);

    // 接触影（接地感；不随身体起伏）
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(H * 0.17, 20), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);
    this.materials.push(shadowMat);

    // ★ 身体 = 圆润豆形（胶囊 + 前后压扁），不是方盒
    const torso = this.addPart(
      this.body,
      new THREE.CapsuleGeometry(bodyR, Math.max(0.01, bodyH - bodyR * 2), 6, 14),
      bodyMat, 0, bodyH / 2, 0,
    );
    torso.scale.z = bodyFlat;

    // ★ 围脖（点缀色 torus，盖住颈缝）
    const collar = this.addPart(
      this.body,
      new THREE.TorusGeometry(headR * 0.52, headR * 0.1, 8, 20), accentMat,
      0, bodyH * 0.98, 0,
    );
    collar.rotation.x = Math.PI / 2;
    collar.scale.z = bodyFlat;

    // ★ 头部：圆脸球 + 球面脸补丁（无头发；headPivot 用于反向稳定/待机张望/点头）
    const headY = bodyH + headR * 0.75;
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = headY;
    this.body.add(this.headPivot);
    const head = this.addPart(this.headPivot, new THREE.SphereGeometry(headR, 22, 16), bodyMat, 0, 0, 0);
    head.scale.set(1.0, 1.04, 1.0);
    this.faceMesh = new THREE.Mesh(this.makeFaceGeometry(1), faceMat);
    this.faceMesh.visible = false;
    this.headPivot.add(this.faceMesh);
    if (faceAsset) void this.loadFace(faceAsset, style.faceFrame);

    // ---- 四肢：短粗胶囊 + 关节球 + 连指手套 + 圆头鞋 ----
    const shoulderX = bodyR * 0.95 + armR * 1.15;
    const shoulderY = bodyH * 0.74;
    this.shoulderL = this.addLimbRoot(-shoulderX, shoulderY, upperArm, armR, limbMat);
    this.shoulderR = this.addLimbRoot(shoulderX, shoulderY, upperArm, armR, limbMat);
    this.elbowL = this.addJoint(this.shoulderL, -upperArm, armR * 1.08, limbMat);
    this.elbowR = this.addJoint(this.shoulderR, -upperArm, armR * 1.08, limbMat);
    this.addPart(this.elbowL, new THREE.CapsuleGeometry(armR, Math.max(0.01, foreArm - armR * 2), 4, 10), limbMat, 0, -foreArm / 2, 0);
    this.addPart(this.elbowR, new THREE.CapsuleGeometry(armR, Math.max(0.01, foreArm - armR * 2), 4, 10), limbMat, 0, -foreArm / 2, 0);
    // 连指手套（圆手，剪影收口）
    this.addPart(this.elbowL, new THREE.SphereGeometry(armR * 1.45, 12, 10), limbMat, 0, -foreArm, 0);
    this.addPart(this.elbowR, new THREE.SphereGeometry(armR * 1.45, 12, 10), limbMat, 0, -foreArm, 0);

    const hipX = bodyR * 0.55;
    this.hipL = this.addLimbRoot(-hipX, 0, thigh, legR, limbMat);
    this.hipR = this.addLimbRoot(hipX, 0, thigh, legR, limbMat);
    this.kneeL = this.addJoint(this.hipL, -thigh, legR * 1.08, limbMat);
    this.kneeR = this.addJoint(this.hipR, -thigh, legR * 1.08, limbMat);
    this.addPart(this.kneeL, new THREE.CapsuleGeometry(legR, Math.max(0.01, shin - legR * 2), 4, 10), limbMat, 0, -shin / 2, 0);
    this.addPart(this.kneeR, new THREE.CapsuleGeometry(legR, Math.max(0.01, shin - legR * 2), 4, 10), limbMat, 0, -shin / 2, 0);
    // 圆头鞋（点缀色，横卧胶囊向前）
    for (const knee of [this.kneeL, this.kneeR]) {
      const shoe = this.addPart(
        knee,
        new THREE.CapsuleGeometry(legR * 0.9, legR * 1.9, 5, 12), accentMat,
        0, -shin + legR * 0.3, legR * 1.25,
      );
      shoe.rotation.x = Math.PI / 2;
    }

    scene.add(this.root);
  }

  /** ★ 零件工厂：网格 + 反向壳描边（共享几何；几何由 dispose 统一释放） */
  private addPart(
    parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
    x = 0, y = 0, z = 0, outline = OUTLINE_SCALE,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    if (outline > 0) {
      const shell = new THREE.Mesh(geo, this.outlineMat);
      shell.scale.setScalar(outline);
      mesh.add(shell);
    }
    return mesh;
  }

  /** 上级轴心（肩/髋）：轴心球 + 上段胶囊 */
  private addLimbRoot(x: number, y: number, segLen: number, r: number, mat: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    this.body.add(pivot);
    this.addPart(pivot, new THREE.SphereGeometry(r * 1.12, 12, 10), mat); // 关节球（藏接缝）
    this.addPart(pivot, new THREE.CapsuleGeometry(r, Math.max(0.01, segLen - r * 2), 4, 10), mat, 0, -segLen / 2, 0);
    return pivot;
  }

  /** 下级关节（肘/膝）：轴心球（下段胶囊与手脚由调用方挂） */
  private addJoint(parent: THREE.Group, offsetY: number, r: number, mat: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.y = offsetY;
    parent.add(pivot);
    this.addPart(pivot, new THREE.SphereGeometry(r, 12, 10), mat);
    return pivot;
  }

  /** ★ 脸贴片几何：头球正面的球面补丁（以 +Z 为中线、整体压低到发盖下；
   *  横向张角固定，纵向张角按纹理宽高比自适应）。 */
  private makeFaceGeometry(aspect: number): THREE.SphereGeometry {
    const w = FACE_PHI_SPAN;
    const h = Math.min(FACE_THETA_SPAN, w / Math.max(0.35, aspect) * 0.85);
    return new THREE.SphereGeometry(
      this.headR * 1.02, 24, 16,
      Math.PI / 2 - w / 2, w,
      Math.PI / 2 + FACE_TILT - h / 2, h,
    );
  }

  // ---- FxRendererBase 接口 ----

  override setPosition(x: number, y: number, z = 0): void {
    this.root.position.set(x, y, z);
  }

  override setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 朝向（实体按移动方向给 yaw；身体不用 flip/前后面） */
  setYaw(rad: number): void {
    this.root.rotation.y = rad;
  }

  override setFlip(): void {
    // 3D 身体：朝向由 setYaw 决定，忽略贴片 flip
  }

  override render(): void {
    // 关节动画在 update() 里驱动，渲染层无需按帧重绘
  }

  /** 行进状态（实体每帧喂；speed = 世界单位/秒，0 = 待机） */
  setLocomotion(moving: boolean, speed: number): void {
    this.speed = moving && speed > 0.05 ? speed : 0;
  }

  /** ★ 每帧关节动画：相位 = 2π·(速度/步幅)，正弦驱动四肢 + 躯干反相 + 待机呼吸/随机动作 */
  update(dt: number): void {
    const moving = this.speed > 0.05;
    const speedN = Math.min(1, this.speed / WALK_REF_SPEED);
    if (moving) {
      const hz = Math.min(MAX_CYCLE_HZ, Math.max(MIN_CYCLE_HZ, this.speed / this.strideLength));
      this.phase += dt * TAU * hz;
      // 走动打断待机动作
      this.idleAction = 'none';
      this.idleActionNext = 2 + Math.random() * 3;
    } else {
      this.idleT += dt;
      // ★ 待机随机小动作调度：动作播完 → 随机间隔后再抽一个
      if (this.idleAction !== 'none') {
        this.idleActionT += dt;
        if (this.idleActionT >= this.idleActionDur) {
          this.idleAction = 'none';
          this.idleActionNext = 2.5 + Math.random() * 4;
        }
      } else {
        this.idleActionNext -= dt;
        if (this.idleActionNext <= 0) this.startIdleAction();
      }
    }
    const s = Math.sin(this.phase);
    const k = 1 - Math.exp(-dt * JOINT_EASE);
    const ease = (cur: number, target: number): number => cur + (target - cur) * k;
    // 面朝 +Z：前摆 = 负 X 旋转（右腿同相位取反）；速度越大摆幅越大（夸张原则）
    const swing = 0.85 + speedN * 0.35;
    const legA = moving ? -s * this.legSwing * swing : 0;
    const legB = moving ? s * this.legSwing * swing : 0;
    const kneeA = moving ? Math.max(0, s) * this.kneeBend : 0;
    const kneeB = moving ? Math.max(0, -s) * this.kneeBend : 0;
    const armA = moving ? s * this.armSwing * swing : 0;
    const armB = moving ? -s * this.armSwing * swing : 0;

    // ---- 目标姿态（先算好；待机动作叠加后再统一阻尼跟随）----
    let hipLx = legA, hipRx = legB, kneeLx = kneeA, kneeRx = kneeB;
    let shLx = armA, shRx = armB;
    let shLz = moving ? -0.22 : -0.16;
    let shRz = moving ? 0.22 : 0.16;
    let elLx = this.elbowBend + Math.max(0, -armA) * 0.3;
    let elRx = this.elbowBend + Math.max(0, -armB) * 0.3;
    const bodyRx = moving ? 0.05 + speedN * 0.09 : 0;
    let bodyRy = moving ? s * this.torsoTwist : Math.sin(this.idleT * 0.9) * 0.04;
    let bodyRz = moving ? -s * this.torsoSway : 0;
    let headRy = moving ? -s * this.torsoTwist * 0.6 : Math.sin(this.idleT * 0.6) * 0.08;
    let headRz = moving ? s * this.torsoSway * 0.5 : 0;
    let headRx = 0;
    const bob = moving ? Math.sin(this.phase * 2) * this.bobAmp : Math.sin(this.idleT * 2.2) * this.bobAmp * 0.5;
    let bodyY = this.hipY + bob;

    // ★ 待机随机小动作（包络 0→1→0，淡入淡出；不打断正常呼吸）
    if (!moving && this.idleAction !== 'none') {
      const p = Math.min(1, this.idleActionT / this.idleActionDur);
      const env = Math.sin(Math.PI * p);
      switch (this.idleAction) {
        case 'look': // 张望：脑袋转向一侧
          headRy += env * 0.7 * this.idleSide;
          break;
        case 'nod': // 点头
          headRx += env * 0.4;
          break;
        case 'wave': // 挥手：单臂抬起左右摆
          if (this.idleSide > 0) {
            shRz = 2.15 + Math.sin(this.idleActionT * 13) * 0.22;
            shRx = 0.25;
            elRx = 0.35;
          } else {
            shLz = -2.15 - Math.sin(this.idleActionT * 13) * 0.22;
            shLx = 0.25;
            elLx = 0.35;
          }
          headRy += this.idleSide * 0.2 * env;
          break;
        case 'stretch': // 伸懒腰：双臂上举 + 后仰
          shLz = -2.5;
          shRz = 2.5;
          shLx = 0.15;
          shRx = 0.15;
          headRx -= 0.25 * env;
          break;
        case 'shift': // 挪重心：左右晃一下
          bodyRz += env * 0.08 * this.idleSide;
          break;
        case 'hop': { // 原地小跳
          const hop = 4 * p * (1 - p);
          bodyY += hop * this.bobAmp * 3;
          kneeLx += hop * 0.35;
          kneeRx += hop * 0.35;
          break;
        }
      }
    }

    this.hipL.rotation.x = ease(this.hipL.rotation.x, hipLx);
    this.hipR.rotation.x = ease(this.hipR.rotation.x, hipRx);
    this.kneeL.rotation.x = ease(this.kneeL.rotation.x, kneeLx);
    this.kneeR.rotation.x = ease(this.kneeR.rotation.x, kneeRx);
    this.shoulderL.rotation.x = ease(this.shoulderL.rotation.x, shLx);
    this.shoulderR.rotation.x = ease(this.shoulderR.rotation.x, shRx);
    this.shoulderL.rotation.z = ease(this.shoulderL.rotation.z, shLz);
    this.shoulderR.rotation.z = ease(this.shoulderR.rotation.z, shRz);
    this.elbowL.rotation.x = ease(this.elbowL.rotation.x, elLx);
    this.elbowR.rotation.x = ease(this.elbowR.rotation.x, elRx);
    this.body.rotation.x = ease(this.body.rotation.x, bodyRx);
    this.body.rotation.y = ease(this.body.rotation.y, bodyRy);
    this.body.rotation.z = ease(this.body.rotation.z, bodyRz);
    this.headPivot.rotation.x = ease(this.headPivot.rotation.x, headRx);
    this.headPivot.rotation.y = ease(this.headPivot.rotation.y, headRy);
    this.headPivot.rotation.z = ease(this.headPivot.rotation.z, headRz);
    this.body.position.y = ease(this.body.position.y, bodyY);
  }

  /** 抽一个待机小动作（时长/方向随机） */
  private startIdleAction(): void {
    const r = Math.random();
    const a = r < 0.24 ? 'look'
      : r < 0.45 ? 'nod'
      : r < 0.63 ? 'wave'
      : r < 0.8 ? 'shift'
      : r < 0.92 ? 'stretch'
      : 'hop';
    this.idleAction = a;
    this.idleActionT = 0;
    this.idleActionDur = a === 'hop' ? 0.7 : a === 'nod' ? 1.2 : 1.6;
    this.idleSide = Math.random() < 0.5 ? -1 : 1;
  }

  /** 脸纹理：FTX 资产首帧（或"前"帧）CPU 合成 → CanvasTexture */
  private async loadFace(asset: FrameAssetSource, faceFrame?: number): Promise<void> {
    const a = asset as unknown as { getFtxFrame?: (i: number) => unknown };
    if (typeof a.getFtxFrame !== 'function') return;
    try {
      const idx = asset.resolveFrame('前') ?? faceFrame ?? 0;
      const canvas = compositeFrameToCanvas(asset as unknown as FtxAsset, idx);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      if (this.disposed) { tex.dispose(); return; }
      this.setFaceTexture(tex, canvas.width / Math.max(1, canvas.height));
    } catch (e) {
      console.warn('[VisitorBody] 脸纹理合成失败:', e);
    }
  }

  /** 直接注入脸纹理（上层已加载/自定义贴图；旧纹理自动释放；aspect = 宽/高） */
  setFaceTexture(tex: THREE.Texture | null, aspect = 1): void {
    if (this.disposed) { tex?.dispose(); return; }
    this.faceTex?.dispose();
    this.faceTex = tex;
    if (!this.faceMesh) return;
    const mat = this.faceMesh.material as THREE.MeshBasicMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    if (!tex) {
      this.faceMesh.visible = false;
      return;
    }
    // 重建球面补丁几何（按纹理宽高比调整纵向张角）
    this.faceMesh.geometry.dispose();
    this.faceMesh.geometry = this.makeFaceGeometry(aspect);
    this.faceMesh.visible = true;
  }

  override dispose(): void {
    this.disposed = true;
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
    });
    for (const mat of this.materials) mat.dispose();
    this.materials.length = 0;
    this.faceTex?.dispose();
    this.faceTex = null;
    this.faceMesh = null;
  }
}
