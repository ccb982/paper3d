// ============================================================
// BulletRenderer —— 3D 子弹渲染器（InstancedMesh 一次 draw call）
// ============================================================
// 输入：离屏纹理（BulletVisual.getTexture）+ 实体快照（位置/速度/激活）。
// 输出：InstancedMesh（capacity 个实例），每帧从快照写入 instance matrix。
//
// 实例变换（全部折叠进矩阵，无逐帧覆盖残留）：
//   - 长轴（纹理上端 = 弹头）沿【水平飞行方向】（速度 XZ 投影；零速保持上次）
//   - 弹头锚点：quad 中心沿 -v 回移半高 → 弹头压在实体位置（碰撞点）
//   - 平面法线 = 世界 up（恒水平躺平，不随相机转）
// 绘制方式（材质/实例化）完全自决，不知道纹理是怎么烘焙出来的。

import * as THREE from 'three';

/** 渲染器消费的实体快照（纯数据，不持有实体） */
export interface BulletInstanceSource {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  isActive: boolean;
}

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uDistortEnabled;
  uniform float uDistortAmplitude;
  uniform float uDistortFrequency;
  uniform float uDistortSpeed;
  uniform float uDistortRotation;
  uniform float uFadeAlpha;
  varying vec2 vUv;

  void main() {
    // 纹理数据 row0=顶部（烘焙约定）→ vUv 左下原点，翻转 v
    vec2 texUV = vec2(vUv.x, 1.0 - vUv.y);
    // ★ 呼吸式扭曲（UV 空间，与 FTXQuad 一致；烘焙时已关闭，这里统一应用）
    if (uDistortEnabled > 0.5) {
      float time = uTime;
      float cosDR = cos(uDistortRotation);
      float sinDR = sin(uDistortRotation);
      vec2 dUv = texUV - 0.5;
      vec2 rotUv = vec2(
        dUv.x * cosDR - dUv.y * sinDR,
        dUv.x * sinDR + dUv.y * cosDR
      );
      rotUv += 0.5;
      float amplitude = uDistortAmplitude * (0.5 + 0.5 * sin(time * 0.4));
      float frequency = uDistortFrequency;
      float phase = time * uDistortSpeed + 0.5 * sin(time * 0.3);
      float offsetX = amplitude * sin(frequency * rotUv.y + phase);
      rotUv.x += offsetX;
      float secondaryAmp = amplitude * 0.3;
      float secondaryFreq = frequency * 1.8;
      float secondaryPhase = time * 2.5;
      rotUv.x += secondaryAmp * sin(secondaryFreq * rotUv.y + secondaryPhase);
      vec2 backUv = rotUv - 0.5;
      texUV = vec2(
        backUv.x * cosDR + backUv.y * sinDR,
        -backUv.x * sinDR + backUv.y * cosDR
      );
      texUV += 0.5;
    }
    if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard;
    vec4 c = texture2D(uTex, texUV);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb, c.a * uFadeAlpha);
  }
