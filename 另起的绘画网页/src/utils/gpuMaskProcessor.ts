import type { Point } from '../types';

// WebGL 着色器代码
const VERTEX_SHADER_SOURCE = `
precision highp float;

attribute vec2 aVertexPosition;
attribute float aVertexIndex;

uniform float uTime;
uniform vec2 uResolution;

// 变换参数
uniform vec2 uTransformPosition;
uniform vec2 uTransformAnchor;
uniform float uTransformRotation;
uniform vec2 uTransformScale;

// 扭曲参数数组（最多支持8个扭曲效果）
uniform int uDistortionCount;
uniform int uDistortionTypes[8];      // 0: wave, 1: turbulent, 2: twirl
uniform bool uDistortionEnabled[8];
uniform float uDistortionAmplitude[8];
uniform float uDistortionFrequency[8];
uniform float uDistortionSpeed[8];
uniform float uDistortionPhase[8];
uniform int uDistortionDirection[8];  // 0: normal, 1: tangent, 2: xy
uniform vec2 uDistortionCenter[8];
uniform float uDistortionFalloffRadius[8];
uniform float uDistortionSeed[8];
uniform int uDistortionOctaves[8];

// 顶点索引和总数（用于切线计算）
uniform int uVertexCount;
uniform vec2 uPrevVertex;
uniform vec2 uNextVertex;

varying float vPhi;

// 伪随机噪声
float hash(float p) {
  float x = sin(p) * 43758.5453;
  return x - floor(x);
}

float smoothNoise(float x, float y, float seed) {
  float ix = floor(x);
  float iy = floor(y);
  float fx = x - ix;
  float fy = y - iy;
  float ux = fx * fx * (3.0 - 2.0 * fx);
  float uy = fy * fy * (3.0 - 2.0 * fy);
  float n00 = hash(ix * 127.1 + iy * 311.7 + seed);
  float n10 = hash((ix + 1.0) * 127.1 + iy * 311.7 + seed);
  float n01 = hash(ix * 127.1 + (iy + 1.0) * 311.7 + seed);
  float n11 = hash((ix + 1.0) * 127.1 + (iy + 1.0) * 311.7 + seed);
  return n00 * (1.0 - ux) * (1.0 - uy) + n10 * ux * (1.0 - uy) + n01 * (1.0 - ux) * uy + n11 * ux * uy;
}

void main() {
  vec2 pos = aVertexPosition;
  
  // 应用变换
  vec2 anchor = uTransformAnchor;
  vec2 p = pos - anchor;
  
  // 旋转
  float cosR = cos(uTransformRotation);
  float sinR = sin(uTransformRotation);
  vec2 rotated = vec2(p.x * cosR - p.y * sinR, p.x * sinR + p.y * cosR);
  
  // 缩放和位移
  vec2 transformed = rotated * uTransformScale + uTransformPosition + anchor;
  
  // 应用扭曲链
  vec2 distorted = transformed;
  
  for (int i = 0; i < 8; i++) {
    if (i >= uDistortionCount) break;
    if (!uDistortionEnabled[i]) continue;
    
    int type = uDistortionTypes[i];
    float amp = uDistortionAmplitude[i];
    float freq = uDistortionFrequency[i];
    float speed = uDistortionSpeed[i];
    float phase = uDistortionPhase[i];
    float t = uTime * speed + phase;
    
    if (type == 0) {
      // Wave 扭曲
      int dir = uDistortionDirection[i];
      float offset = amp * sin(freq * (distorted.x + distorted.y) + t);
      
      if (dir == 0) {
        // normal 方向
        vec2 tangent = uNextVertex - uPrevVertex;
        float len = length(tangent);
        if (len > 0.0001) {
          vec2 normal = normalize(vec2(-tangent.y, tangent.x));
          distorted += normal * offset;
        }
      } else if (dir == 1) {
        // tangent 方向
        vec2 tangent = uNextVertex - uPrevVertex;
        float len = length(tangent);
        if (len > 0.0001) {
          vec2 tangentUnit = tangent / len;
          distorted += tangentUnit * offset;
        }
      } else {
        // xy 方向
        distorted.x += amp * sin(freq * distorted.x + t);
        distorted.y += amp * sin(freq * distorted.y + t * 1.3);
      }
    } else if (type == 1) {
      // Turbulent 扭曲
      float seed = uDistortionSeed[i];
      int octaves = uDistortionOctaves[i];
      vec2 noiseOffset = vec2(0.0);
      
      for (int o = 0; o < octaves; o++) {
        float f = freq * pow(2.0, float(o));
        float a = amp / pow(2.0, float(o));
        float nx = distorted.x * f + uTime * speed;
        float ny = distorted.y * f + uTime * speed * 0.7;
        float n = smoothNoise(nx, ny, seed + float(o) * 100.0);
        noiseOffset.x += (n - 0.5) * a * 2.0;
        noiseOffset.y += (n - 0.5) * a * 2.0;
      }
      distorted += noiseOffset;
    } else if (type == 2) {
      // Twirl 扭曲
      vec2 center = uDistortionCenter[i];
      float radius = uDistortionFalloffRadius[i];
      float angle = amp;
      
      vec2 delta = distorted - center;
      float dist = length(delta);
      if (dist > 0.0001) {
        float falloff = exp(-dist / radius);
        float theta = angle * falloff * (1.0 + sin(t));
        float cosA = cos(theta);
        float sinA = sin(theta);
        vec2 rotated = vec2(
          delta.x * cosA - delta.y * sinA,
          delta.x * sinA + delta.y * cosA
        );
        distorted = center + rotated;
      }
    }
  }
  
  // 转换为裁剪空间坐标
  vec2 clipPos = (distorted / uResolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y; // Y轴翻转
  
  gl_Position = vec4(clipPos, 0.0, 1.0);
  vPhi = -1.0; // 标记为内部点
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying float vPhi;

void main() {
  // 内部像素输出 phi = -1.0，外部被硬件光栅化器自动丢弃
  gl_FragColor = vec4(vPhi, 0.0, 0.0, 1.0);
}
`;

