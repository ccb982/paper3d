import * as THREE from 'three';
import { BulletFluidTexture } from './BulletFluidTexture';
import { TriangleFluidTexture } from './TriangleFluidTexture';
import { VerticalTriangleTexture } from './VerticalTriangleTexture';

export interface ITextureGenerator {
  type: 'canvas' | 'shader';
  generate(): THREE.Texture | THREE.Material;
  update(delta?: number): void;
  dispose(): void;
}

interface TextureEntry {
  id: string;
  generator: ITextureGenerator;
  texture?: THREE.Texture;
  material?: THREE.Material;
  refCount: number;       // 引用计数，用于自动释放
}

export class TextureManager {
  private static instance: TextureManager;
  private textures: Map<string, TextureEntry> = new Map();
  private isInitialized: boolean = false;

  private constructor() {}

  public static getInstance(): TextureManager {
    if (!TextureManager.instance) {
      TextureManager.instance = new TextureManager();
    }
    return TextureManager.instance;
  }

  // 初始化内置纹理
  public initialize(): void {
    if (this.isInitialized) return;
    
    // 注册子弹流体纹理
    this.register('bulletFluid', new BulletFluidTexture());
    
    // 注册三角形流体纹理
    this.register('triangleFluid', new TriangleFluidTexture());
    
    // 注册竖直三角形水滴纹理
    this.register('verticalTriangle', new VerticalTriangleTexture());
    
    this.isInitialized = true;
  }

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

  // 每帧更新所有纹理（包括 Shader 和 Canvas 类型）
  public updateAll(delta: number): void {
    this.textures.forEach(entry => {
      // 更新所有类型的纹理生成器
      entry.generator.update(delta);
    });
  }
}
