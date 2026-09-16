// probe13.mjs —— 那 90 个"头发判据碰到耳朵层"的三角面到底是什么？是耳朵还是后脑顶盖？
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GLB = path.join(DIR, 'candidate_cubeguy.glb');
const out = []; const P = (...a) => out.push(a.join(' '));
const buf = fs.readFileSync(GLB);
const DV = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 12, gltf = null, BIN = null;
while (off < buf.length) { const len = DV.getUint32(off,true), type = DV.getUint32(off+4,true), s = off+8;
  if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(buf.subarray(s, s+len)));
  else if (type === 0x004e4942) BIN = buf.subarray(s, s+len);
  off = s + len; }
const gt=(ct)=>ct===5126?'getFloat32':ct===5125?'getUint32':ct===5123?'getUint16':ct===5121?'getUint8':ct===5122?'getInt16':'getInt8';
const so=(ct)=>ct===5126||ct===5125?4:ct===5123||ct===5122?2:1;
const NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function acc(i){const a=gltf.accessors[i],bv=gltf.bufferViews[a.bufferView];const base=(bv.byteOffset||0)+(a.byteOffset||0);const n=NC[a.type],stride=bv.byteStride||(n*so(a.componentType));const g=gt(a.componentType),sz=so(a.componentType);return{count:a.count,read:(idx,c)=>DV[g](BIN.byteOffset+base+idx*stride+c*sz,true)};}
const prim=gltf.meshes[0].primitives[0];
const POS=acc(prim.attributes.POSITION),JNT=acc(prim.attributes.JOINTS_0),WGT=acc(prim.attributes.WEIGHTS_0),IDX=acc(prim.indices);
const N=POS.count,T=IDX.count/3;
const X=(i)=>POS.read(i,0),Y=(i)=>POS.read(i,1),Z=(i)=>POS.read(i,2);
const headJoint=gltf.skins[0].joints.findIndex((j)=>gltf.nodes[j].name==='Head');
const isHeadDom=(i)=>{let bw=0,bj=-1;for(let k=0;k<4;k++){const w=WGT.read(i,k);if(w>bw){bw=w;bj=JNT.read(i,k);}}return bj===headJoint&&bw>0.5;};

const FACE_Z_TOP=0.026036, EAR_Y=-0.001901;
const isHair=(i)=>Z(i)>=FACE_Z_TOP-1e-4;
const earSet=new Set();
for(let i=0;i<N;i++) if(isHeadDom(i)&&Math.abs(Y(i)-EAR_Y)<0.0005) earSet.add(i);

// 收集"头发判据 ∩ 耳朵层"的三角面
const hits=[];
for(let t=0;t<T;t++){
  const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  if(isHair(a)&&isHair(b)&&isHair(c)&&(earSet.has(a)||earSet.has(b)||earSet.has(c))) hits.push(t);
}
P('"头发 ∩ 耳朵层"的三角面: ' + hits.length);

// 这些三角面的空间分布：看是"头顶大盖"还是"耳朵尖"
let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
const vs=new Set();
for(const t of hits) for(let k=0;k<3;k++){const i=IDX.read(t*3+k,0);vs.add(i);
  x0=Math.min(x0,X(i));x1=Math.max(x1,X(i));y0=Math.min(y0,Y(i));y1=Math.max(y1,Y(i));z0=Math.min(z0,Z(i));z1=Math.max(z1,Z(i));}
P('  x ' + x0.toFixed(6) + '..' + x1.toFixed(6));
P('  y ' + y0.toFixed(6) + '..' + y1.toFixed(6));
P('  z ' + z0.toFixed(6) + '..' + z1.toFixed(6));
P('  涉及顶点 ' + vs.size);

// 这些顶点里 |x| 很大的（耳朵特征）有多少？
let wide=0, narrow=0;
for(const i of vs){ if(Math.abs(X(i))>0.0066) wide++; else narrow++; }
P('  |x|>0.0066（耳朵外缘特征）: ' + wide + '   |x|<=0.0066: ' + narrow);

// 列表前 20 个顶点的坐标
P('\n  顶点明细（前 24 个）:');
const arr=[...vs].sort((a,b)=>X(a)-X(b));
for(const i of arr.slice(0,24)) P('    v'+i+'  x '+X(i).toFixed(6)+'  y '+Y(i).toFixed(6)+'  z '+Z(i).toFixed(6));

// ★ 关键判断：耳朵本体（平面 y≈-0.0019 且 |x| 最大那圈）的 z 最高是多少？
//   如果耳朵本体最高 z < 0.026036，那 90 面就是"头顶盖子贴近后侧的部分"，不是耳朵
let earMaxZ=-Infinity, earMinZ=Infinity;
for(const i of earSet){ earMaxZ=Math.max(earMaxZ,Z(i)); earMinZ=Math.min(earMinZ,Z(i)); }
P('\n耳朵层(y≈-0.0019)全部顶点的 z 范围: ' + earMinZ.toFixed(6) + ' .. ' + earMaxZ.toFixed(6));

// 耳朵"听筒"位置通常 z 在头中部。找 |x| 最大的那一圈耳朵顶点的 z
const earArr=[...earSet].sort((a,b)=>Math.abs(X(b))-Math.abs(X(a)));
P('耳朵层最外侧 8 个顶点:');
for(const i of earArr.slice(0,8)) P('    v'+i+'  x '+X(i).toFixed(6)+'  y '+Y(i).toFixed(6)+'  z '+Z(i).toFixed(6));

fs.writeFileSync(path.join(DIR,'_probe13.txt'), out.join('\n'), 'utf8');
console.log('OK');
