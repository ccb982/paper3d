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

  /**
   * ★★ 视锥判据球（中心相对脚底的高度 + 半径）—— 视锥裁剪用（2026-11-08）。
   *   ★ 为什么需要：视锥裁剪用球判定，球必须罩住整个可见体。
   *     旧的全局常量（中心 0.9m / 半径 1.0m）只适配人形贴片：
   *     掩体（4.0×4.5m）、访客（宽 2.0m）等大件用同一个球 ⇒ 可见体有一部分在球外
   *     ⇒ 走到画面边缘时整块提前消失（实测掩体误杀 13.4%、访客 0.9%）。
   *   ★ 由渲染层自报 ⇒ 尺寸永远与实际绘制一致（改资产/缩放不会漏改判据）。
   *   ★ 默认实现：贴片**底部锚定地面** ⇒ 中心 = 半高；
   *     半径 = max(半宽, 半高) × 1.1（**不用半对角线**：那是 3D 球最坏情况，
   *     贴片是薄片 ⇒ 半对角线会白白多罩一倍（实测浪费 19% vs 14%））。
   *     锚点/形状特殊的子类覆写（FTXQuad 非底部锚定、CoverRenderer 3D 网格）。
   */
  visBounds(): { centerH: number; radius: number } {
    const w = Math.abs(this.baseScale.x);
    const h = Math.abs(this.baseScale.y);
    return { centerH: h / 2, radius: Math.max(w / 2, h / 2) * 1.1 };
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

  /**
   * ★★ 连续表现强度（0~1；2026-11-07 架构重构）。
   * ★ 为什么单独一个接口：旧实现把「档位 → alpha」硬编码在 FTXQuad.setLodLevel 里
   *   （1 / 0.45 / 0 三个离散值）⇒ 敌人在 LOD 边界抖动 ⇒ alpha 跳变 = 闪烁。
   *   现在由**距离连续插值**驱动（services/visibility.ts 的 fadeForDistance），
   *   渲染器只负责接收一个 0~1 的强度。
   * 默认实现：不支持渐隐的渲染器忽略即可。
   */
  setFade(_fade: number): void {
    /* 默认无渐隐能力 */
  }

  /** 子类实现：读 FrameState 渲染当前帧
   *  @param fluidMix 染料混入系数（0 = 纯基础色，1 = 纯染料结果）；只有 FTXQuad 使用 */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(_state: { frameIndex: number }, _fluidTexture?: THREE.Texture | null, _fluidMix = 1): void {
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
