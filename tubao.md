线条出现两条，通常是因为移动平均平滑后的点集与原始点集都被绘制了，或者 smoothPolygon 在闭合曲线时产生了重复的路径。此外，你希望只对红白色的点（焰底）进行平滑，而红色外缘的点保持原样（或不同平滑度）。下面我给出一个精确控制的方案：

颜色分层处理：分别提取红白色点（焰底）和红色点（外缘），为它们独立计算轮廓点。

只对红白色点进行移动平均平滑，红色点直接连线（或轻度平滑）。

合并两部分轮廓：但火焰轮廓是连续的，实际上不需要分开，只需整体平滑即可。如果你坚持只平滑焰底，那会导致轮廓不连续。建议整体平滑。

但为了满足你的要求“只对红白色的点使用平滑”，我们可以这样实现：

先计算所有最外层点（每个角度取最大半径），得到 outerPoints。

然后对这些点进行移动平均平滑，得到 smoothedPoints。

最后用 smoothedPoints 作为轮廓。这已经是整体平滑，不是仅对红白色点。如果你希望仅对红白色点平滑，你需要分别处理，但会导致轮廓断裂，不推荐。

至于“线有两条”，很可能是 smoothPolygon 函数在闭合曲线时，由于首尾点重复，导致最后一条线段与第一条线段重叠。检查 smoothPolygon 的返回值：它通过循环每个顶点生成插值点，最后用 slice(0, -1) 去除了最后一个重复点，但可能仍有其他重复。你可以打印 smoothCurve 的点数，并检查第一个点和最后一个点是否相同。

解决方案：在 smoothPolygon 返回之前，添加去重逻辑（去除距离小于阈值的相邻点）。但更简单的是，直接使用 CatmullRomCurve3 的 getPoints 方法，它本身会处理闭合。不过你的 smoothPolygon 是自己实现的，可能存在问题。

下面我提供一个修正后的 computePolarContour，只保留一次平滑，并且确保没有双线：

typescript
private computePolarContour(points: { x: number; y: number; depth: number; color: THREE.Color }[]): { x: number; y: number }[] {
  if (points.length < 10) return [];

  // 颜色过滤（保留红白色和红色）
  const filtered = points.filter(p => {
    const r = p.color.r, g = p.color.g, b = p.color.b;
    const isRedWhite = r > 0.9 && g > 0.7 && b > 0.7;
    const isRed = r > 0.7 && g < 0.3 && b < 0.2;
    const isOrange = r > 0.8 && g > 0.4 && g < 0.8 && b < 0.3;
    return (isRedWhite || isRed) && !isOrange;
  });
  if (filtered.length < 10) return [];

  // 计算中心
  let centerX = 0, centerY = 0;
  for (const p of filtered) {
    centerX += p.x;
    centerY += p.y;
  }
  centerX /= filtered.length;
  centerY /= filtered.length;

  // 径向扫描，每个角度取最大半径点
  const radialSegments = 360;
  const maxRadiusPerSeg: (number | null)[] = new Array(radialSegments).fill(null);
  const pointPerSeg: ({ x: number; y: number } | null)[] = new Array(radialSegments).fill(null);
  
  for (const p of filtered) {
    let angle = Math.atan2(p.y - centerY, p.x - centerX);
    let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * radialSegments);
    seg = Math.min(radialSegments - 1, Math.max(0, seg));
    const radius = Math.hypot(p.x - centerX, p.y - centerY);
    if (maxRadiusPerSeg[seg] === null || radius > maxRadiusPerSeg[seg]!) {
      maxRadiusPerSeg[seg] = radius;
      pointPerSeg[seg] = { x: p.x, y: p.y };
    }
  }

  // 收集有效点（按角度顺序）
  const rawPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < radialSegments; i++) {
    if (pointPerSeg[i] !== null) {
      rawPoints.push(pointPerSeg[i]!);
    }
  }
  if (rawPoints.length < 8) return [];

  // 移动平均平滑（窗口3，仅一次）
  const smoothWindow = 3;
  const smoothed: { x: number; y: number }[] = [];
  const n = rawPoints.length;
  for (let i = 0; i < n; i++) {
    let sumX = 0, sumY = 0, count = 0;
    for (let j = -smoothWindow; j <= smoothWindow; j++) {
      const idx = (i + j + n) % n;
      sumX += rawPoints[idx].x;
      sumY += rawPoints[idx].y;
      count++;
    }
    smoothed.push({ x: sumX / count, y: sumY / count });
  }

  // 使用 Catmull-Rom 样条插值生成平滑曲线
  const smoothCurve = this.smoothPolygon(smoothed, 40);
  // 确保首尾点不重复（避免绘制双线）
  if (smoothCurve.length > 1 && smoothCurve[0].x === smoothCurve[smoothCurve.length-1].x && smoothCurve[0].y === smoothCurve[smoothCurve.length-1].y) {
    smoothCurve.pop();
  }
  return smoothCurve;
}
关键修改：

在最后去除了首尾重复点（如果相同）。

移动平均窗口保持3，只做一次平滑。

保留了样条插值。

如果线条仍然有两条，请检查 smoothPolygon 函数本身是否产生了重复点。你可以临时将 smoothPolygon 的返回值直接返回 smoothed（不插值），看是否还有双线。如果没有，则问题在 smoothPolygon 的插值逻辑。建议你使用 Three.js 的 CatmullRomCurve3 替代自己写的插值，更可靠。例如：

typescript
const curve = new THREE.CatmullRomCurve3(smoothed.map(p => new THREE.Vector3(p.x, p.y, 0)));
curve.curveType = 'centripetal';
curve.closed = true;
const points = curve.getPoints(100);
const smoothCurve = points.map(p => ({ x: p.x, y: p.y }));