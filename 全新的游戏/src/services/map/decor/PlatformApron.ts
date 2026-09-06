// ============================================================
// PlatformApron —— 沙土高台石围裙（装饰性实体；用户手绘 JSON 定稿 2026-09-05）
// ============================================================
// 语义（《装饰性实体，石头围裙.json》+ 用户二轮定调）：
//   · 石质压边环完整包围 1~2 个相邻沙土高台块：30% 高台成为锚点
//     （锚点判定见 ApronAnchor.ts，与地形精修共享），锚点可并上东/南
//     邻块（非锚点）组成二块单元；环四边无条件全有
//     （用户：四个边都要有，完整包围）；
//   · ★ 四条边不要有坡面（用户 2026-09-05）——两侧共同保证：
//     a) 地形期：Refinements.planRefinements 对锚点相关块的边跳过 30%
//        产坡骰（水/坑的无条件 weld 地形侧管不到）；
//     b) 围裙期：建环前逐边采样高度剖面，检出缓坡（weld 斜坡/水坑
//        插值/弹坑唇）→ 整单元弃环。石环只会坐在垂直坎上；
//   · 压边比台面高 +0.35m（用户 2026-09-06 定版）；外缘微悬挑
//     0.04m 盖缝 + 下裙垂直包住侧壁；裙底 0.15m 细采样 + 贴地邻域取最大
//     再下埋 0.06m（用户：围墙下部要接地——低处埋地、高处贴合、永不悬空）；
//     裙深无上限钳制（用户：很高高台也不接地——原 1.5m 上限已废，
//     cliff 处裙深天然≤台高，保底 0.15m 仍在）；
//   · ★ 光照重映射（用户 2026-09-06：两个边很暗）——onBeforeCompile 把
//     RE_Direct 的 dotNL 换成地形同款 dirMod = clamp(max(N·L,0.12)/L.y,
//     0.85~1.2)：背光侧不再只剩环境光近黑，顺背光幅度与 TerrainMaterial
//     一致；
//   · 表面小裂痕 + 石纹 = 程序化 CanvasTexture（模块级单例共享；
//     基色 = 水泥灰 #6f6f6a（2026-09-06 与台座实体同色），
//     裂痕深灰细折线 + 风化色斑 + 颗粒）；
//   · 防叠环（两环共边会 z-fighting）：锚点四邻域不得含任何锚点/已环块；
//     并块的其余邻域同理；跨 chunk 边界用世界块坐标确定性哈希求值
//     邻块锚点资格（同函数同结果）→ 两 chunk 独立构建也不会共边叠环；
//   · 角部闭合（相框式 45° 斜切，用户 2026-09-05：角部墙裙要闭合）：
//     边端若是真角（垂直边属于周界）→ 内缘缩进 BAND_W、外缘外延
//     OVERHANG——两向边在角上共享同一条斜切线（顶面）与同一个外角
//     竖直线（下裙/内 Step），三层几何全闭合；直线延续端（二块单元
//     拼接侧）不缩不延 → 两段精确对接；闭环无自由端 → 无端帽；
//   · 物理碰撞（用户 2026-09-06 定版：墙裙属于高台的一部分，用与地形
//     同样的逻辑）：围裙几何输出 trimesh（块中心相对坐标系），由调用方
//     经宿主 createGround 建独立地面刚体——与地形顶面/侧壁同一 entity
//     kind、同一套碰撞管线（角色/子弹行为与高台 cliff 完全一致）。
//     ★ 勿改回独立 cuboid 盒：0.35m 垂直薄盒与地面 trimesh 挤压去穿透
//     会抖动穿模甚至物理爆炸（角色接近即卡退，已踩坑）；角部双盒重叠
//     还会双重解算。
//   · 高度解析（用户 2026-09-06：墙裙的参数也交给高度解析）：角色贴地走
//     RasterMap.surfaceHeightAt 解析采样（不查物理 trimesh）→ 周界边计划
//     （planPlatformAprons）被高度解析叠加消费（apronBandHeightAt），
//     带顶 = 基面 + CURB_H，与视觉几何同源同高 → 看得见的墙裙=站得上的
//     墙裙。buildPlatformAprons 采样改用基面高度（baseSurfaceHeightAt）
//     防自反馈（采样到自己的带顶会循环抬升）。
//     ★ CURB_H=0.35 ≡ CharacterBase.EDGE_CLIFF_BAND：落地态 `gy-p.y > 0.35`
//     才回退 → 恰好压线可被 clamp 自动踏过；调 CURB_H 必须 ≤ EDGE_CLIFF_BAND
//     否则角色上不去（只能跳）。
//   · 不做烘焙影（体积趋零）。
// ============================================================

