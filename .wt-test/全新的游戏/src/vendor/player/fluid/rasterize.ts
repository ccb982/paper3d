import * as THREE from 'three';

// ============================================================
// 区域边界 → 障碍物纹理（RedFormat Uint8）
// ============================================================
//
// 语义（与 FluidSolver SOR/平流着色器一致）：
//   R = 0   → 流体可通过（区域内部）
//   R = 255 → 墙（区域外部）
//
// 坐标对齐：boundary 为世界归一化坐标 (0~1)，world Y 向上。
// 目标纹理 row 0 = world y=1（顶部），与 colorGrid 对齐。
// Canvas2D 的 Y 向下，故绘制时 canvas_y = (1 - world.y) * h。

export function rasterizeBoundaryToObstacle(
  boundary: { x: number; y: number }[][],
  width: number,
  height: number,
): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 区域外 = 黑（墙），区域内 = 白（流体）
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  for (const ring of boundary) {
    if (!ring || ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const cx = ring[i].x * width;
      const cy = (1 - ring[i].y) * height;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');

  // 描边，避免边界像素被误判为墙（区域窄缝也能流通）
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (const ring of boundary) {
    if (!ring || ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const cx = ring[i].x * width;
      const cy = (1 - ring[i].y) * height;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    // 区域内(白, R>128) → 流体(0)；区域外(黑) → 墙(255)
    data[i] = img.data[i * 4] > 128 ? 0 : 255;
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false; // ★ row 0 = world 顶部，与 colorGrid 对齐
  tex.needsUpdate = true;
  return tex;
}

/**
 * 将墙体掩码（1 bit/像素 base64）解码为障碍物纹理（RedFormat，Uint8）。
 * 与 FluidEditor.getObstacleBitmap 打包约定严格对称（LSB-first）。
 *
 * @param width   掩码原始宽度
 * @param height  掩码原始高度
 * @param data    掩码 base64（1 bit/像素）
 * @param targetW 目标纹理宽度（解算器分辨率），不匹配时最近邻缩放
 * @param targetH 目标纹理高度
 */
export function buildObstacleTextureFromBitmask(
  width: number,
  height: number,
  data: string,
  targetW: number,
  targetH: number,
): THREE.DataTexture | null {
  if (!data || width <= 0 || height <= 0) return null;
  let bitmap: Uint8Array;
  try {
    const bin = atob(data);
    bitmap = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bitmap[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  const totalPixels = width * height;
  const unpacked = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    if (bitmap[Math.floor(i / 8)] & (1 << (i % 8))) unpacked[i] = 255;
  }

  let out = unpacked;
  if (width !== targetW || height !== targetH) {
    out = new Uint8Array(targetW * targetH);
    for (let y = 0; y < targetH; y++) {
      const sy = Math.min(Math.floor((y * height) / targetH), height - 1);
      for (let x = 0; x < targetW; x++) {
        const sx = Math.min(Math.floor((x * width) / targetW), width - 1);
        out[y * targetW + x] = unpacked[sy * width + sx];
      }
    }
  }

  const tex = new THREE.DataTexture(out, targetW, targetH, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
