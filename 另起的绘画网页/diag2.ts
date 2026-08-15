// 诊断 2：验证"导入参数后突变"是否由 sRGB 色彩管理/显示路径差异造成
// 核心对比：同一份像素数据，经两条路径渲染到主 framebuffer 后读回
//   A: DataTexture（模拟 staticColorTex / boundBaseTexture 创建方式）
//   B: WebGLRenderTarget（模拟 compositeTarget / FluidSolver 输出方式）
// 若 A≠B → 显示路径色彩管理差异 = 用户看到的"突变"（即便 composite 数据与烘焙帧一致）
import * as THREE from 'three';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

// 构造测试数据：渐变 + 锐利色块（模拟子弹红蓝黑渐变）
const W = 128, H = 128;
const src = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    // 色相渐变：红→黄→绿→青→蓝→紫 + 亮度渐变
    const h = (x / W) % 1;
    const l = 0.2 + 0.6 * (y / H);
    const [r, g, b] = hsl2rgb(h, 1.0, l);
    src[i] = r; src[i + 1] = g; src[i + 2] = b; src[i + 3] = 255;
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FS = `uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uTex, vUv); }`;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
scene.add(quad);

function renderToScreen(tex: THREE.Texture) {
  const mat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: tex } }, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false });
  quad.material = mat;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(null, 0, 0, W, H, px);
  return px;
}

function compare(name: string, px: Uint8Array, flip: boolean) {
  let diff = 0, max = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const j = (flip ? (H - 1 - y) * W + x : y * W + x) * 4;
      const d = Math.abs(src[i] - px[j]) + Math.abs(src[i + 1] - px[j + 1]) + Math.abs(src[i + 2] - px[j + 2]);
      if (d > 2) diff++;
      max = Math.max(max, d);
    }
  }
  log(`${name}: 差异>2=${diff}/${W * H} (${(diff / (W * H) * 100).toFixed(1)}%), 最大=${max.toFixed(1)}`);
}

function compareAB(name: string, pa: Uint8Array, pb: Uint8Array) {
  let diff = 0, max = 0;
  for (let i = 0; i < W * H * 4; i++) {
    const d = Math.abs(pa[i] - pb[i]);
    if (d > 2) diff++;
    max = Math.max(max, d);
  }
  log(`${name}: 差异>2=${diff}/${W * H} (${(diff / (W * H) * 100).toFixed(1)}%), 最大=${max.toFixed(1)}`);
}

// ===== 场景 1：renderer 默认（outputColorSpace=SRGB，主页面大概率同款） =====
log(`renderer.outputColorSpace = ${renderer.outputColorSpace}`);
log(`渲染器：WebGL${renderer.capabilities.isWebGL2 ? 2 : 1}\n`);

// 路径 A：DataTexture，同 boundBaseTexture 创建方式（RGBA8, NoColorSpace, flipY=false）
const texA = new THREE.DataTexture(new Uint8Array(src), W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
texA.flipY = false;
texA.needsUpdate = true;
texA.minFilter = THREE.LinearFilter;
texA.magFilter = THREE.LinearFilter;
const pxA = renderToScreen(texA);
compare('[A] DataTexture(同 boundBaseTexture) 渲染 → 屏幕读回 vs 原始', pxA, false);

// 路径 B：RT 纹理（同 compositeTarget：WebGLRenderTarget 无 colorSpace 设置）
const rtB = new THREE.WebGLRenderTarget(W, H, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
const pxB = renderToScreen(rtB.texture);
compare('[B] RT(同 compositeTarget) 渲染 → 屏幕读回 vs 原始', pxB, false);

// ★ 核心对比：A vs B（同数据经不同纹理类型渲染到屏幕的显示差异）
compareAB('[核心] A(DataTexture) vs B(RT) 屏幕显示逐像素对比', pxA, pxB);

// 路径 B2：RT 内先写入内容再读
const matCopy = new THREE.ShaderMaterial({ uniforms: { uTex: { value: texA } }, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false });
quad.material = matCopy;
renderer.setRenderTarget(rtB);
renderer.clear();
renderer.render(scene, cam);
renderer.setRenderTarget(null);
const pxB2 = renderToScreen(rtB.texture);
compare('[B2] RT写入后再渲染 → 屏幕读回 vs 原始', pxB2, false);

// ===== 场景 2：renderer.outputColorSpace = LinearSRGBColorSpace =====
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const pxA2 = renderToScreen(texA);
compare('[A线性] outputColorSpace=Linear 时 DataTexture vs 原始', pxA2, false);
const pxB3 = renderToScreen(rtB.texture);
compare('[B线性] outputColorSpace=Linear 时 RT vs 原始', pxB3, false);

log(`\n[结论] 若 A 与 B 显示一致 → 显示路径无色彩管理差异，突变另有原因`);
log(`[结论] 若 A≠B → sRGB 编码差异确为突变来源（static 与 composite 显示不一致）`);
log(`[样本] 原始(64,64)=${src[(64 * W + 64) * 4]},${src[(64 * W + 64) * 4 + 1]},${src[(64 * W + 64) * 4 + 2]}`);
log(`[样本] A 显示(64,64)=${pxA[(64 * W + 64) * 4]},${pxA[(64 * W + 64) * 4 + 1]},${pxA[(64 * W + 64) * 4 + 2]}`);
log(`[样本] B 显示(64,64)=${pxB[(64 * W + 64) * 4]},${pxB[(64 * W + 64) * 4 + 1]},${pxB[(64 * W + 64) * 4 + 2]}`);

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
