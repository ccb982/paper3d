import type { Point, Shape, ColorBlock } from '../types';
import { computeRegionsExact, computeGridRegions } from './regionDetectionExact';

/**
 * 检测色块：支持同颜色合并和颜色覆盖
 * @param shapes 当前图层的所有形状（按创建顺序排列）
 * @param layerId 图层ID
 * @param startId 起始ID
 * @returns 新生成的色块数组
 */
export function detectColorBlocks(
  shapes: Shape[],
  layerId: string,
  startId: number
): ColorBlock[] {
  if (shapes.length === 0) return [];

  // 按颜色分组，保持形状顺序（用于确定覆盖关系）
  const colorGroups = new Map<string, Shape[]>();
  for (const shape of shapes) {
    const color = shape.color || '#ff0000';
    if (!colorGroups.has(color)) colorGroups.set(color, []);
    colorGroups.get(color)!.push(shape);
  }

  // 世界坐标固定为 [0,1]
  const worldBounds = {
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
  };

  const newBlocks: ColorBlock[] = [];
  let nextId = startId;

  // 为每种颜色计算封闭区域
  for (const [color, groupShapes] of colorGroups.entries()) {
    // 对该颜色组的所有形状计算封闭区域多边形
    const regions = computeRegionsExact(groupShapes, worldBounds, 1000);
    
    // 为每个区域创建一个色块
    for (const polygon of regions) {
      if (polygon.length === 0) continue;
      const area = Math.abs(polygonSignedArea(polygon[0]));
      if (area < 1e-6) continue;
      
      newBlocks.push({
        id: nextId++,
        layerId,
        color,
        polygon,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  // 应用颜色覆盖：按形状的绘制顺序，后绘制的颜色覆盖先绘制的
  return applyColorOverlap(newBlocks, shapes, worldBounds);
}

/**
 * 应用颜色覆盖逻辑：后绘制的形状会覆盖先绘制的形状所在的色块
 * @param blocks 初始色块数组
 * @param shapes 所有形状（按创建顺序）
 * @param worldBounds 世界坐标范围
 * @returns 处理后的色块数组
 */
function applyColorOverlap(
  blocks: ColorBlock[],
  shapes: Shape[],
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
): ColorBlock[] {
  // 创建一个网格用于判断覆盖关系（只使用实线形状，排除虚线）
  const resolution = 200;
  const solidShapes = shapes.filter(s => s.color !== '#ffaa00');
  const gridData = computeGridRegions(solidShapes, worldBounds, resolution);
  const { regionIdGrid, stepX, stepY, xMin, yMin } = gridData;

  // 创建一个映射：区域ID -> 该区域内最高优先级的颜色
  const regionColorMap = new Map<number, string>();
  
  // 按形状创建顺序处理（后处理的会覆盖先处理的）
  for (const shape of shapes) {
    const color = shape.color || '#ff0000';
    
    // 获取形状覆盖的所有网格单元格
    const cells = getShapeCells(shape, stepX, stepY, xMin, yMin, resolution);
    
    // 更新这些单元格所属区域的颜色
    for (const cell of cells) {
      const regionId = regionIdGrid[cell.i]?.[cell.j];
      if (regionId !== undefined && regionId > 0) {
        regionColorMap.set(regionId, color);
      }
    }
  }

  // 根据区域颜色映射重新分配色块颜色
  const resultBlocks: ColorBlock[] = [];
  const usedRegions = new Set<number>();

  for (const block of blocks) {
    // 找到这个色块覆盖的主要区域
    const mainRegionId = getRegionIdForPolygon(block.polygon[0], regionIdGrid, stepX, stepY, xMin, yMin);
    
    if (mainRegionId === null) {
      resultBlocks.push(block);
      continue;
    }

    // 获取该区域的最终颜色
    const finalColor = regionColorMap.get(mainRegionId) || block.color;
    
    // 如果颜色变了，说明被覆盖了
    if (finalColor !== block.color) {
      // 记录这个区域已被处理
      usedRegions.add(mainRegionId);
    }
    
    resultBlocks.push({
      ...block,
      color: finalColor,
    });
  }

  return resultBlocks;
}

/**
 * 获取形状覆盖的网格单元格
 */
function getShapeCells(
  shape: Shape,
  stepX: number,
  stepY: number,
  xMin: number,
  yMin: number,
  resolution: number
): { i: number; j: number }[] {
  const cells = new Set<string>();
  
  for (const point of shape.points) {
    const i = Math.floor((point.y - yMin) / stepY);
    const j = Math.floor((point.x - xMin) / stepX);
    
    if (i >= 0 && i < resolution && j >= 0 && j < resolution) {
      cells.add(`${i},${j}`);
    }
  }
  
  return Array.from(cells).map(key => {
    const [i, j] = key.split(',').map(Number);
    return { i, j };
  });
}

/**
 * 获取多边形中心点所在的区域ID
 */
function getRegionIdForPolygon(
  polygon: Point[],
  regionIdGrid: number[][],
  stepX: number,
  stepY: number,
  xMin: number,
  yMin: number
): number | null {
  if (polygon.length === 0) return null;
  
  // 计算多边形中心点
  const center = polygon.reduce((acc, p) => ({
    x: acc.x + p.x,
    y: acc.y + p.y
  }), { x: 0, y: 0 });
  center.x /= polygon.length;
  center.y /= polygon.length;
  
  const i = Math.floor((center.y - yMin) / stepY);
  const j = Math.floor((center.x - xMin) / stepX);
  
  if (regionIdGrid[i] && regionIdGrid[i][j] !== undefined) {
    return regionIdGrid[i][j];
  }
  
  return null;
}

// 辅助函数：计算多边形有向面积
function polygonSignedArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += points[j].x * points[i].y - points[j].y * points[i].x;
  }
  return area / 2;
}
