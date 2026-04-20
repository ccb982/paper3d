一、问题分析
当前 Flame2DEffect 的 computePolarContour 使用了所有粒子（包括橙色）来计算极坐标外围点，导致轮廓线可能混杂了中部粒子，形状不准确。火焰颜色规律：

焰底（根部）：红白色（高亮度，RGB 接近 (1.0, 0.8, 0.8)）

中部：橙色（RGB 约 (1.0, 0.6, 0.0)）

外缘：红色（RGB 约 (0.8, 0.1, 0.0)）

你需要只使用红白色和红色粒子，排除橙色粒子。

二、修改方案
在 Flame2DEffect 的 computePolarContour 函数中，增加颜色过滤器，只保留符合条件的粒子。然后基于这些粒子计算轮廓。

2.1 颜色判断逻辑
我们可以根据颜色的 RGB 分量特征判断：

红色外缘：r > 0.7 且 g < 0.3 且 b < 0.1（近似纯红）

红白焰底：r > 0.9 且 g > 0.7 且 b > 0.7（接近白色但带红）

排除橙色：g > 0.4 且 b < 0.3 且 r > 0.8（橙色特征）

更简单的规则：如果颜色的绿色分量大于 0.3 且小于 0.7，同时红色大于 0.8，则为橙色，排除。或者直接使用颜色亮度：焰底亮度高，外缘亮度中等，中部亮度适中但偏橙。

为了精确，我们可以在 FireEffect.ts 的粒子颜色更新逻辑中，为每个粒子增加一个 type 属性（如 root, mid, tip），然后在 Flame2DEffect 中直接使用该属性过滤。但为了不改动现有结构，我们直接用 RGB 判断。

2.2 修改后的 computePolarContour 代码
typescript
/**
 * 极坐标外围点提取（根据颜色过滤）
 */
private computePolarContour(points: { x: number; y: number; depth: number; color: THREE.Color }[]): { x: number; y: number }[] {
  if (points.length < 10) return [];

  // 1. 根据颜色过滤：只保留红色和红白色，排除橙色
  const filtered = points.filter(p => {
    const r = p.color.r;
    const g = p.color.g;
    const b = p.color.b;
    // 红白色（焰底）：r>0.9, g>0.7, b>0.7
    const isRedWhite = r > 0.9 && g > 0.7 && b > 0.7;
    // 红色（外缘）：r>0.7, g<0.3, b<0.2
    const isRed = r > 0.7 && g < 0.3 && b < 0.2;
    // 排除橙色（中部）：r>0.8, g>0.4, b<0.3，且不是红白/红色
    const isOrange = r > 0.8 && g > 0.4 && g < 0.8 && b < 0.3;
    return (isRedWhite || isRed) && !isOrange;
  });

  if (filtered.length < 10) return [];

  // 2. 计算中心（所有过滤后点的平均）
  let centerX = 0, centerY = 0;
  for (const p of filtered) {
    centerX += p.x;
    centerY += p.y;
  }
  centerX /= filtered.length;
  centerY /= filtered.length;

  // 3. 径向分组
  const radialGroups: number[][] = new Array(this.radialSegments).fill(null).map(() => []);
  for (const p of filtered) {
    let angle = Math.atan2(p.y - centerY, p.x - centerX);
    let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * this.radialSegments);
    seg = Math.min(this.radialSegments - 1, Math.max(0, seg));
    const radius = Math.hypot(p.x - centerX, p.y - centerY);
    radialGroups[seg].push(radius);
  }

  // 4. 每个区间取指定百分位数的半径
  const contour: { x: number; y: number }[] = [];
  for (let i = 0; i < this.radialSegments; i++) {
    const radii = radialGroups[i];
    if (radii.length === 0) continue;
    radii.sort((a, b) => a - b);
    const idx = Math.floor(radii.length * this.percentile);
    const targetRadius = radii[Math.min(idx, radii.length - 1)];
    const angle = (i / this.radialSegments) * Math.PI * 2 - Math.PI;
    const x = centerX + Math.cos(angle) * targetRadius;
    const y = centerY + Math.sin(angle) * targetRadius;
    contour.push({ x, y });
  }

  if (contour.length < 3) return [];

  // 按角度排序
  contour.sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });

  // 平滑曲线
  const smooth = this.smoothPolygon(contour, 40);
  return smooth;
}
2.3 调整参数以获得更顺滑的轮廓
radialSegments：增大到 90 或 120 可以让轮廓更平滑（但计算量稍增）。

percentile：建议保持在 0.85 或 0.9，确保取的是外围点。

smoothPolygon 的 segmentsPerEdge：增加到 40 或 60 使曲线更圆润。

2.4 粒子大小保持为 1
你的 PointsMaterial 已经设置 size: 1.0 且 sizeAttenuation: false，所有粒子渲染大小固定为 1 像素（屏幕空间）。这是正确的，无需修改。

三、集成到现有代码