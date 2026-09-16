// layers.mjs —— 头部 y 分层着色诊断页
// 目的：一眼分清「脸面层 / 前脸片 / 眼睛浮雕 / 头发 / 耳朵 / 后脑」
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GAME = 'C:/Users/22641/Desktop/架构重置/全新的游戏';
const req = createRequire(path.join(GAME, 'package.json'));
const esbuild = req('esbuild');

const glbB64 = fs.readFileSync(path.join(DIR, 'candidate_cubeguy.glb')).toString('base64');
fs.writeFileSync(path.join(DIR, 'glb_data.js'), 'window.GLB_B64="' + glbB64 + '";\n', 'utf8');

const entry = path.join(GAME, '_layers_tmp.ts');
fs.writeFileSync(entry, `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export const T = THREE;
function b64(s: string): ArrayBuffer { const b = atob(s); const u = new Uint8Array(b.length); for (let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u.buffer; }

export async function boot(b64s: string) {
  const gltf = await new GLTFLoader().parseAsync(b64(b64s), '');
  let sm: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o)=>{const s=o as THREE.SkinnedMesh; if(s.isSkinnedMesh&&!sm)sm=s;});
  return { src: gltf.scene, sm: sm! };
}

// 逐顶点着色：按判定给颜色
export function colorize(geo: THREE.BufferGeometry, mode: string) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n*3);
  const set=(i:number,r:number,g:number,b:number)=>{col[i*3]=r;col[i*3+1]=g;col[i*3+2]=b;};
  const fSign=-1;
  let projMax=-Infinity;
  for(let i=0;i<n;i++){const p=pos.getY(i)*fSign; if(p>projMax)projMax=p;}
  const EPS=1e-5;
  let stat:any={};
  for(let i=0;i<n;i++){
    const y=pos.getY(i), z=pos.getZ(i), x=pos.getX(i), ny=nrm.getY(i)*fSign;
    const proj=y*fSign;
    const isFrontLayer = projMax-proj<=EPS;
    const isFrontFacing = ny>0.5;
    const isBackFacing = ny<-0.5;
    if (mode==='ylayer') {
      // 按 y 值染色：前=红，后=蓝
      const t=(y+0.005707)/0.011414; // 0..1
      set(i, 1-t*0.8, 1-Math.abs(t-0.5)*1.4, t*0.9);
    } else if (mode==='facejudge') {
      // 模拟生产判据
      const isEye = z>=0.0208&&z<=0.0223&&Math.abs(x)>=0.0017&&Math.abs(x)<=0.0060&&proj<projMax-EPS&&proj>=(0.0040);
      const isHair = z>=0.026036-1e-4;
      if(isEye) set(i,1,0.2,0.9);            // 紫 = 判为眼睛
      else if(isHair) set(i,1,0.55,0);        // 橙 = 判为头发
      else if(isFrontLayer) set(i,0.1,0.9,0.2);// 绿 = 最靠前层(染UV用)
      else if(isFrontFacing) set(i,0.2,0.5,1); // 蓝 = 法线朝前
      else set(i,0.75,0.75,0.75);             // 灰 = 其他
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col,3));
  return stat;
}
`);
let js='';
try {
  const r = await esbuild.build({ entryPoints:[entry], bundle:true, format:'iife', globalName:'V', platform:'browser', target:'es2020', write:false, absWorkingDir: GAME });
  js = r.outputFiles[0].text;
} catch(e){ console.error(e); process.exit(1); }
fs.writeFileSync(path.join(DIR,'layers_bundle.js'), js, 'utf8');

