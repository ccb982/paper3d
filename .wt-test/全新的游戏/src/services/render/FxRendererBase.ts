// ============================================================
// FxRendererBase —— 渲染管线基类（共用最基础版本）
// ============================================================
// 职责（表现层）：
//   - 贴片网格（quad/mesh）的世界变换（位置/缩放/朝向）
//   - 纹理反转（flipX/flipY：quad.scale 取反）
//   - LOD 控制接口（P7 启用完整逻辑）
//   - 生命周期（dispose）
//
// 子类扩展点：
//   - FTXQuad：纯纹理合成 shader（读 FrameState → 纹理 → 画）
//   - 特效网格渲染器：VAT 位移 + 模板裁剪
// 基类不关心"画什么内容"，只做通用的贴片容器管理。

import * as THREE from 'three';

export class FxRendererBase {
  /** 贴片网格（子类构造） */
  protected mesh: THREE.Mesh | null = null;
  protected lodLevel = 0;
  /** 基准缩放（flipX/flipY 在此之上取反） */
  protected baseScale = new THREE.Vector3(1, 1, 1);
  protected flipXState = false;
  protected flipYState = false;

  /** 世界位置（贴片中心） */
  setPosition(x: number, y: number, z = 0): void {
    if (this.mesh) this.mesh.position.set(x, y, z);
  }

  /** ★ 贴片可见性（第一人称隐藏自身等；true=还原） */
  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  /** 基准缩放（flip 状态保持） */
  setScale(sx: number, sy: number): void {
    this.baseScale.set(sx, sy, 1);
    this.applyFlip();
  }

  /** ★ 纹理反转（渲染层应用：quad.scale 取反） */
  setFlip(flipX: boolean, flipY: boolean): void {
    this.flipXState = flipX;
    this.flipYState = flipY;
    this.applyFlip();
  }

  protected applyFlip(): void {
    if (!this.mesh) return;
    this.mesh.scale.set(
      this.baseScale.x * (this.flipXState ? -1 : 1),
      this.baseScale.y * (this.flipYState ? -1 : 1),
      1,
    );
  }

  /** 渲染侧下发 LOD 等级（P7 启用：减细节/静态单帧） */
  setLodLevel(level: number): void {
    this.lodLevel = Math.max(0, Math.min(2, Math.floor(level)));
  }

  /** 子类实现：读 FrameState 渲染当前帧 */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(_state: { frameIndex: number }, _fluidTexture?: THREE.Texture | null): void {
    // 基类不实现，子类覆盖
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material | undefined)?.dispose();
      this.mesh = null;
    }
  }
}