import * as THREE from 'three';
import { TERRAIN_LIGHT_TUNING } from '../TerrainMaterial';
import { tileById } from '../Tiles';
import { CHUNK_SIZE } from '../ChunkGenerator';
import { APRON_ANCHOR_P, apronAnchorRoll } from './ApronAnchor';

// ---- 形态常量（手绘 JSON 换算） ----
const CURB_H = 0.35;      // 压边高出台面（用户 2026-09-06 定版 0.35m）
const BAND_W = 0.36;      // 顶面石框宽（内缩；≥ bevel 0.3 盖住台缘坡面）
const OVERHANG = 0.04;    // 外悬量（盖住台缘顶面/侧壁接缝）
const STEP = 0.5;         // 沿边采样步长（台缘高度跟随机密度的下限）
const SKIRT_BURY = 0.06;  // 下裙底埋入邻面深度（防浮缝）
const MIN_SKIRT = 0.15;   // 下裙最小深度（安全网）；无上限——高台全高包壁
                          // 才能接地（用户 2026-09-06：很高高台的裙不接地，
                          // 原 MAX_SKIRT=1.5 钳制已废；cliff 处裙深天然≤台高）
// ---- dirMod（地形同款公式；窄 clamp 使墙裙四边亮度一致） ----
const APRON_DIR_MOD_MIN = 0.97;
const APRON_DIR_MOD_MAX = 1.0;

// ---- 共享纹理生成（PRNG + Canvas） ----
function texRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeApronTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#6f6f6a';
  g.fillRect(0, 0, S, S);
  const rnd = texRng(0x5a1d09);
  for (let i = 0; i < 5200; i++) {
    const v = Math.floor((rnd() - 0.5) * 16);
    g.fillStyle = `rgb(${111 + v},${111 + v},${106 + v})`;
    g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1, 1);
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(89,89,86,${0.05 + rnd() * 0.05})`;
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 14 + rnd() * 30, 10 + rnd() * 22, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let c = 0; c < 15; c++) {
    let x = rnd() * S, y = rnd() * S, ang = rnd() * Math.PI * 2;
    g.strokeStyle = `rgba(61,61,58,${0.32 + rnd() * 0.26})`;
    g.lineWidth = rnd() < 0.3 ? 1.6 : 1;
    g.beginPath();
    g.moveTo(x, y);
    const segs = 5 + Math.floor(rnd() * 8);
    for (let i = 0; i < segs; i++) {
      ang += (rnd() - 0.5) * 1.3;
      x += Math.cos(ang) * (8 + rnd() * 22);
      y += Math.sin(ang) * (8 + rnd() * 22);
      g.lineTo(x, y);
      if (rnd() < 0.18) {
        const bang = ang + (rnd() < 0.5 ? 0.9 : -0.9);
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(bang) * (6 + rnd() * 14), y + Math.sin(bang) * (6 + rnd() * 14));
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- 共享 ShaderMaterial（自定义 GLSL；dirMod 写死在模板里，零注入） ----
const APRON_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  varying vec2 vUv;
  varying vec3 vNw;
  void main() {
    vec3 alb = texture2D(uTex, vUv).rgb;
    vec3 N = normalize(vNw);
    vec3 L = normalize(uSunDir);
    // 地形同款 dirMod：N·L / L.y；墙裙窄 clamp 使四边一致
    float dirMod = clamp(
      max(dot(N, L), 0.12) / max(L.y, 0.12),
      ${APRON_DIR_MOD_MIN.toFixed(2)}, ${APRON_DIR_MOD_MAX.toFixed(2)}
    );
    vec3 lit = alb * (uAmbient + uSunColor * dirMod);
    gl_FragColor = vec4(lit, 1.0);
  }
`;

const apronRegistry = new Set<THREE.ShaderMaterial>();
let sharedMat: THREE.ShaderMaterial | null = null;

