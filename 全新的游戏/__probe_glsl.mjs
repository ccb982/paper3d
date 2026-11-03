// 临时离屏探针：★ 自动抓 GLSL 编译错误（headless Edge + puppeteer-core）—— 跑完即删
// 用法：node __probe_glsl.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// ① 打一个最小页面：创建 renderer + 水材质 + 一个面 ⇒ 触发 shader 编译
const entry = path.join(ROOT, '__glsl_check_entry.ts');
fs.writeFileSync(entry, `
import * as THREE from 'three';
import { sharedWaterMaterial } from './src/services/map/WaterMaterial';
export function boot(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(64, 64, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 2, 3);
  cam.lookAt(0, 0, 0);
  const geo = new THREE.PlaneGeometry(4, 4, 2, 2);
  // 给 water 材质必需的属性
  const g = geo as any;
  g.setAttribute('deep', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1.0), 1));
  g.setAttribute('border', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1));
  g.setAttribute('spin', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  const mesh = new THREE.Mesh(g, sharedWaterMaterial);
  scene.add(mesh);
  renderer.render(scene, cam);
  // 读像素：统计非黑像素比例 ⇒ 水是否真的画出来了
  const gl = renderer.getContext();
  const px = new Uint8Array(64 * 64 * 4);
  gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nonBlack = 0, maxCh = 0;
  for (let i = 0; i < px.length; i += 4) {
    const m = Math.max(px[i], px[i + 1], px[i + 2]);
    if (m > 8) nonBlack++;
    if (m > maxCh) maxCh = m;
  }
  return { nonBlack, total: 64 * 64, maxCh };
}
`);

const outfile = path.join(ROOT, '__glsl_check_bundle.js');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: 'GLslCheck',
  outfile,
  logLevel: 'warning',
});

const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><canvas id="c" width="64" height="64"></canvas>
<script src="./__glsl_check_bundle.js"></script></body></html>`;
fs.writeFileSync(path.join(ROOT, '__glsl_check.html'), html);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    '--allow-file-access-from-files',
    '--no-sandbox',
  ],
});

const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('file:///' + path.join(ROOT, '__glsl_check.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  const ok = await page.evaluate(() => {
    try { return GLslCheck.boot(document.getElementById('c')); }
    catch (e) { return 'THREW: ' + e.message; }
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('boot result:', ok);
} catch (e) {
  console.log('LAUNCH ERROR:', e.message);
} finally {
  await browser.close();
}

const shaderErrors = logs.filter((l) => /shader|GLSL|ERROR|error:|not defined|redefin|undeclared/i.test(l));
console.log('--- console (' + logs.length + ' lines) ---');
for (const l of logs.slice(0, 40)) console.log(' ', l.slice(0, 400));

let fails = 0;
if (shaderErrors.length) {
  fails++;
  console.log('\n★★ 发现 ' + shaderErrors.length + ' 条着色器相关错误');
} else {
  console.log('\n★ 无着色器编译错误');
}

// 清理
for (const f of [entry, outfile, path.join(ROOT, '__glsl_check.html')]) {
  try { fs.unlinkSync(f); } catch {}
}
process.exit(fails ? 1 : 0);
