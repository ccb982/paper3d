// ============================================================
// proceduralShip —— 程序化军武运输舰（GLB 未就位时的内置模型）
// ============================================================
// 造型基调（2026-09-12 二版：去丑化——克制、流线、军武）：
//   · 楔形分段船体 + 背脊线（loft 硬边面）——靠形状分段与面板分缝显精细
//   · 双引擎舱为锥形圆管舱 ×2 + 尾喷口 ×4（自发光，随油门）
//   · 低矮后掠舰岛 + 传感器鳍 + 雷达穹罩（无细杆天线）
//   · 下腹货舱门（暗色 + 两道琥珀描边）——警示色只做"细线点缀"，不铺大色块
//   · 近防炮塔 ×2（小尺寸倒角）+ 翼灯（左红右绿）
//   · 1024² 程序化装甲贴图（面板线/铆钉/风化/小号舷号）
// 机头朝 +Z；姿态枢轴 ≈ 船体几何中心（与 ShipRenderer 姿态组对齐）。
// ============================================================

import * as THREE from 'three';

/** 船体总长（米，机头 +Z；GLB 归一化也用它） */
export const SHIP_LENGTH = 6.6;

export interface ProceduralShip {
  group: THREE.Group;
  /** 喷口发光材质（ShipRenderer.setThrottle 调制） */
  nozzleMat: THREE.MeshBasicMaterial;
  /** 尾焰网格（锥形，随油门伸缩；与 nozzleMat 一起调制） */
  flames: THREE.Mesh[];
  /** 尾焰共享材质（透明度随油门） */
  flameMat: THREE.MeshBasicMaterial;
}

/** 尾焰几何：锥体沿 -Z（apex 朝后），顶点色从喷口(亮)到焰尖(暗)渐变 */
function makeFlameGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.14, 1.0, 8, 1, true);
  g.rotateX(-Math.PI / 2); // 轴 +Y → -Z（apex 指向机尾方向）
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) + 0.5) / 1.0; // 0=焰尖 .. 1=喷口
    const k = 0.2 + 0.8 * t;
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// ---- 确定性随机（同参数同结果，便于回归对照） ----
let randSeed = 0x51ed270b;
const rnd = (): number => {
  randSeed = (randSeed * 1664525 + 1013904223) >>> 0;
  return randSeed / 4294967296;
};

const hexToRgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
];
const rgbCss = (c: [number, number, number], mul = 1): string => {
  const f = (v: number): number => Math.round(Math.min(1, Math.max(0, v * mul)) * 255);
  return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
};

// ============================================================
// 程序化装甲贴图（1024²；面板分缝 + 风化，无大色块）
// ============================================================

const HULL_BASE = 0x8d96a3;

function makeHullTexture(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const base = hexToRgb(HULL_BASE);
  // ① 面板明度抖动（64px 分块）
  for (let y = 0; y < S; y += 64) {
    for (let x = 0; x < S; x += 64) {
      g.fillStyle = rgbCss(base, 0.9 + rnd() * 0.18);
      g.fillRect(x, y, 64, 64);
    }
  }
  // ② 面板分缝（64px 细线 / 256px 粗线）
  g.strokeStyle = 'rgba(38,44,52,0.6)';
  for (let i = 0; i <= S; i += 64) {
    g.lineWidth = i % 256 === 0 ? 4 : 2;
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }
  // ③ 铆钉
  g.fillStyle = 'rgba(30,35,42,0.45)';
  for (let y = 32; y < S; y += 128) {
    for (let x = 16; x < S; x += 32) g.fillRect(x, y, 3, 3);
  }
  // ④ 风化竖条 + 高光擦痕
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, w = 2 + rnd() * 10, h = 60 + rnd() * 320, y = rnd() * S;
    g.fillStyle = `rgba(25,28,34,${0.03 + rnd() * 0.05})`;
    g.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S, y = rnd() * S, w = 20 + rnd() * 120;
    g.fillStyle = `rgba(220,228,238,${0.02 + rnd() * 0.04})`;
    g.fillRect(x, y, w, 1 + rnd() * 2);
  }
  // ⑤ 舷号（减小字号、压暗，做"军标"而非涂鸦）
  g.save();
  g.translate(S * 0.70, S * 0.62);
  g.fillStyle = 'rgba(52,60,72,0.75)';
  g.font = 'bold 56px Consolas, monospace';
  g.fillText('RD-07', 0, 0);
  g.font = '20px Consolas, monospace';
  g.fillStyle = 'rgba(52,60,72,0.5)';
  g.fillText('TRANSPORT', 4, 28);
  g.restore();
  // ⑥ 克制的琥珀警示小段（只做短线点缀，不铺色块）
  g.fillStyle = 'rgba(216,166,58,0.85)';
  for (let i = 0; i < 4; i++) {
    g.fillRect(24 + i * 20, S * 0.5 - 3, 12, 6);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ============================================================
// loft（硬边面：逐面独立顶点 → 平面法线；截面可换）
// ============================================================

/** 船体截面（八边形；归一化 x/y） */
const HULL_SECTION: [number, number][] = [
  [0, 1], [0.62, 0.72], [0.98, 0.18], [0.82, -0.62],
  [0, -0.9], [-0.82, -0.62], [-0.98, 0.18], [-0.62, 0.72],
];
/** 圆管截面（引擎舱） */
const ROUND_SECTION: [number, number][] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)] as [number, number];
});
/** 菱形截面（背脊线） */
const SPINE_SECTION: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

