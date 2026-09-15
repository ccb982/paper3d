// ============================================================
// VisitorBodyRenderer —— 访客程序化身体（球头 + 方身 + 关节胶囊四肢）
// ============================================================
// 用户定调（2026-09-15）：访客没有模型 ——
//   · 头 = 球（大头比例 0.155×身高）/ 身体 = 方盒
//   · 四肢 = 两端半球圆柱（THREE.CapsuleGeometry，即"有头有尾的圆柱"）
//   · 每名访客只换"脸"纹理（FTX 帧 → 大头正前方 1.9×头半径的贴板，按宽高比自适应）
// 关节：肩/肘/髋/膝各一个 Group 轴心，rotation.x 前后摆动。
//   （人物面朝 +Z；绕 +X 正旋转 = 肢体向后摆 → 前摆用负值。）
//
// ★ 步态参数（2026-09-15 网上调研 → 折算成游戏手感；全部可在 VisitorBodyStyle 覆盖）：
//   · 步频随速度：整周期频率 = speed / strideLength（正常成人步幅 1.4~1.6m、
//     步频 100~130 步/分 ≈ 1.7~2.2 步/s；这里 clamp 0.5~2.4 周期/s，快走/小跑区间）
//   · 髋（大腿）前后摆幅 ±0.45 rad（≈26°；生理髋屈峰值 ~30°、总幅度 ~45°）
//   · 膝：摆动相屈曲峰值 ~0.9 rad（≈52°；生理 ~60°），支撑相几乎伸直
//   · 肩（上臂）与腿反相 ±0.4 rad（≈23°；随速度增大，生理峰值可达 ~45°）
//   · 肘基础屈曲 0.18 rad（生理 ~8°~30°），前摆时略增
//   · 躯干扭转 ±0.08 rad（肩带与骨盆反向 ~7°~12°）+ 侧摆 ±0.05 rad
//   · 垂直起伏每周期两次、幅度 0.025m（生理躯干总起伏 ~46mm）
// 数据源：正常步态解剖学（hip 屈 ~30°/膝摆动屈 ~60°/肩 ~45°、步频 110~120、
//   stride 1.5m）+ 程序化步态实现惯例（sin 相位、膝仅摆动相屈曲、臂腿反相）。
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
  /** 整体尺寸倍率（缺省 1.8；2026-09-15 用户两次反馈"NPC 太小" → 放大 + 大头比例） */
  scale?: number;
  /** 躯干/头部颜色（hex 或 CSS；缺省米灰 #d8d2c6） */
  bodyColor?: number | string;
  /** 四肢颜色（缺省 = bodyColor 略深） */
  limbColor?: number | string;
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
/** 步频夹取（整周期/秒）：慢走下限 / 小跑上限 */
const MIN_CYCLE_HZ = 0.5;
const MAX_CYCLE_HZ = 2.4;
/** 关节趋近速率（1/s；指数阻尼） */
const JOINT_EASE = 12;

export class VisitorBodyRenderer extends FxRendererBase {
  private root: THREE.Group;
  private body: THREE.Group;
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

