import type { Point, MaskEffect } from './types';
import { applyDistortionCPU } from './mask';

export function buildDisplacementTextureData(
  boundary: Point[][],
  maskEffect: MaskEffect | null,
  canvasWidth: number,
  canvasHeight: number,
  fixedVertices: number[],
  loopFrames: number = 30,
): { data: Float32Array; width: number; height: number } | null {
  if (boundary.length === 0 || boundary[0].length < 3) return null;

  const allVertices = boundary.flat();
  const vertexCount = allVertices.length;
  const totalFrames = 2 * loopFrames;
  const data = new Float32Array(totalFrames * vertexCount * 2);

  const hasFixed = fixedVertices.length > 0;
  const fixedSet = new Set(fixedVertices);

  for (let frame = 0; frame < totalFrames; frame++) {
    let t: number;
    if (frame < loopFrames) {
      t = (frame / loopFrames) * 2 * Math.PI;
    } else {
      const reverseIndex = frame - loopFrames;
      t = (1 - (reverseIndex + 1) / loopFrames) * 2 * Math.PI;
    }

    const distortedAll: Point[] = [];
    if (maskEffect) {
      for (const ring of boundary) {
        const distorted = applyDistortionCPU(ring, maskEffect, t);
        distortedAll.push(...distorted);
      }
    } else {
      for (const v of allVertices) distortedAll.push({ x: v.x, y: v.y });
    }

    const rawDeltas = new Float32Array(vertexCount * 2);
    for (let gi = 0; gi < vertexCount; gi++) {
      const orig = allVertices[gi];
      const dist = distortedAll[gi];
      rawDeltas[gi * 2] = dist.x - orig.x;
      rawDeltas[gi * 2 + 1] = dist.y - orig.y;
    }

    let avgDx = 0, avgDy = 0, fixedCount = 0;
    if (hasFixed) {
      for (let gi = 0; gi < vertexCount; gi++) {
        if (fixedSet.has(gi)) {
          avgDx += rawDeltas[gi * 2];
          avgDy += rawDeltas[gi * 2 + 1];
          fixedCount++;
        }
      }
      if (fixedCount > 0) { avgDx /= fixedCount; avgDy /= fixedCount; }
    }

    for (let gi = 0; gi < vertexCount; gi++) {
      const idx = (frame * vertexCount + gi) * 2;
      if (hasFixed && fixedSet.has(gi)) {
        data[idx] = 0;
        data[idx + 1] = 0;
      } else {
        data[idx] = rawDeltas[gi * 2] - avgDx;
        data[idx + 1] = rawDeltas[gi * 2 + 1] - avgDy;
      }
    }
  }

  const frameSize = vertexCount * 2;
  data.copyWithin((totalFrames - 1) * frameSize, 0, frameSize);

  return { data, width: vertexCount, height: totalFrames };
}
