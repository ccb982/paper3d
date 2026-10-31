// ============================================================
// RoomDecoGeo —— 手搓顶点的房间装饰几何生成器（2026-09-16）
// ============================================================
// 用户定调：「不用建模」= **不许从网上找 / 导入现成模型**；但房间要**真的有实体道具**，
//   而且要靠**自己写顶点**做出简易装饰品、**改变房间布局**。
//
// 因此这里提供一批极简但完全可控的生成函数（全部运行期手写 BufferGeometry）：
//   · extrudeProfile —— 2D 轮廓（逆时针，局部 xy）→ 沿局部 z 挤出指定厚度
//        · 前后盖走扇形三角化（轮廓需为简单凸-ish 多边形）
//        · 侧壁每条边独占 4 顶点 → 硬边法线（不会被 computeVertexNormals 抹平成圆壳）
//   · trapezoidProfile / chamferRectProfile / roundRectProfile / iBeamProfile / wedgeProfile
//   · arcLayout —— 把 N 件部件沿圆弧排布（指挥台围弧 / 环形座椅 / 螺旋灯具）
//
// 复用方式：这些函数在房间构建期调用一次，生成的 BufferGeometry 随场景 dispose 回收。

import * as THREE from 'three';

/** 2D 轮廓点（局部 xy；**必须逆时针**，否则前后盖绕序反了 → 背面剔除看不见） */
export type P2 = readonly [number, number];

/**
 * ★ 手写挤出：2D 轮廓 → 沿局部 z 挤出 depth（中心对齐，z ∈ [-depth/2, +depth/2]）
 * 顶点布局：[0,n) 前盖 → [n,2n) 后盖 → [2n, 6n) 侧壁（每边 4 顶点独占）
 */
