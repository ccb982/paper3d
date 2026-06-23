import type { Point } from '../types';

// GPU顶点着色器 - 真正的GPU扭曲
const VERTEX_SHADER_SOURCE = `
precision highp float;

// 顶点位置（世界坐标 0~1）
attribute vec2 aPosition;

// 时间
uniform float uTime;

// 分辨率
uniform vec2 uResolution;

// 变换参数
uniform vec2 uTransformPosition;
uniform vec2 uTransformAnchor;
uniform float uTransformRotation;
uniform vec2 uTransformScale;

// 扭曲参数
uniform int uDistortionCount;
uniform int uDistortionTypes[8];      // 0: wave, 1: turbulent, 2: twirl
uniform int uDistortionEnabled[8];
uniform float uDistortionAmplitude[8];
uniform float uDistortionFrequency[8];
uniform float uDistortionSpeed[8];
uniform float uDistortionPhase[8];
uniform int uDistortionDirection[8];  // 0: normal, 1: tangent, 2: xy
uniform vec2 uDistortionCenter[8];
uniform float uDistortionFalloffRadius[8];
uniform float uDistortionSeed[8];
uniform int uDistortionOctaves[8];

varying float vPhi;

// 伪随机噪声
float hash(float p) {
  float x = sin(p) * 43758.5453;
  return x - floor(x);
}

float smoothNoise(vec2 p, float seed) {
  vec2 ix = floor(p);
  vec2 fx = fract(p);
  vec2 ux = fx * fx * (3.0 - 2.0 * fx);
  vec2 uy = fx * fx * (3.0 - 2.0 * fx);
  float n00 = hash(ix.x * 127.1 + ix.y * 311.7 + seed);
  float n10 = hash((ix.x + 1.0) * 127.1 + ix.y * 311.7 + seed);
  float n01 = hash(ix.x * 127.1 + (ix.y + 1.0) * 311.7 + seed);
  float n11 = hash((ix.x + 1.0) * 127.1 + (ix.y + 1.0) * 311.7 + seed);
  return mix(
    mix(n00, n10, ux.x),
    mix(n01, n11, ux.x),
    uy.y
  );
}

void main() {
  vec2 pos = aPosition;
  
  // ========== 1. 应用变换 ==========
  vec2 anchor = uTransformAnchor;
  vec2 p = pos - anchor;
  
  // 旋转
  float cosR = cos(uTransformRotation);
  float sinR = sin(uTransformRotation);
  vec2 rotated = vec2(p.x * cosR - p.y * sinR, p.x * sinR + p.y * cosR);
  
  // 缩放
  vec2 scaled = rotated * uTransformScale;
  
  // 位移
  vec2 transformed = scaled + uTransformPosition + anchor;
  
  // ========== 2. 应用扭曲链（完全在GPU上并行计算）==========
  vec2 distorted = transformed;
  
  for (int d = 0; d < 8; d++) {
    if (d >= uDistortionCount) break;
    if (uDistortionEnabled[d] == 0) continue;
    
    int dtype = uDistortionTypes[d];
    
    if (dtype == 0) {
      // Wave 扭曲 - 在GPU上实时计算偏移
      float amp = uDistortionAmplitude[d];
      float freq = uDistortionFrequency[d];
      float speed = uDistortionSpeed[d];
      float phase = uDistortionPhase[d];
      float t = uTime * speed + phase;
      
      int dir = uDistortionDirection[d];
      
      if (dir == 0) {
        // Normal方向 - 需要通过顶点位置推断法线
        // 使用局部梯度估计法线
        float eps = 0.001;
        vec2 pPlusX = transformed + vec2(eps, 0.0);
        vec2 pPlusY = transformed + vec2(0.0, eps);
        float offsetHere = amp * sin(freq * (distorted.x + distorted.y) + t);
        float offsetX = amp * sin(freq * (pPlusX.x + pPlusX.y) + t);
        float offsetY = amp * sin(freq * (pPlusY.x + pPlusY.y) + t);
        
        // 简化：用当前点和邻居的差估计切线方向
        vec2 gradient = vec2(offsetX - offsetHere, offsetY - offsetHere);
        if (length(gradient) > 0.0001) {
          vec2 normal = normalize(vec2(-gradient.y, gradient.x));
          float offset = amp * sin(freq * (distorted.x + distorted.y) + t);
          distorted += normal * offset;
        }
      } else if (dir == 1) {
        // Tangent方向
        float offset = amp * sin(freq * (distorted.x + distorted.y) + t);
        vec2 tangent = normalize(vec2(1.0, 1.0)); // 简化的切线方向
        distorted += tangent * offset;
      } else {
        // XY方向
        distorted.x += amp * sin(freq * distorted.x + t);
        distorted.y += amp * sin(freq * distorted.y + t * 1.3);
      }
    } else if (dtype == 1) {
      // Turbulent 扭曲
      float amp = uDistortionAmplitude[d];
      float freq = uDistortionFrequency[d];
      float speed = uDistortionSpeed[d];
      float seed = uDistortionSeed[d];
      int octaves = uDistortionOctaves[d];
      
      vec2 noiseOffset = vec2(0.0);
      for (int o = 0; o < 6; o++) {
        if (o >= octaves) break;
        float f = freq * pow(2.0, float(o));
        float a = amp / pow(2.0, float(o));
        vec2 noiseCoord = distorted * f + vec2(uTime * speed, uTime * speed * 0.7);
        float n = smoothNoise(noiseCoord, seed + float(o) * 100.0);
        noiseOffset += (n - 0.5) * a * 2.0;
      }
      distorted += noiseOffset;
    } else if (dtype == 2) {
      // Twirl 扭曲
      vec2 center = uDistortionCenter[d];
      float radius = uDistortionFalloffRadius[d];
      float amp = uDistortionAmplitude[d];
      float speed = uDistortionSpeed[d];
      
      vec2 delta = distorted - center;
      float dist = length(delta);
      if (dist > 0.0001) {
        float falloff = exp(-dist / radius);
        float angle = amp * falloff * (1.0 + sin(uTime * speed));
        float cosA = cos(angle);
        float sinA = sin(angle);
        distorted = center + vec2(
          delta.x * cosA - delta.y * sinA,
          delta.x * sinA + delta.y * cosA
        );
      }
    }
  }
  
  // ========== 3. 转换到裁剪空间 ==========
  // 世界坐标 (0~1) -> 像素坐标 (0~resolution) -> 裁剪坐标 (-1~1)
  vec2 pixelPos = distorted * uResolution;
  vec2 clipPos = pixelPos / (uResolution * 0.5); // 归一化到 [-1, 1]
  clipPos.y = -clipPos.y; // Y轴翻转（Canvas坐标系）
  
  gl_Position = vec4(clipPos, 0.0, 1.0);
  vPhi = -1.0; // 内部点
}
`;

