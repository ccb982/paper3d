import * as THREE from 'three';
import { ITextureGenerator } from './BaseTextureGenerator';

interface TextureEntry {
  id: string;
  generator: ITextureGenerator;
  texture?: THREE.Texture;
  material?: THREE.Material;
  refCount: number;       // 引用计数，用于自动释放
}

export class TextureManager {
  private textures: Map<string, TextureEntry> = new Map();

  // 注册纹理生成器
  public register(id: string, generator: ITextureGenerator): void {
    if (this.textures.has(id)) {
      console.warn(`Texture ${id} already exists, overwriting.`);
      this.unregister(id);
    }
    const result = generator.generate();
    const entry: TextureEntry = {
      id,
      generator,
      texture: result instanceof THREE.Texture ? result : undefined,
      material: result instanceof THREE.Material ? result : undefined,
      refCount: 0,
    };
    this.textures.set(id, entry);
  }

  // 获取纹理（增加引用计数）
  public getTexture(id: string): THREE.Texture | undefined {
    const entry = this.textures.get(id);
    if (entry?.texture) {
      entry.refCount++;
      return entry.texture;
    }
    return undefined;
  }

  // 获取材质（用于 Shader 纹理）
  public getMaterial(id: string): THREE.Material | undefined {
    const entry = this.textures.get(id);
    if (entry?.material) {
      entry.refCount++;
      return entry.material;
    }
    return undefined;
  }

  // 更新纹理（手动触发重绘）
  public update(id: string, delta?: number): void {
    const entry = this.textures.get(id);
    if (entry) {
      entry.generator.update(delta);
    }
  }

  // 释放引用（当不再使用时调用）
  public release(id: string): void {
    const entry = this.textures.get(id);
    if (entry && entry.refCount > 0) {
      entry.refCount--;
      if (entry.refCount === 0) {
        this.unregister(id);
      }
    }
  }

  // 强制销毁纹理
  public unregister(id: string): void {
    const entry = this.textures.get(id);
    if (entry) {
      entry.generator.dispose();
      this.textures.delete(id);
    }
  }

  // 每帧更新所有 Shader 纹理（如果需要统一时间）
  public updateAll(delta: number): void {
    this.textures.forEach(entry => {
      if (entry.generator.type === 'shader') {
        entry.generator.update(delta);
      }
    });
  }
}