const PANEL=(id,t)=>`<div class="panel"><div class="cap">${t}</div><canvas id="${id}"></canvas></div>`;
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#dfe4ea;font:12px ui-monospace,monospace;color:#111}
#grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}
.panel{background:#fff;border:1px solid #b9c2cf;border-radius:6px;overflow:hidden}
.cap{padding:5px 8px;font-weight:700;background:#f2f5f9;border-bottom:1px solid #dde3ea}
canvas{display:block;width:100%}
#log{position:fixed;right:8px;top:8px;background:#fff8e1;border:1px solid #e0b800;border-radius:6px;padding:8px;white-space:pre;font-size:11px;z-index:9;max-width:420px}
</style></head><body>
<div id="log">init</div>
<div id="grid">
  ${PANEL('c0','① y分层着色 · 正脸')}
  ${PANEL('c1','② 生产判据 · 正脸（绿=染UV层 橙=判为头发 紫=判为眼睛）')}
  ${PANEL('c2','① y分层着色 · 侧脸')}
  ${PANEL('c3','② 生产判据 · 侧脸')}
</div>
<script src="glb_data.js"></script>
<script src="layers_bundle.js"></script>
<script>
window.onerror=(m,u,l,c,e)=>{document.getElementById('log').textContent='ONERR '+m+' @'+l+'\\n'+(e&&e.stack||'');};
window.addEventListener('unhandledrejection',ev=>{document.getElementById('log').textContent='REJECT '+(ev.reason&&ev.reason.stack||ev.reason);});
(async()=>{
  const L=document.getElementById('log');
  try{
    const {src,sm}=await V.boot(window.GLB_B64);
    const THREE=V.T;
    const W=430,H=620;
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(W,H);renderer.setPixelRatio(2);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    const wq=sm.getWorldQuaternion(new THREE.Quaternion());
    const fDir=new THREE.Vector3(0,-1,0).applyQuaternion(wq).normalize();
    const rDir=new THREE.Vector3(1,0,0).applyQuaternion(wq).normalize();
    // ★ 局部坐标的头部盒 —— 必须先 applyMatrix4 变成世界盒，再用世界盒算尺寸！
    const localHb=new THREE.Box3(new THREE.Vector3(-0.0073,-0.0058,0.0149),new THREE.Vector3(0.0068,0.0058,0.0284));
    const hb=localHb.clone().applyMatrix4(sm.matrixWorld);
    const center=hb.getCenter(new THREE.Vector3());
    const hsz=hb.getSize(new THREE.Vector3());
    const DIST=Math.max(hsz.x,hsz.y,hsz.z)*3.2;
    const shots=[
      {mode:'ylayer',dir:fDir},{mode:'facejudge',dir:fDir},
      {mode:'ylayer',dir:rDir},{mode:'facejudge',dir:rDir},
    ];
    for(let i=0;i<shots.length;i++){
      const geo=sm.geometry.clone();
      V.colorize(geo,shots[i].mode);
      const sc=new THREE.Scene();
      sc.background=new THREE.Color('#f4f6f8');
      sc.add(new THREE.HemisphereLight(0xffffff,0x999999,2.4));
      const l1=new THREE.DirectionalLight(0xffffff,1.8);l1.position.set(2,3,2);sc.add(l1);
      const l2=new THREE.DirectionalLight(0xffffff,1.0);l2.position.set(-2,1,-3);sc.add(l2);
      const clone=src.clone(true);
      let csm=null;clone.traverse(o=>{const k=o;if(k.isSkinnedMesh&&!csm)csm=k;});
      csm.geometry=geo;
      csm.material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
      csm.frustumCulled=false;
      sc.add(clone);sc.updateMatrixWorld(true);
      const cam=new THREE.PerspectiveCamera(28,W/H,0.001,300);
      cam.position.copy(center).addScaledVector(shots[i].dir,DIST);
      cam.up.set(0,1,0);cam.lookAt(center);
      renderer.render(sc,cam);
      const out=document.getElementById('c'+i);
      out.width=W;out.height=H;
      out.getContext('2d').drawImage(renderer.domElement,0,0);
    }
    L.textContent='✔ 完成';
    window.__done=true;
  }catch(e){L.textContent='ERR '+(e&&e.stack||e);window.__err=String(e);}
})();
</script></body></html>`;
fs.writeFileSync(path.join(DIR,'layers.html'),html,'utf8');
try{fs.unlinkSync(entry);}catch{}
console.log('OK layers.html',html.length);
