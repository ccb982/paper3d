// ============================================================
// proceduralShip —— 程序化军武运输舰（GLB 未就位时的内置模型）
// ============================================================
// 目标（对齐"500KB 模型"的观感预算，但不占下载体积）：
//   · 楔形分段船体（loft 硬边面 + 装甲带分缝）——形状分段清晰，不靠面数
//   · 双引擎舱 ×2 + 尾部喷口 ×4（自发光，随油门增亮）
//   · 舰岛/桅杆/雷达罩 + 舷窗灯带
//   · 下腹货舱门（黄黑警示带）+ 近防炮塔 ×2 + 翼灯（左红右绿）
//   · 1024² 程序化装甲贴图（面板线/铆钉/风化/舷号/警示条）
// 机头朝 +Z；姿态枢轴 ≈ 船体几何中心（与 ShipRenderer 姿态组对齐）。
// ============================================================

import * as THREE from 'three';

/** 船体总长（米，机头 +Z；GLB 归一化也用它） */
export const SHIP_LENGTH = 6.6;

export interface ProceduralShip {
  group: THREE.Group;
  /** 喷口发光材质（ShipRenderer.setThrottle 调制） */
  nozzleMat: THREE.MeshBasicMaterial;
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
// 程序化装甲贴图（1024²；等效 500KB 预算里的"贴图大头"）
// ============================================================

const HULL_BASE = 0x8d96a3;

/** 黄黑 45° 警示条带（货舱门/船体装饰用） */
function drawStripeBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#151a20';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#d8a63a';
  const step = 28;
  for (let i = -h; i < w; i += step * 2) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + h, y);
    g.lineTo(x + i + h + step, y);
    g.lineTo(x + i + step, y + h);
    g.closePath();
    g.fill();
  }
  g.restore();
}

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
  g.strokeStyle = 'rgba(38,44,52,0.65)';
  for (let i = 0; i <= S; i += 64) {
    g.lineWidth = i % 256 === 0 ? 4 : 2;
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }
  // ③ 铆钉
  g.fillStyle = 'rgba(30,35,42,0.5)';
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
  // ⑤ 舷号（贴到船体舷侧）
  g.save();
  g.translate(S * 0.70, S * 0.62);
  g.fillStyle = 'rgba(52,60,72,0.9)';
  g.font = 'bold 84px Consolas, monospace';
  g.fillText('RD-07', 0, 0);
  g.font = '26px Consolas, monospace';
  g.fillStyle = 'rgba(52,60,72,0.65)';
  g.fillText('TRANSPORT / 07', 4, 36);
  g.restore();
  // ⑥ 警示条带
  drawStripeBand(g, S * 0.06, S * 0.86, S * 0.34, 46);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ============================================================
// 船体 loft（硬边面：逐面独立顶点 → 平面法线）
// ============================================================

/** 截面（归一化 x/y；半宽半高由 loft 参数给） */
const HULL_SECTION: [number, number][] = [
  [0, 1], [0.62, 0.72], [0.98, 0.18], [0.82, -0.62],
  [0, -0.9], [-0.82, -0.62], [-0.98, 0.18], [-0.62, 0.72],
];

interface Station {
  /** 站位（+Z 舰首 → -Z 舰尾） */
  z: number;
  /** 截面中心高度 */
  y: number;
  /** 截面宽/高缩放（0..1） */
  sx: number;
  sy: number;
}