interface Station {
  /** 站位（+Z 舰首 → -Z 舰尾） */
  z: number;
  /** 截面中心高度 */
  y: number;
  /** 截面宽/高缩放（0..1） */
  sx: number;
  sy: number;
}

function loftHull(
  stations: Station[],
  halfW: number,
  halfH: number,
  section: [number, number][] = HULL_SECTION,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const n = stations.length;
  const m = section.length;
  const pt = (st: Station, k: number): [number, number, number] => [
    section[k][0] * st.sx * halfW,
    st.y + section[k][1] * st.sy * halfH,
    st.z,
  ];
  const tri = (
    a: number[], b: number[], c: number[],
    ua: number, va: number, ub: number, vb: number, uc: number, vc: number,
  ): void => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    uv.push(ua, va, ub, vb, uc, vc);
  };
  for (let i = 0; i < n - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const v0 = i / (n - 1), v1 = (i + 1) / (n - 1);
      const u0 = k / m, u1 = (k + 1) / m;
      const a0 = pt(a, k), a1 = pt(a, k2), b0 = pt(b, k), b1 = pt(b, k2);
      // ⚠️ 绕序：截面顺时针 + 站位沿 -Z 推进 → 必须先环内再环间，法线才朝外
      tri(a0, a1, b0, u0, v0, u1, v0, u0, v1);
      tri(a1, b1, b0, u1, v0, u1, v1, u0, v1);
    }
  }
  // 首尾风扇盖（front = 舰首 +Z 朝向 +Z；rear 反之）
  const cap = (st: Station, front: boolean): void => {
    const c: [number, number, number] = [0, st.y, st.z];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const p0 = pt(st, k), p1 = pt(st, k2);
      if (front) tri(c, p1, p0, 0.5, 0.5, 1, 1, 0, 1);
      else tri(c, p0, p1, 0.5, 0.5, 0, 1, 1, 1);
    }
  };
  cap(stations[0], true);
  cap(stations[n - 1], false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 单侧机翼（标准后掠翼：前缘后掠、后缘平直；sign=+1 右 / -1 左）
 *  形状坐标 x=展向、y 经 rotateX(-90°) 映射为世界 -Z（y+ = 后缘方向） */
function wingGeometry(sign: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  // ⚠️ 翼根 x 必须同乘 sign（否则左右翼根偏向同侧 → 机翼不对称/悬空）
  s.moveTo(sign * 0.15, -1.0);   // 翼根前缘（世界 z ≈ +1.0）
  s.lineTo(sign * 1.85, 0.35);   // 翼尖前缘（后掠 ~35°）
  s.lineTo(sign * 1.5, 0.95);    // 翼尖后缘
  s.lineTo(sign * 0.1, 0.9);     // 翼根后缘（后缘近似平直）
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  // 翼根嵌入船体侧壁（±0.6 + 翼根 0.15 ≈ 0.75 < 该高度船体半宽 ≈0.77~0.88）
  m.position.set(sign * 0.6, -0.06, -0.3);
  m.rotation.z = sign * 0.06; // 轻微上反角
  return m;
}

/** 后掠传感器鳍（形状在 XY：x=后掠长、y=高；挤出厚度转 X） */
function finGeometry(mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.05, 0.4);
  s.lineTo(-0.42, 0.5);
  s.lineTo(-0.66, 0.02);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.07, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1,
  });
  g.rotateY(Math.PI / 2); // 形状 +X → 世界 -Z（后掠）；厚度 → +X
  const m = new THREE.Mesh(g, mat);
  // ★ 尾鳍单独后移（用户定调）：移到舰尾（origin -2.7 → 尾缘 -3.36），
  //   由下方鳍座（组装处）托住，不悬空
  m.position.set(0, 0.76, -2.98);
  return m;
}

