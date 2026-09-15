// ============================================================
// VisitorBodyRenderer —— 访客程序化身体（球头 + 方身 + 关节胶囊四肢）
// ============================================================
// 用户定调（2026-09-15）：访客没有模型 ——
//   · 头 = 球（大头比例 0.155×身高）/ 身体 = 方盒
//   · 四肢 = 两端半球圆柱（THREE.CapsuleGeometry，即"有头有尾的圆柱"）
//   · 每名访客只换"脸"纹理（FTX 帧 → 头球正面的球面补丁，"糊在脸上"，按宽高比自适应）
//
// ★ 造型优化（2026-09-15 二版：全网调研"低模怎么才好看"后落地）：
//   · **剪影优先**：大头/宽肩/分开的四肢 + 手（小球）/ 脚（横卧胶囊）/ 关节球，
//     黑剪影也要能认出"人"（低模第一原则：silhouette test）；
//   · **卡通着色**：MeshToonMaterial + 4 阶梯度贴图（NearestFilter）→ 明暗分层，
//     比 PBR 更适合纯几何体（参考 three.js MeshToonMaterial 官方用法）；
//   · **描边**：反向壳（BackSide 外扩 6%）深色描边，卡通轮廓、远看也立得住；
//   · **三色配色**：身体主色 / 四肢次色 / 腰带点缀色（accent），一眼可辨；
//   · **接地感**：脚下半透明圆形接触影（不依赖 FTX 剪影管线）；
//   · **动作带戏**：速度越大摆幅越大（夸张）、前倾、头部反向稳定、
//     手臂外展不穿模、待机呼吸起伏（低模"动画好看 > 模型精细"）。
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
  /** 躯干/头部颜色（hex 或 CSS；缺省米灰 #d8d2c6） */
  bodyColor?: number | string;
  /** 四肢颜色（缺省 = bodyColor 略深） */
  limbColor?: number | string;
  /** 点缀色（腰带；缺省 = 主色深调，用于三色配色的"accent"） */
  accentColor?: number | string;
  /** 脸纹理取第几帧（缺省：优先"前"帧，否则 0） */
  faceFrame?: number;
  /** 步幅（米/整周期；缺省 1.6）——决定步频 = 速度 / 步幅 */
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
  /** 垂直起伏幅度（米；缺省 0.025） */
  bobAmp?: number;
}