export function extrudeProfile(pts: P2[], depth: number): THREE.BufferGeometry {
  const n = pts.length;
  if (n < 3) throw new Error('[RoomDecoGeo] extrudeProfile 至少 3 个轮廓点');
  const hz = depth / 2;
  const vcount = 6 * n;
  const pos = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  // ★ uv 归一化到轮廓包围盒 [0,1]（shader 里扫描/行波要用 0..1 的 uv）
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const sx = maxX - minX > 1e-6 ? 1 / (maxX - minX) : 1;
  const sy = maxY - minY > 1e-6 ? 1 / (maxY - minY) : 1;
  let pi = 0;
  let ui = 0;
  // 注：传入的 pt 是世界/局部实际坐标；写出去的 uv 是它的归一化位置
  const ptUv = (i: number): [number, number] => [
    (pts[i][0] - minX) * sx,
    (pts[i][1] - minY) * sy,
  ];
  const put = (x: number, y: number, z: number, uu: number, vv: number): void => {
    pos[pi++] = x; pos[pi++] = y; pos[pi++] = z;
    uv[ui++] = uu; uv[ui++] = vv;
  };
  // 前后盖（同一份 xy，各写一遍以保证法线各自独立）
  for (let s = 0; s < 2; s++) {
    const z = s === 0 ? hz : -hz;
    for (let i = 0; i < n; i++) {
      const t = ptUv(i);
      put(pts[i][0], pts[i][1], z, t[0], t[1]);
    }
  }
  // 侧壁（每条边独立 4 顶点）
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ta = ptUv(i);
    const tb = ptUv((i + 1) % n);
    put(a[0], a[1], hz, ta[0], ta[1]);
    put(b[0], b[1], hz, tb[0], tb[1]);
    put(b[0], b[1], -hz, tb[0], tb[1]);
    put(a[0], a[1], -hz, ta[0], ta[1]);
  }
  const idx: number[] = [];
  // 前盖（从 +z 看逆时针）
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  // 后盖（绕序反转）
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i);
  // 侧壁：逆时针轮廓 → 边 i→i+1 的外法线 = normalize(dy, -dx)，据此定绕序
  for (let i = 0; i < n; i++) {
    const o = 2 * n + 4 * i;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** 梯形（底宽 w0、顶宽 w1、高 h；斜面控制台/渐缩柱的基础截面） */
export function trapezoidProfile(w0: number, w1: number, h: number): P2[] {
  return [
    [-w0 / 2, -h / 2], [w0 / 2, -h / 2], [w1 / 2, h / 2], [-w1 / 2, h / 2],
  ];
}

/** 直角楔形（底宽 w、高 h、顶边缩进 inset；踢脚线/遮檐/导流片） */
export function wedgeProfile(w: number, h: number, inset: number): P2[] {
  return [
    [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 - inset, h / 2], [-w / 2, h / 2],
  ];
}

/** 切角矩形（八边形；金属面板/门框/舱盖常用） */
export function chamferRectProfile(w: number, h: number, c: number): P2[] {
  const x = w / 2;
  const y = h / 2;
  const cc = Math.min(c, x * 0.95, y * 0.95);
  return [
    [-x + cc, -y], [x - cc, -y], [x, -y + cc], [x, y - cc],
    [x - cc, y], [-x + cc, y], [-x, y - cc], [-x, -y + cc],
  ];
}

/** 圆角矩形（&gt;3 段时轮廓非凸 → 扇形三角化会出错，请保证 r 适中且用于正面板） */
export function roundRectProfile(w: number, h: number, r: number, seg = 4): P2[] {
  const rr = Math.max(0.001, Math.min(r, Math.min(w, h) / 2 - 0.001));
  const kx = w / 2 - rr;
  const ky = h / 2 - rr;
  const corners: readonly [number, number, number][] = [
    [kx, -ky, -Math.PI / 2],
    [kx, ky, 0],
    [-kx, ky, Math.PI / 2],
    [-kx, -ky, Math.PI],
  ];
  const out: P2[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return out;
}

/** 工字梁截面（高 h、法兰宽 fw、壁厚 t；天花板桁架/承重梁） */
export function iBeamProfile(h: number, fw: number, t: number): P2[] {
  const hw = fw / 2;
  const hh = h / 2;
  const tt = Math.max(0.01, t / 2);
  return [
    [-hw, -hh], [hw, -hh], [hw, -hh + t], [tt, -hh + t],
    [tt, hh - t], [hw, hh - t], [hw, hh], [-hw, hh],
    [-hw, hh - t], [-tt, hh - t], [-tt, -hh + t], [-hw, -hh + t],
  ];
}

/** 正 n 边形截面（六/八棱柱：熔炉/终端台座/全息基座） */
export function polyProfile(sides: number, r: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (Math.PI * 2 * i) / sides;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** 圆弧排布：N 件沿半径 R 的一段弧均匀分布（返回世界/本地位姿；yaw 朝弧心） */
export interface ArcSlot { x: number; z: number; yaw: number; }

/**
 * @param count   件数
 * @param radius  弧半径
 * @param arcDeg  弧跨度（度）；360 = 整圈
 * @param cx,cz   弧心
 * @param baseDeg 起始角（度，0 = +x 方向）
 * @param faceOut true = 部件朝弧外侧（背对弧心）；false = 朝弧心
 */
export function arcLayout(
  count: number, radius: number, arcDeg: number,
  cx = 0, cz = 0, baseDeg = 0, faceOut = false,
): ArcSlot[] {
  const out: ArcSlot[] = [];
  if (count <= 0) return out;
  const span = (arcDeg * Math.PI) / 180;
  const step = count > 1 ? span / (count - 1) : 0;
  const a0 = (baseDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const a = a0 + step * i;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    // three 的 rotation.y = yaw 使局部 +z 指向 (sin yaw, 0, cos yaw)
    // → 径向朝外 = atan2(dx, dz) = atan2(cos a, sin a)；朝弧心则 +π
    const radial = Math.atan2(Math.cos(a), Math.sin(a));
    const yaw = faceOut ? radial : radial + Math.PI;
    out.push({ x, z, yaw });
  }
  return out;
}

/** 常用：合并多个几何到一个 BufferGeometry（同材质批量件的 draw call 优化；可选） */
export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vc = 0;
  let ic = 0;
  for (const g of geos) {
    vc += g.getAttribute('position').count;
    ic += g.getIndex()?.count ?? 0;
  }
  const pos = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const nor = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0;
  let io = 0;
  let po = 0;
  let uo = 0;
  let no = 0;
  for (const g of geos) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const t = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    pos.set(p.array as Float32Array, po);
    po += p.count * 3;
    if (t) { uv.set(t.array as Float32Array, uo); uo += t.count * 2; }
    if (nrm) { nor.set(nrm.array as Float32Array, no); no += nrm.count * 3; }
    const gi = g.getIndex();
    if (gi) {
      for (let i = 0; i < gi.count; i++) idx[io++] = gi.getX(i) + vo;
    }
    vo += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