`;

export class BulletRenderer {
  private mesh: THREE.InstancedMesh;
  private material: THREE.ShaderMaterial;
  private matrices: Float32Array;
  /** 每实例上次非零水平方向（零速时保持朝向，无状态残留） */
  private dirs: Float32Array;
  private readonly capacity: number;
  private readonly quadW: number;
  private readonly quadH: number;

  constructor(
    scene: THREE.Scene,
    capacity: number,
    opts: { width: number; height: number },
  ) {
    this.capacity = capacity;
    this.quadW = opts.width;
    this.quadH = opts.height;
    this.matrices = new Float32Array(capacity * 16);
    this.dirs = new Float32Array(capacity * 3);

    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // ★ 必须手动应用实例矩阵（three 对 ShaderMaterial 不自动乘 instanceMatrix，
          //   否则所有实例都画在几何原点）
          vec3 pos = (instanceMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTex: { value: null as unknown as THREE.Texture },
        uTime: { value: 0 },
        uDistortEnabled: { value: 0 },
        uDistortAmplitude: { value: 0.06 },
        uDistortFrequency: { value: 5.0 },
        uDistortSpeed: { value: 1.2 },
        uDistortRotation: { value: 0 },
        uFadeAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      this.material,
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 初始全部隐藏（scale 0）
    this.matrices.fill(0);
    this.mesh.instanceMatrix.array.set(this.matrices);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** ★ 设置采样纹理（离屏烘焙结果；null = 不渲染） */
  setTexture(tex: THREE.Texture | null): void {
    this.material.uniforms.uTex.value = tex;
  }

  /** ★ 呼吸式扭曲参数（素材包 per_frame_data；无 = 关闭） */
  setDistort(opts: { enabled: boolean; amplitude: number; frequency: number; speed: number; rotation: number }): void {
    const u = this.material.uniforms;
    u.uDistortEnabled.value = opts.enabled ? 1 : 0;
    u.uDistortAmplitude.value = opts.amplitude;
    u.uDistortFrequency.value = opts.frequency;
    u.uDistortSpeed.value = opts.speed;
    u.uDistortRotation.value = opts.rotation;
  }

  /**
   * ★ 每帧同步：实体快照 → instance matrix（单次 draw call 的输入）
   * 朝向：平面法线 = 水平朝相机（可见）；长轴（弹头/拖尾）= 速度水平投影
   * （恒水平；正对/背对飞行时投影≈0 → 水平兜底 = 相机右侧，绝不竖直）
   */
  sync(sources: ArrayLike<BulletInstanceSource>, camera: THREE.Camera): void {
    this.material.uniforms.uTime.value = performance.now() / 1000;
    const m = this.matrices;
    const halfH = this.quadH / 2;
    const cp = camera.position;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * 16;
      const src = sources[i];
      if (!src || !src.isActive) {
        m[o] = m[o + 1] = m[o + 2] = m[o + 3] = 0;
        m[o + 4] = m[o + 5] = m[o + 6] = m[o + 7] = 0;
        m[o + 8] = m[o + 9] = m[o + 10] = m[o + 11] = 0;
        m[o + 12] = m[o + 13] = m[o + 14] = m[o + 15] = 0;
        continue;
      }
      const px = src.position.x, py = src.position.y, pz = src.position.z;
      // 平面法线：水平朝相机（子弹 → 相机的 XZ 投影）
      let nx = cp.x - px, nz = cp.z - pz;
      const nlen = Math.hypot(nx, nz);
      if (nlen < 1e-6) { nx = 1; nz = 0; }
      else { nx /= nlen; nz /= nlen; }
      // 长轴（弹头/拖尾）：速度水平投影 ⊥ 法线；零投影 → 保持上次/水平兜底
      let sx = src.velocity.x - nx * (src.velocity.x * nx + src.velocity.z * nz);
      let sz = src.velocity.z - nz * (src.velocity.x * nx + src.velocity.z * nz);
      const slen = Math.hypot(sx, sz);
      const di = i * 3;
      if (slen < 1e-6) {
        sx = this.dirs[di]; sz = this.dirs[di + 1];
        if (Math.hypot(sx, sz) < 1e-6) { sx = -nz; sz = nx; } // 相机右侧（恒水平）
      } else {
        sx /= slen; sz /= slen;
        this.dirs[di] = sx; this.dirs[di + 1] = sz;
      }
      // 基（右手系）：X = Y×Z（竖直），Y = 长轴，Z = 法线
      const xy = sz * nx - sx * nz;
      const xl = Math.abs(xy) || 1;
      const ux = 0, uy = xy / xl, uz = 0;
      // 弹头锚点：quad 中心 = 实体位置 - Y * 半高（弹头端压在碰撞点）
      const cx = px - sx * halfH;
      const cy = py;
      const cz = pz - sz * halfH;
      m[o] = ux * this.quadW; m[o + 1] = uy * this.quadW; m[o + 2] = uz * this.quadW; m[o + 3] = 0;
      m[o + 4] = sx * this.quadH; m[o + 5] = 0; m[o + 6] = sz * this.quadH; m[o + 7] = 0;
      m[o + 8] = nx; m[o + 9] = 0; m[o + 10] = nz; m[o + 11] = 0;
      m[o + 12] = cx; m[o + 13] = cy; m[o + 14] = cz; m[o + 15] = 1;
    }
    this.mesh.instanceMatrix.array.set(this.matrices);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
