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
import { BulletEntity } from '../combat/BulletEntity';

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
  uniform float uTexRotation;
  uniform float uFadeAlpha;
  varying vec2 vUv;

  void main() {
    // 纹理数据 row0=顶部（烘焙约定）→ vUv 左下原点，翻转 v
    vec2 texUV = vec2(vUv.x, 1.0 - vUv.y);
    // ★ 纹理旋转（只走 Z 轴 = 平面法线）：2D UV 旋转，与底图变换语义一致
    if (abs(uTexRotation) > 0.001) {
      float cosR = cos(uTexRotation);
      float sinR = sin(uTexRotation);
      vec2 d = texUV - 0.5;
      texUV = vec2(d.x * cosR - d.y * sinR, d.x * sinR + d.y * cosR) + 0.5;
    }
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
  /** 每实例上次速度方向（零速保持，基类 resolveFlightDirection 消费） */
  private dirs: Float32Array;
  private readonly capacity: number;
  /** 实例世界尺寸（宽/高，由 BulletEntity.computeWorldSize 提供） */
  private readonly size: { width: number; height: number };

  constructor(
    scene: THREE.Scene,
    capacity: number,
    opts: { width: number; height: number },
  ) {
    this.capacity = capacity;
    this.size = { ...opts };
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
        uTexRotation: { value: 0 },
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

  /** ★ 纹理旋转（rad，绕平面法线 Z 轴；素材包底图变换参数） */
  setTextureRotation(rad: number): void {
    this.material.uniforms.uTexRotation.value = rad;
  }

  /**
   * ★ 每帧同步：实体快照 → instance matrix（单次 draw call 的输入）。
   * 全部朝向/锚点/矩阵逻辑 = BulletEntity 基类公共函数：
   *   resolveFlightDirection（零速保持上次）→ computeRenderTransform
   *   （头尾轴 = 速度 3D 共线 + 滚转到面积最大）→ writeRenderMatrix（零分配写入）。
   */
  sync(sources: ArrayLike<BulletInstanceSource>, camera: THREE.Camera): void {
    this.material.uniforms.uTime.value = performance.now() / 1000;
    const m = this.matrices;
    const camPos = camera.position;
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
      // ★ 基类函数：零速保持上次方向（3D，反弹/静止无跳变）
      const last = { x: this.dirs[i * 3], y: this.dirs[i * 3 + 1], z: this.dirs[i * 3 + 2] };
      const dir = BulletEntity.resolveFlightDirection(src.velocity, last);
      this.dirs[i * 3] = dir.x; this.dirs[i * 3 + 1] = dir.y; this.dirs[i * 3 + 2] = dir.z;
      // ★ 基类函数：头尾轴 + 滚转 + 弹头锚点 + 缩放 → 零分配写入矩阵
      BulletEntity.writeRenderMatrix(m, o, src.position, dir, camPos, this.size);
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
