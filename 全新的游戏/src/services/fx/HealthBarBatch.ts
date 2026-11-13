// ============================================================
// HealthBarBatch —— 血条批量渲染（全实体共用 2 个 InstancedMesh）
// ============================================================
// 收敛前：每个实体一组 `2×PlaneGeometry + 2×MeshBasicMaterial + Group`，
//   升格层上限 L3_CAP=128 ⇒ 最坏 512 个 GPU 对象 / 256 次 draw call。
// 现在：底部条 + 前景条各 1 个 InstancedMesh（固定 CAPACITY 槽）⇒ **2 次 draw call**，
//   每实体只占一个槽（int）+ 一份 CPU 端状态（位置 / 比例 / 尺寸）。
//
// ★ 血条挂在实体特效槽（EntityEffect），是**常驻**对象：不走"播完回收"那套池，
//   而是 acquire/release 的槽位租赁。HealthBar 的构造/方法签名保持不变 ⇒ 3 个调用点零改动。
//
// ★ 为什么不是"每帧全量 flush"：`render(idx, camera)` 由每个实体在自己的渲染阶段调用，
//   只写自己那一个矩阵；两次 `needsUpdate` 标记在同帧内合并成一次上传。
// ============================================================

import * as THREE from 'three';

/** 槽位上限（L3_CAP=128 的敌人 + 掉落物 + 掩体的余量） */
const CAPACITY = 256;

const _pos = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();
/** 隐藏用：位置 0 / 朝向单位 / 缩放 0 ⇒ 退化三角形，不产生像素。
 *  ★ 不用全 0 矩阵：那样 m44 也是 0 → 顶点 w=0，属于裁剪边界情况；
 *    compose 出来的矩阵 m44=1、缩放 0，是标准做法。 */
const _HIDDEN = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 0, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0, 0, 0),
);

export interface HealthBarSlotOptions {
  width: number;
  height: number;
  color: number;
}

class HealthBarBatchImpl {
  private scene: THREE.Scene | null = null;
  private bg: THREE.InstancedMesh | null = null;
  private fg: THREE.InstancedMesh | null = null;
  private next = 0;
  private readonly freeList: number[] = [];
  private readonly used = new Uint8Array(CAPACITY);
  /** 1 = 可见（实体没被剔除） */
  private readonly shown = new Uint8Array(CAPACITY);
  private readonly px = new Float32Array(CAPACITY);
  private readonly py = new Float32Array(CAPACITY);
  private readonly pz = new Float32Array(CAPACITY);
  /** 血量比例（0~1） */
  private readonly ratio = new Float32Array(CAPACITY);
  private readonly w = new Float32Array(CAPACITY);
  private readonly h = new Float32Array(CAPACITY);
  private warnedFull = false;

  /** 占用一个槽；返回 -1 = 满（该实体不显示血条，不抢占别人的） */
  acquire(scene: THREE.Scene, opts: HealthBarSlotOptions): number {
    this.ensureScene(scene);

    let idx: number;
    if (this.freeList.length > 0) {
      idx = this.freeList.pop()!;
    } else if (this.next < CAPACITY) {
      idx = this.next++;
    } else {
      if (!this.warnedFull) {
        this.warnedFull = true;
        console.warn(`[HealthBarBatch] 槽位已满（${CAPACITY}），后续实体不显示血条`);
      }
      return -1;
    }

    this.used[idx] = 1;
    this.shown[idx] = 1;
    this.w[idx] = opts.width;
    this.h[idx] = opts.height;
    this.ratio[idx] = 1;
    this.px[idx] = 0; this.py[idx] = 0; this.pz[idx] = 0;
    this.hide(idx);

    // 前景颜色：material.color 为白，实例色乘上去
    _color.setHex(opts.color);
    this.fg!.setColorAt(idx, _color);
    if (this.fg!.instanceColor) this.fg!.instanceColor.needsUpdate = true;
    return idx;
  }

  release(idx: number): void {
    if (idx < 0 || idx >= CAPACITY || !this.used[idx]) return;
    this.used[idx] = 0;
    this.shown[idx] = 0;
    this.hide(idx);
    this.freeList.push(idx);
  }

  /** 可见性：隐藏要**立刻**写零矩阵，否则实体被剔除后血条会留在屏幕上（幽灵血条） */
  setVisible(idx: number, visible: boolean): void {
    if (idx < 0 || idx >= CAPACITY || !this.used[idx]) return;
    this.shown[idx] = visible ? 1 : 0;
    if (!visible) this.hide(idx);
  }

