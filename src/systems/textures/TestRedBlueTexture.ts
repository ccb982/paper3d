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
  private time: number = 0;

  /**
   * 生成红蓝色测试纹理
   */
  generate(): THREE.Texture | THREE.Material {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建canvas上下文');
    }

    // 流动效果参数
    const flowSpeed = 2.0; // 增加流动速度
    const flowOffset = this.time * flowSpeed;
    
    // 动态变化的波浪参数（正弦变化）
    const baseAmplitude = 1.0 + Math.sin(this.time * 1.5) * 0.5; // 振幅在0.5-1.5之间变化
    const baseFrequency = 0.6 + Math.sin(this.time * 0.8) * 0.4; // 频率在0.2-1.0之间变化
    
    // 随机杂波参数（每帧随机）
    const noiseAmplitude = Math.random() * 0.5; // 随机杂波振幅0-0.5
    const noiseX = Math.random() * 8; // 随机X位置
    const noiseY = Math.random() * 2 - 1; // 随机Y偏移-1到1

    // 绘制红色上半部分（带波浪边界）
    context.fillStyle = '#ff0000';
    context.beginPath();
    context.moveTo(0, 0);
    
    // 绘制波浪边界（动态变化 + 随机杂波）
    for (let x = 0; x <= 8; x++) {
      const waveY = Math.sin(x * baseFrequency + flowOffset) * baseAmplitude;
      const noiseY1 = Math.sin(x * 3.7 + this.time * 5.3) * noiseAmplitude;
      const noiseY2 = Math.cos(x * 2.3 + this.time * 4.1) * noiseAmplitude * 0.5;
      const y = 4 + waveY + noiseY1 + noiseY2;
      context.lineTo(x, y);
    }
    
    context.lineTo(8, 0);
    context.closePath();
    context.fill();
    
    // 绘制蓝色下半部分（带波浪边界）
    context.fillStyle = '#0000ff';
    context.beginPath();
    context.moveTo(0, 8);
    
    // 绘制波浪边界（与上半部分对称，动态变化 + 随机杂波）
    for (let x = 0; x <= 8; x++) {
      const waveY = Math.sin(x * baseFrequency + flowOffset) * baseAmplitude;
      const noiseY1 = Math.sin(x * 3.7 + this.time * 5.3) * noiseAmplitude;
      const noiseY2 = Math.cos(x * 2.3 + this.time * 4.1) * noiseAmplitude * 0.5;
      const y = 4 + waveY + noiseY1 + noiseY2;
      context.lineTo(x, y);
    }
    
    context.lineTo(8, 8);
    context.closePath();
    context.fill();

    if (!this.texture) {
      this.texture = new THREE.CanvasTexture(canvas);
    } else {
      (this.texture as THREE.CanvasTexture).image = canvas;
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }

  update(delta?: number): void {
    if (delta && this.texture) {
      this.time += delta * 0.5; // 控制流动速度
      this.generate(); // 重新生成纹理以实现流动效果
    }
  }

  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
    }
  }
}