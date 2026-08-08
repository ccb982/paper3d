import * as THREE from 'three';
import {
  VAT_VERTEX_SHADER,
  HSL_COLOR_FRAGMENT_SHADER,
  FILL_FRAGMENT_SHADER,
} from './shaders';

export class SharedMaterials {
  fillMaterial: THREE.ShaderMaterial;
  colorMaterial: THREE.ShaderMaterial;

  constructor() {
    this.fillMaterial = new THREE.ShaderMaterial({
      vertexShader: VAT_VERTEX_SHADER,
      fragmentShader: FILL_FRAGMENT_SHADER,
      uniforms: {
        uDisplacementTex: { value: null },
        uTime: { value: 0 },
        uFramesPerSecond: { value: 30 },
        uTotalFrames: { value: 60 },
        uVertexCount: { value: 0 },
      },
      transparent: false,
      stencilWrite: true,
      stencilZPass: THREE.InvertStencilOp,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilRef: 0,
      stencilWriteMask: 1,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    this.colorMaterial = new THREE.ShaderMaterial({
      vertexShader: VAT_VERTEX_SHADER,
      fragmentShader: HSL_COLOR_FRAGMENT_SHADER,
      uniforms: {
        uDisplacementTex: { value: null },
        uTime: { value: 0 },
        uFramesPerSecond: { value: 30 },
        uTotalFrames: { value: 60 },
        uVertexCount: { value: 0 },
        uColorTex: { value: null },
        uTexOffset: { value: new THREE.Vector2(0, 0) },
        uTexScale: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      stencilWrite: false,
      stencilFunc: THREE.EqualStencilFunc,
      stencilRef: 1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  }

  dispose(): void {
    this.fillMaterial.dispose();
    this.colorMaterial.dispose();
  }
}
