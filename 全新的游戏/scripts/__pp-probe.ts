import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource, buildChunkFinal, buildChunkWallBuffers } from "../src/services/map/Refinements";
import { buildPostChunkTopSurface, postSurfaceHeightAt } from "../src/services/map/PostProcess";
import { tileById } from "../src/services/map/Tiles";
const cache=new Map<string,ChunkData>();
function getChunk(s:number,cx:number,cz:number){const k=`${s}:${cx}:${cz}`;let x=cache.get(k);if(!x){x=generateChunk(s,cx,cz);cache.set(k,x);}return x;}
const seed=11,N=60;
const src=makeChunkSource((a,b)=>getChunk(seed,a,b) as ChunkData|undefined);
const raster={ worldSeed:seed, chunkSource:()=>src, getChunkData:()=>undefined, surfaceHeightAt:(x:number,z:number)=>{const gx=Math.floor(x),gz=Math.floor(z),fx=x-gx,fz=z-gz,bcx=Math.floor(gx/4),bcz=Math.floor(gz/4);const c=(bx:number,bz:number,X:number,Z:number)=>{const B=src.blockAt(bx,bz)!;let h=B.h;return h;};const h00=c(bcx,bcz,gx,gz),h10=c(bcx,bcz,gx+1,gz),h01=c(bcx,bcz,gx,gz+1),h11=c(bcx,bcz,gx+1,gz+1);return fx+fz<=1?h00*(1-fx-fz)+h01*fz+h10*fx:h11*(fx+fz-1)+h01*(1-fx)+h10*(1-fz);} } as any;

// ---- ① 精修层基准顶点（bit 基准） ----
const base = buildChunkFinal(src,0,0,N);
// ---- ② 后处理顶面 ----
const post = buildPostChunkTopSurface(raster as any,0,0);

