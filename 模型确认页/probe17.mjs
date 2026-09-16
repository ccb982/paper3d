// probe17.mjs —— 真正的"脸"在哪里？
// 用**眼睛浮雕的实际位置**反推脸的矩形区域（而不是拿"最靠前那层"的 bbox 当脸）。
// 眼睛浮雕 = 唯一的五官几何，它所在的高度带就是"眼睛的高度"。
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const GLB = path.join(DIR, 'candidate_cubeguy.glb');
const out=[]; const P=(...a)=>out.push(a.join(' '));
const buf=fs.readFileSync(GLB); const DV=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
let off=12,gltf=null,BIN=null;
while(off<buf.length){const len=DV.getUint32(off,true),type=DV.getUint32(off+4,true),s=off+8;
  if(type===0x4e4f534a)gltf=JSON.parse(new TextDecoder().decode(buf.subarray(s,s+len)));
  else if(type===0x004e4942)BIN=buf.subarray(s,s+len); off=s+len;}
const gt=(ct)=>ct===5126?'getFloat32':ct===5125?'getUint32':ct===5123?'getUint16':ct===5121?'getUint8':ct===5122?'getInt16':'getInt8';
const so=(ct)=>ct===5126||ct===5125?4:ct===5123||ct===5122?2:1;
const NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function acc(i){const a=gltf.accessors[i],bv=gltf.bufferViews[a.bufferView];const base=(bv.byteOffset||0)+(a.byteOffset||0);const n=NC[a.type],stride=bv.byteStride||(n*so(a.componentType));const g=gt(a.componentType),sz=so(a.componentType);return{count:a.count,read:(idx,c)=>DV[g](BIN.byteOffset+base+idx*stride+c*sz,true)};}
const prim=gltf.meshes[0].primitives[0];
const POS=acc(prim.attributes.POSITION),NRM=acc(prim.attributes.NORMAL),JNT=acc(prim.attributes.JOINTS_0),WGT=acc(prim.attributes.WEIGHTS_0),IDX=acc(prim.indices);
const N=POS.count,T=IDX.count/3;
const X=(i)=>POS.read(i,0),Y=(i)=>POS.read(i,1),Z=(i)=>POS.read(i,2);
const NY=(i)=>NRM.read(i,1);
const headJoint=gltf.skins[0].joints.findIndex((j)=>gltf.nodes[j].name==='Head');
const isHeadDom=(i)=>{let bw=0,bj=-1;for(let k=0;k<4;k++){const w=WGT.read(i,k);if(w>bw){bw=w;bj=JNT.read(i,k);}}return bj===headJoint&&bw>0.5;};

// 整体头包围盒
let hx0=Infinity,hx1=-Infinity,hy0=Infinity,hy1=-Infinity,hz0=Infinity,hz1=-Infinity;
for(let i=0;i<N;i++) if(isHeadDom(i)){hx0=Math.min(hx0,X(i));hx1=Math.max(hx1,X(i));
  hy0=Math.min(hy0,Y(i));hy1=Math.max(hy1,Y(i));hz0=Math.min(hz0,Z(i));hz1=Math.max(hz1,Z(i));}
P('头包围盒  x '+hx0.toFixed(6)+'..'+hx1.toFixed(6)+'  y '+hy0.toFixed(6)+'..'+hy1.toFixed(6)+'  z '+hz0.toFixed(6)+'..'+hz1.toFixed(6));

// 脸面层(最靠前)的完整范围
const FACE_Y=-0.005707;
const fyV=[]; for(let i=0;i<N;i++) if(isHeadDom(i)&&Math.abs(Y(i)-FACE_Y)<1e-6) fyV.push(i);
let fx0=Infinity,fx1=-Infinity,fz0=Infinity,fz1=-Infinity;
for(const i of fyV){fx0=Math.min(fx0,X(i));fx1=Math.max(fx1,X(i));fz0=Math.min(fz0,Z(i));fz1=Math.max(fz1,Z(i));}
P('\\n★ 最靠前那层(y='+FACE_Y+') 顶点'+fyV.length);
P('   x '+fx0.toFixed(6)+'..'+fx1.toFixed(6)+'   z '+fz0.toFixed(6)+'..'+fz1.toFixed(6));
P('   → 高度跨度 '+(fz1-fz0).toFixed(6)+'（占头高 '+((fz1-fz0)/(hz1-hz0)*100).toFixed(1)+'%）');
P('   → 顶端 z='+fz1.toFixed(6)+' 距离头顶 z='+hz1.toFixed(6)+' 还差 '+(hz1-fz1).toFixed(6));
P('   ★ 这一层从 z='+fz0.toFixed(5)+' 一直到 '+fz1.toFixed(5)+' —— 是一整片"前脸",');
P('     上面那截 (z 靠近 '+fz1.toFixed(5)+') 从五官位置看是**额头/头发**，不是脸');

