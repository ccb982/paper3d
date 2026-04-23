import * as THREE from 'three';

export class CanvasTextureGenerator {
  public type = 'canvas';
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private drawCallback: (ctx: CanvasRenderingContext2D, width: number, height: number, time?: number) => void;

  constructor(width: number, height: number, drawCallback: (ctx: CanvasRenderingContext2D, w: number, h: number, time?: number) => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.drawCallback = drawCallback;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.draw();
  }

  private draw(time?: number): void {
    const ctx = this.canvas.getContext('2d')!;
    this.drawCallback(ctx, this.canvas.width, this.canvas.height, time);
  }

  public generate(): THREE.Texture {
    return this.texture;
  }

  public update(time?: number): void {
    this.draw(time);
    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.texture.dispose();
  }
}