function loftHull(stations: Station[], halfW: number, halfH: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const n = stations.length;
  const m = HULL_SECTION.length;
  const pt = (st: Station, k: number): [number, number, number] => [
    HULL_SECTION[k][0] * st.sx * halfW,
    st.y + HULL_SECTION[k][1] * st.sy * halfH,
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
      tri(a0, b0, a1, u0, v0, u0, v1, u1, v0);
      tri(a1, b0, b1, u1, v0, u0, v1, u1, v1);
    }
  }
  // 首尾风扇盖
  const cap = (st: Station, front: boolean): void => {
    const c: [number, number, number] = [0, st.y, st.z];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const p0 = pt(st, k), p1 = pt(st, k2);
      if (front) tri(c, p0, p1, 0.5, 0.5, 0, 1, 1, 1);
      else tri(c, p1, p0, 0.5, 0.5, 1, 1, 0, 1);
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

/** 单侧机翼（swept 梯形挤出；sign=+1 右 / -1 左） */
function wingGeometry(sign: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(0, 1.05);
  s.lineTo(sign * 1.85, -0.1);
  s.lineTo(sign * 1.62, -0.78);
  s.lineTo(sign * 0.1, -0.95);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(sign * 0.82, -0.06, -0.3);
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

  const add = (
    geo: THREE.BufferGeometry, mat: THREE.Material,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  // ① 主船体（楔形分段）
  const stations: Station[] = [
    { z: 3.25, y: 0.10, sx: 0.10, sy: 0.22 },
    { z: 2.35, y: 0.06, sx: 0.44, sy: 0.52 },
    { z: 1.30, y: 0.02, sx: 0.74, sy: 0.76 },
    { z: 0.10, y: 0.00, sx: 0.94, sy: 0.94 },
    { z: -1.50, y: 0.00, sx: 1.00, sy: 1.00 },
    { z: -2.70, y: 0.02, sx: 0.96, sy: 0.96 },
    { z: -3.25, y: 0.05, sx: 0.80, sy: 0.84 },
  ];
  add(loftHull(stations, 0.95, 0.55), hullMat);
  // ② 装甲带 ×2（凸出轮廓的分缝）
  add(new THREE.BoxGeometry(1.96, 1.16, 0.16), darkMat, 0, 0, 0.6);
  add(new THREE.BoxGeometry(2.0, 1.18, 0.16), darkMat, 0, 0, -1.05);
  // ③ 舰岛 + 顶台 + 舷窗灯带
  add(new THREE.BoxGeometry(1.3, 0.5, 1.25), darkMat, 0, 0.72, -1.15);
  add(new THREE.BoxGeometry(0.88, 0.22, 0.86), darkMat, 0, 1.05, -1.25);
  add(new THREE.BoxGeometry(1.32, 0.1, 0.06), windowMat, 0, 0.8, -0.52);
  // ④ 桅杆 + 雷达罩
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 6), darkMat, 0, 1.55, -1.35);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), darkMat, 0, 1.98, -1.35, Math.PI / 2, 0, 0);
  // ⑤ 引擎舱 ×2 + 挂架 + 喷口 ×4
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.62, 0.62, 2.0), hullMat, s * 1.12, 0.02, -1.85);
    add(new THREE.BoxGeometry(0.5, 0.16, 0.9), darkMat, s * 0.85, 0.04, -1.7);
    for (const dx of [-0.17, 0.17]) {
      add(
        new THREE.CylinderGeometry(0.24, 0.27, 0.34, 12, 1, true),
        darkMat, s * 1.12 + dx, 0.02, -2.95, Math.PI / 2, 0, 0,
      );
      add(new THREE.CircleGeometry(0.2, 16), nozzleMat, s * 1.12 + dx, 0.02, -3.13, 0, Math.PI, 0);
    }
  }
  // ⑥ 机翼 + 翼尖安定面 + 舷灯
  group.add(wingGeometry(1, hullMat));
  group.add(wingGeometry(-1, hullMat));
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 0.58, 0.78), darkMat, s * 2.5, 0.24, -0.75);
    add(new THREE.SphereGeometry(0.055, 8, 6), s < 0 ? redMat : greenMat, s * 2.55, 0.05, -0.4);
  }
  // ⑦ 下腹货舱门（警示）+ 侧舱口
  add(new THREE.BoxGeometry(1.3, 0.12, 1.05), accentMat, 0, -0.55, -0.9);
  add(new THREE.BoxGeometry(0.5, 0.1, 0.5), accentMat, 0.78, -0.32, 1.1);
  add(new THREE.BoxGeometry(0.5, 0.1, 0.5), accentMat, -0.78, -0.32, 1.1);
  // ⑧ 舰首下颌传感器 + 航行灯
  add(new THREE.BoxGeometry(0.42, 0.16, 0.42), darkMat, 0, -0.28, 2.35);
  add(new THREE.CircleGeometry(0.07, 10), windowMat, 0, -0.28, 2.57, 0, 0, 0);
  // ⑨ 近防炮塔 ×2（基座 + 炮室 + 炮管）
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.17, 0.21, 0.12, 10), darkMat, s * 0.62, 0.5, 0.95);
    add(new THREE.BoxGeometry(0.32, 0.18, 0.46), darkMat, s * 0.62, 0.64, 0.95);
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.62, 6), darkMat, s * 0.62, 0.64, 1.35, Math.PI / 2, 0, 0);
  }

  return { group, nozzleMat };
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