// ============================================================
// 组装
// ============================================================

export function buildProceduralShip(): ProceduralShip {
  const group = new THREE.Group();
  const hullTex = makeHullTexture();
  const hullMat = new THREE.MeshStandardMaterial({
    map: hullTex, roughness: 0.78, metalness: 0.18, side: THREE.DoubleSide,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a414b, roughness: 0.85, metalness: 0.22 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd8a63a, roughness: 0.65, metalness: 0.1 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const nozzleMat = new THREE.MeshBasicMaterial({ color: 0x8fdcff });
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x5aff8a });
  // 尾焰：加法混合 + 顶点色渐变（近喷口亮白蓝 → 焰尖透明）
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x8fd0ff, vertexColors: true, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flameGeo = makeFlameGeometry();
  const flames: THREE.Mesh[] = [];

  const add = <T extends THREE.BufferGeometry>(
    geo: T, mat: THREE.Material,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  // ① 主船体（更细的站位 → 楔形过渡更顺）
  const stations: Station[] = [
    { z: 3.25, y: 0.10, sx: 0.08, sy: 0.2 },
    { z: 2.85, y: 0.08, sx: 0.24, sy: 0.34 },
    { z: 2.30, y: 0.05, sx: 0.46, sy: 0.54 },
    { z: 1.60, y: 0.02, sx: 0.68, sy: 0.72 },
    { z: 0.70, y: 0.00, sx: 0.88, sy: 0.9 },
    { z: -0.30, y: 0.00, sx: 1.0, sy: 1.0 },
    { z: -1.50, y: 0.00, sx: 1.0, sy: 1.0 },
    { z: -2.50, y: 0.01, sx: 0.94, sy: 0.95 },
    { z: -3.25, y: 0.04, sx: 0.74, sy: 0.82 },
  ];
  add(loftHull(stations, 0.95, 0.55), hullMat);
  // ② 背脊线（菱形截面）：从舰首一路延伸到尾部舰岛（中部留白）
  add(loftHull([
    { z: 2.15, y: 0.33, sx: 0.35, sy: 0.45 },
    { z: 1.25, y: 0.43, sx: 0.8, sy: 0.75 },
    { z: 0.25, y: 0.5, sx: 1.0, sy: 1.0 },
    { z: -0.75, y: 0.53, sx: 0.92, sy: 0.9 },
    { z: -1.55, y: 0.54, sx: 0.72, sy: 0.78 },
  ], 0.12, 0.085, SPINE_SECTION), hullMat);
  // ③ 尾部舰岛（2026-09-12 用户定调：中部清空，指挥/电子舱全部集中到引擎段上方）
  add(loftHull([
    { z: -1.6, y: 0.5, sx: 0.58, sy: 0.46 },
    { z: -2.2, y: 0.53, sx: 1.0, sy: 1.0 },
    { z: -3.05, y: 0.5, sx: 0.8, sy: 0.84 },
  ], 0.62, 0.3), darkMat);
  // 舷窗灯带：贴舰岛前脸（舰岛前脸 y 0.38~0.64，取中段）
  add(new THREE.BoxGeometry(0.8, 0.06, 0.04), windowMat, 0, 0.50, -1.585);
  // ④ 尾鳍（单独后移到舰尾，尾缘 ≈ -3.64）+ 鳍座 + 雷达穹罩留在舰岛尾段
  add(new THREE.BoxGeometry(0.08, 0.34, 0.62), darkMat, 0, 0.60, -3.22);
  group.add(finGeometry(darkMat));
  add(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), darkMat, 0, 0.72, -2.4);
  // ⑤ 引擎舱 ×2（锥形圆管舱）+ 挂架 + 外侧散热格栅 + 尾喷口 ×4
  const nacelleStations: Station[] = [
    { z: -0.75, y: 0, sx: 0.5, sy: 0.5 },
    { z: -1.25, y: 0, sx: 1.0, sy: 1.0 },
    { z: -2.5, y: 0, sx: 1.0, sy: 1.0 },
    { z: -2.92, y: 0, sx: 0.78, sy: 0.78 },
  ];
  for (const s of [-1, 1]) {
    add(loftHull(nacelleStations, 0.34, 0.34, ROUND_SECTION), hullMat, s * 1.16, 0.0, 0);
    add(new THREE.BoxGeometry(0.42, 0.12, 0.85), darkMat, s * 0.88, 0.02, -1.75);
    for (const gz of [-1.5, -1.75, -2.0]) {
      add(new THREE.BoxGeometry(0.06, 0.28, 0.16), darkMat, s * 1.52, 0, gz);
    }
    for (const dx of [-0.16, 0.16]) {
      add(
        new THREE.CylinderGeometry(0.2, 0.23, 0.3, 12, 1, true),
        darkMat, s * 1.16 + dx, 0, -2.98, Math.PI / 2, 0, 0,
      );
      add(new THREE.CircleGeometry(0.17, 16), nozzleMat, s * 1.16 + dx, 0, -3.14, 0, Math.PI, 0);
      // 尾焰（锥沿 -Z；scale.z 由 setThrottle 调制）
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(s * 1.16 + dx, 0, -3.16);
      flame.scale.set(1, 1, 0.25);
      flame.visible = false;
      group.add(flame);
      flames.push(flame);
    }
  }
  // ⑥ 机翼（无尾鳍）+ 翼尖舷灯
  group.add(wingGeometry(1, hullMat));
  group.add(wingGeometry(-1, hullMat));
  for (const s of [-1, 1]) {
    // 翼尖后缘中点（新翼型：翼尖弦 z -0.65 ~ -1.25；翼尖 x ≈ ±2.45）
    add(new THREE.SphereGeometry(0.05, 8, 6), s < 0 ? redMat : greenMat, s * 2.35, 0.02, -0.95);
  }
  // ⑦ 下腹货舱门（后置到舰岛下方；暗色 + 两道琥珀细描边）
  add(new THREE.BoxGeometry(1.28, 0.1, 1.0), darkMat, 0, -0.5, -1.95);
  add(new THREE.BoxGeometry(1.3, 0.02, 0.05), accentMat, 0, -0.545, -1.47);
  add(new THREE.BoxGeometry(1.3, 0.02, 0.05), accentMat, 0, -0.545, -2.43);
  // ⑧ RCS 姿态喷口（功能自洽：舰首侧向 ×2 + 尾部侧向 ×2）
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6), darkMat, s * 0.55, 0.08, 1.8, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 6), darkMat, s * 0.9, 0.06, -2.25, 0, 0, Math.PI / 2);
  }
  // ⑨ 舰首下颌传感器 + 灯（舰首保留识别特征）
  add(new THREE.BoxGeometry(0.4, 0.14, 0.4), darkMat, 0, -0.27, 2.35);
  add(new THREE.CircleGeometry(0.06, 10), windowMat, 0, -0.27, 2.56);

  return { group, nozzleMat, flames, flameMat };
}

/** 释放物体树（几何 + 材质 + 贴图；共享材质重复 dispose 无害） */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      std.map?.dispose();
      m.dispose();
    }
  });
}
