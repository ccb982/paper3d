import * as THREE from 'three';
import type { FtxAsset } from '../core/ftxAsset';

/**
 * ★ 轻量纹理帧渲染：全屏 quad + base/residual 合成 shader。
 * 无需实体/位移/流体，直接播放 FTX3 纹理帧。
 * 帧的 bbox 像素区域映射到画布（画布 = 帧 width×height）。
 */
export function renderFtxFrame(
  ftx: FtxAsset,
  index: number,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  fluidTexture?: THREE.Texture | null,
): void {
  const tex = ftx.getFrame(index);
  if (!tex) return;

  let quad: THREE.Mesh = scene.userData.ftxQuad as THREE.Mesh;
  let material: THREE.ShaderMaterial;
  if (!quad) {
    material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBaseTexture;
        uniform sampler2D uResidual;
        uniform sampler2D uFluidTex;
        uniform float uUseFluid;
        uniform vec2 uFrameSize;
        uniform vec4 uBbox; // x, y, w, h（像素）
        varying vec2 vUv;
        vec3 hsl2rgb(float h, float s, float l) {
          vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }
        void main() {
          // ★ vUv 左下原点 → 翻转 v（纹理数据 row0=顶部，flipY=false）
          vec2 texUV = (vec2(vUv.x, 1.0 - vUv.y) * uFrameSize - uBbox.xy) / uBbox.zw;
          if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
            discard;
          }
          // ★ 流体模式：直接采样解算器 composite 纹理（base+残差±密度已合成）
          //   ★ 不用 discard：残差平流到基础色=0 区域时 alpha 渐变衰减（<0.5），
          //     discard 会丢掉流动痕迹 → 看不到残差流动。alpha 混合保留渐变
          if (uUseFluid > 0.5) {
            vec4 fluid = texture2D(uFluidTex, texUV);
            gl_FragColor = fluid;
            return;
          }
          vec4 base = texture2D(uBaseTexture, texUV);
          if (base.a < 0.5) discard;
          vec4 res = texture2D(uResidual, texUV);
          float dH = (res.r * 2.0 - 1.0) * 0.5;
          float dS = (res.g * 2.0 - 1.0) * 0.5;
          float dL = (res.b * 2.0 - 1.0) * 0.5;
          float finalH = fract(base.r + dH);
          float finalS = clamp(base.g + dS, 0.0, 1.0);
          float finalL = clamp(base.b + dL, 0.0, 1.0);
          vec3 rgb = hsl2rgb(finalH, finalS, finalL);
          gl_FragColor = vec4(rgb, base.a);
        }
      `,
      uniforms: {
        uBaseTexture: { value: null as unknown as THREE.Texture },
        uResidual: { value: null as unknown as THREE.Texture },
        uFluidTex: { value: null as unknown as THREE.Texture },
        uUseFluid: { value: 0 },
        uFrameSize: { value: new THREE.Vector2(512, 512) },
        uBbox: { value: new THREE.Vector4(0, 0, 512, 512) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    quad = new THREE.Mesh(geometry, material);
    quad.position.set(0.5, 0.5, 0);
    scene.add(quad);
    scene.userData.ftxQuad = quad;
    scene.userData.ftxMaterial = material;
  } else {
    material = quad.material as THREE.ShaderMaterial;
  }

  const ftxFrame = ftx.decoded.frames[index];
  material.uniforms.uBaseTexture.value = tex.base;
  material.uniforms.uResidual.value = tex.residual;
  material.uniforms.uFrameSize.value.set(ftx.width, ftx.height);
  material.uniforms.uBbox.value.set(ftxFrame.bbox.x, ftxFrame.bbox.y, ftxFrame.bbox.w, ftxFrame.bbox.h);
  if (fluidTexture) {
    material.uniforms.uFluidTex.value = fluidTexture;
    material.uniforms.uUseFluid.value = 1;
  } else {
    material.uniforms.uUseFluid.value = 0;
  }

  renderer.render(scene, camera);
}

/** 释放轻量渲染资源（scene.userData.ftxQuad） */
export function disposeFtxQuad(scene: THREE.Scene): void {
  const quad: THREE.Mesh | undefined = scene.userData.ftxQuad;
  if (!quad) return;
  scene.remove(quad);
  (quad.material as THREE.Material).dispose();
  quad.geometry.dispose();
  delete scene.userData.ftxQuad;
  delete scene.userData.ftxMaterial;
}
