// ============================================================
// GroundBlobLayer —— 动态贴地圆影层（实时渲染域·LiveFeature #1）
// ============================================================
// 架构 8.0 v4：billboard 竖片的"真实投影"会随视角坍缩/摆动（几何宿命），
// 因此角色/物品/子弹的影子一律使用【贴地软圆斑】表示：
//
//   存在性 = 实体可见(视锥) ∧ LOD 达标 ∧ 类型声明有影子
//   位置   = 每帧跟随实体 x/z，y = surfaceHeightAt + 0.02（贴地爬坡）
//   形状   = 共享径向渐变纹理（永不随相机/朝向变化）
//
// 数据意图来自实体基类（minimapInfo 同款模式，实体不碰渲染）：
//   EntityBase.getShadowSpec() → { radius, alpha } | null
//
// 处理范围：上游 queryFrustum 视锥已过滤（复用渲染剔除管线）
// ============================================================

import * as THREE from 'three';
import type { RasterMap } from '../map/RasterMap';
import type { EntityManager } from '../../entity/EntityManager';
import { LOD_MAX_DIST, levelForDistance } from '../lod';

const _UP = new THREE.Vector3(0, 1, 0);
const _tmpQyaw = new THREE.Quaternion();
const _tmpQflat = new THREE.Quaternion();

export class GroundBlobLayer {
  private blobs = new Map<number, {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
  }>();
  private blobTex: THREE.CanvasTexture | null = null;
  private scene: THREE.Scene;

  /** ★ 所有圆斑共享同一份几何体（形状恒定；永不 dispose，进程级复用） */
  private static readonly SHARED_GEO = new THREE.PlaneGeometry(1, 1);

  constructor(
    scene: THREE.Scene,
    private raster: RasterMap,
  ) {
    this.scene = scene;
  }

  /** 每帧同步（WorldMode.render 调用；在实体 applyViewDistance 之后执行） */
  update(camera: THREE.Camera): void {
    const seen = new Set<number>();
    const rSqMax = LOD_MAX_DIST * LOD_MAX_DIST;
    for (const base of this.raster.queryFrustum(camera as never, LOD_MAX_DIST)) {
      const spec = base.shadowSpec;
      if (!spec) continue;
      seen.add(base.entity.id);

      let b = this.blobs.get(base.entity.id);
      if (!b) {
        const customTex = (base as unknown as { shadowAlphaTex: THREE.CanvasTexture | null }).shadowAlphaTex;
        const mat = new THREE.MeshBasicMaterial({
          map: customTex ?? this.ensureTexture(),
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(GroundBlobLayer.SHARED_GEO, mat);
        mesh.rotation.x = -Math.PI / 2; // 贴地
        mesh.renderOrder = -1;          // ★ 先于透明角色绘制：角色踩在自己的影子上
        this.scene.add(mesh);
        b = { mesh, mat };
        this.blobs.set(base.entity.id, b);
      }

      // ---- 每帧同步 ----
      const p = base.position;
      const gy = this.raster.surfaceHeightAt(p.x, p.z) + 0.02;
      b.mesh.position.set(p.x, gy, p.z);
      const sz = spec.stretchZ ?? 1;
      b.mesh.scale.set(spec.radius * 2, spec.radius * 2 * sz, 1);
      // 存在性：实体可见 ∧ 距离 LOD <3（与相机角度无关；只和距离/视锥有关）
      const dx = p.x - camera.position.x;
      const dz = p.z - camera.position.z;
      const lod = levelForDistance(Math.hypot(dx, dz));
      b.mesh.visible = base.visible && lod < 3;
      b.mat.opacity = spec.alpha * (lod === 2 ? 0.45 : 1);

      // ★ 影子朝向：优先读实体的 groundShadowYaw，否则从渲染器四元数提取。
      //   子弹等无 FTXQuad 渲染器的实体通过 groundShadowYaw 字段传递方向。
      const gsY = (base as unknown as { groundShadowYaw?: number }).groundShadowYaw;
      if (gsY !== undefined) {
        _tmpQyaw.setFromAxisAngle(_UP, gsY);
      } else {
        const rm = (base as unknown as { renderer?: { mesh?: THREE.Mesh } }).renderer?.mesh;
        if (rm) {
          const eq = rm.quaternion;
          const yaw = Math.atan2(2 * (eq.w * eq.y + eq.x * eq.z), 1 - 2 * (eq.y * eq.y + eq.z * eq.z));
          _tmpQyaw.setFromAxisAngle(_UP, yaw);
        }
      }
      _tmpQflat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      b.mesh.quaternion.copy(_tmpQyaw).multiply(_tmpQflat);
    }

    // 差分回收：离开视锥/销毁的实体 → 圆影一并移除
    // （共享几何体不 dispose —— 进程级复用）
    for (const [id, b] of this.blobs) {
      if (!seen.has(id)) {
        this.scene.remove(b.mesh);
        b.mat.dispose();
        this.blobs.delete(id);
      }
    }
  }

  /** 共享径向渐变纹理（全项目一份，惰性创建） */
  private ensureTexture(): THREE.CanvasTexture {
    if (this.blobTex) return this.blobTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.blobTex = new THREE.CanvasTexture(c);
    return this.blobTex;
  }

  dispose(): void {
    for (const [, b] of this.blobs) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
    }
    this.blobs.clear();
    this.blobTex?.dispose();
    this.blobTex = null;
  }
}
