import * as THREE from 'three';
import { ITextureGenerator } from './BaseTextureGenerator';

export class ShaderTextureGenerator implements ITextureGenerator {
  public type = 'shader';
  private material: THREE.ShaderMaterial;
  private uniforms: Record<string, any>;

  constructor(uniforms: Record<string, any>, vertexShader: string, fragmentShader: string) {
    this.uniforms = uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });
  }

  public generate(): THREE.Material {
    return this.material;
  }

  public update(delta: number): void {
    if (this.uniforms.uTime) this.uniforms.uTime.value += delta;
  }

  public dispose(): void {
    this.material.dispose();
  }
}
