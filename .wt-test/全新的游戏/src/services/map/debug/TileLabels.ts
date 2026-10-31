// ============================================================
// TileLabels —— 测试地图地块名标注层（调试专用；ChunkManager.testChunk 消费）
// ============================================================
// 每 4×4m 地块上方一个 Sprite 标牌：地块名(label) + key + id。
// 纹理/材质按 tile key 模块级缓存（225 块共享十几种纹理，不按块建）。
// 共享资源标记 decorShared —— ChunkManager.disposeVisual 跳过，
// 模式退出由 disposeTileLabelCache 统一释放（与装饰渲染器同契约）。
// ============================================================

import * as THREE from 'three';
import { tileById, tileTypeName, type TileDef } from '../Tiles';
import type { ChunkData } from '../ChunkGenerator';

const BLOCK = 4;
const HALF = 30; // CHUNK_SIZE/2 —— chunk group 原点在中心，子对象须用本地坐标

/** 类型 → 显示色（标注与面板同源；语义色呼应：水蓝/坑红） */
export const TILE_TYPE_COLORS: Record<string, string> = {
  '平地': '#8fd48f',
  '装饰性平地': '#57b894',
  '高台': '#e8b04a',
  '装饰性高台': '#c98a3d',
  '水': '#5aa7e0',
  '坑洞': '#e05a5a',
};

const cache = new Map<string, THREE.SpriteMaterial>();

function getLabelMaterial(td: TileDef): THREE.SpriteMaterial {
  let mat = cache.get(td.key);
  if (mat) return mat;

  const typeText = tileTypeName(td);
  const typeColor = TILE_TYPE_COLORS[typeText] ?? '#cccccc';

  const cvs = document.createElement('canvas');
  cvs.width = 256;
  cvs.height = 140;
  const ctx = cvs.getContext('2d')!;
  // 半透明圆角底
  ctx.fillStyle = 'rgba(10, 12, 16, 0.62)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 132, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  // 行1：地块名（描边保证亮底可读）
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
  ctx.strokeText(td.label, 128, 44);
  ctx.fillText(td.label, 128, 44);
  // 行2：地块类型（类型色）
  ctx.font = 'bold 28px "Microsoft YaHei", sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(typeText, 128, 82);
  ctx.fillStyle = typeColor;
  ctx.fillText(typeText, 128, 82);
  // 行3：key · id
  ctx.font = '24px Consolas, monospace';
  ctx.fillStyle = '#ffe08a';
  ctx.fillText(`${td.key} · id ${td.id}`, 128, 120);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  mat.userData.decorShared = true; // disposeVisual 契约：共享缓存不随 chunk 释放
  cache.set(td.key, mat);
  return mat;
}

/**
 * ★ 测试 chunk 的地块名标注层（每 4×4m 块一枚悬浮标牌，贴各自地表上方）。
 * 返回 null 不会发生（15×15 恒有块）；调用方挂进 chunk group。
 */
export function buildTileLabelLayer(
  chunkData: ChunkData,
  surfaceHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  const ox = chunkData.chunkX * 60;
  const oz = chunkData.chunkZ * 60;
  for (let bz = 0; bz < 15; bz++) {
    for (let bx = 0; bx < 15; bx++) {
      const td = tileById(chunkData.blockTypes[bz * 15 + bx]);
      const sprite = new THREE.Sprite(getLabelMaterial(td));
      // three 的 Sprite 共享内部几何——标记 decorShared 防 disposeVisual 误释放
      (sprite.geometry as unknown as { userData: Record<string, unknown> }).userData.decorShared = true;
      const wx = ox + bx * BLOCK + BLOCK / 2;
      const wz = oz + bz * BLOCK + BLOCK / 2;
      sprite.position.set(bx * BLOCK + BLOCK / 2 - HALF, surfaceHeightAt(wx, wz) + 2.4, bz * BLOCK + BLOCK / 2 - HALF);
      sprite.scale.set(3.6, 1.97, 1); // 保持 256:140 画布比例
      group.add(sprite);
    }
  }
  return group;
}

/** 模式退出统一释放（ChunkManager.dispose 调用） */
export function disposeTileLabelCache(): void {
  for (const mat of cache.values()) {
    mat.map?.dispose();
    mat.dispose();
  }
  cache.clear();
}
