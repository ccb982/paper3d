// ============================================================
// viewer —— Three.js 3D 视图：把 10 个海猫组件当成"护甲板"贴在 10 个刚体上
// ============================================================
// ★★ 视觉方案（用户定调）：3D 真骨架 + 每个环节正面贴一张组件当护甲板 + 骨架本身隐藏。
//   · 骨架（胶囊/脚掌盒的线框）默认**不渲染** —— 只有打开「显示关节」才出现，
//     那是排查穿模时的诊断视图，不是给人看的最终画面。
//   · 护甲板跟着刚体的**完整四元数**走，所以刚体一旦在 3D 里翻转，板子跟着翻 ——
//     这才是"贴在身上"，不是"贴在屏幕上"。
//
// ★ 板子的朝向（qFix）：PlaneGeometry 的本地面是 XY、法线 +Z；
//   我们要它 法线 = 刚体本地 +X（角色正面）、板内右 = 刚体本地 −Z、板内上 = +Y。
//   对应"绕 Y 转 +90°"：+Z→+X（法线）、+X→−Z（板内右）、+Y→+Y（板内上）。
//   为什么板内右必须是 −Z：从正面（相机在 +X 看向 −X，up=+Y）看过去屏幕右 = −Z，
//   而素材的"画布右"必须落在屏幕右，否则人形会左右镜像。见 skeleton.ts 的 mapZ。
//
// ★ 绘制顺序：3D 之后不能再按美术定的固定 z 值排（parts.json 的 z 只在"正面平铺"时成立）。
//   相机一转，挥到身前的胳膊应该在躯干**前面**。所以每帧按**真实深度**（相机前方向上的
//   投影距离）从远到近排 renderOrder，parts.json 的 z 只作为深度接近时的次级判据。
//
// 整代视图（ghost）：population 个个体各画 9 条骨架线，合成一个 LineSegments，
//   每帧只改一个 Float32Array —— 比渲染几百块贴图便宜两个数量级。

import * as THREE from 'three';
import { META } from '../core/partsMeta';
import type { Skeleton } from '../core/skeleton';
import type { Ragdoll } from '../core/ragdoll';
import type { Trainer } from '../core/evolution';

/** 相机球坐标默认值：方位角 41° / 俯角 15° / 距离 4.4m */
const DEFAULT_AZ = 0.72;
const DEFAULT_EL = 0.26;
const DEFAULT_DIST = 4.4;

export interface ViewerOptions {
  /** 贴图根路径（public 下） */
  assetBase?: string;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** 与 skeleton.bodies 一一对应的护甲板 */
  private readonly plates: THREE.Mesh[] = [];
  /** 每个刚体的物理线框（胶囊 + 脚掌盒），与 bodies 一一对应 */
  private readonly boneGroups: THREE.Group[] = [];
  private readonly ghost: THREE.LineSegments;
  private readonly ghostPos: Float32Array;
  private readonly ghostSegPer = 9;
  private readonly jointDots: THREE.Points;
  private readonly jointPos: Float32Array;
  private readonly canvas: HTMLCanvasElement;
  private readonly ro?: ResizeObserver;

