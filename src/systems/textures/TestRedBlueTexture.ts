import * as THREE from 'three';

interface ITextureGenerator {
  type: 'canvas' | 'shader';
  generate(): THREE.Texture | THREE.Material;
  update(delta?: number): void;
  dispose(): void;
}

/**
 * 测试用红蓝色纹理生成器
 * 8x8像素，上半部分红色，下半部分蓝色
 */
export class TestRedBlueTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';
  private texture: THREE.Texture | null = null;

  /**
   * 生成红蓝色测试纹理
   */
  generate(): THREE.Texture | THREE.Material {
    if (!this.texture) {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('无法创建canvas上下文');
      }

      // 填充上半部分为红色
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, 8, 4);
      
      // 填充下半部分为蓝色
      context.fillStyle = '#0000ff';
      context.fillRect(0, 4, 8, 4);

      this.texture = new THREE.CanvasTexture(canvas);
      this.texture.needsUpdate = true;
    }
    return this.texture;
  }

  update(delta?: number): void {
    // 不需要更新
  }

  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
    }
  }
}