    const bodyColor = new THREE.Color(style.bodyColor ?? 0xd8d2c6);
    const limbColor = style.limbColor !== undefined
      ? new THREE.Color(style.limbColor)
      : bodyColor.clone().multiplyScalar(0.82);
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85, metalness: 0.02, flatShading: true });
    const limbMat = new THREE.MeshStandardMaterial({ color: limbColor, roughness: 0.9, metalness: 0.02, flatShading: true });
    this.materials.push(bodyMat, limbMat);

    // ---- 尺寸（按身高比例；★ 大头卡通比例 —— 用户要求"脸上的纹理非常明显"）----
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

    // 躯干（方盒，中心在髋上方半高）
    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), bodyMat);
    torso.position.y = torsoH / 2;
    torso.castShadow = false;
    this.body.add(torso);

    // 头（球；★ 大头比例，让脸纹理一目了然）
    const headY = torsoH + headR * 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 14), bodyMat);
    head.position.y = headY;
    this.body.add(head);

    // 脸贴片（每名访客只换这张纹理；贴在大头正前方 —— 尺寸自适应纹理宽高比）
    const faceMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.materials.push(faceMat);
    this.faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMat);
    this.faceMesh.position.set(0, headY, headR * 0.92);
    this.faceMesh.scale.set(headR * 1.9, headR * 1.9, 1);
    this.faceMesh.visible = false;
    this.body.add(this.faceMesh);
    if (faceAsset) void this.loadFace(faceAsset, style.faceFrame);

    // ---- 四肢（胶囊 + 关节轴心）----
    const shoulderX = torsoW / 2 + armR * 1.2;
    const shoulderY = torsoH * 0.86;
    this.shoulderL = this.addLimbRoot(-shoulderX, shoulderY, upperArm, armR, limbMat);
    this.shoulderR = this.addLimbRoot(shoulderX, shoulderY, upperArm, armR, limbMat);
    this.elbowL = this.addJoint(this.shoulderL, -upperArm);
    this.elbowR = this.addJoint(this.shoulderR, -upperArm);
    this.addCapsule(this.elbowL, foreArm, armR, limbMat);
    this.addCapsule(this.elbowR, foreArm, armR, limbMat);

    const hipX = torsoW * 0.28;
    this.hipL = this.addLimbRoot(-hipX, 0, thigh, legR, limbMat);
    this.hipR = this.addLimbRoot(hipX, 0, thigh, legR, limbMat);
    this.kneeL = this.addJoint(this.hipL, -thigh);
    this.kneeR = this.addJoint(this.hipR, -thigh);
    this.addCapsule(this.kneeL, shin, legR, limbMat);
    this.addCapsule(this.kneeR, shin, legR, limbMat);

    scene.add(this.root);
  }

  /** 上级轴心（肩/髋）：挂上段胶囊 + 返回轴心组 */
  private addLimbRoot(x: number, y: number, segLen: number, r: number, mat: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    this.body.add(pivot);
    this.addCapsule(pivot, segLen, r, mat);
    return pivot;
  }

  /** 下级关节（肘/膝）：挂在下段起点，挂下段胶囊 */
  private addJoint(parent: THREE.Group, offsetY: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.y = offsetY;
    parent.add(pivot);
    return pivot;
  }

  /** 胶囊（圆柱两端半球）：上端挂在轴心 → 中心下移半长 */
  private addCapsule(parent: THREE.Object3D, segLen: number, r: number, mat: THREE.Material): void {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(r, Math.max(0.01, segLen - r * 2), 4, 8),
      mat,
    );
    mesh.position.y = -segLen / 2;
    parent.add(mesh);
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

  /** ★ 每帧关节动画：相位 = 2π·(速度/步幅)，正弦驱动四肢 + 躯干反相 */
  update(dt: number): void {
    const moving = this.speed > 0.05;
    if (moving) {
      const hz = Math.min(MAX_CYCLE_HZ, Math.max(MIN_CYCLE_HZ, this.speed / this.strideLength));
      this.phase += dt * TAU * hz;
    }
    const s = Math.sin(this.phase);
    const k = 1 - Math.exp(-dt * JOINT_EASE);
    const ease = (cur: number, target: number): number => cur + (target - cur) * k;
    // 面朝 +Z：前摆 = 负 X 旋转（右腿同相位取反）
    const legA = moving ? -s * this.legSwing : 0;
    const legB = moving ? s * this.legSwing : 0;
    const kneeA = moving ? Math.max(0, s) * this.kneeBend : 0;
    const kneeB = moving ? Math.max(0, -s) * this.kneeBend : 0;
    const armA = moving ? s * this.armSwing : 0;
    const armB = moving ? -s * this.armSwing : 0;

    this.hipL.rotation.x = ease(this.hipL.rotation.x, legA);
    this.hipR.rotation.x = ease(this.hipR.rotation.x, legB);
    this.kneeL.rotation.x = ease(this.kneeL.rotation.x, kneeA);
    this.kneeR.rotation.x = ease(this.kneeR.rotation.x, kneeB);
    this.shoulderL.rotation.x = ease(this.shoulderL.rotation.x, armA);
    this.shoulderR.rotation.x = ease(this.shoulderR.rotation.x, armB);
    // 肘：基础屈曲 + 前摆略增（负 X = 前摆方向）
    this.elbowL.rotation.x = ease(this.elbowL.rotation.x, this.elbowBend + Math.max(0, -armA) * 0.25);
    this.elbowR.rotation.x = ease(this.elbowR.rotation.x, this.elbowBend + Math.max(0, -armB) * 0.25);
    // 躯干：扭转（绕 Y）+ 侧摆（绕 Z）+ 垂直起伏（每周期两次）
    this.body.rotation.y = ease(this.body.rotation.y, moving ? s * this.torsoTwist : 0);
    this.body.rotation.z = ease(this.body.rotation.z, moving ? -s * this.torsoSway : 0);
    const bob = moving ? Math.sin(this.phase * 2) * this.bobAmp : 0;
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
    this.faceMesh.visible = !!tex;
    if (!tex) return;
    // 脸板贴满大头正面（长边 = 1.9 × 头半径；按纹理宽高比自适应）
    const size = this.headR * 1.9;
    const w = aspect >= 1 ? size : size * aspect;
    const h = aspect >= 1 ? size / aspect : size;
    this.faceMesh.scale.set(w, h, 1);
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