const TAU = Math.PI * 2;
/** 脸贴片横向张角（弧度；≈126°，覆盖头球正面） */
const FACE_PHI_SPAN = 2.2;
/** 脸贴片纵向张角上限（弧度；≈126°，长脸纹理可到更大但封顶） */
const FACE_THETA_SPAN = 2.2;
/** 步频夹取（整周期/秒）：慢走下限 / 小跑上限 */
const MIN_CYCLE_HZ = 0.5;
const MAX_CYCLE_HZ = 2.4;
/** 关节趋近速率（1/s；指数阻尼） */
const JOINT_EASE = 12;
/** 摆幅全开参考速度（米/秒；访客基础步速 3.2 → 越大摆得越夸张） */
const WALK_REF_SPEED = 3.2;
/** 反向壳描边外扩比例 */
const OUTLINE_SCALE = 1.06;

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
  /** 已销毁（异步脸纹理迟到 → 直接释放） */
  private disposed = false;

  constructor(scene: THREE.Scene, faceAsset: FrameAssetSource | null, style: VisitorBodyStyle = {}) {
    super();
    const H = (style.height ?? 1.8) * (style.scale ?? 1.8);
    this.strideLength = style.strideLength ?? 1.6;
    this.legSwing = style.legSwing ?? 0.45;
    this.kneeBend = style.kneeBend ?? 0.9;
    this.armSwing = style.armSwing ?? 0.4;
    this.elbowBend = style.elbowBend ?? 0.18;
    this.torsoTwist = style.torsoTwist ?? 0.08;
    this.torsoSway = style.torsoSway ?? 0.05;
    this.bobAmp = style.bobAmp ?? 0.025;

    // ★ 三色配色：主色（躯干/头）/ 次色（四肢）/ 点缀色（腰带）
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

    // ---- 尺寸（大头卡通比例；剪影优先：四肢分开、头肩清晰）----
    const legLen = H * 0.4;
    const torsoH = H * 0.28;
    const torsoW = H * 0.3;
    const torsoD = H * 0.17;
    const headR = H * 0.155;
    const armR = H * 0.045;
    const legR = H * 0.06;
    const upperArm = H * 0.15;
    const foreArm = H * 0.14;
    const thigh = H * 0.2;
    const shin = H * 0.2;
    this.hipY = legLen;
    this.headR = headR;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.position.y = this.hipY;
    this.root.add(this.body);

    // ★ 接触影（接地感；不随身体起伏）
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(H * 0.13, 20), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);
    this.materials.push(shadowMat);

    // 躯干（方盒）+ 腰带（点缀色）
    this.addPart(this.body, new THREE.BoxGeometry(torsoW, torsoH, torsoD), bodyMat, 0, torsoH / 2, 0);
    this.addPart(
      this.body,
      new THREE.BoxGeometry(torsoW * 1.06, torsoH * 0.13, torsoD * 1.1), accentMat,
      0, torsoH * 0.22, 0, 0,
    );

    // 头部（球 + 球面脸补丁；headPivot 用于反向稳定/待机张望）
    const headY = torsoH + headR * 0.85;
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = headY;
    this.body.add(this.headPivot);
    this.addPart(this.headPivot, new THREE.SphereGeometry(headR, 20, 14), bodyMat, 0, 0, 0);
    this.faceMesh = new THREE.Mesh(this.makeFaceGeometry(1), faceMat);
    this.faceMesh.visible = false;
    this.headPivot.add(this.faceMesh);
    if (faceAsset) void this.loadFace(faceAsset, style.faceFrame);

    // ---- 四肢（胶囊 + 关节球 + 手脚；肩/髋轴心 → 肘/膝轴心）----
    const shoulderX = torsoW / 2 + armR * 1.2;
    const shoulderY = torsoH * 0.86;
    this.shoulderL = this.addLimbRoot(-shoulderX, shoulderY, upperArm, armR, limbMat);
    this.shoulderR = this.addLimbRoot(shoulderX, shoulderY, upperArm, armR, limbMat);
    this.elbowL = this.addJoint(this.shoulderL, -upperArm, armR * 1.05, limbMat);
    this.elbowR = this.addJoint(this.shoulderR, -upperArm, armR * 1.05, limbMat);
    this.addPart(this.elbowL, new THREE.CapsuleGeometry(armR, Math.max(0.01, foreArm - armR * 2), 4, 8), limbMat, 0, -foreArm / 2, 0);
    this.addPart(this.elbowR, new THREE.CapsuleGeometry(armR, Math.max(0.01, foreArm - armR * 2), 4, 8), limbMat, 0, -foreArm / 2, 0);
    // 手（小球，剪影末端收口）
    this.addPart(this.elbowL, new THREE.SphereGeometry(armR * 1.15, 10, 8), limbMat, 0, -foreArm, 0);
    this.addPart(this.elbowR, new THREE.SphereGeometry(armR * 1.15, 10, 8), limbMat, 0, -foreArm, 0);

    const hipX = torsoW * 0.28;
    this.hipL = this.addLimbRoot(-hipX, 0, thigh, legR, limbMat);
    this.hipR = this.addLimbRoot(hipX, 0, thigh, legR, limbMat);
    this.kneeL = this.addJoint(this.hipL, -thigh, legR * 1.05, limbMat);
    this.kneeR = this.addJoint(this.hipR, -thigh, legR * 1.05, limbMat);
    this.addPart(this.kneeL, new THREE.CapsuleGeometry(legR, Math.max(0.01, shin - legR * 2), 4, 8), limbMat, 0, -shin / 2, 0);
    this.addPart(this.kneeR, new THREE.CapsuleGeometry(legR, Math.max(0.01, shin - legR * 2), 4, 8), limbMat, 0, -shin / 2, 0);
    // 脚（横卧胶囊，向前伸出；剪影落地）
    for (const knee of [this.kneeL, this.kneeR]) {
      const foot = this.addPart(
        knee,
        new THREE.CapsuleGeometry(legR * 0.78, legR * 1.7, 4, 8), limbMat,
        0, -shin + legR * 0.35, legR * 1.15,
      );
      foot.rotation.x = Math.PI / 2; // 胶囊轴 → 前后
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
    this.addPart(pivot, new THREE.SphereGeometry(r * 1.05, 12, 10), mat); // 关节球（藏接缝）
    this.addPart(pivot, new THREE.CapsuleGeometry(r, Math.max(0.01, segLen - r * 2), 4, 8), mat, 0, -segLen / 2, 0);
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

  /** ★ 脸贴片几何：头球正面的球面补丁（以 +Z 为中线；微大半径贴附，"糊在脸上"）。
   *  横向张角固定，纵向张角按纹理宽高比自适应（长脸盖更高、宽脸盖更矮）。 */
  private makeFaceGeometry(aspect: number): THREE.SphereGeometry {
    const w = FACE_PHI_SPAN;
    const h = Math.min(FACE_THETA_SPAN, w / Math.max(0.35, aspect));
    return new THREE.SphereGeometry(
      this.headR * 1.03, 24, 16,
      Math.PI / 2 - w / 2, w,
      Math.PI / 2 - h / 2, h,
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

  /** ★ 每帧关节动画：相位 = 2π·(速度/步幅)，正弦驱动四肢 + 躯干反相 + 待机呼吸 */
  update(dt: number): void {
    const moving = this.speed > 0.05;
    const speedN = Math.min(1, this.speed / WALK_REF_SPEED);
    if (moving) {
      const hz = Math.min(MAX_CYCLE_HZ, Math.max(MIN_CYCLE_HZ, this.speed / this.strideLength));
      this.phase += dt * TAU * hz;
    } else {
      this.idleT += dt;
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

    this.hipL.rotation.x = ease(this.hipL.rotation.x, legA);
    this.hipR.rotation.x = ease(this.hipR.rotation.x, legB);
    this.kneeL.rotation.x = ease(this.kneeL.rotation.x, kneeA);
    this.kneeR.rotation.x = ease(this.kneeR.rotation.x, kneeB);
    this.shoulderL.rotation.x = ease(this.shoulderL.rotation.x, armA);
    this.shoulderR.rotation.x = ease(this.shoulderR.rotation.x, armB);
    // 手臂外展（不贴身体、剪影更清楚）
    this.shoulderL.rotation.z = ease(this.shoulderL.rotation.z, moving ? -0.14 : -0.1);
    this.shoulderR.rotation.z = ease(this.shoulderR.rotation.z, moving ? 0.14 : 0.1);
    // 肘：基础屈曲 + 前摆略增（负 X = 前摆方向）
    this.elbowL.rotation.x = ease(this.elbowL.rotation.x, this.elbowBend + Math.max(0, -armA) * 0.3);
    this.elbowR.rotation.x = ease(this.elbowR.rotation.x, this.elbowBend + Math.max(0, -armB) * 0.3);
    // 躯干：前倾（速度越大越倾）+ 扭转 + 侧摆
    this.body.rotation.x = ease(this.body.rotation.x, moving ? 0.05 + speedN * 0.09 : 0);
    this.body.rotation.y = ease(this.body.rotation.y, moving ? s * this.torsoTwist : Math.sin(this.idleT * 0.9) * 0.04);
    this.body.rotation.z = ease(this.body.rotation.z, moving ? -s * this.torsoSway : 0);
    // 头：反向稳定（躯干转、头稳住）+ 待机张望
    this.headPivot.rotation.y = ease(
      this.headPivot.rotation.y,
      moving ? -s * this.torsoTwist * 0.6 : Math.sin(this.idleT * 0.6) * 0.08,
    );
    this.headPivot.rotation.z = ease(this.headPivot.rotation.z, moving ? s * this.torsoSway * 0.5 : 0);
    // 起伏：走路 = 每周期两次；待机 = 呼吸微起伏
    const bob = moving ? Math.sin(this.phase * 2) * this.bobAmp : Math.sin(this.idleT * 2.2) * 0.012;
    this.body.position.y = ease(this.body.position.y, this.hipY + bob);
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