// ★ 眼睛浮雕的真实位置
const eyeV=[];
for(let i=0;i<N;i++){ if(!isHeadDom(i))continue;
  const y=Y(i),z=Z(i),ax=Math.abs(X(i));
  if(y>-0.005707-1e-6 && y<=-0.0040 && z>=0.0208 && z<=0.0223 && ax>=0.0017 && ax<=0.0060) eyeV.push(i); }
let ez0=Infinity,ez1=-Infinity,eax=0;
for(const i of eyeV){ez0=Math.min(ez0,Z(i));ez1=Math.max(ez1,Z(i));eax=Math.max(eax,Math.abs(X(i)));}
P('\\n★ 眼睛浮雕 顶点'+eyeV.length+'  z '+ez0.toFixed(6)+'..'+ez1.toFixed(6)+'  max|x| '+eax.toFixed(6));

// 眼睛在头高里的相对位置
P('   眼睛高度占头高: '+(((ez0+ez1)/2-hz0)/(hz1-hz0)*100).toFixed(1)+'% （0%=下巴底 100%=头顶）');
P('   脸面层上沿高度占比: '+((fz1-hz0)/(hz1-hz0)*100).toFixed(1)+'%');
P('   脸面层下沿高度占比: '+((fz0-hz0)/(hz1-hz0)*100).toFixed(1)+'%');

// ★★ 关键：头的"高度结构"—— 各高度带的顶点数，看哪里是脸/哪里是头发
P('\\n=== 头部各高度带（占头高比例）的顶点数 ===');
const bands=new Array(10).fill(0);
const bandTris=new Array(10).fill(0);
for(let i=0;i<N;i++) if(isHeadDom(i)) bands[Math.min(9,Math.floor((Z(i)-hz0)/(hz1-hz0)*10))]++;
for(let t=0;t<T;t++){const a=IDX.read(t*3,0),b=IDX.read(t*3+1,0),c=IDX.read(t*3+2,0);
  if(!(isHeadDom(a)&&isHeadDom(b)&&isHeadDom(c)))continue;
  const zc=(Z(a)+Z(b)+Z(c))/3; bandTris[Math.min(9,Math.floor((zc-hz0)/(hz1-hz0)*10))]++;}
for(let b=0;b<10;b++){
  const lo=(hz0+(hz1-hz0)*b/10), hi=(hz0+(hz1-hz0)*(b+1)/10);
  P('  '+String(b*10).padStart(3)+'%..'+String((b+1)*10).padStart(3)+'%  z '+lo.toFixed(5)+'..'+hi.toFixed(5)
    +'  顶点'+String(bands[b]).padStart(4)+'  三角'+String(bandTris[b]).padStart(5));
}

// ★★ 决定性：脸的左右宽度 vs 前脸片的左右宽度，看"脸"是不是只占前脸片的下半部分
P('\\n=== 最靠前层按高度分带（看它是不是"上面是额头"）===');
for(let b=0;b<10;b++){
  const lo=(hz0+(hz1-hz0)*b/10), hi=(hz0+(hz1-hz0)*(b+1)/10);
  const sel=fyV.filter(i=>Z(i)>=lo&&Z(i)<hi|| (b===9&&Z(i)>=lo&&Z(i)<=hi));
  if(!sel.length) continue;
  let x0=Infinity,x1=-Infinity;
  for(const i of sel){x0=Math.min(x0,X(i));x1=Math.max(x1,X(i));}
  P('  '+String(b*10).padStart(3)+'%..'+String((b+1)*10).padStart(3)+'%  顶点'+String(sel.length).padStart(3)
    +'  x '+x0.toFixed(6)+'..'+x1.toFixed(6)+'  宽 '+(x1-x0).toFixed(6));
}

fs.writeFileSync(path.join(DIR,'_probe17.txt'),out.join('\n'),'utf8');
console.log('OK');
