// verify.mjs —— 重建验收页（正确版）
// 关键经验：① GLB 与 bundle 拆成独立 <script src>（巨型内联脚本会让无头 Chrome 静默白屏）
//           ② 相机距离按**世界尺度**（mesh 节点 ×100）
//           ③ 逻辑与生产代码逐条对齐
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GAME = 'C:/Users/22641/Desktop/架构重置/全新的游戏';
const req = createRequire(path.join(GAME, 'package.json'));
const esbuild = req('esbuild');

// 独立 GLB 数据文件
const glbB64 = fs.readFileSync(path.join(DIR, 'candidate_cubeguy.glb')).toString('base64');
fs.writeFileSync(path.join(DIR, 'glb_data.js'), 'window.GLB_B64="' + glbB64 + '";\n', 'utf8');

const entry = path.join(GAME, '_verify_tmp.ts');
fs.writeFileSync(entry, `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export const T = THREE;
function b64(s: string): ArrayBuffer { const b = atob(s); const u = new Uint8Array(b.length); for (let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u.buffer; }

// ===== 与生产代码同判据 =====
const CG_FACE_Z_TOP = 0.026036;
const CG_EYE_Z0 = 0.0208, CG_EYE_Z1 = 0.0223, CG_EYE_AX0 = 0.0017, CG_EYE_AX1 = 0.0060, CG_EYE_Y_MAX = -0.0040;
const fSign = -1;  // frontAxis '-y'

export function stripAndRemap(geo: THREE.BufferGeometry, FR: any) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv  = geo.getAttribute('uv') as THREE.BufferAttribute;
  const getF = (i:number)=>pos.getY(i), getU=(i:number)=>pos.getZ(i), getL=(i:number)=>pos.getX(i);
  const EPS = 1e-5;
  // 最靠前层 = proj 最大
  let projMax = -Infinity;
  for (let i=0;i<pos.count;i++){ const p=getF(i)*fSign; if(p>projMax)projMax=p; }
  const face: number[] = [];
  for (let i=0;i<pos.count;i++) if (projMax - getF(i)*fSign <= EPS) face.push(i);

  // 自检（法线朝前）
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  let fwd=0,bwd=0;
  for (const i of face){ const n=nrm.getY(i)*fSign; if(n>0.5)fwd++; else if(n<-0.5)bwd++; }

  // UV 重映射
  let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity;
  for (const i of face){ l0=Math.min(l0,getL(i));l1=Math.max(l1,getL(i));u0=Math.min(u0,getU(i));u1=Math.max(u1,getU(i)); }
  const lw=Math.max(1e-6,l1-l0), uh=Math.max(1e-6,u1-u0), PAD=0.5/32;
  const pu=FR.u0+PAD,pu1=FR.u1-PAD,pv=FR.v0+PAD,pv1=FR.v1-PAD;
  for (const i of face){ const tl=(getL(i)-l0)/lw, tu=(getU(i)-u0)/uh;
    uv.setXY(i, pu+tl*(pu1-pu), pv+(1-tu)*(pv1-pv)); }
  uv.needsUpdate = true;

  // 削浮雕
  const idx = geo.getIndex()!;
  const eyeProjMin = CG_EYE_Y_MAX * fSign;
  const isEye=(i:number)=>{ const u=getU(i),ax=Math.abs(getL(i)),p=getF(i)*fSign;
    if(u<CG_EYE_Z0||u>CG_EYE_Z1)return false; if(ax<CG_EYE_AX0||ax>CG_EYE_AX1)return false;
    if(p>=projMax-EPS)return false; if(p<eyeProjMin)return false; return true; };
  const isHair=(i:number)=>getU(i)>=CG_FACE_Z_TOP-1e-4;
  const old=idx.array, nw:number[]=[]; let hair=0,eye=0;
  for(let t=0;t<old.length;t+=3){ const a=old[t],b=old[t+1],c=old[t+2];
    if(isHair(a)&&isHair(b)&&isHair(c)){hair++;continue;}
    if(isEye(a)&&isEye(b)&&isEye(c)){eye++;continue;} nw.push(a,b,c); }
  geo.setIndex(nw);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return { faceCount: face.length, projMax, fwd, bwd, hair, eye,
           total: old.length/3, left: nw.length/3 };
}

export async function boot(b64s: string) {
  const gltf = await new GLTFLoader().parseAsync(b64(b64s), '');
  let sm: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o)=>{const s=o as THREE.SkinnedMesh; if(s.isSkinnedMesh&&!sm)sm=s;});
  return { src: gltf.scene, sm: sm! };
}
`);
let js = '';
try {
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', globalName: 'V', platform: 'browser', target: 'es2020', write: false, absWorkingDir: GAME });
  js = r.outputFiles[0].text;
} catch (e) { console.error(e); process.exit(1); }
fs.writeFileSync(path.join(DIR, 'verify_bundle.js'), js, 'utf8');

