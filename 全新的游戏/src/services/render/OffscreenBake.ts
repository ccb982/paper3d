// ============================================================
// OffscreenBake —— 离屏烘焙基类（RT 管线，纹理坐标系）
// ============================================================
// 通用"离屏绘制 → 单张纹理"的底座：
//   - 建 RT（纹理同尺寸，透明底，模板缓冲）
//   - begin()/end()：切 RT + 透明清屏 + 还原 clear color/autoClear/RT
//   - getTexture()：渲染器唯一采样源
// 子类只需：往 scene 里放内容，在 begin/end 之间渲染。
// 不知道 3D 世界/相机/实体——纯 2D 纹理空间的画面生产者。

import * as THREE from 'three';

export class OffscreenBake {
  protected rt: THREE.WebGLRenderTarget;
  protected camera: THREE.OrthographicCamera;
  protected renderer: THREE.WebGLRenderer;
  private prevTarget: THREE.WebGLRenderTarget | null = null;
  private prevClearColor = new THREE.Color();
  private prevClearAlpha = 1;
  private prevAutoClear = true;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: true,
    });
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  }

  /** ★ 开始离屏绘制：切 RT + 透明清屏（颜色/深度/模板）。
   *   渲染完成后必须调用 end() 还原。 */
  protected begin(): void {
    const r = this.renderer;
    this.prevTarget = r.getRenderTarget();
    r.getClearColor(this.prevClearColor);
    this.prevClearAlpha = r.getClearAlpha();
    this.prevAutoClear = r.autoClear;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    r.clear(true, true, true);
  }

  /** ★ 结束离屏绘制：还原 clear color / autoClear / RT */
  protected end(): void {
    const r = this.renderer;
    r.autoClear = this.prevAutoClear;
    r.setClearColor(this.prevClearColor, this.prevClearAlpha);
    r.setRenderTarget(this.prevTarget);
  }

  /** ★ 输出烘焙纹理（渲染器唯一采样源） */
  getTexture(): THREE.Texture | null {
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
  }
}