  /** 记录位置与血量比例（矩阵留到 render 阶段算，因为要相机朝向） */
  updateState(idx: number, x: number, y: number, z: number, ratio: number): void {
    if (idx < 0 || idx >= CAPACITY || !this.used[idx]) return;
    this.px[idx] = x;
    this.py[idx] = y;
    this.pz[idx] = z;
    this.ratio[idx] = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  }

  /** 写矩阵（每实体每帧一次，只动自己那一格） */
  render(idx: number, camera: THREE.Camera): void {
    if (idx < 0 || idx >= CAPACITY || !this.used[idx] || !this.bg || !this.fg) return;
    if (!this.shown[idx]) return;

    const width = this.w[idx];
    const height = this.h[idx];
    const r = this.ratio[idx];
    _pos.set(this.px[idx], this.py[idx], this.pz[idx]);
    const q = camera.quaternion;

    // 底条：居中
    _scale.set(width, height, 1);
    _mat4.compose(_pos, q, _scale);
    this.bg.setMatrixAt(idx, _mat4);

    // 前景条：geometry 已 translate(0.5,0,0)（左端锚点）→ 位置左移半宽，scale.x 按比例收缩
    _offset.set(-width / 2, 0, 0.01).applyQuaternion(q).add(_pos);
    _scale.set(r > 0 ? r * width : 0, height, 1);
    _mat4.compose(_offset, q, _scale);
    this.fg.setMatrixAt(idx, _mat4);

    this.bg.instanceMatrix.needsUpdate = true;
    this.fg.instanceMatrix.needsUpdate = true;
  }

  /** 模式销毁/场景更换：整批释放 */
  dispose(): void {
    for (let i = 0; i < this.next; i++) {
      this.bg?.setMatrixAt(i, _HIDDEN);
      this.fg?.setMatrixAt(i, _HIDDEN);
    }
    if (this.bg) {
      this.bg.removeFromParent();
      this.bg.geometry.dispose();
      (this.bg.material as THREE.Material).dispose();
      this.bg.dispose();
    }
    if (this.fg) {
      this.fg.removeFromParent();
      this.fg.geometry.dispose();
      (this.fg.material as THREE.Material).dispose();
      this.fg.dispose();
    }
    this.bg = null;
    this.fg = null;
    this.scene = null;
    this.next = 0;
    this.freeList.length = 0;
    this.used.fill(0);
    this.shown.fill(0);
    this.warnedFull = false;
  }

  private hide(idx: number): void {
    if (this.bg) this.bg.setMatrixAt(idx, _HIDDEN);
    if (this.fg) this.fg.setMatrixAt(idx, _HIDDEN);
    if (this.bg) this.bg.instanceMatrix.needsUpdate = true;
    if (this.fg) this.fg.instanceMatrix.needsUpdate = true;
  }

  /** 场景变了（跨模式）→ 重建整批 */
  private ensureScene(scene: THREE.Scene): void {
    if (this.scene === scene && this.bg && this.fg) return;
    if (this.bg || this.fg) this.dispose();

    const bgGeo = new THREE.PlaneGeometry(1, 1);
    // ★ 与子弹同款层级：水面 renderOrder=10 先画，血条排 20/21 后画；
    //   不写深度（透明排序安全），depthTest 仍读地形/角色深度 → 遮挡关系保持正确
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a, transparent: true, opacity: 0.7,
      depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.bg = new THREE.InstancedMesh(bgGeo, bgMat, CAPACITY);
    this.bg.renderOrder = 20;
    this.bg.frustumCulled = false;
    this.bg.count = CAPACITY;
    for (let i = 0; i < CAPACITY; i++) this.bg.setMatrixAt(i, _HIDDEN);
    this.bg.instanceMatrix.needsUpdate = true;
    scene.add(this.bg);

    const fgGeo = new THREE.PlaneGeometry(1, 1);
    // ★ 锚点左端：几何平移到右侧 → scale.x 从左侧收缩
    fgGeo.translate(0.5, 0, 0);
    const fgMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.fg = new THREE.InstancedMesh(fgGeo, fgMat, CAPACITY);
    this.fg.renderOrder = 21;
    this.fg.frustumCulled = false;
    this.fg.count = CAPACITY;
    for (let i = 0; i < CAPACITY; i++) this.fg.setMatrixAt(i, _HIDDEN);
    this.fg.instanceMatrix.needsUpdate = true;
    scene.add(this.fg);

    this.scene = scene;
  }
}

/** 全局单例（血条跨实体共享一张 instanced 缓冲） */
export const healthBarBatch = new HealthBarBatchImpl();