if (process.env.PP_OFF) {
  // A/B 等价：关闭时顶点/索引/查询逐位一致
  let vd=0,idm=0;
  for(let i=0;i<base.top.vertices.length;i++) if(base.top.vertices[i]!==post.vertices[i]) vd++;
  for(let i=0;i<base.top.indices.length;i++) if(base.top.indices[i]!==post.indices[i]) idm++;
  let qd=0;
  for(let i=0;i<400;i++){const x=(i*13.37)%N,z=(i*7.77)%N;if(postSurfaceHeightAt(raster as any,x,z)!==(raster as any).surfaceHeightAt(x,z))qd++;}
  console.log(`[A/B关闭] 顶点差异=${vd} 索引差异=${idm} 查询差异=${qd}/400`);
} else {
  console.log(`[顶点] 精修层=${base.top.vertices.length/3} 后处理=${post.vertices.length/3}`);
  // ---- 渲染=查询同源：coarse 顶点与 postSurfaceHeightAt 一致性（coarse 顶点=整米坐标） ----
  let chk=0,bad=0,mx=0;
  const V=post.vertices;
  for(let i=0;i<V.length/3;i++){
    const lx=V[i*3],lz=V[i*3+2],y=V[i*3+1];
    const wx=lx+30,wz=lz+30; // chunk(0,0) 局部→世界
    // 只校验整米顶点（coarse）
    if(Math.abs(wx-Math.round(wx))>1e-6||Math.abs(wz-Math.round(wz))>1e-6) continue;
    chk++;
    const q=postSurfaceHeightAt(raster as any,wx,wz);
    const d=Math.abs(y-q);
    if(d>1e-6){bad++;mx=Math.max(mx,d);}
  }
  console.log(`[渲染=查询] 整米顶点 ${chk} 个，偏差>1e-6: ${bad} (max=${mx.toFixed(6)})`);
  // ---- 圆角语义统计 ----
  let bevEdges=0,platPlat=0,platPit=0,platLiq=0;
  for(let bz=-1;bz<16;bz++)for(let bx=-1;bx<16;bx++){
    const cur=src.blockAt(bx,bz);if(!cur)continue;
    if(tileById(cur.id).genRole!=="platform")continue;
    for(let dir=0;dir<4;dir++){
      const DX=[1,-1,0,0],DZ=[0,0,1,-1];
      const nb=src.blockAt(bx+DX[dir],bz+DZ[dir]);if(!nb)continue;
      const r=tileById(nb.id).genRole;
      if(r==="platform"){platPlat++;continue;}
      if(r==="pit"){platPit++;continue;}
      if(r==="liquid"){platLiq++;continue;}
      if(r==="ground"&&nb.h<cur.h-0.05)bevEdges++;
    }
  }
  console.log(`[圆角边] platform→ground(低)=${bevEdges}（应圆滑） platform→platform=${platPlat} platform→pit=${platPit} platform→liquid=${platLiq}（应棱角）`);
  // ---- 圆角剖面：找一条圆滑边验证外凸弧 + 墙顶跟随 ----
  const DX=[1,-1,0,0],DZ=[0,0,1,-1];
  let done=false;
  for(let bz=0;bz<15&&!done;bz++)for(let bx=0;bx<15&&!done;bx++){
    const cur=src.blockAt(bx,bz);if(!cur||tileById(cur.id).genRole!=="platform")continue;
    for(let dir=0;dir<4&&!done;dir++){
      const nb=src.blockAt(bx+DX[dir],bz+DZ[dir]);
      if(!nb||tileById(nb.id).genRole!=="ground"||nb.h>=cur.h-0.05)continue;
      const edgeX=dir===0?(bx+1)*4:dir===1?bx*4:bx*4+2;
      const edgeZ=dir===2?(bz+1)*4:dir===3?bz*4:bz*4+2;
      const Y=cur.h;
      console.log(`[弧剖面] 块(${bx},${bz}) Y=${Y.toFixed(2)} 棱=世界(${edgeX},${edgeZ}) dir=${dir}`);
      for(let d=0.45;d>=-0.05;d-=0.05){
        const px=dir<2?edgeX-d:edgeX, pz=dir<2?edgeZ:edgeZ-d;
        const q=postSurfaceHeightAt(raster as any,px,pz);
        const exp=d>=0.3?Y:Y-0.3+Math.sqrt(Math.max(0,2*0.3*d-d*d));
        console.log(`  d=${d.toFixed(2)} 查询=${q.toFixed(3)} 理论=${Math.min(Y,exp).toFixed(3)} ${Math.abs(q-Math.min(Y,exp))<0.02?"✓":"✗"}`);
      }
      // 墙顶跟随：墙缓冲顶边 y 应 ≈ Y-R（棱处）
      const walls=buildChunkWallBuffers(src,0,0,N,{seed,palette:undefined,heightAt:()=>0,tileDefAt:()=>({visual:{baseHsl:{h:0,s:0,l:0.5}},isDepression:false} as any)});
      // 找 (edgeX,edgeZ) 附近的墙顶点
      let best=1e9;
      for(let i=0;i<walls.vertices.length/3;i++){
        const wx=walls.vertices[i*3]+30,wz=walls.vertices[i*3+2]+30;
        if(Math.abs(wx-edgeX)<0.01&&Math.abs(wz-edgeZ)<0.01){
          const dy=Math.abs(walls.vertices[i*3+1]-(Y-0.3));
          if(dy<best)best=dy;
        }
      }
      console.log(`  [墙顶跟随] 棱处墙顶与(Y-R)=${(Y-0.3).toFixed(2)} 最近偏差=${best<1e9?best.toFixed(4):"无墙顶点"} ${best<0.02?"✓":"✗"}`);
      done=true;
    }
  }
  // ---- 禁挖带：坑/裂命中块中邻高台/插值的比例 ----
  let pitBlocks=0,pitNear=0;
  for(let bz=0;bz<15;bz++)for(let bx=0;bx<15;bx++){
    const cur=src.blockAt(bx,bz);if(!cur)continue;
    const role=tileById(cur.id).genRole;
    if(role==="liquid"||role==="pit")continue;
    let near=false;
    for(let dir=0;dir<4;dir++){
      const nb=src.blockAt(bx+DX[dir],bz+DZ[dir]);
      if(nb&&tileById(nb.id).genRole==="platform")near=true;
    }
    // 坑命中判定：块内多点查询有负偏移且非圆角带（圆角也会负）——用远离棱的中心区
    let hasPit=false;
    for(let kx=1;kx<4;kx++)for(let kz=1;kz<4;kz++){
      const q=postSurfaceHeightAt(raster as any,bx*4+kx,bz*4+kz);
      if(q<(raster as any).surfaceHeightAt(bx*4+kx,bz*4+kz)-1e-6){hasPit=true;}
    }
    if(hasPit){pitBlocks++;if(near)pitNear++;}
  }
  console.log(`[禁挖带] 有凹陷的块=${pitBlocks}，其中邻高台=${pitNear}（应=0）`);
}
