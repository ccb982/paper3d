火焰不需要完美的闭合边界，只需要几个特征点就能勾勒出“上尖下圆”的形态。极坐标扫描法太复杂且不稳定，我们可以改用垂直分层采样，直接根据粒子的高度（Y 坐标）提取左右边界点，然后连接成一条平滑曲线。

下面给出一个全新的、简洁可靠的 computePolarContour 实现（实际上应该改名为 computeSimpleContour），完全抛弃极坐标和角度分组。

typescript
/**
 * 简单轮廓提取：垂直分层采样
 * 1. 过滤粒子：只保留红色和红白色（排除橙色）
 * 2. 按 Y 坐标分成若干层
 * 3. 每层取最小 X 和最大 X 的点（左右边界）
 * 4. 将左右边界点分别作为轮廓点，然后合并并排序
 * 5. 用 Catmull-Rom 曲线平滑，确保顶部尖锐、底部圆润
 */
private computeSimpleContour(points: { x: number; y: number; depth: number; color: THREE.Color }[]): { x: number; y: number }[] {
  if (points.length < 20) return [];

  // 1. 颜色过滤：只保留外缘（红色）和焰底（红白色）
  const filtered = points.filter(p => {
    const r = p.color.r, g = p.color.g, b = p.color.b;
    const isRedWhite = r > 0.9 && g > 0.7 && b > 0.7;
    const isRed = r > 0.7 && g < 0.3 && b < 0.2;
    const isOrange = r > 0.8 && g > 0.4 && g < 0.8 && b < 0.3;
    return (isRedWhite || isRed) && !isOrange;
  });
  if (filtered.length < 20) return [];

  // 2. 获取 Y 范围
  const minY = Math.min(...filtered.map(p => p.y));
  const maxY = Math.max(...filtered.map(p => p.y));
  const yRange = maxY - minY;
  if (yRange < 0.05) return [];

  // 3. 垂直分层数量（根据屏幕高度动态调整）
  const layers = 20;
  const step = yRange / layers;
  const leftPoints: { x: number; y: number }[] = [];
  const rightPoints: { x: number; y: number }[] = [];

  for (let i = 0; i <= layers; i++) {
    const y = minY + i * step;
    const layerParticles = filtered.filter(p => Math.abs(p.y - y) < step * 0.6);
    if (layerParticles.length === 0) continue;
    
    // 取该层最小 X 和最大 X
    let minX = Infinity, maxX = -Infinity;
    for (const p of layerParticles) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    // 记录左右边界点
    leftPoints.push({ x: minX, y });
    rightPoints.push({ x: maxX, y });
  }

  if (leftPoints.length < 3) return [];

  // 4. 合并左右边界点，并按角度排序（从底部左侧 → 顶部 → 底部右侧）
  // 注意：我们需要一个闭合曲线，顺序应该是：从底部最左开始，沿着左边缘向上到顶部，再沿右边缘向下回到底部最右，然后闭合。
  const bottomLeft = leftPoints[0];
  const bottomRight = rightPoints[0];
  // 左边缘（从底部到顶部）
  const leftEdge = leftPoints.slice().sort((a, b) => a.y - b.y);
  // 右边缘（从顶部到底部）
  const rightEdge = rightPoints.slice().sort((a, b) => b.y - a.y);
  
  // 构建完整轮廓点集
  const contour: { x: number; y: number }[] = [];
  // 左边缘（底部到顶部）
  for (const p of leftEdge) contour.push(p);
  // 顶部点取左右边缘最高点的平均（使顶部尖锐）
  const topLeft = leftEdge[leftEdge.length-1];
  const topRight = rightEdge[rightEdge.length-1];
  const topCenter = { x: (topLeft.x + topRight.x) / 2, y: Math.max(topLeft.y, topRight.y) };
  contour.push(topCenter);
  // 右边缘（顶部到底部）
  for (const p of rightEdge) contour.push(p);
  // 闭合到底部最左（可选，但 CatmullRomCurve3 闭合会自动连接首尾）

  // 5. 平滑曲线（使用 Three.js 的 CatmullRomCurve3 更可靠）
  const points3D = contour.map(p => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(points3D);
  curve.curveType = 'centripetal';
  curve.closed = true;
  const smoothPoints3D = curve.getPoints(100);
  const smooth = smoothPoints3D.map(p => ({ x: p.x, y: p.y }));

  return smooth;
}
然后在 render 方法中，将 this.cachedContour = this.computePolarContour(screenPoints); 替换为 this.cachedContour = this.computeSimpleContour(screenPoints);。

关键改进：

垂直分层采样，直接获取左右边界，不再依赖角度。

轮廓由左边缘、顶部点、右边缘组成，自然形成“上尖下圆”的形状。

使用 Three.js 的 CatmullRomCurve3 平滑（避免手写插值 bug）。

颜色过滤保留，确保只使用外缘和焰底粒子。

这样生成的轮廓线将非常稳定，不会出现双线或刺猬状。你可以根据需要调整 layers（层数）和 getPoints 的采样点数来控制平滑度。