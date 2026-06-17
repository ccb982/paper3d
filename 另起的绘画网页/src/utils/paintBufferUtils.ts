import type { Point } from '../types';

/** 将十六进制颜色转换为 RGB 分量 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return res ? {
    r: parseInt(res[1], 16),
    g: parseInt(res[2], 16),
    b: parseInt(res[3], 16)
  } : null;
}

/** 在世界坐标 (0~1) 中绘制圆形笔刷到 ImageData (512x512) */
export function drawCircleOnBuffer(
  imageData: ImageData,
  centerWorld: Point,    // x,y 范围 [0,1]
  radiusWorld: number,   // 世界坐标半径 (例如 0.05)
  colorHex: string,
  canvasSize = 512
) {
  const rgb = hexToRgb(colorHex);
  if (!rgb) return;

  const centerX = centerWorld.x * canvasSize;
  const centerY = (1 - centerWorld.y) * canvasSize; // Y轴翻转
  const radiusPx = radiusWorld * canvasSize;
  const radiusSq = radiusPx * radiusPx;

  const minX = Math.max(0, Math.floor(centerX - radiusPx));
  const maxX = Math.min(canvasSize - 1, Math.ceil(centerX + radiusPx));
  const minY = Math.max(0, Math.floor(centerY - radiusPx));
  const maxY = Math.min(canvasSize - 1, Math.ceil(centerY + radiusPx));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        const idx = (y * canvasSize + x) * 4;
        imageData.data[idx] = rgb.r;
        imageData.data[idx+1] = rgb.g;
        imageData.data[idx+2] = rgb.b;
        imageData.data[idx+3] = 255;
      }
    }
  }
}

/** 从 ImageData 中提取指定颜色的连通域多边形（世界坐标） */
export function extractPolygonsFromImageData(
  imageData: ImageData,
  targetColorHex: string,
  canvasSize = 512
): Point[][] {
  const rgb = hexToRgb(targetColorHex);
  if (!rgb) return [];

  const width = canvasSize;
  const height = canvasSize;
  const visited = new Uint8Array(width * height);
  const polygons: Point[][] = [];

  // 方向 (8连通)
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isTarget = imageData.data[idx] === rgb.r &&
                       imageData.data[idx+1] === rgb.g &&
                       imageData.data[idx+2] === rgb.b &&
                       imageData.data[idx+3] > 0;
      if (!isTarget || visited[y * width + x]) continue;

      // BFS 收集连通域像素
      const queue: [number, number][] = [[x, y]];
      const regionPixels: [number, number][] = [];
      visited[y * width + x] = 1;
      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        regionPixels.push([cx, cy]);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (visited[ny * width + nx]) continue;
          const nIdx = (ny * width + nx) * 4;
          const match = imageData.data[nIdx] === rgb.r &&
                        imageData.data[nIdx+1] === rgb.g &&
                        imageData.data[nIdx+2] === rgb.b &&
                        imageData.data[nIdx+3] > 0;
          if (match) {
            visited[ny * width + nx] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      // 摩尔邻域边界追踪 (Moore-neighbor tracing)
      const boundary = traceBoundary(regionPixels, width, height, (px, py) => {
        const idx = (py * width + px) * 4;
        return imageData.data[idx] === rgb.r &&
               imageData.data[idx+1] === rgb.g &&
               imageData.data[idx+2] === rgb.b &&
               imageData.data[idx+3] > 0;
      });

      if (boundary.length >= 3) {
        // 像素坐标 -> 世界坐标 (y轴翻转)
        const worldPolygon = boundary.map(([px, py]) => ({
          x: px / width,
          y: 1 - py / height,
        }));
        polygons.push(worldPolygon);
      }
    }
  }
  return polygons;
}

/** 摩尔邻域边界追踪 (返回有序边界点，像素坐标) */
export function traceBoundary(
  pixels: [number, number][],
  width: number,
  height: number,
  isInside: (x: number, y: number) => boolean
): [number, number][] {
  if (pixels.length === 0) return [];
  // 找到最左上角像素作为起点
  let start = pixels.reduce((a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a : b));
  let [cx, cy] = start;
  const visitedEdge = new Set<string>();
  const boundary: [number, number][] = [];

  // 八邻域顺时针方向
  const moore = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0],   [1, 1],  [0, 1],
    [-1, 1],  [-1, 0]
  ];

  let dir = 0; // 初始方向
  do {
    const key = `${cx},${cy},${dir}`;
    if (visitedEdge.has(key)) break;
    visitedEdge.add(key);
    boundary.push([cx, cy]);

    // 寻找下一个边界点
    let nextDir = (dir + 5) % 8; // 从当前方向的顺时针方向开始找
    let found = false;
    for (let i = 0; i < 8; i++) {
      const [dx, dy] = moore[nextDir];
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && isInside(nx, ny)) {
        cx = nx; cy = ny;
        dir = nextDir;
        found = true;
        break;
      }
      nextDir = (nextDir + 1) % 8;
    }
    if (!found) break;
  } while (!(cx === start[0] && cy === start[1]));

  return boundary;
}