// GPU蒙版处理器类
export class GPUMaskProcessor {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  
  private resolution: number = 512;
  
  constructor() {}
  
  // 初始化WebGL上下文
  init(canvas?: HTMLCanvasElement): boolean {
    const targetCanvas = canvas || document.createElement('canvas');
    const gl = targetCanvas.getContext('webgl');
    
    if (!gl) {
      console.error('WebGL is not supported');
      return false;
    }
    
    this.gl = gl;
    this.resolution = 512;
    targetCanvas.width = this.resolution;
    targetCanvas.height = this.resolution;
    
    // 创建着色器程序
    this.program = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!this.program) {
      return false;
    }
    
    // 创建帧缓冲和纹理
    this.createFramebuffer();
    
    return true;
  }
  
  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl!;
    
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      return null;
    }
    
    const program = gl.createProgram();
    if (!program) {
      return null;
    }
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }
  
  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    
    if (!shader) {
      return null;
    }
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  private createFramebuffer(): void {
    const gl = this.gl!;
    
    // 创建纹理
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
    
    // 检查帧缓冲状态
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Framebuffer not complete:', status);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  
  // 计算多边形重心
  private getCentroid(points: Point[]): Point {
    let cx = 0, cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    return { x: cx / points.length, y: cy / points.length };
  }
  
  // 生成掩码纹理（使用硬件光栅化）
  generateMask(
    polygon: Point[][],
    maskEffect: any,
    time: number
  ): Float32Array | null {
    if (!this.gl || !this.program) {
      console.error('GPU Mask Processor not initialized');
      return null;
    }
    
    const gl = this.gl;
    
    // 绑定帧缓冲
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    
    // 设置视口
    gl.viewport(0, 0, this.resolution, this.resolution);
    
    // 使用程序
    gl.useProgram(this.program);
    
    // 清空缓冲区（外部区域设为 phi = 1.0）
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // 启用混合（用于处理孔洞）
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ZERO);
    
    // 对每个环进行绘制
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
      const ring = polygon[ringIndex];
      if (ring.length < 3) continue;
      
      // 应用扭曲效果
      const distortedRing = this.applyDistortion(ring, maskEffect, time);
      
      // 创建顶点数据
      const vertices = new Float32Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        const p = distortedRing[i];
        vertices[i * 2] = p.x * this.resolution;
        vertices[i * 2 + 1] = p.y * this.resolution;
      }
      
      // 创建索引（TRIANGLE_FAN）
      const indices = new Uint16Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        indices[i] = i;
      }
      
      // 创建顶点缓冲区
      if (!this.vertexBuffer) {
        this.vertexBuffer = gl.createBuffer();
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      
      // 创建索引缓冲区
      if (!this.indexBuffer) {
        this.indexBuffer = gl.createBuffer();
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      
      // 设置顶点属性
      const aVertexPosition = gl.getAttribLocation(this.program, 'aVertexPosition');
      gl.enableVertexAttribArray(aVertexPosition);
      gl.vertexAttribPointer(aVertexPosition, 2, gl.FLOAT, false, 0, 0);
      
      // 设置uniforms
      this.setUniforms(ring, distortedRing, maskEffect, time);
      
      // 绘制：外环使用默认混合（覆盖），内环使用反向混合（擦除）
      if (ringIndex === 0) {
        // 外环：绘制 phi = -1.0
        gl.blendFunc(gl.ONE, gl.ZERO);
        gl.drawElements(gl.TRIANGLE_FAN, ring.length, gl.UNSIGNED_SHORT, 0);
      } else {
        // 内环：用 phi = 1.0 覆盖，形成孔洞
        gl.blendFunc(gl.ONE, gl.ZERO);
        gl.drawElements(gl.TRIANGLE_FAN, ring.length, gl.UNSIGNED_SHORT, 0);
      }
    }
    
    // 读取结果
    const result = new Float32Array(this.resolution * this.resolution * 4);
    gl.readPixels(0, 0, this.resolution, this.resolution, gl.RGBA, gl.FLOAT, result);
    
    // 解绑
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    
    return result;
  }
  
  // CPU端预计算扭曲（用于不支持WebGL的环境或调试）
  applyDistortion(points: Point[], maskEffect: any, time: number): Point[] {
    if (!maskEffect || !maskEffect.enabled) {
      return points.slice();
    }
    
    let pts = points.slice();
    
    // 应用变换
    if (maskEffect.transform) {
      const transform = maskEffect.transform;
      const anchor = transform.anchor || this.getCentroid(points);
      const pos = transform.position || { x: 0, y: 0 };
      const rotation = transform.rotation || 0;
      const scale = transform.scale || { x: 1, y: 1 };
      
      pts = pts.map(p => {
        let x = p.x - anchor.x;
        let y = p.y - anchor.y;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        const sx = rx * scale.x + pos.x + anchor.x;
        const sy = ry * scale.y + pos.y + anchor.y;
        return { x: sx, y: sy };
      });
    }
    
    // 应用扭曲链
    if (maskEffect.distortions) {
      for (const op of maskEffect.distortions) {
        if (!op.enabled) continue;
        
        switch (op.type) {
          case 'wave':
            pts = this.applyWave(pts, op, time);
            break;
          case 'turbulent':
            pts = this.applyTurbulent(pts, op, time);
            break;
          case 'twirl':
            pts = this.applyTwirl(pts, op, time);
            break;
        }
      }
    }
    
    return pts;
  }
  
  private applyWave(points: Point[], op: any, time: number): Point[] {
    const dir = op.direction || 'normal';
    const freq = op.frequency || 1;
    const amp = op.amplitude || 0.05;
    const speed = op.speed || 1;
    const phase = op.phase || 0;
    
    if (dir === 'normal') {
      const n = points.length;
      return points.map((p, i) => {
        const prev = points[(i - 1 + n) % n];
        const next = points[(i + 1) % n];
        const tangent = { x: next.x - prev.x, y: next.y - prev.y };
        const len = Math.hypot(tangent.x, tangent.y);
        if (len < 1e-6) return p;
        const normal = { x: -tangent.y / len, y: tangent.x / len };
        const offset = amp * Math.sin(freq * (p.x + p.y) + speed * time + phase);
        return { x: p.x + normal.x * offset, y: p.y + normal.y * offset };
      });
    } else if (dir === 'tangent') {
      const n = points.length;
      return points.map((p, i) => {
        const prev = points[(i - 1 + n) % n];
        const next = points[(i + 1) % n];
        const tangent = { x: next.x - prev.x, y: next.y - prev.y };
        const len = Math.hypot(tangent.x, tangent.y);
        if (len < 1e-6) return p;
        const tangentUnit = { x: tangent.x / len, y: tangent.y / len };
        const offset = amp * Math.sin(freq * (p.x + p.y) + speed * time + phase);
        return { x: p.x + tangentUnit.x * offset, y: p.y + tangentUnit.y * offset };
      });
    } else {
      return points.map(p => ({
        x: p.x + amp * Math.sin(freq * p.x + speed * time + phase),
        y: p.y + amp * Math.sin(freq * p.y + speed * time + phase * 1.3)
      }));
    }
  }
  
  private applyTurbulent(points: Point[], op: any, time: number): Point[] {
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
        const n = this.smoothNoise(nx, ny, seed + o * 100);
        dx += (n - 0.5) * a * 2;
        dy += (n - 0.5) * a * 2;
      }
      return { x: p.x + dx, y: p.y + dy };
    });
  }
  
  private applyTwirl(points: Point[], op: any, time: number): Point[] {
    const center = op.center || { x: 0.5, y: 0.5 };
    const radius = op.falloffRadius || 0.5;
    const angle = op.amplitude || 0.2;
    const speed = op.speed || 0.5;
    
    return points.map(p => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) return p;
      const falloff = Math.exp(-dist / radius);
      const theta = angle * falloff * (1 + Math.sin(time * speed));
      const cosA = Math.cos(theta);
      const sinA = Math.sin(theta);
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;
      return { x: center.x + rx, y: center.y + ry };
    });
  }
  
  private smoothNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const n00 = this.hash(ix * 127.1 + iy * 311.7 + seed);
    const n10 = this.hash((ix + 1) * 127.1 + iy * 311.7 + seed);
    const n01 = this.hash(ix * 127.1 + (iy + 1) * 311.7 + seed);
    const n11 = this.hash((ix + 1) * 127.1 + (iy + 1) * 311.7 + seed);
    return n00 * (1 - ux) * (1 - uy) + n10 * ux * (1 - uy) + n01 * (1 - ux) * uy + n11 * ux * uy;
  }
  
  private hash(p: number): number {
    let x = Math.sin(p) * 43758.5453;
    return x - Math.floor(x);
  }
  
  private setUniforms(ring: Point[], distortedRing: Point[], maskEffect: any, time: number): void {
    if (!this.gl || !this.program) return;
    
    const gl = this.gl;
    
    // 设置时间
    gl.uniform1f(gl.getUniformLocation(this.program, 'uTime'), time);
    
    // 设置分辨率
    gl.uniform2f(gl.getUniformLocation(this.program, 'uResolution'), this.resolution, this.resolution);
    
    // 设置变换参数
    const transform = maskEffect?.transform || {};
    const anchor = transform.anchor || this.getCentroid(ring);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTransformPosition'), 
      (transform.position?.x || 0) * this.resolution, 
      (transform.position?.y || 0) * this.resolution
    );
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTransformAnchor'), 
      anchor.x * this.resolution, 
      anchor.y * this.resolution
    );
    gl.uniform1f(gl.getUniformLocation(this.program, 'uTransformRotation'), transform.rotation || 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTransformScale'), 
      transform.scale?.x || 1, 
      transform.scale?.y || 1
    );
    
    // 设置顶点信息（用于切线计算）
    gl.uniform1i(gl.getUniformLocation(this.program, 'uVertexCount'), ring.length);
    
    // 设置扭曲参数
    const distortions = maskEffect?.distortions || [];
    gl.uniform1i(gl.getUniformLocation(this.program, 'uDistortionCount'), distortions.length);
    
    for (let i = 0; i < Math.min(distortions.length, 8); i++) {
      const op = distortions[i];
      const type = op.type === 'wave' ? 0 : op.type === 'turbulent' ? 1 : 2;
      const dir = op.direction === 'normal' ? 0 : op.direction === 'tangent' ? 1 : 2;
      
      gl.uniform1iv(gl.getUniformLocation(this.program, 'uDistortionTypes'), [type]);
      gl.uniform1iv(gl.getUniformLocation(this.program, 'uDistortionEnabled'), [op.enabled ? 1 : 0]);
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionAmplitude'), [op.amplitude || 0.05]);
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionFrequency'), [op.frequency || 1]);
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionSpeed'), [op.speed || 1]);
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionPhase'), [op.phase || 0]);
      gl.uniform1iv(gl.getUniformLocation(this.program, 'uDistortionDirection'), [dir]);
      gl.uniform2fv(gl.getUniformLocation(this.program, 'uDistortionCenter'), 
        [(op.center?.x || 0.5) * this.resolution, (op.center?.y || 0.5) * this.resolution]
      );
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionFalloffRadius'), [op.falloffRadius || 0.5]);
      gl.uniform1fv(gl.getUniformLocation(this.program, 'uDistortionSeed'), [op.seed || 42]);
      gl.uniform1iv(gl.getUniformLocation(this.program, 'uDistortionOctaves'), [op.octaves || 3]);
    }
  }
  
  // 销毁资源
  dispose(): void {
    if (!this.gl) return;
    
    const gl = this.gl;
    
    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }
    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer);
      this.indexBuffer = null;
    }
    if (this.texture) {
      gl.deleteTexture(this.texture);
      this.texture = null;
    }
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    
    this.gl = null;
  }
}

// 全局单例实例
let _instance: GPUMaskProcessor | null = null;

export function getGPUMaskProcessor(): GPUMaskProcessor {
  if (!_instance) {
    _instance = new GPUMaskProcessor();
    _instance.init();
  }
  return _instance;
}

// CPU回退版本（当WebGL不可用时）
export function processMaskRingCPU(
  baseRing: Point[],
  maskEffect: any,
  time: number
): Point[] {
  const processor = new GPUMaskProcessor();
  return processor.applyDistortion(baseRing, maskEffect, time);
}