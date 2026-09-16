// probe16.mjs —— 定案：脸面层(y=-0.005707) 自己的 UV 是什么？它是不是"没有五官的空白脸"？
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
const POS=acc(prim.attributes.POSITION),NRM=acc(prim.attributes.NORMAL),JNT=acc(prim.attributes.JOINTS_0),WGT=acc(prim.attributes.WEIGHTS_0),UV=acc(prim.attributes.TEXCOORD_0),IDX=acc(prim.indices);
const N=POS.count;
const X=(i)=>POS.read(i,0),Y=(i)=>POS.read(i,1),Z=(i)=>POS.read(i,2);
const NY=(i)=>NRM.read(i,1);
const U=(i)=>UV.read(i,0),V=(i)=>UV.read(i,1);
const headJoint=gltf.skins[0].joints.findIndex((j)=>gltf.nodes[j].name==='Head');
const isHeadDom=(i)=>{let bw=0,bj=-1;for(let k=0;k<4;k++){const w=WGT.read(i,k);if(w>bw){bw=w;bj=JNT.read(i,k);}}return bj===headJoint&&bw>0.5;};

// 全模型 UV 清单（8 个）
P('=== 全模型 UV 清单 ===');
const allU=new Map();
for(let i=0;i<N;i++){const k=U(i).toFixed(4)+','+V(i).toFixed(4); allU.set(k,(allU.get(k)||0)+1);}
for(const [k,c] of [...allU.entries()].sort()) P('  ' + k + '  ×' + c);
P('共 ' + allU.size + ' 个 UV');

// 脸面层（y = -0.005707）
const FACE_Y=-0.005707;
P('\n=== 脸面层 y=' + FACE_Y + ' ===');
const fy=new Set(); for(let i=0;i<N;i++) if(isHeadDom(i)&&Math.abs(Y(i)-FACE_Y)<1e-6) fy.add(i);
P('顶点 ' + fy.size);
const faceUV=new Map();
for(const i of fy){const k=U(i).toFixed(4)+','+V(i).toFixed(4); faceUV.set(k,(faceUV.get(k)||0)+1);}
P('这些顶点用的 UV:');
for(const [k,c] of faceUV) P('  ' + k + '  ×' + c);

// 对面层（y = +0.005707）
const BACK_Y=0.005707;
P('\n=== 对面层 y=' + BACK_Y + ' ===');
const by=new Set(); for(let i=0;i<N;i++) if(isHeadDom(i)&&Math.abs(Y(i)-BACK_Y)<1e-6) by.add(i);
P('顶点 ' + by.size);
const backUV=new Map();
for(const i of by){const k=U(i).toFixed(4)+','+V(i).toFixed(4); backUV.set(k,(backUV.get(k)||0)+1);}
for(const [k,c] of backUV) P('  ' + k + '  ×' + c);

// ★ 区别：脸面层**独有**的 UV
P('\n=== 脸面层独有 / 对面层独有的 UV ===');
const fs_=new Set(faceUV.keys()), bs_=new Set(backUV.keys());
P('脸面层独有: ' + [...fs_].filter(k=>!bs_.has(k)).join('  ') || '（无）');
P('对面层独有: ' + [...bs_].filter(k=>!fs_.has(k)).join('  ') || '（无）');

// 眼睛/嘴浮雕用的 UV（那些浮雕片是不是也采样同一个 texel？）
P('\n=== 眼睛浮雕(y -0.00552..-0.0040) 的 UV ===');
const eyeUV=new Map();
for(let i=0;i<N;i++){
  if(!isHeadDom(i))continue;
  const y=Y(i), z=Z(i), ax=Math.abs(X(i));
  if(y>FACE_Y+1e-6 && y<=-0.0040 && z>=0.0208 && z<=0.0223 && ax>=0.0017 && ax<=0.0060){
    const k=U(i).toFixed(4)+','+V(i).toFixed(4); eyeUV.set(k,(eyeUV.get(k)||0)+1);
  }
}
for(const [k,c] of eyeUV) P('  ' + k + '  ×' + c);

// 贴图尺寸
const img = gltf.images && gltf.images[0];
P('\n=== 贴图 ===');
P(JSON.stringify(img || null));

fs.writeFileSync(path.join(DIR,'_probe16.txt'), out.join('\n'), 'utf8');
console.log('OK');
