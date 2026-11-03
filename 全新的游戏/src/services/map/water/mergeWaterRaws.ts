// ============================================================
// mergeWaterRaws —— 多个水体几何合并成一个（远景大网格）
// ============================================================
// ★ 为什么能合并：水面着色按**世界坐标**采样 FFT 波场 ⇒ 顶点各带各的世界坐标，
//   合到一个 BufferGeometry 后采样结果不变 ⇒ 只是少了 draw call。
// ★ 合并后仍要逐 body 记水位：每个 body 的顶点在**自己**的水位上（y 各写各的）。
// ============================================================

import type { WaterSurfaceRaw } from '../WaterSurface';

/** 合并多份水面几何（世界坐标；索引重映射） */
export function mergeWaterRaws(parts: WaterSurfaceRaw[]): WaterSurfaceRaw {
  let vTotal = 0, iTotal = 0;
  for (const raw of parts) { vTotal += raw.vertices.length; iTotal += raw.indices.length; }
  const vertices = new Float32Array(vTotal);
  const normals = new Float32Array(vTotal);
  const uvs = new Float32Array((vTotal / 3) * 2);
  const deep = new Float32Array(vTotal / 3);
  const border = new Float32Array(vTotal / 3);
  const spin = new Float32Array((vTotal / 3) * 2);
  const indices = new Uint32Array(iTotal);
  let vo = 0, io = 0, base = 0;
  for (const raw of parts) {
    const n = raw.vertices.length / 3;
    vertices.set(raw.vertices, vo);
    normals.set(raw.normals, vo);
    uvs.set(raw.uvs, (vo / 3) * 2);
    deep.set(raw.deep, vo / 3);
    if (raw.border) border.set(raw.border, vo / 3);
    if (raw.spin) spin.set(raw.spin, (vo / 3) * 2);
    for (let k = 0; k < raw.indices.length; k++) indices[io + k] = raw.indices[k] + base;
    vo += raw.vertices.length;
    io += raw.indices.length;
    base += n;
  }
  return { vertices, normals, uvs, deep, border, spin, indices, quads: iTotal / 6 };
}