  /** 护甲板朝向：绕 Y +90°（见文件头） */
  private readonly qFix = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), Math.PI / 2,
  );
  private readonly qBody = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly sortDir = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly depths: Float64Array;
  private readonly order: number[];

  /** 关掉护甲板，只看物理（排查穿模/关节问题时用） */
  showTextures = true;
  /** 显示整代骨架 */
  showGhost = false;
  /** ★ 显示**骨架本体**（胶囊线框）—— 默认关，符合"把火柴人隐藏"的定调 */
  showJoints = false;
  /** 相机跟随展示个体（人学会走就会跑出固定视野） */
  followShowcase = true;
  /** 跟随时间常数（秒）。越大越"懒"，0.18s 观感比较自然，且与帧率无关 */
  followTau = 0.18;

  // ---- 相机球坐标 ----
  camAz = DEFAULT_AZ;
  camEl = DEFAULT_EL;
  camDist = DEFAULT_DIST;
  private readonly target = new THREE.Vector3(0, 1.0, 0);

  constructor(canvas: HTMLCanvasElement, sk: Skeleton, population: number, opt: ViewerOptions = {}) {
    this.canvas = canvas;
    const assetBase = opt.assetBase ?? '';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xeef1f4, 1);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(4, 1.6, 2);
    this.camera.lookAt(this.target);

    // ---- 地面 + 三维距离网格 ----
    this.scene.add(this.buildGround());

    // ---- 护甲板 ----
    const loader = new THREE.TextureLoader();
    for (const b of sk.bodies) {
      const tex = loader.load(assetBase + b.part.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());

      const w = b.part.bw * sk.px2m;
      const h = b.part.bh * sk.px2m;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false,
        // ★ DoubleSide：相机绕到背面时板子不能凭空消失
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      this.plates.push(mesh);
      this.scene.add(mesh);
    }
    this.depths = new Float64Array(this.plates.length);
    this.order = this.plates.map((_, i) => i);

    // ---- 骨架线框（胶囊 + 脚掌扁盒）----
    // 只有贴图的话看不出"物理体到底长什么样"——贴图是美术包围盒，物理胶囊比它瘦 40%
    // （limbRadiusScale 0.6）。这一层是排查穿模/贴图错位的关键视图。
    const boneMat = new THREE.MeshBasicMaterial({
      color: 0xb4331f, wireframe: true, transparent: true, opacity: 0.55,
      depthTest: false, depthWrite: false,
    });
    for (const b of sk.bodies) {
      const g = new THREE.Group();
      const cap = new THREE.Mesh(
        new THREE.CapsuleGeometry(b.radius, Math.max(1e-3, b.halfHeight * 2), 3, 10),
        boneMat,
      );
      cap.renderOrder = 85;
      g.add(cap);
      for (const c of b.colliders) {
        if (c.shape !== 'cuboid') continue;
        const box = new THREE.Mesh(new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.hz * 2), boneMat);
        box.position.set(0, c.offsetY, 0);
        box.renderOrder = 85;
        g.add(box);
      }
      g.visible = false;
      this.boneGroups.push(g);
      this.scene.add(g);
    }

    // ---- 整代骨架线 ----
    this.ghostPos = new Float32Array(population * this.ghostSegPer * 2 * 3);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(this.ghostPos, 3));
    this.ghost = new THREE.LineSegments(
      gGeo,
      new THREE.LineBasicMaterial({
        color: 0xb4331f, transparent: true, opacity: 0.28,
        depthTest: false, depthWrite: false,
      }),
    );
    this.ghost.renderOrder = 5;
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // ---- 关节锚点 ----
    this.jointPos = new Float32Array(sk.joints.length * 3);
    const jGeo = new THREE.BufferGeometry();
    jGeo.setAttribute('position', new THREE.BufferAttribute(this.jointPos, 3));
    this.jointDots = new THREE.Points(
      jGeo,
      new THREE.PointsMaterial({
        color: 0x1c1f24, size: 10, sizeAttenuation: false,
        depthTest: false, depthWrite: false,
      }),
    );
    this.jointDots.renderOrder = 90;
    this.jointDots.frustumCulled = false;
    this.jointDots.visible = false;
    this.scene.add(this.jointDots);

    this.resize();

    // ★ 双保险：光靠 window.resize 不够 —— 首帧时容器可能还没布局完成（clientWidth=0），
    //   而且容器尺寸变化也未必伴随窗口 resize。用 ResizeObserver 盯住 canvas 本身。
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    requestAnimationFrame(() => this.resize());
  }

  /** 三维地面网格：沿 X 的行走刻度 + 沿 Z 的侧向刻度 */
  private buildGround(): THREE.Object3D {
    const g = new THREE.Group();
    const main: number[] = [];   // 主网格
    const old: number[] = [];    // 每米细分

    const X0 = -8, X1 = 24, Z0 = -6, Z1 = 6;

    // 沿 X 方向的线（在常量 z 上），+ z=0 是中线
    for (let z = Z0; z <= Z1; z += 1) {
      const arr = z === 0 ? main : old;
      arr.push(X0, 0, z, X1, 0, z);
    }
    // 沿 Z 方向的线（在常量 x 上，每 1m；5 的倍数是主线）
    for (let x = X0; x <= X1; x += 1) {
      const arr = x % 5 === 0 ? main : old;
      arr.push(x, 0, Z0, x, 0, Z1);
    }
    // 每米短刻度（沿 +Z 的小刺，帮助判断"走了多远"）
    for (let x = Math.ceil(X0); x <= X1; x += 1) {
      old.push(x, 0, 0, x, 0, x % 5 === 0 ? 0.6 : 0.28);
    }

    const mk = (pts: number[], color: number, opacity: number, order: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const ls = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false }),
      );
      ls.renderOrder = order;
      ls.frustumCulled = false;
      g.add(ls);
    };
    mk(old, 0xd2d8de, 0.9, -21);
    mk(main, 0xb9c2cc, 1.0, -20);
    return g;
  }

  resize(): void {
    // ★ 不要只信 clientWidth：canvas 若被 CSS 退化成固有尺寸（300×150）或 display:none，
    //   clientWidth 会是 0 或 300，画面就成了左上角一小块。逐级回退兜住。
    //   （症状：网页只有 UI 面板、看不到骨骼 —— 见 index.html 里 #view 的注释）
    const w = this.canvas.clientWidth || window.innerWidth || 1;
    const h = this.canvas.clientHeight || window.innerHeight || 1;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 第三个参数 false = 不写 CSS style，尺寸交给 CSS（否则 Three 会把 canvas 钉成固定像素）
    this.renderer.setSize(w, h, false);
  }

  // ------------------------------------------------------------ 相机操作

  /** 拖拽转视角（弧度增量） */
  orbit(dAz: number, dEl: number): void {
    this.camAz += dAz;
    this.camEl = Math.max(-0.25, Math.min(1.25, this.camEl + dEl));
  }

  /** 滚轮缩放 */
  zoom(factor: number): void {
    this.camDist = Math.max(1.6, Math.min(16, this.camDist * factor));
  }

  resetView(): void {
    this.camAz = DEFAULT_AZ;
    this.camEl = DEFAULT_EL;
    this.camDist = DEFAULT_DIST;
  }

  /**
   * 相机解算：球坐标 + 目标点平滑跟随。
   * az=0 ⇒ 相机在角色**正前方**（+X 侧）；az≈41° 是默认的 3/4 视角 ——
   * 这是"正面视图素材"与"行走步态"之间唯一能兼顾的角度：
   * 纯正面看不到迈腿（腿是朝/离镜头摆），纯侧面护甲板只剩一条线。
   */
  private updateCamera(doll: Ragdoll, dt: number): void {
    const t = doll.torso().translation();
    const k = 1 - Math.exp(-dt / Math.max(1e-3, this.followTau));
    const wantX = this.followShowcase ? t.x : 0;
    const wantZ = this.followShowcase ? t.z : 0;
    this.target.x += (wantX - this.target.x) * k;
    this.target.z += (wantZ - this.target.z) * k;
    this.target.y += (t.y * 0.9 + 0.25 - this.target.y) * k;

    const ce = Math.cos(this.camEl);
    this.camDir.set(
      ce * Math.cos(this.camAz),
      Math.sin(this.camEl),
      ce * Math.sin(this.camAz),
    );
    this.camera.position.copy(this.target).addScaledVector(this.camDir, this.camDist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** 把展示个体（doll）的姿态刷到护甲板上；dt 用于相机跟随的帧率无关平滑 */
  syncShowcase(doll: Ragdoll, dt = 1 / 60): void {
    this.updateCamera(doll, dt);

    for (let i = 0; i < this.plates.length; i++) {
      const body = doll.bodies[i];
      const t = body.translation();
      const q = body.rotation();
      const mesh = this.plates[i];
      mesh.visible = this.showTextures;
      mesh.position.set(t.x, t.y, t.z);
      // ★ 板子的世界朝向 = 刚体朝向 ⊗ 板子固定朝向（先 qFix 后 qBody）
      this.qBody.set(q.x, q.y, q.z, q.w);
      mesh.quaternion.copy(this.qBody).multiply(this.qFix);
    }

    // ---- 深度排序（远 → 近）----
    // 相机前方向：从相机指向目标
    this.sortDir.copy(this.target).sub(this.camera.position).normalize();
    for (let i = 0; i < this.plates.length; i++) {
      const p = this.plates[i].position;
      this.tmpV.copy(p).sub(this.camera.position);
      this.depths[i] = this.tmpV.dot(this.sortDir);
    }
    const artZ = doll.sk.bodies;
    this.order.sort((a, b) => {
      const d = this.depths[b] - this.depths[a];
      if (Math.abs(d) > 1e-4) return d;
      return artZ[a].part.z - artZ[b].part.z;
    });
    for (let rank = 0; rank < this.order.length; rank++) {
      this.plates[this.order[rank]].renderOrder = rank;
    }

    if (this.showJoints) {
      for (let i = 0; i < this.boneGroups.length; i++) {
        const g = this.boneGroups[i];
        const body = doll.bodies[i];
        const t = body.translation();
        const q = body.rotation();
        g.position.set(t.x, t.y, t.z);
        g.quaternion.set(q.x, q.y, q.z, q.w);
        g.visible = true;
      }
      const geo = this.jointDots.geometry;
      for (let i = 0; i < doll.jointCount; i++) {
        const pi = doll.jointBodies[i * 2];
        const parent = doll.bodies[pi];
        const spec = doll.sk.joints[i];
        const t = parent.translation();
        const q = parent.rotation();
        // 关节锚点 = 父刚体位置 + R·(本地锚点)
        const lx = spec.parentLocal[0], ly = spec.parentLocal[1], lz = spec.parentLocal[2];
        const tx = 2 * (q.y * lz - q.z * ly);
        const ty = 2 * (q.z * lx - q.x * lz);
        const tz = 2 * (q.x * ly - q.y * lx);
        this.jointPos[i * 3] = t.x + lx + q.w * tx + (q.y * tz - q.z * ty);
        this.jointPos[i * 3 + 1] = t.y + ly + q.w * ty + (q.z * tx - q.x * tz);
        this.jointPos[i * 3 + 2] = t.z + lz + q.w * tz + (q.x * ty - q.y * tx);
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    } else if (this.boneGroups.length && this.boneGroups[0].visible) {
      for (const g of this.boneGroups) g.visible = false;
    }
  }

  /** 把整代骨架刷到线框群里 */
  syncGhost(trainer: Trainer): void {
    this.ghost.visible = this.showGhost;
    if (!this.showGhost) return;

    const buf = this.ghostPos;
    let w = 0;
    const n = Math.min(trainer.sims.length, Math.floor(buf.length / (this.ghostSegPer * 6)));
    for (let s = 0; s < n; s++) {
      const doll = trainer.sims[s].doll;
      for (let i = 0; i < doll.jointCount; i++) {
        const p = doll.bodies[doll.jointBodies[i * 2]].translation();
        const c = doll.bodies[doll.jointBodies[i * 2 + 1]].translation();
        buf[w++] = p.x; buf[w++] = p.y; buf[w++] = p.z;
        buf[w++] = c.x; buf[w++] = c.y; buf[w++] = c.z;
      }
    }
    // 补零（多余的个体线段塌到原点，视觉上不可见）
    for (; w < buf.length; w++) buf[w] = 0;
    (this.ghost.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.ghost.geometry.setDrawRange(0, n * this.ghostSegPer * 2);
  }

  render(): void {
    this.jointDots.visible = this.showJoints;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro?.disconnect();
    for (const g of this.boneGroups) {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      const m = (g.children[0] as THREE.Mesh | undefined)?.material;
      if (m instanceof THREE.Material) m.dispose();
    }
    for (const p of this.plates) {
      const m = p.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
      p.geometry.dispose();
    }
    this.renderer.dispose();
  }
}

/** 素材里描述过的组件顺序（用于自检：视图里的板数必须等于素材组件数） */
export const EXPECTED_PLATES = META.parts.length;