function apronMaterial(): THREE.ShaderMaterial {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: makeApronTexture() },
      uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uAmbient:  { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNw;
      void main() {
        vUv = uv;
        vNw = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: APRON_FRAG,
    side: THREE.DoubleSide,
  });
  sharedMat.userData.decorShared = true;
  sharedMat.userData.cached = true;
  apronRegistry.add(sharedMat);
  return sharedMat;
}

/** 每帧昼夜调制（由 RenderManager.follow 调用） */
export function updateApronLighting(sun: {
  dir: { x: number; y: number; z: number };
  color: number;
  intensityScale: number;
  daylight: number;
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambDay  = new THREE.Color(T.ambientDay);
  const ambNight = new THREE.Color(T.ambientNight);
  const t = sun.daylight;
  const amb = ambNight.clone().lerp(ambDay, t);
  const ambI = T.ambientNightIntensity + (T.ambientDayIntensity - T.ambientNightIntensity) * t;
  amb.multiplyScalar(ambI);
  const sunC = new THREE.Color(sun.color).multiplyScalar(T.sunIntensity * sun.intensityScale);
  for (const m of apronRegistry) {
    m.uniforms.uSunDir.value.set(sun.dir.x, sun.dir.y, sun.dir.z);
    m.uniforms.uSunColor.value.copy(sunC);
    m.uniforms.uAmbient.value.copy(amb);
  }
}

/** 顶点累积器（非索引三角形 + 面法线 + 逐顶点 UV） */
class QuadSink {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  /** a→b→c→d 四角 + 面法线 + 各角 UV；内部拆两三角 (a,b,c)(a,c,d) */
  quad(
    a: number[], b: number[], c: number[], d: number[],
    n: number[], ua: number[], ub: number[], uc: number[], ud: number[],
  ): void {
    const tris = [a, b, c, a, c, d];
    const uvs = [ua, ub, uc, ua, uc, ud];
    for (let i = 0; i < 6; i++) {
      this.pos.push(tris[i][0], tris[i][1], tris[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
  }
}

/** 边采样点：内缘/外缘顶、内 Step 底（高度全部世界采样实测；裙底走细采样另行生成） */
interface EdgePt {
  ix: number; iz: number; ty: number;  // 内缘 xz + 压边顶 y
  ox: number; oz: number;              // 外缘 xz（顶 y 同 ty）
  ib: number;                          // 内 Step 底 y（台面略埋）
}

/** 世界块坐标 → 地块 key（null = 邻 chunk 未加载） */
type BlockKeyAt = (wx: number, wz: number) => string | null;

/** 围裙物理 trimesh（顶点为 chunk 中心相对坐标系，与地形地面刚体同帧；y 为世界绝对高度） */
export interface ApronPhysics {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** 围裙周界边（chunk 局部坐标 0~60；视觉几何与解析高度共用同一份计划） */
export interface ApronEdge {
  ox: number; oz: number;             // 边原点（块角）
  dx: number; dz: number;             // 沿边方向（单位轴）
  nx: number; nz: number;             // 外法向（单位轴）
  ti0: number; ti1: number;           // 内缘沿边跨度（角端缩进 BAND_W）
  to0: number; to1: number;           // 外缘沿边跨度（角端外延 OVERHANG）
}

/** 围裙采样基面（chunk 局部坐标 (lx,lz) → 世界高度；不含围裙自身贡献） */
export type LocalHeightAt = (lx: number, lz: number) => number;

/**
 * ★ 规划本 chunk 全部围裙周界边（放置决策 + 坡面拒绝；纯函数零 three）。
 * 视觉几何（buildPlatformAprons）与解析高度（RasterMap.surfaceHeightAt 叠加层）
 * 共用本计划 → "看得见的墙裙"与"站得上的墙裙"逐位一致。
 * @param H 基面高度（局部坐标；由调用方绑定 baseSurfaceHeightAt，防自反馈）
 * @param blockKeyAt 世界块坐标 → 地块 key（跨 chunk 防叠环判定用）
 */
export function planPlatformAprons(
  cx: number, cz: number, seed: number,
  blockTypes: Uint8Array | undefined,
  blockKeyAt: BlockKeyAt,
  H: LocalHeightAt,
): ApronEdge[] | null {
  if (!blockTypes) return null;

  // ---- 放置决策（本 chunk 块坐标 bx,bz ∈ [-1,15] 可探邻 chunk） ----
  const key15 = (bx: number, bz: number) => bz * 15 + bx;
  const inChunk = (bx: number, bz: number) => bx >= 0 && bx < 15 && bz >= 0 && bz < 15;
  const tileKey = (bx: number, bz: number): string | null => {
    const wx = cx * 15 + bx, wz = cz * 15 + bz;
    return blockKeyAt(wx, wz);
  };
  const sandPlat = (bx: number, bz: number): boolean => tileKey(bx, bz) === 'platform_sand';
  // 锚点资格：世界块坐标哈希（跨 chunk 两端求值恒一致；与地形精修共享判定）
  const isAnchor = (bx: number, bz: number): boolean =>
    sandPlat(bx, bz) && apronAnchorRoll(cx * 15 + bx, cz * 15 + bz, seed) < APRON_ANCHOR_P;

  const anchorSet = new Set<number>();
  const ringSet = new Set<number>();   // 最终带环块（含被并块）
  for (let bz = 0; bz < 15; bz++) {
    for (let bx = 0; bx < 15; bx++) {
      if (tileById(blockTypes[key15(bx, bz)]).key === 'platform_sand' &&
        apronAnchorRoll(cx * 15 + bx, cz * 15 + bz, seed) < APRON_ANCHOR_P) {
        anchorSet.add(key15(bx, bz));
      }
    }
  }
  // 环占用判定：锚点（保守含最终弃环者）或已成环块；跨界只看对方锚点哈希
  const ringish = (bx: number, bz: number): boolean => {
    if (!inChunk(bx, bz)) return isAnchor(bx, bz);
    return anchorSet.has(key15(bx, bz)) || ringSet.has(key15(bx, bz));
  };
  // 读序贪心：锚点成环（四邻域无环才成），可并东/南邻块为二块单元
  const units: Array<{ bx: number; bz: number; px: number; pz: number }[]> = [];
  const allEdges: ApronEdge[] = [];
  for (let bz = 0; bz < 15; bz++) {
    for (let bx = 0; bx < 15; bx++) {
      const idx = key15(bx, bz);
      if (!anchorSet.has(idx) || ringSet.has(idx)) continue;
      if (ringish(bx + 1, bz) || ringish(bx - 1, bz) || ringish(bx, bz + 1) || ringish(bx, bz - 1)) continue;
      ringSet.add(idx);
      const unit: { bx: number; bz: number; px: number; pz: number }[] = [{ bx, bz, px: -1, pz: -1 }];
      const tryPair = (px: number, pz: number): boolean => {
        if (!inChunk(px, pz) || !sandPlat(px, pz)) return false;
        const pidx = key15(px, pz);
        if (anchorSet.has(pidx) || ringSet.has(pidx)) return false;
        // 并块其余邻域不得有环（防两环共边叠几何）
        const nb: Array<[number, number]> = [[px + 1, pz], [px - 1, pz], [px, pz + 1], [px, pz - 1]];
        for (const [nx, nz] of nb) {
          if (nx === bx && nz === bz) continue;
          if (ringish(nx, nz)) return false;
        }
        ringSet.add(pidx);
        return true;
      };
      if (tryPair(bx + 1, bz)) unit.push({ bx: bx + 1, bz, px: -1, pz: -1 });
      else if (tryPair(bx, bz + 1)) unit.push({ bx, bz: bz + 1, px: -1, pz: -1 });
      units.push(unit);
    }
  }

  // ---- 逐单元建环（周界全部边无条件；闭环无端帽） ----
  for (const unit of units) {
    // 周界边集合："bx,bz,edge"（edge: north/south/west/east）
    const perim = new Set<string>();
    for (const b of unit) {
      const others = unit.filter((o) => o !== b);
      const shared = (ox: number, oz: number) => others.some((o) => o.bx === ox && o.bz === oz);
      if (!shared(b.bx, b.bz - 1)) perim.add(`${b.bx},${b.bz},north`);
      if (!shared(b.bx, b.bz + 1)) perim.add(`${b.bx},${b.bz},south`);
      if (!shared(b.bx - 1, b.bz)) perim.add(`${b.bx},${b.bz},west`);
      if (!shared(b.bx + 1, b.bz)) perim.add(`${b.bx},${b.bz},east`);
    }
    const has = (bx: number, bz: number, e: string) => perim.has(`${bx},${bz},${e}`);

    // ---- 周界边展开（相框式 45° 斜切角：顶面/下裙/内 Step 角部全闭合） ----
    // 真角端（垂直边属于周界）：内缘缩进 BAND_W、外缘外延 OVERHANG
    // —— 两向边共享同一条斜切线与同一个外角竖直线；
    // 直线延续端（二块单元拼接侧）：不缩不延，两段精确对接。
    const edges: ApronEdge[] = [];
    for (const raw of perim) {
      const [bxs, bzs, eKey] = raw.split(',') as [string, string, string];
      const bx = Number(bxs), bz = Number(bzs);
      let ox: number, oz: number, dx: number, dz: number, nx: number, nz: number;
      if (eKey === 'north') { ox = bx * 4; oz = bz * 4; dx = 1; dz = 0; nx = 0; nz = -1; }
      else if (eKey === 'south') { ox = bx * 4; oz = bz * 4 + 4; dx = 1; dz = 0; nx = 0; nz = 1; }
      else if (eKey === 'west') { ox = bx * 4; oz = bz * 4; dx = 0; dz = 1; nx = -1; nz = 0; }
      else { ox = bx * 4 + 4; oz = bz * 4; dx = 0; dz = 1; nx = 1; nz = 0; }
      // 两端角部判定：垂直方向的边属于周界 = 真角
      const c0 = dz === 0 ? has(bx, bz, 'west') : has(bx, bz, 'north');
      const c1 = dz === 0 ? has(bx, bz, 'east') : has(bx, bz, 'south');
      edges.push({
        ox, oz, dx, dz, nx, nz,
        ti0: c0 ? BAND_W : 0, ti1: c1 ? 4 - BAND_W : 4,       // 内缘跨度
        to0: c0 ? -OVERHANG : 0, to1: c1 ? 4 + OVERHANG : 4,  // 外缘跨度
      });
    }

    // ---- ★ 坡面拒绝（用户：四条边不要有坡面） ----
    // 任一周界边外沿是缓坡（weld 斜坡/水坑插值/弹坑唇）→ 整单元弃环。
    // 判据（对全高差鲁棒）：悬崖在界外 0.10m 已落到低面（d10≈d45），
    // 缓坡只先落一小段（w=1.333m 线性坡：d10/d45≈0.22）→
    // d45>0.05 且 d10 < d45×0.5 判为坡。
    let sloped = false;
    for (const e of edges) {
      for (let i = 0; i <= 4; i++) {
        const t = e.to0 + ((e.to1 - e.to0) * i) / 4;
        const px = e.ox + e.dx * t, pz = e.oz + e.dz * t;
        const hin = H(px - e.nx * BAND_W, pz - e.nz * BAND_W);
        const d10 = hin - H(px + e.nx * 0.10, pz + e.nz * 0.10);
        const d45 = hin - H(px + e.nx * 0.45, pz + e.nz * 0.45);
        if (d45 > 0.05 && d10 < d45 * 0.5) { sloped = true; break; }
      }
      if (sloped) break;
    }
    if (sloped) continue;

    allEdges.push(...edges);
  }
  return allEdges.length > 0 ? allEdges : null;
}

/**
 * ★ 围裙解析高度（用户 2026-09-06：墙裙的参数也交给高度解析）：
 * (lx,lz) 落在某条周界边的石框带内 → 带顶高度（基面+CURB_H），否则 null。
 * 点测与几何同一参数化：v 求带内横向 s、u 反解纵向 f（角端斜切 = span 线性
 * 内插），带顶 = H(内缘点@f) + CURB_H —— 与 buildPlatformAprons 逐位同源，
 * 角色贴地/clamp（EDGE_CLIFF_BAND 台阶阈值）与视觉完全一致。
 * 已知 4cm 级差异：带外悬挑落在邻 chunk 侧的 4cm 条由邻 chunk 布局覆盖
 * 不到 → 角色在该缝按基面贴地（化妆品级，可忽略）。
 */
export function apronBandHeightAt(
  edges: ApronEdge[], lx: number, lz: number, H: LocalHeightAt,
): number | null {
  for (const e of edges) {
    const rx = lx - e.ox, rz = lz - e.oz;
    const u = rx * e.dx + rz * e.dz;                       // 沿边坐标
    const v = rx * e.nx + rz * e.nz;                       // 法向坐标（外正）
    const s = (v + BAND_W) / (BAND_W + OVERHANG);          // 0=内缘线 1=外缘线
    if (s < 0 || s > 1) continue;
    const tiLen = e.ti1 - e.ti0;
    const a = e.to0 - e.ti0;                               // 内端角部偏移（0/−OVERHANG）
    const b = (e.to1 - e.to0) - tiLen;                     // 外端角部偏移（0/+OVERHANG）
    const den = tiLen + s * b;
    if (den <= 1e-9) continue;
    const f = (u - e.ti0 - s * a) / den;                   // 0=内端 1=外端
    if (f < 0 || f > 1) continue;
    const ti = e.ti0 + tiLen * f;
    const ix = e.ox + e.dx * ti - e.nx * BAND_W;           // 内缘采样点（与几何同式）
    const iz = e.oz + e.dz * ti - e.nz * BAND_W;
    return H(ix, iz) + CURB_H;
  }
  return null;
}

/**
 * ★ 构建本 chunk 全部石围裙（15% 锚点单元的完整闭环 + 侧壁下裙）。
 * 视觉网格 + 物理 trimesh（调用方经宿主 createGround 建地面刚体，与地形同
 * 管线）；周界计划与解析高度共用 planPlatformAprons → 几何与"站得上"一致。
 * @param surfaceHeightAt 基面高度（世界坐标；★必须传 baseSurfaceHeightAt——
 *   传叠加层会采样到自己的带顶造成自反馈循环抬升）
 * @param blockKeyAt 世界块坐标 → 地块 key（跨 chunk 防叠环判定用）
 */
export function buildPlatformAprons(
  cx: number, cz: number, seed: number,
  blockTypes: Uint8Array | undefined,
  surfaceHeightAt: (x: number, z: number) => number,
  blockKeyAt: BlockKeyAt,
): { mesh: THREE.Mesh; physics: ApronPhysics } | null {
  const edges = planPlatformAprons(cx, cz, seed, blockTypes, blockKeyAt,
    (lx, lz) => surfaceHeightAt(cx * 60 + lx, cz * 60 + lz));
  if (!edges) return null;
  const sink = new QuadSink();
  const H = (lx: number, lz: number) => surfaceHeightAt(cx * 60 + lx, cz * 60 + lz);
  // UV：顶面世界平面 (x,z)/4（4m 一 repeat）；侧面 (x+z) 对角映射 + y/2
  const uvTop = (x: number, z: number): number[] => [x / 4, z / 4];
  const uvSide = (x: number, y: number, z: number): number[] => [(x + z) * 0.177, y / 2];

  // ---- 逐边建几何（顶面 + 内 Step + 外裙） ----
  // 内缘/外缘各有自己的跨度（角端斜切）：同一采样位 f 下 ti≠to，
  // 端部肋线即斜切线，中部肋线近似平行四边形（顶面仍为同一平面）。
  for (const e of edges) {
    const n = Math.max(2, Math.ceil((e.ti1 - e.ti0) / STEP) + 1);
    const pts: EdgePt[] = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const ti = e.ti0 + (e.ti1 - e.ti0) * f;
      const to = e.to0 + (e.to1 - e.to0) * f;
      const ix = e.ox + e.dx * ti - e.nx * BAND_W;              // 内缘点
      const iz = e.oz + e.dz * ti - e.nz * BAND_W;              //（沿法向内缩）
      const oxx = e.ox + e.dx * to + e.nx * OVERHANG;           // 外缘点
      const ozz = e.oz + e.dz * to + e.nz * OVERHANG;           //（含外悬挑）
      const ty = H(ix, iz) + CURB_H;     // 压边顶（用户 2026-09-06：只采样
                                         //  自己高台的高度——外缘/对角点在
                                         //  块界之外，邻块高台更高时会把
                                         //  角部抬起跟着邻居走；内缘点在
                                         //  自己块内，恒为自己高台高度）
      const ib = H(ix, iz) - 0.02;                              // 内 Step 底（略埋台面）
      pts.push({ ix, iz, ty, ox: oxx, oz: ozz, ib });
    }
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      // 顶面（+Y）
      sink.quad(
        [a.ix, a.ty, a.iz], [b.ix, b.ty, b.iz], [b.ox, b.ty, b.oz], [a.ox, a.ty, a.oz],
        [0, 1, 0], uvTop(a.ix, a.iz), uvTop(b.ix, b.iz), uvTop(b.ox, b.oz), uvTop(a.ox, a.oz),
      );
      // 内 Step（顶→底，法线朝环内）
      sink.quad(
        [a.ix, a.ty, a.iz], [b.ix, b.ty, b.iz], [b.ix, b.ib, b.iz], [a.ix, a.ib, a.iz],
        [-e.nx, 0, -e.nz], uvSide(a.ix, a.ty, a.iz), uvSide(b.ix, b.ty, b.iz), uvSide(b.ix, b.ib, b.iz), uvSide(a.ix, a.ib, a.iz),
      );
    }

    // ---- 外裙（细采样接地版；用户 2026-09-06：围墙下部要接地） ----
    // 旧版裙底每 0.5m 单点采样、直边连线——采样点之间地形鼓包（弹坑唇/
    // 坡面/噪点）时直边悬空漏缝。改为 0.15m 细采样条带，每个底点取裙面
    // 附近两个法向深度的地形高度最大值再下埋：低处裙底深入地下不可见、
    // 高处精确贴合地面 → 下沿在数学上永不高于贴地处地形，保证接地。
    // 顶沿用粗采样 ty 的线性插值，与压边外缘折线精确共线（无缝）。
    const mFine = Math.max(1, Math.ceil((e.to1 - e.to0) / 0.15));
    let ptx: number[] | null = null;   // 上一细点 [x, yTop, z]
    let pbt = 0;                       // 上一细点裙底 y
    for (let j = 0; j <= mFine; j++) {
      const f = j / mFine;
      const to = e.to0 + (e.to1 - e.to0) * f;
      const gx = e.ox + e.dx * to, gz = e.oz + e.dz * to;      // 界上点
      const pxo = gx + e.nx * OVERHANG, pzo = gz + e.nz * OVERHANG;
      // 顶沿：粗采样 ty 线性插值（pts 的 to 均匀 → 段号线性映射）
      const seg = Math.min(n - 2, Math.floor(f * (n - 1)));
      const lf = f * (n - 1) - seg;
      const ty = pts[seg].ty + (pts[seg + 1].ty - pts[seg].ty) * lf;
      // 裙底：贴地邻域取最大（贴壁侧优先——坡面越靠近壁越高）
      const hWall = H(pxo + e.nx * 0.02, pzo + e.nz * 0.02);
      const hOut = H(pxo + e.nx * 0.08, pzo + e.nz * 0.08);
      const rawSy = Math.max(hWall, hOut) - SKIRT_BURY;
      const sy = Math.min(rawSy, ty - MIN_SKIRT);   // 无上限钳制：高台全高包壁才接地
      if (ptx) {
        sink.quad(
          [ptx[0], ptx[1], ptx[2]], [pxo, ty, pzo], [pxo, sy, pzo], [ptx[0], pbt, ptx[2]],
          [e.nx, 0, e.nz], uvSide(ptx[0], ptx[1], ptx[2]), uvSide(pxo, ty, pzo), uvSide(pxo, sy, pzo), uvSide(ptx[0], pbt, ptx[2]),
        );
      }
      ptx = [pxo, ty, pzo];
      pbt = sy;
    }
  }
  if (sink.pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uv, 2));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, apronMaterial());
  mesh.name = 'platform_apron';
  // ---- 物理 trimesh（块中心相对坐标系：x/z − CHUNK_SIZE/2，与地形地面刚体同帧；
  //      非索引 quad 展开 → 顺序索引；子弹命中等同地形命中，可正常打补丁重建） ----
  const half = CHUNK_SIZE / 2;
  const n3 = sink.pos.length;
  const vertices = new Float32Array(n3);
  for (let i = 0; i < n3; i += 3) {
    vertices[i] = sink.pos[i] - half;
    vertices[i + 1] = sink.pos[i + 1];
    vertices[i + 2] = sink.pos[i + 2] - half;
  }
  const triCount = n3 / 9;
  const indices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount * 3; t++) indices[t] = t;
  return { mesh, physics: { vertices, indices } };
}
