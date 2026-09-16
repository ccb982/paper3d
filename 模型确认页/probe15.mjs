// probe15.mjs —— 用「人形常识」定案：脸必须长在**脖子上面、下巴下方**；
// 且脸是"竖直的一块"（z 方向有高度），而头顶是水平的。
// 判据：把"朝 -y 的法线面"和"朝 +y 的法线面"分别投影到 x-z 平面，看哪一面
//       的形状更像脸（宽>高或高>宽的方形 + 位于头的下半部）。
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
const POS=acc(prim.attributes.POSITION),NRM=acc(prim.attributes.NORMAL),JNT=acc(prim.attributes.JOINTS_0),WGT=acc(prim.attributes.WEIGHTS_0),UV=acc(prim.attributes.TEXCOORD_0);
const N=POS.count;
const X=(i)=>POS.read(i,0),Y=(i)=>POS.read(i,1),Z=(i)=>POS.read(i,2);
const NX=(i)=>NRM.read(i,0),NY=(i)=>NRM.read(i,1),NZ=(i)=>NRM.read(i,2);
const U=(i)=>UV.read(i,0),V=(i)=>UV.read(i,1);
const headJoint=gltf.skins[0].joints.findIndex((j)=>gltf.nodes[j].name==='Head');
const isHeadDom=(i)=>{let bw=0,bj=-1;for(let k=0;k<4;k++){const w=WGT.read(i,k);if(w>bw){bw=w;bj=JNT.read(i,k);}}return bj===headJoint&&bw>0.5;};

// 头部的 z（高度）范围
let z0=Infinity,z1=-Infinity;
for(let i=0;i<N;i++) if(isHeadDom(i)){z0=Math.min(z0,Z(i));z1=Math.max(z1,Z(i));}
P('头 z(高度) ' + z0.toFixed(6) + ' .. ' + z1.toFixed(6));
const zMid=(z0+z1)/2;
const zRange=z1-z0;

// ★ 判据：把"面朝 -y"的三角形按 z（高度）统计，看它们集中在头的哪一段
//   脸应该占头的**下半部**（z 低），头顶盖在**上半部**。
function report(dirName, cond) {
  P('\n=== ' + dirName + ' 的三角形按高度分布 ===');
  const byBand = new Map();
  for (let i=0;i<N;i++) {
    if (!isHeadDom(i)) continue;
    if (!cond(i)) continue;
    const band = Math.floor((Z(i)-z0)/zRange*5);
    byBand.set(band, (byBand.get(band)||0)+1);
  }
  for (let b=0;b<5;b++) {
    const lo=z0+zRange*b/5, hi=z0+zRange*(b+1)/5;
    P('  z ' + lo.toFixed(5) + '..' + hi.toFixed(5) + '  顶点 ' + (byBand.get(b)||0));
  }
}
report('法线朝 -y (ny<-0.8) —— 若是脸，应集中在下半部', (i)=>NY(i)<-0.8);
report('法线朝 +y (ny>+0.8) —— 若是脸，应集中在下半部', (i)=>NY(i)>+0.8);

// ★ 另一个判据：脸的 UV 采样。模型自带贴图只有 8 个 texel。
//   看朝 -y 和朝 +y 的顶点分别采样哪些 UV
P('\n=== 朝 -y 的顶点采样的 UV ===');
const uvsNeg=new Set(), uvsPos=new Set();
for(let i=0;i<N;i++){ if(!isHeadDom(i))continue;
  if(NY(i)<-0.8) uvsNeg.add(U(i).toFixed(4)+','+V(i).toFixed(4));
  if(NY(i)>+0.8) uvsPos.add(U(i).toFixed(4)+','+V(i).toFixed(4)); }
P('  ' + [...uvsNeg].join('  '));
P('=== 朝 +y 的顶点采样的 UV ===');
P('  ' + [...uvsPos].join('  '));

// ★ 最决定性：模型有 18 个动画。脖子/头的骨骼朝向能告诉我们"前"在哪。
//   看 Head 关节的**父链**，以及 Head 关节自身是否有旋转偏移。
const headNode = gltf.skins[0].joints[headJoint];
P('\nHead 关节 node 名: ' + gltf.nodes[headNode].name);
P('  rotation: ' + JSON.stringify(gltf.nodes[headNode].rotation || null));
P('  translation: ' + JSON.stringify(gltf.nodes[headNode].translation || null));

// ★★ 终极判据：Cube Guy 在游戏里 yaw = atan2(dx,dz)，即"局部前向 = 世界 +Z"。
//   而 probe10 已算出：局部 **-y → 世界 +Z**。
//   → 所以**局部 -y 就是模型正脸朝向**，frontAxis:'-y' 是对的。
//   那"立绘糊在后脑勺"只可能是 **remapFaceUV 选错了层**（选了 y=+0.005707）。
P('\n★★ 结论（可推）：');
P('   · 游戏里 yaw=atan2(dx,dz) → 局部前向 = 世界 +Z');
P('   · probe10：局部 -y → 世界 +Z  ⇒  frontAxis 应为 -y（正确）');
P('   · 但 y=-0.005707 与 y=+0.005707 两层**都有 ~200 面、都是大平面**');
P('   · 所以要定案"哪层是脸"，必须看**高度分布**（上面 report 的结果）');

fs.writeFileSync(path.join(DIR,'_probe15.txt'), out.join('\n'), 'utf8');
console.log('OK');