const CAP = (t) => `<div class="cap">${t}</div>`;
const PANEL = (id, t) => `<div class="panel">${CAP(t)}<canvas id="${id}"></canvas></div>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#dfe4ea;font:12px ui-monospace,monospace;color:#111}
#grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}
.panel{background:#fff;border:1px solid #b9c2cf;border-radius:6px;overflow:hidden}
.cap{padding:5px 8px;font-weight:700;background:#f2f5f9;border-bottom:1px solid #dde3ea}
canvas{display:block;width:100%}
#log{position:fixed;right:8px;top:8px;background:#fff8e1;border:1px solid #e0b800;border-radius:6px;padding:8px;white-space:pre;font-size:11px;z-index:9;max-width:440px}
</style></head><body>
<div id="log">init</div>
<div id="grid">
  ${PANEL('c0','① 原样 · 正脸方向（脸朝相机）')}
  ${PANEL('c1','② 削浮雕+重映射 · 正脸')}
  ${PANEL('c2','③ 原样 · 侧面')}
  ${PANEL('c3','④ 削浮雕+重映射 · 侧面（耳朵应保留）')}
</div>
<script src="glb_data.js"></script>
<script src="verify_bundle.js"></script>
<script>
window.onerror = (m,u,l,c,e)=>{ document.getElementById('log').textContent='ONERR '+m+' @'+l+'\\n'+(e&&e.stack||''); };
window.addEventListener('unhandledrejection', ev=>{ document.getElementById('log').textContent='REJECT '+(ev.reason&&ev.reason.stack||ev.reason); });
(async () => {
  const L = document.getElementById('log');
  try {
    const { src, sm } = await V.boot(window.GLB_B64);
    const THREE = V.T;
    const pos = sm.geometry.getAttribute('position');

    // 原样几何（克隆）与 削后几何
    const origGeo = sm.geometry.clone();
    const stripGeo = sm.geometry.clone();
    const st = V.stripAndRemap(stripGeo, { u0:0/32, u1:6/32, v0:23/32, v1:1 });
    L.textContent = '脸层顶点 ' + st.faceCount + '（法线朝前 ' + st.fwd + ' / 朝后 ' + st.bwd + '）'
      + '\\n' + (st.fwd > st.bwd ? '✔ 选中正脸' : '✘ 选中后脑，逻辑又反了')
      + '\\n删头发 ' + st.hair + ' 面 + 眼睛 ' + st.eye + ' 面'
      + ' → 剩 ' + st.left + '/' + st.total;

    // 贴图：底图 + 脸图区画立绘（用高对比色块，便于肉眼确认落点）
    const S = 512;
    const cv = document.createElement('canvas'); cv.width=S; cv.height=S;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(sm.material.map.image, 0, 0, S, S);
    cx.imageSmoothingEnabled = true;
    const x0=0, x1=6/32*S, y0=23/32*S, y1=S;
    cx.fillStyle='#ffd9b3'; cx.fillRect(x0,y0,x1-x0,y1-y0);
    // 明显的五官记号：两只青眼 + 红嘴
    cx.fillStyle='#0aa'; cx.fillRect(x0+(x1-x0)*0.14, y0+(y1-y0)*0.26, (x1-x0)*0.20, (y1-y0)*0.12);
    cx.fillRect(x0+(x1-x0)*0.64, y0+(y1-y0)*0.26, (x1-x0)*0.20, (y1-y0)*0.12);
    cx.fillStyle='#c33'; cx.fillRect(x0+(x1-x0)*0.32, y0+(y1-y0)*0.62, (x1-x0)*0.36, (y1-y0)*0.10);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;

    const W = 430, H = 620;
    const renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.setSize(W,H); renderer.setPixelRatio(2);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ★ 世界尺度取景：整体包围盒
    const whole = new THREE.Box3().setFromObject(src);
    const wholeSize = whole.getSize(new THREE.Vector3());
    const DIST = Math.max(wholeSize.x, wholeSize.y, wholeSize.z) * 3.0;
    // 相机在"正脸方向"：局部 -y → 世界 +Z（模型节点自身矩阵已含该旋转）
    const wq = sm.getWorldQuaternion(new THREE.Quaternion());
    const fDir  = new THREE.Vector3(0,-1,0).applyQuaternion(wq).normalize();  // 世界：脸朝向
    const rDir  = new THREE.Vector3(1, 0,0).applyQuaternion(wq).normalize();  // 世界：+x
    const center = whole.getCenter(new THREE.Vector3());
    center.copy(new THREE.Box3(new THREE.Vector3(-0.0073,-0.0058,0.0149), new THREE.Vector3(0.0068,0.0058,0.0284)).applyMatrix4(sm.matrixWorld).getCenter(new THREE.Vector3()));

    const shots = [
      { geo: origGeo,  dir: fDir,  up: new THREE.Vector3(0,1,0) },
      { geo: stripGeo, dir: fDir,  up: new THREE.Vector3(0,1,0) },
      { geo: origGeo,  dir: rDir,  up: new THREE.Vector3(0,1,0) },
      { geo: stripGeo, dir: rDir,  up: new THREE.Vector3(0,1,0) },
    ];

    for (let i=0;i<shots.length;i++) {
      const sc = new THREE.Scene();
      sc.background = new THREE.Color('#eef1f5');
      sc.add(new THREE.HemisphereLight(0xffffff, 0x909098, 2.6));
      const l1=new THREE.DirectionalLight(0xffffff,2.3); l1.position.set(2,3,2); sc.add(l1);
      const l2=new THREE.DirectionalLight(0xffffff,1.3); l2.position.set(-2,1,-3); sc.add(l2);
      const l3=new THREE.DirectionalLight(0xffffff,0.9); l3.position.set(0,-3,0); sc.add(l3);
      const clone = src.clone(true);
      let csm=null;
      clone.traverse(o=>{ const k=o; if(k.isSkinnedMesh&&!csm) csm=k; });
      csm.geometry = shots[i].geo;
      csm.material = new THREE.MeshToonMaterial({ map: tex, side: THREE.DoubleSide });
      csm.frustumCulled = false;
      sc.add(clone);
      sc.updateMatrixWorld(true);
      const cam = new THREE.PerspectiveCamera(30, W/H, 0.001, 200);
      cam.position.copy(center).addScaledVector(shots[i].dir, DIST);
      cam.up.copy(shots[i].up);
      cam.lookAt(center);
      renderer.render(sc, cam);
      const out = document.getElementById('c'+i);
      out.width=W; out.height=H;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0);
    }
    L.textContent += '\\n渲染完成';
    window.__done = true;
  } catch(e) {
    L.textContent = 'ERR ' + (e && e.stack || e);
    window.__err = String(e);
  }
})();
</script></body></html>`;
fs.writeFileSync(path.join(DIR, 'verify.html'), html, 'utf8');
try { fs.unlinkSync(entry); } catch {}
console.log('OK verify.html', html.length);
