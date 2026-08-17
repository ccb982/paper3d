// ============================================================
// DeathAnimEffect —— 角色死亡动画（单纯特效，纯表现层）
// ============================================================
// 实体死亡 → 纹理所有权转移：冻结在死亡帧，交给独立流体求解器
// （矢量模式）撕碎消散。实体正常销毁（掉落/结算不阻塞），
// 本类只做三件事：
//   ① PUSH    —— 随机方向大重力（把纹理整体推离）
//   ② 速度冲击 —— 随机方向/强度冲量（撕裂纹理）
//   ③ FADE    —— alpha 平滑淡出 → 销毁
// 渲染：世界空间 quad 采样流体 composite 纹理，面向相机 billboard。

import * as THREE from 'three';
import type { CharacterFxAssetSource } from './AssetSource';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';

export interface DeathAnimOptions {
  /** 世界尺寸（quad 边长，默认 2.0；角色贴片约 2m 高） */
  worldSize?: number;
  /** 定向推力大小（px/s²，随机方向；默认 4000） */
  pushForce?: number;
  /** 定向推压时长（秒，默认 0.3；之后进入爆炸） */
  pushDuration?: number;
  /** 散度爆炸强度（默认 30000；负=向外推） */
  explodeStrength?: number;
  /** 爆炸半径（归一化，默认 0.4） */
  explodeRadius?: number;
  /** 淡出时长（秒，默认 1.2） */
  fadeDuration?: number;
  /** 硬性寿命上限（秒，默认 2.5） */
  maxLifetime?: number;
}

export class DeathAnimEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private fluid: FluidEffect | null;
  private elapsed = 0;
  private fadeStart: number;
  private maxLifetime: number;
  private fadeDuration: number;
  private worldSize: number;
  private scaleX = 1;
  private scaleY = 1;

  /** 世界位置（管理器每帧更新） */
  readonly position = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    asset: CharacterFxAssetSource,
    frameIndex: number,
    renderer: THREE.WebGLRenderer,
    opts?: DeathAnimOptions,
  ) {
    this.worldSize = opts?.worldSize ?? 2.0;
    this.fadeDuration = opts?.fadeDuration ?? 1.2;
    this.maxLifetime = opts?.maxLifetime ?? 2.5;

    // ★ 独立流体实例（矢量模式：残差流动 → 纹理被撕碎）
    this.fluid = asset.createDeathFluidEffect(renderer, frameIndex);

    // ★ 世界宽高比：按死亡帧 bbox 比例（与角色贴片 setScaleKeepAspect 一致，
    //   竖长/横长纹理不被压扁）。worldSize 作为贴片高度，宽 = 高 × 宽高比
    const ftxFrame = asset.getFtxFrame(frameIndex);
    const aspect = ftxFrame ? ftxFrame.bbox.w / Math.max(1, ftxFrame.bbox.h) : 1;
    this.scaleY = this.worldSize;
    this.scaleX = this.worldSize * aspect;

    // ★ 渲染 quad（采样流体 composite 纹理；无流体时兜底显示原始帧对）
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uFluidTex: { value: this.fluid?.getCompositeTexture() ?? null },
        uUseFluid: { value: this.fluid ? 1 : 0 },
        uOpacity: { value: 1 },
        uColorTex: { value: null as THREE.Texture | null },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFluidTex;
        uniform sampler2D uColorTex;
        uniform float uUseFluid;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // ★ 纹理数据 row0=顶部（flipY=false）→ quad UV v=0 在底部，翻转 v
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          vec4 c;
          if (uUseFluid > 0.5) {
            c = texture2D(uFluidTex, uv);
          } else {
            c = texture2D(uColorTex, uv);
          }
          c.a *= uOpacity;
          gl_FragColor = c;
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.scale.set(this.scaleX, this.scaleY, 1);
    // ★ 底部锚点（与角色贴片一致）：贴片底边在地面，中心抬升半高 → 不埋地
    this.mesh.frustumCulled = false;
    this.mesh.visible = true;
    scene.add(this.mesh);

    // 无流体兜底：用死亡帧的静态纹理对（残差仍可显示，只是不流动）
    if (!this.fluid) {
      const pair = asset.getFramePair(frameIndex);
      if (pair) {
        this.material.uniforms.uColorTex.value = pair.base;
        this.material.uniforms.uUseFluid.value = 0;
      }
    }

    // ★ 阶段规划（用计数器延迟散度爆炸：先定向推，再撕裂）
    this.fadeStart = (opts?.pushDuration ?? 0.3) + 0.15;
  }

  /** 启动死亡动画：设置随机方向推力 + 记录起始位置（底部锚点：中心抬升半高） */
  play(x: number, y: number, z: number): void {
    this.position.set(x, y + this.scaleY / 2, z);
    this.mesh.position.copy(this.position);

    // ★ PUSH：随机方向大重力（全向随机，把纹理整体推离）
    const angle = Math.random() * Math.PI * 2;
    const force = 4000;
    this.fluid?.solver.updateConfig({
      gravity: { x: Math.cos(angle) * force, y: Math.sin(angle) * force },
    });

    // ★ 随机速度冲击（一次性，纹理被撕开/推散；旧版散度爆炸已移除——
    //   散度源需要压力迭代传导，速度冲击更直接且无"填满纹理"风险）
    const speed = 800 + Math.random() * 1200; // 随机强度
    const vAngle = Math.random() * Math.PI * 2; // 随机方向
    this.fluid?.solver.queueInjection({
      enabled: true,
      position: { x: 0.5, y: 0.5 },
      radius: 0.5,
      velocity: {
        x: Math.cos(vAngle) * speed,
        y: Math.sin(vAngle) * speed,
      },
      rate: 1.0,
    });
  }

  /** 每帧推进：流体 step → 淡出 → 播完返回 true */
  update(dt: number, camera: THREE.Camera): boolean {
    this.elapsed += dt;
    if (this.elapsed >= this.maxLifetime) return true;

    // 流体推进（有实例才 step；静态兜底直接走淡出）
    if (this.fluid) {
      this.fluid.step(dt);
    }

    // ★ FADE：淡出阶段 alpha 平滑衰减
    let opacity = 1;
    if (this.elapsed >= this.fadeStart) {
      const t = Math.min(1, (this.elapsed - this.fadeStart) / this.fadeDuration);
      opacity = 1 - t;
      if (opacity <= 0.02) return true;
    }
    this.material.uniforms.uOpacity.value = opacity;
    this.material.uniforms.uFluidTex.value = this.fluid?.getCompositeTexture() ?? null;

    // ★ billboard 面相机
    this.mesh.quaternion.copy(camera.quaternion);
    return false;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.fluid?.dispose();
    this.fluid = null;
  }
}
