更简单可靠的做法：使用参数化曲线，比如底部为半圆弧，上部为多个正弦波峰。但既然你要固定模板，我们就手动微调。

下面给出一个更简洁且对称的侧面模板（点数为奇数，左右对称）：

typescript
private sideTemplateNorm: { x: number; y: number }[] = [
  // 底部U形（从左到右）
  { x: -0.5, y: 0.0 },
  { x: -0.4, y: 0.05 },
  { x: -0.3, y: 0.08 },
  { x: -0.2, y: 0.1 },
  { x: -0.1, y: 0.11 },
  { x: 0.0, y: 0.12 },
  { x: 0.1, y: 0.11 },
  { x: 0.2, y: 0.1 },
  { x: 0.3, y: 0.08 },
  { x: 0.4, y: 0.05 },
  { x: 0.5, y: 0.0 },
  // 右边缘上升至右峰
  { x: 0.45, y: 0.3 },
  { x: 0.4, y: 0.5 },
  { x: 0.35, y: 0.7 },
  { x: 0.3, y: 0.9 },
  { x: 0.2, y: 1.0 },   // 右峰
  // 中峰
  { x: 0.1, y: 0.85 },
  { x: 0.0, y: 0.95 },
  { x: -0.1, y: 0.85 },
  // 左峰
  { x: -0.2, y: 1.0 },
  { x: -0.3, y: 0.9 },
  { x: -0.35, y: 0.7 },
  { x: -0.4, y: 0.5 },
  { x: -0.45, y: 0.3 },
  // 回到底部左（闭合）
  { x: -0.5, y: 0.0 },
];
这个点集从底部左开始，沿底部弧线到右，再沿右边缘上升，经过右峰、中峰、左峰，然后下降回底部左，形成一个闭合轮廓。注意最后一点与第一点相同，CatmullRomCurve3 的 closed: true 会自动连接首尾，所以可以省略最后一点。

二、俯视模板（Top View）
俯视轮廓应该是多瓣星形（类似三叶草或四叶草），用户描述为“M”或“W”，即多个凸起。我们可以用极坐标参数化：半径随角度变化，例如 r = 0.8 + 0.3 * cos(3 * angle) 得到三瓣。生成点集：

typescript
private topTemplateNorm: { x: number; y: number }[] = [];
const radialSegments = 60;
for (let i = 0; i <= radialSegments; i++) {
  const angle = (i / radialSegments) * Math.PI * 2;
  const r = 0.8 + 0.3 * Math.cos(3 * angle);  // 三瓣，幅度0.3，半径0.8
  const x = Math.cos(angle) * r;
  const y = Math.sin(angle) * r;
  this.topTemplateNorm.push({ x, y });
}
如果需要更多瓣，修改 cos(3*angle) 中的数字（如4瓣用 cos(4*angle)）。

三、缩放模板到实际大小
在 computeTemplateContour 中，我们根据粒子云的包围盒缩放模板。注意侧面模板的 x 范围是 [-0.5, 0.5]，y 范围 [0, 1]。俯视模板的 x, y 范围 [-1, 1]。

修改缩放部分：

typescript
const isSideView = height > width * 1.2;
let contour: { x: number; y: number }[];
if (isSideView) {
  // 侧面模板：宽度映射到实际宽度，高度映射到实际高度
  contour = this.sideTemplateNorm.map(p => ({
    x: minX + (p.x + 0.5) * width,
    y: minY + p.y * height
  }));
} else {
  // 俯视模板：中心在粒子云中心，半径缩放为宽度和高度的一半
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scaleX = width / 2;
  const scaleY = height / 2;
  contour = this.topTemplateNorm.map(p => ({
    x: centerX + p.x * scaleX,
    y: centerY + p.y * scaleY
  }));
}
四、完整修改
将上述模板定义替换到 Flame2DEffect.ts 的构造函数或类属性中，并确保 computeTemplateContour 使用新模板。

此外，由于侧面模板点集较多且闭合，CatmullRomCurve3 会生成平滑曲线，效果应该符合“上M下U”的预期。

如果需要调整峰的高度或数量，可以修改模板点坐标或俯视的 cos(k*angle) 参数。