import * as THREE from 'three';

/**
 * 统一的全屏 GPU 渲染辅助类。
 *
 * 持有一个全屏四边形 + 正交相机 + 场景，材质按 key 缓存。
 * 所有 GPU Pass（copy、gravity、injection、boundary、pressure 等）
 * 共用这一套基础设施，避免每帧创建/销毁 ShaderMaterial/Scene/Quad 的巨额开销。
 */
export class GPUOps {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private quadGeom: THREE.PlaneGeometry;

  private materials: Map<string, THREE.ShaderMaterial> = new Map();

  private static readonly VS = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeom = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeom);
    this.scene.add(this.quad);
  }

  /**
   * 获取或创建材质（按 key 缓存）。
   * 如果材质已存在则只更新 uniforms，避免重新编译着色器。
   */
  getMaterial(
    key: string,
    uniforms: Record<string, { value: unknown }>,
    fragmentShader: string,
  ): THREE.ShaderMaterial {
    let mat = this.materials.get(key);
    if (mat) {
      for (const [name, u] of Object.entries(uniforms)) {
        if (mat.uniforms[name]) mat.uniforms[name].value = u.value;
      }
      return mat;
    }
    mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: GPUOps.VS,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.materials.set(key, mat);
    return mat;
  }

  /**
   * 全屏渲染到 RenderTarget。
   */
  render(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    material: THREE.ShaderMaterial,
  ): void {
    const prevMat = this.quad.material;
    this.quad.material = material;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);

    this.quad.material = prevMat;
  }

  dispose(): void {
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.quadGeom.dispose();
  }
}