// 片段着色器 - 简单输出
const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying float vPhi;

void main() {
  // 内部像素输出 phi = -1.0
  // 外部像素不会被光栅化（硬件自动丢弃）
  gl_FragColor = vec4(vPhi, 0.0, 0.0, 1.0);
}
`;

/**
 * GPU掩码处理器 - 使用顶点着色器进行真正的GPU扭曲
 * 
 * 核心优势：
 * 1. 顶点扭曲完全在GPU上并行计算
 * 2. 硬件光栅化自动生成掩码
 * 3. 支持实时动画（扭曲参数随时间变化）
 */
export class GPUMaskProcessor {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private floatTexture: WebGLTexture | null = null;
  
  private resolution: number = 512;
  private isInitialized: boolean = false;
  
  constructor() {}
  
  /**
   * 初始化WebGL上下文
   */
  init(canvas?: HTMLCanvasElement): boolean {
    const targetCanvas = canvas || this.createOffscreenCanvas();
    
    // 配置参数：启用模板缓冲用于奇偶填充
    const contextOptions = {
      stencil: true,
      depth: false,
      antialias: false,
    };
    
    // 尝试获取 WebGL2 上下文（支持 float 纹理）
    let gl = targetCanvas.getContext('webgl2', contextOptions) as WebGLRenderingContext | null;
    
    if (!gl) {
      // 回退到 WebGL1
      gl = targetCanvas.getContext('webgl', contextOptions) as WebGLRenderingContext | null;
    }
    
    if (!gl) {
      console.error('[GPUMaskProcessor] WebGL is not supported');
      return false;
    }
    
    this.gl = gl;
    this.resolution = 512;
    targetCanvas.width = this.resolution;
    targetCanvas.height = this.resolution;
    
    // 创建着色器程序
    this.program = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!this.program) {
      console.error('[GPUMaskProcessor] Failed to create shader program');
      return false;
    }
    
    // 创建缓冲区
    this.positionBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    
    // 创建帧缓冲和纹理
    this.createFramebuffer();
    
    this.isInitialized = true;
    console.log('[GPUMaskProcessor] Initialized successfully with WebGL');
    return true;
  }
  
  /**
   * 创建离屏Canvas
   */
  private createOffscreenCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.resolution;
    canvas.height = this.resolution;
    return canvas;
  }
  
  /**
   * 创建着色器程序
   */
  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl!;
    
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      return null;
    }
    
    const program = gl.createProgram();
    if (!program) return null;
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[GPUMaskProcessor] Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }
  
  /**
   * 创建着色器
   */
  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    
    if (!shader) return null;
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[GPUMaskProcessor] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  /**
   * 创建帧缓冲和纹理
   */
  private createFramebuffer(): void {
    const gl = this.gl!;
    
    // 创建 RGBA 纹理
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.resolution,
      this.resolution,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // 创建帧缓冲
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0
    );
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('[GPUMaskProcessor] Framebuffer incomplete:', status);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  
  /**
   * 计算多边形重心（用于默认锚点）
   */
  private getCentroid(points: Point[]): Point {
    let cx = 0, cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    return { x: cx / points.length, y: cy / points.length };
  }
  
  /**
   * 生成掩码 - 真正的GPU顶点扭曲
   * 
   * @param polygon 多边形环数组（世界坐标 0~1）
   * @param maskEffect 蒙版特效参数
   * @param time 当前时间（秒）
   * @returns 掩码数组（1=内部，0=外部），或null表示失败
   */
  generateMask(
    polygon: Point[][],
    maskEffect: any,
    time: number
  ): Uint8Array | null {
    if (!this.isInitialized || !this.gl || !this.program || !this.framebuffer) {
      console.error('[GPUMaskProcessor] Not initialized, falling back to CPU');
      return this.generateMaskCPU(polygon, maskEffect, time);
    }
    
    const gl = this.gl;
    
    try {
      // 绑定帧缓冲
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.resolution, this.resolution);
      
      // 使用着色器程序
      gl.useProgram(this.program);
      
      // ===== 模板缓冲初始化 =====
      gl.enable(gl.STENCIL_TEST);
      gl.clearStencil(0);
      gl.stencilMask(0xFF);
      
      // 清空颜色缓冲为外部（黑色=0），模板缓冲为0
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      
      // 禁用混合，我们使用模板缓冲来处理奇偶填充
      gl.disable(gl.BLEND);
      
      // ===== 第一步：绘制所有环到模板缓冲 =====
      // 关键设置：绘制三角形时翻转模板位（偶数→奇数→偶数）
      gl.stencilOp(gl.INVERT, gl.INVERT, gl.INVERT);
      gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
      gl.colorMask(false, false, false, false); // 只写模板，不写颜色
      
      // 绘制每个环
      for (let ringIdx = 0; ringIdx < polygon.length; ringIdx++) {
        const ring = polygon[ringIdx];
        if (ring.length < 3) continue;
        
        // 创建顶点数据（原始坐标，不预扭曲！）
        const positions = new Float32Array(ring.length * 2);
        const indices = new Float32Array(ring.length);
        
        for (let i = 0; i < ring.length; i++) {
          positions[i * 2] = ring[i].x;     // X: 0~1
          positions[i * 2 + 1] = ring[i].y; // Y: 0~1
          indices[i] = i;                    // 顶点索引
        }
        
        // 上传顶点数据
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        
        // 设置顶点属性
        const aPosition = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
        
        // 创建并上传顶点索引（仅在着色器需要时设置）
        const aIndex = gl.getAttribLocation(this.program, 'aIndex');
        if (aIndex >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(aIndex);
          gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, 0);
        }
        
        // 设置Uniforms
        this.setUniforms(ring, maskEffect, time);
        
        // 绘制（使用TRIANGLE_FAN）- 只更新模板缓冲
        gl.drawArrays(gl.TRIANGLE_FAN, 0, ring.length);
      }
      
      // ===== 第二步：只绘制模板值为1的像素（奇数层 = 内部） =====
      gl.colorMask(true, true, true, true); // 恢复颜色写入
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(gl.EQUAL, 1, 0xFF); // 只绘制模板值为1的像素
      
      // 设置颜色为内部（白色=1）
      gl.clearColor(1.0, 0.0, 0.0, 1.0);
      
      // 使用模板测试的 clear 来填充内部区域
      this.fillStencilRegion();
      
      // ===== 读取结果 =====
      const pixels = new Uint8Array(this.resolution * this.resolution * 4);
      gl.readPixels(0, 0, this.resolution, this.resolution, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      
      // 转换为掩码数组（1=内部，0=外部）
      const mask = new Uint8Array(this.resolution * this.resolution);
      for (let i = 0; i < mask.length; i++) {
        const r = pixels[i * 4];
        mask[i] = r > 128 ? 1 : 0; // R>128 表示内部
      }
      
      // 解绑
      gl.disable(gl.STENCIL_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      
      return mask;
      
    } catch (e) {
      console.error('[GPUMaskProcessor] GPU render failed, falling back to CPU:', e);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return this.generateMaskCPU(polygon, maskEffect, time);
    }
  }
  
  /**
   * 设置Uniforms - 将扭曲参数传递给GPU
   */
  private setUniforms(ring: Point[], maskEffect: any, time: number): void {
    const gl = this.gl!;
    const program = this.program!;
    
    // 基本参数
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), this.resolution, this.resolution);
    
    // 变换参数
    const transform = maskEffect?.transform || {};
    const anchor = transform.anchor ? 
      { x: transform.anchor.x, y: transform.anchor.y } : 
      this.getCentroid(ring);
    
    gl.uniform2f(gl.getUniformLocation(program, 'uTransformPosition'), 
      transform.position?.x || 0, 
      transform.position?.y || 0
    );
    gl.uniform2f(gl.getUniformLocation(program, 'uTransformAnchor'), anchor.x, anchor.y);
    gl.uniform1f(gl.getUniformLocation(program, 'uTransformRotation'), transform.rotation || 0);
    gl.uniform2f(gl.getUniformLocation(program, 'uTransformScale'), 
      transform.scale?.x || 1, 
      transform.scale?.y || 1
    );
    
    // 扭曲参数
    const distortions = maskEffect?.distortions || [];
    gl.uniform1i(gl.getUniformLocation(program, 'uDistortionCount'), distortions.length);
    
    // 预分配数组用于uniform设置
    const types = new Int32Array(8);
    const enabled = new Int32Array(8);
    const amplitudes = new Float32Array(8);
    const frequencies = new Float32Array(8);
    const speeds = new Float32Array(8);
    const phases = new Float32Array(8);
    const directions = new Int32Array(8);
    const centers = new Float32Array(16);
    const falloffRadii = new Float32Array(8);
    const seeds = new Float32Array(8);
    const octaves = new Int32Array(8);
    
    for (let i = 0; i < 8; i++) {
      if (i < distortions.length) {
        const op = distortions[i];
        types[i] = op.type === 'wave' ? 0 : op.type === 'turbulent' ? 1 : 2;
        enabled[i] = op.enabled ? 1 : 0;
        amplitudes[i] = op.amplitude || 0.05;
        frequencies[i] = op.frequency || 1;
        speeds[i] = op.speed || 1;
        phases[i] = op.phase || 0;
        directions[i] = op.direction === 'normal' ? 0 : op.direction === 'tangent' ? 1 : 2;
        centers[i * 2] = op.center?.x || 0.5;
        centers[i * 2 + 1] = op.center?.y || 0.5;
        falloffRadii[i] = op.falloffRadius || 0.5;
        seeds[i] = op.seed || 42;
        octaves[i] = op.octaves || 3;
      }
    }
    
    gl.uniform1iv(gl.getUniformLocation(program, 'uDistortionTypes'), types);
    gl.uniform1iv(gl.getUniformLocation(program, 'uDistortionEnabled'), enabled);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionAmplitude'), amplitudes);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionFrequency'), frequencies);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionSpeed'), speeds);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionPhase'), phases);
    gl.uniform1iv(gl.getUniformLocation(program, 'uDistortionDirection'), directions);
    gl.uniform2fv(gl.getUniformLocation(program, 'uDistortionCenter'), centers);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionFalloffRadius'), falloffRadii);
    gl.uniform1fv(gl.getUniformLocation(program, 'uDistortionSeed'), seeds);
    gl.uniform1iv(gl.getUniformLocation(program, 'uDistortionOctaves'), octaves);
  }
  
  /**
   * 填充模板缓冲标记的区域（使用 gl.clear + 模板测试）
   */
  private fillStencilRegion(): void {
    const gl = this.gl!;
    
    // gl.clear 也会受模板测试影响！
    // 这是最简单高效的方式：只清除（填充）模板值为1的像素
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  
  /**
   * CPU回退 - 当GPU不可用时使用
   */
  private generateMaskCPU(polygon: Point[][], maskEffect: any, time: number): Uint8Array {
    // 使用CPU扭曲
    const distortedPolygon = polygon.map(ring => this.applyDistortionCPU(ring, maskEffect, time));
    
    // 使用canvas光栅化
    const canvas = document.createElement('canvas');
    canvas.width = this.resolution;
    canvas.height = this.resolution;
    const ctx = canvas.getContext('2d')!;
    
    // 填充外部（白色=0）
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, this.resolution, this.resolution);
    
    // 绘制内部（黑色=1）
    ctx.fillStyle = 'black';
    ctx.beginPath();
    
    for (let ringIdx = 0; ringIdx < distortedPolygon.length; ringIdx++) {
      const ring = distortedPolygon[ringIdx];
      if (ring.length < 3) continue;
      
      const px = ring.map(p => p.x * this.resolution);
      const py = ring.map(p => (1 - p.y) * this.resolution);
      
      ctx.moveTo(px[0], py[0]);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(px[i], py[i]);
      }
      ctx.closePath();
    }
    
    ctx.fill('evenodd');
    
    // 读取结果
    const imageData = ctx.getImageData(0, 0, this.resolution, this.resolution);
    const mask = new Uint8Array(this.resolution * this.resolution);
    
    for (let i = 0; i < mask.length; i++) {
      const idx = i * 4;
      mask[i] = (imageData.data[idx] === 0 && imageData.data[idx + 1] === 0 && imageData.data[idx + 2] === 0) ? 1 : 0;
    }
    
    return mask;
  }
  
  /**
   * CPU扭曲（用于回退）
   */
  private applyDistortionCPU(points: Point[], maskEffect: any, time: number): Point[] {
    if (!maskEffect?.enabled) {
      return points.slice();
    }
    
    let pts = points.slice();
    
    // 应用变换
    if (maskEffect.transform) {
      const transform = maskEffect.transform;
      const anchor = transform.anchor || this.getCentroid(points);
      
      pts = pts.map(p => {
        let x = p.x - anchor.x;
        let y = p.y - anchor.y;
        
        // 旋转
        const cos = Math.cos(transform.rotation || 0);
        const sin = Math.sin(transform.rotation || 0);
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        
        // 缩放
        const sx = rx * (transform.scale?.x || 1);
        const sy = ry * (transform.scale?.y || 1);
        
        // 位移
        return {
          x: sx + (transform.position?.x || 0) + anchor.x,
          y: sy + (transform.position?.y || 0) + anchor.y
        };
      });
    }
    
    // 应用扭曲
    if (maskEffect.distortions) {
      for (const op of maskEffect.distortions) {
        if (!op.enabled) continue;
        
        switch (op.type) {
          case 'wave':
            pts = this.applyWaveCPU(pts, op, time);
            break;
          case 'turbulent':
            pts = this.applyTurbulentCPU(pts, op, time);
            break;
          case 'twirl':
            pts = this.applyTwirlCPU(pts, op, time);
            break;
        }
      }
    }
    
    return pts;
  }
  
  private applyWaveCPU(points: Point[], op: any, time: number): Point[] {
    const dir = op.direction || 'normal';
    const freq = op.frequency || 1;
    const amp = op.amplitude || 0.05;
    const speed = op.speed || 1;
    const phase = op.phase || 0;
    
    const n = points.length;
    return points.map((p, i) => {
      // 计算法线方向
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const tangent = { x: next.x - prev.x, y: next.y - prev.y };
      const len = Math.hypot(tangent.x, tangent.y);
      
      let normal = { x: -tangent.y / len, y: tangent.x / len };
      
      if (dir === 'tangent') {
        normal = { x: tangent.x / len, y: tangent.y / len };
      } else if (dir === 'xy') {
        return {
          x: p.x + amp * Math.sin(freq * p.x + speed * time + phase),
          y: p.y + amp * Math.sin(freq * p.y + speed * time + phase * 1.3)
        };
      }
      
      const offset = amp * Math.sin(freq * (p.x + p.y) + speed * time + phase);
      return { x: p.x + normal.x * offset, y: p.y + normal.y * offset };
    });
  }
  
  private applyTurbulentCPU(points: Point[], op: any, time: number): Point[] {
    const amp = op.amplitude || 0.05;
    const freq = op.frequency || 3;
    const speed = op.speed || 0.5;
    const seed = op.seed || 42;
    const octaves = op.octaves || 3;
    
    return points.map(p => {
      let dx = 0, dy = 0;
      for (let o = 0; o < octaves; o++) {
        const f = freq * Math.pow(2, o);
        const a = amp / Math.pow(2, o);
        const nx = p.x * f + time * speed;
        const ny = p.y * f + time * speed * 0.7;
        const n = this.smoothNoiseCPU(nx, ny, seed + o * 100);
        dx += (n - 0.5) * a * 2;
        dy += (n - 0.5) * a * 2;
      }
      return { x: p.x + dx, y: p.y + dy };
    });
  }
  
  private applyTwirlCPU(points: Point[], op: any, time: number): Point[] {
    const center = op.center || { x: 0.5, y: 0.5 };
    const radius = op.falloffRadius || 0.5;
    const angle = op.amplitude || 0.2;
    const speed = op.speed || 0.5;
    
    return points.map(p => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.0001) return p;
      
      const falloff = Math.exp(-dist / radius);
      const theta = angle * falloff * (1 + Math.sin(time * speed));
      const cosA = Math.cos(theta);
      const sinA = Math.sin(theta);
      
      return {
        x: center.x + dx * cosA - dy * sinA,
        y: center.y + dx * sinA + dy * cosA
      };
    });
  }
  
  private smoothNoiseCPU(x: number, y: number, seed: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    const n00 = this.hashCPU(ix * 127.1 + iy * 311.7 + seed);
    const n10 = this.hashCPU((ix + 1) * 127.1 + iy * 311.7 + seed);
    const n01 = this.hashCPU(ix * 127.1 + (iy + 1) * 311.7 + seed);
    const n11 = this.hashCPU((ix + 1) * 127.1 + (iy + 1) * 311.7 + seed);
    
    return n00 * (1 - ux) * (1 - uy) + n10 * ux * (1 - uy) + n01 * (1 - ux) * uy + n11 * ux * uy;
  }
  
  private hashCPU(p: number): number {
    let x = Math.sin(p) * 43758.5453;
    return x - Math.floor(x);
  }
  
  /**
   * 获取GPU纹理（用于调试或直接使用）
   */
  getTexture(): WebGLTexture | null {
    return this.texture;
  }
  
  /**
   * 检查是否初始化
   */
  isReady(): boolean {
    return this.isInitialized;
  }
  
  /**
   * 销毁资源
   */
  dispose(): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    
    if (this.program) gl.deleteProgram(this.program);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.floatTexture) gl.deleteTexture(this.floatTexture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    
    this.program = null;
    this.positionBuffer = null;
    this.indexBuffer = null;
    this.texture = null;
    this.floatTexture = null;
    this.framebuffer = null;
    this.gl = null;
    this.isInitialized = false;
  }
}

// ========== 导出函数：用于兼容旧的 CPU 扭曲接口 ==========

/**
 * 处理单个环的扭曲（CPU版本）
 * @deprecated 使用 GPUMaskProcessor.generateMask 代替
 */
export function processMaskRingCPU(
  ring: Point[],
  maskEffect: any,
  time: number
): Point[] {
  // 使用 GPUMaskProcessor 的 CPU 回退
  const processor = new GPUMaskProcessor();
  // 不需要初始化，直接使用 CPU 路径
  return processor.applyDistortionCPU(ring, maskEffect, time);
}

// 导出单例（可选，用于全局共享GPU处理器）
let gpuProcessorInstance: GPUMaskProcessor | null = null;

export function getGPUMaskProcessor(): GPUMaskProcessor {
  if (!gpuProcessorInstance) {
    gpuProcessorInstance = new GPUMaskProcessor();
    gpuProcessorInstance.init();
  }
  return gpuProcessorInstance;
}
