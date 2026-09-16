// probe14.mjs —— 定案：脸到底在 -y 还是 +y？
// 判据：脸 = 有眼睛/头发浮雕的那一侧 = 几何最复杂的那一侧。
// 方法：统计每个 y 层上的三角形数（复杂度），以及"凸起"（y 方向上的层数量）。
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
const POS=acc(prim.attributes.POSITION),NRM=acc(prim.attributes.NORMAL),JNT=acc(prim.attributes.JOINTS_0),WGT=acc(prim.attributes.WEIGHTS_0),IDX=acc(prim.indices);
const N=POS.count,T=IDX.count/3;
const X=(i)=>POS.read(i,0),Y=(i)=>POS.read(i,1),Z=(i)=>POS.read(i,2);
const NY=(i)=>NRM.read(i,1),NX=(i)=>NRM.read(i,0),NZ=(i)=>NRM.read(i,2);
const headJoint=gltf.skins[0].joints.findIndex((j)=>gltf.nodes[j].name==='Head');
const isHeadDom=(i)=>{let bw=0,bj=-1;for(let k=0;k<4;k++){const w=WGT.read(i,k);if(w>bw){bw=w;bj=JNT.read(i,k);}}return bj===headJoint&&bw>0.5;};

const hv=[]; for(let i=0;i<N;i++) if(isHeadDom(i)) hv.push(i);
P('头部主导顶点 ' + hv.length);
let hy0=Infinity,hy1=-Infinity;
for(const i of hv){hy0=Math.min(hy0,Y(i));hy1=Math.max(hy1,Y(i));}
P('头部 y 范围 ' + hy0.toFixed(6) + ' .. ' + hy1.toFixed(6));

// ★ 复杂度图：每个 y 层上有多少顶点（越多=越"浮雕"=越可能是脸）
P('\n=== 每个 y 层的顶点数（头部）===');
const byY=new Map();
for(const i of hv){const k=Y(i).toFixed(6); if(!byY.has(k))byY.set(k,[]); byY.get(k).push(i);}
const yl=[...byY.entries()].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0]));
P('总 y 层数 ' + yl.length);
// 分两半：靠近 -y 极值的 vs 靠近 +y 极值的
P('\n靠近 -y 端（y 最小 20 层）:');
for(const [k,vs] of yl.slice(0,20)) P('   y=' + k + '  顶点 ' + vs.length);
P('\n靠近 +y 端（y 最大 20 层）:');
for(const [k,vs] of yl.slice(-20)) P('   y=' + k + '  顶点 ' + vs.length);

// ★ 每层的"面片密度"：该层参与多少三角形
const triPerY=new Map();
for(let t=0;t<T;t++){
  const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  if(!(isHeadDom(a)&&isHeadDom(b)&&isHeadDom(c))) continue;
  for(const i of [a,b,c]){const k=Y(i).toFixed(6); triPerY.set(k,(triPerY.get(k)||0)+1);}
}
P('\n=== 每 y 层的三角形参与数（前 15 层 / 后 15 层）===');
const tl=[...triPerY.entries()].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0]));
P('靠 -y（y 最小 15 层）:');
for(const [k,v] of tl.slice(0,15)) P('   y=' + k + '  三角 ' + v);
P('靠 +y（y 最大 15 层）:');
for(const [k,v] of tl.slice(-15)) P('   y=' + k + '  三角 ' + v);

// ★ 法线朝向汇总：朝 -y 的顶点 vs 朝 +y 的
let negY=0,posY=0;
for(const i of hv){ if(NY(i)<-0.6)negY++; else if(NY(i)>0.6)posY++; }
P('\n头部顶点法线朝 -y(ny<-0.6): ' + negY + '   朝 +y(ny>0.6): ' + posY);

// ★ 决定性判据：脸在"画面正对相机"的那面。用 mesh 节点旋转把局部轴映射到父空间后，
//   父空间 +Z 是"朝向观察者"（Three.js 惯例）。
//   已知：局部 -y → 父 +Z，局部 +y → 父 -Z（probe10 实测）
P('\n★★ 由 probe10 实测：局部 -y → 世界 +Z（面向相机）');
P('   所以如果"复杂/有五官的那侧"在局部 +y，那它其实在**背面**（世界 -Z）');
P('   → 需要确认：模型在游戏里是不是被 yaw 转了 180°？');

// 用"最外侧耳朵"(|x|最大) 的 y 来判断：耳朵在头的两侧，y 应接近中轴
const earCand=hv.filter(i=>Math.abs(X(i))>0.0065);
let ey=0; for(const i of earCand) ey+=Y(i); ey/=Math.max(1,earCand.length);
P('\n耳朵候选(|x|>0.0065) ' + earCand.length + ' 个，平均 y = ' + ey.toFixed(6));

// ★ 鼻尖/最凸点：脸通常有个最凸的鼻子。
//   看 |x| 小时 y 的极值
const mid=hv.filter(i=>Math.abs(X(i))<0.0012 && Z(i)>0.0200 && Z(i)<0.0245);
let my0=Infinity,my1=-Infinity;
for(const i of mid){my0=Math.min(my0,Y(i));my1=Math.max(my1,Y(i));}
P('中轴窄带(|x|<0.0012) 顶点 ' + mid.length + '  y ' + my0.toFixed(6) + ' .. ' + my1.toFixed(6));

// ★ 直接看"有眼睛浮雕那侧"在哪：眼睛浮雕 = z 0.021..0.0223 的共面片，两侧各一
//   它的 y 已知在 -0.0057..-0.0040（probe8 实测）→ 那它在局部 -y 侧。
//   但用户说有眼睛的那侧是前脸 → 说明"局部 -y"在游戏里就是对着相机的前方。
P('\n眼睛浮雕 y 带: -0.005522 .. -0.004097 （probe8 实测）');
P('头发（z>=0.026036）覆盖: x ±0.0057, y ±0.0057（probe9 实测，头顶整盖）');

fs.writeFileSync(path.join(DIR,'_probe14.txt'), out.join('\n'), 'utf8');
console.log('OK');
