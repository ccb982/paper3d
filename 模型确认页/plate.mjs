// plate.mjs —— 验收页：直接用与生产同源的压平逻辑渲染
// 4 联：原样正脸 / 压平后正脸 / 原样侧脸 / 压平后侧脸
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GAME = 'C:/Users/22641/Desktop/架构重置/全新的游戏';
const req = createRequire(path.join(GAME, 'package.json'));
const esbuild = req('esbuild');

const glbB64 = fs.readFileSync(path.join(DIR, 'candidate_cubeguy.glb')).toString('base64');
fs.writeFileSync(path.join(DIR, 'glb_data.js'), 'window.GLB_B64="' + glbB64 + '";\n', 'utf8');

const entry = path.join(GAME, '_plate_tmp.ts');
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

// ===== 与生产 flattenFacePlate 同源逻辑 =====
const CG_PLATE_Z0 = 0.014933, CG_PLATE_Z1 = 0.026036;
const CG_PLATE_PROJ_MIN = 0.0038, CG_PLATE_FLAT_PROJ = 0.00585;
const CG_EYE_Z0=0.0208, CG_EYE_Z1=0.0223, CG_EYE_AX0=0.0017, CG_EYE_AX1=0.0060, CG_EYE_Y_MAX=-0.0040;
const CG_FACE_PAD = 0.5/32;
export function flattenFacePlate(geo: THREE.BufferGeometry, FR: any) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv  = geo.getAttribute('uv') as THREE.BufferAttribute;
  const jnt = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const wgt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  const fAxis='y', uAxis='z', lrAxis='x', fSign=-1;
  const getF=(i:number)=>pos.getY(i), getU=(i:number)=>pos.getZ(i), getL=(i:number)=>pos.getX(i);
  const setF=(i:number,v:number)=>pos.setY(i,v), setNF=(i:number,v:number)=>nrm.setY(i,v);
  // headDom
  let headJoint = -1;
  const sk = (smRef && smRef.skeleton) as any;
  if (jnt && wgt && sk) headJoint = sk.bones.findIndex((b:any)=>b.name==='Head');
  const isHeadDom=(i:number)=>{
    if(headJoint<0||!jnt||!wgt) return true;
    let bw=0,bj=-1;
    for(let k=0;k<4;k++){const w=wgt.getComponent(i,k); if(w>bw){bw=w;bj=jnt.getComponent(i,k);}}
    return bj===headJoint && bw>0.5;
  };
  const plate:number[]=[];
  for(let i=0;i<pos.count;i++){
    if(!isHeadDom(i)) continue;
    const u=getU(i);
    if(u<CG_PLATE_Z0||u>CG_PLATE_Z1) continue;
    if(getF(i)*fSign < CG_PLATE_PROJ_MIN) continue;
    plate.push(i);
  }
  let l0=Infinity,l1=-Infinity,u0=Infinity,u1=-Infinity;
  for(const i of plate){const l=getL(i),u=getU(i);l0=Math.min(l0,l);l1=Math.max(l1,l);u0=Math.min(u0,u);u1=Math.max(u1,u);}
  const lw=Math.max(1e-6,l1-l0), uh=Math.max(1e-6,u1-u0);
  const pu=FR.u0+CG_FACE_PAD, pu1=FR.u1-CG_FACE_PAD, pv=FR.v0+CG_FACE_PAD, pv1=FR.v1-CG_FACE_PAD;
  // ★ 保持立绘比例：在「立绘区」里取出一个与「脸面」同比例的**子矩形**，
  //   再把脸的 (左右,高度) 线性映射进去 —— 立绘就不会被拉伸。
  //   脸面 = lw × uh（本模型 1.169:1，横向）；立绘区 = (pu1-pu) × (pv1-pv)。
  const faceRatio = lw/uh;
  const regRatio = (pu1-pu)/(pv1-pv);
  // 新 faceRect 按脸面比例选取 → 直接用满，不做裁剪
  const uu0=pu, uu1=pu1, vv0=pv, vv1=pv1;
  for(const i of plate){
    setF(i, CG_PLATE_FLAT_PROJ*fSign);
    setNF(i, fSign);
    const tl=(getL(i)-l0)/lw, tu=(getU(i)-u0)/uh;
    uv.setXY(i, uu0+tl*(uu1-uu0), vv0+(1-tu)*(vv1-vv0));
  }
  // ⑤ 删眼睛浮雕
  let eyeFaces=0;
  {
    const idx=geo.getIndex();
    if(idx){
      const eyeProjMin=CG_EYE_Y_MAX*fSign;
      const isEyeVert=(i:number)=>{
        const u=getU(i), ax=Math.abs(getL(i)), proj=getF(i)*fSign;
        if(u<CG_EYE_Z0||u>CG_EYE_Z1) return false;
        if(ax<CG_EYE_AX0||ax>CG_EYE_AX1) return false;
        if(proj<eyeProjMin) return false;
        return true;
      };
      const old=idx.array; const nw:number[]=[];
      for(let t=0;t<old.length;t+=3){
        const a=old[t],b=old[t+1],c=old[t+2];
        if(isEyeVert(a)&&isEyeVert(b)&&isEyeVert(c)){eyeFaces++;continue;}
        nw.push(a,b,c);
      }
      if(eyeFaces>0) geo.setIndex(new THREE.BufferAttribute(new Uint16Array(nw),1));
    }
  }
  pos.needsUpdate=true; nrm.needsUpdate=true; uv.needsUpdate=true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return { plateN: plate.length, total: pos.count, headJoint, eyeFaces,
           bbox:{l0,l1,u0,u1}, ratio:faceRatio, regRatio, uu:[uu0,uu1], vv:[vv0,vv1] };
}
let smRef: THREE.SkinnedMesh | null = null;
export function setRef(s: THREE.SkinnedMesh) { smRef = s; }
`);
let js='';
try {
  const r = await esbuild.build({ entryPoints:[entry], bundle:true, format:'iife', globalName:'P', platform:'browser', target:'es2020', write:false, absWorkingDir: GAME });
  js = r.outputFiles[0].text;
} catch(e){
  // 第一遍编译会因 smRef 未声明失败，用带声明的版本重试
  console.error('build fail, retry with declared smRef');
  const src = fs.readFileSync(entry,'utf8').replace('const sk = (smRef && smRef.skeleton) as any;','const sk = (smRef && smRef.skeleton) as any;');
  fs.writeFileSync(entry, src.replace('let smRef: THREE.SkinnedMesh | null = null;','let smRef: THREE.SkinnedMesh | null = null;'));
  try {
    const r2 = await esbuild.build({ entryPoints:[entry], bundle:true, format:'iife', globalName:'P', platform:'browser', target:'es2020', write:false, absWorkingDir: GAME });
    js = r2.outputFiles[0].text;
  } catch(e2){ console.error(String(e2).slice(0,2000)); process.exit(1); }
}
fs.writeFileSync(path.join(DIR,'plate_bundle.js'), js, 'utf8');

const PANEL=(id,t)=>`<div class="panel"><div class="cap">${t}</div><canvas id="${id}"></canvas></div>`;
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#dfe4ea;font:12px ui-monospace,monospace;color:#111}
#grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}
.panel{background:#fff;border:1px solid #b9c2cf;border-radius:6px;overflow:hidden}
.cap{padding:5px 8px;font-weight:700;background:#f2f5f9;border-bottom:1px solid #dde3ea}
canvas{display:block;width:100%}
#log{position:fixed;right:8px;top:8px;background:#fff8e1;border:1px solid #e0b800;border-radius:6px;padding:8px;white-space:pre;font-size:11px;z-index:9;max-width:460px}
</style></head><body>
<div id="log">init</div>
<div id="grid">
  ${PANEL('c0','① 原样 · 正脸')}
  ${PANEL('c1','② 压平+贴立绘 · 正脸')}
  ${PANEL('c2','③ 原样 · 侧脸')}
  ${PANEL('c3','④ 压平+贴立绘 · 侧脸')}
</div>
<script src="glb_data.js"></script>
<script src="plate_bundle.js"></script>
<script>
window.onerror=(m,u,l,c,e)=>{document.getElementById('log').textContent='ONERR '+m+' @'+l+'\\n'+(e&&e.stack||'');};
window.addEventListener('unhandledrejection',ev=>{document.getElementById('log').textContent='REJECT '+(ev.reason&&ev.reason.stack||ev.reason);});
(async()=>{
  const L=document.getElementById('log');
  try{
    const {src,sm}=await P.boot(window.GLB_B64);
    const THREE=P.T;
    P.setRef(sm);
    const origGeo=sm.geometry.clone();
    const plateGeo=sm.geometry.clone();
    const st=P.flattenFacePlate(plateGeo,{u0:0,u1:0.4434,v0:0.62,v1:1});
    L.textContent='压平顶点 '+st.plateN+'/'+st.total+'  Head关节='+st.headJoint
      +'\\n脸区 x '+st.bbox.l0.toFixed(4)+'..'+st.bbox.l1.toFixed(4)
      +'  z '+st.bbox.u0.toFixed(4)+'..'+st.bbox.u1.toFixed(4)
      +'\\n宽高比 '+st.ratio.toFixed(3)+'  删眼睛 '+st.eyeFaces+' 面'
      +'\\nUV u '+st.uu[0].toFixed(4)+'..'+st.uu[1].toFixed(4)+'  v '+st.vv[0].toFixed(4)+'..'+st.vv[1].toFixed(4);

    // 立绘贴图：底图 + 脸区高对比记号
    const S=512;
    const cv=document.createElement('canvas');cv.width=S;cv.height=S;
    const cx=cv.getContext('2d');
    cx.drawImage(sm.material.map.image,0,0,S,S);
    const x0=0,x1=0.4434*S,y0=0.62*S,y1=S;
    cx.fillStyle='#8040c0';cx.fillRect(x0,y0,x1-x0,y1-y0);
    cx.strokeStyle='#fff';cx.lineWidth=6;cx.strokeRect(x0+3,y0+3,x1-x0-6,y1-y0-6);
    cx.fillStyle='#ffe000';cx.fillRect(x0,y0+(y1-y0)*0.06,x1-x0,(y1-y0)*0.10);
    cx.fillStyle='#00ff40';cx.fillRect(x0,y0+(y1-y0)*0.44,x1-x0,(y1-y0)*0.10);
    cx.fillStyle='#ff2000';cx.fillRect(x0,y0+(y1-y0)*0.84,x1-x0,(y1-y0)*0.10);
    const tex=new THREE.CanvasTexture(cv);
    tex.colorSpace=THREE.SRGBColorSpace;tex.flipY=false;

    const W=430,H=620;
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(W,H);renderer.setPixelRatio(2);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    const wq=sm.getWorldQuaternion(new THREE.Quaternion());
    const fDir=new THREE.Vector3(0,-1,0).applyQuaternion(wq).normalize();
    const rDir=new THREE.Vector3(1,0,0).applyQuaternion(wq).normalize();
    // ★ 取景：对准「整个头盒」（含头发），距离保证头完整入画
    const hb=new THREE.Box3(
      new THREE.Vector3(-0.0075,-0.0062,0.0146),
      new THREE.Vector3(0.0075,0.0062,0.0288));
    const hw=hb.clone().applyMatrix4(sm.matrixWorld);
    const center=hw.getCenter(new THREE.Vector3());
    const hsz=hw.getSize(new THREE.Vector3());
    const DIST=Math.max(hsz.x,hsz.y,hsz.z)*1.9;
    const shots=[
      {geo:origGeo,dir:fDir},{geo:plateGeo,dir:fDir},
      {geo:origGeo,dir:rDir},{geo:plateGeo,dir:rDir},
    ];
    for(let i=0;i<shots.length;i++){
      const sc=new THREE.Scene();
      sc.background=new THREE.Color('#eef1f5');
      sc.add(new THREE.HemisphereLight(0xffffff,0x909098,2.6));
      const l1=new THREE.DirectionalLight(0xffffff,2.3);l1.position.set(2,3,2);sc.add(l1);
      const l2=new THREE.DirectionalLight(0xffffff,1.2);l2.position.set(-2,1,-3);sc.add(l2);
      const clone=src.clone(true);
      let csm=null;clone.traverse(o=>{const k=o;if(k.isSkinnedMesh&&!csm)csm=k;});
      csm.geometry=shots[i].geo;
      csm.material=new THREE.MeshToonMaterial({map:tex,side:THREE.DoubleSide});
      csm.frustumCulled=false;
      sc.add(clone);sc.updateMatrixWorld(true);
      const cam=new THREE.PerspectiveCamera(30,W/H,0.001,300);
      cam.position.copy(center).addScaledVector(shots[i].dir,DIST);
      cam.up.set(0,1,0);cam.lookAt(center);
      renderer.render(sc,cam);
      const out=document.getElementById('c'+i);
      out.width=W;out.height=H;
      out.getContext('2d').drawImage(renderer.domElement,0,0);
    }
    L.textContent+='\\n✔ 渲染完成';
    window.__done=true;
  }catch(e){L.textContent='ERR '+(e&&e.stack||e);window.__err=String(e);}
})();
</script></body></html>`;
fs.writeFileSync(path.join(DIR,'plate.html'),html,'utf8');
try{fs.unlinkSync(entry);}catch{}
console.log('OK plate.html',html.length);
