# BulletFluidTexture 逐行详解

## 概述

`BulletFluidTexture` 是一个基于 `@bienehito/fluid-dynamics` 库实现的子弹流体尾迹纹理生成器。该类模拟了子弹高速运动时产生的卡门涡街效应和锥形尾气。

---

## 代码逐行解析

### 1. 导入依赖

```typescript
import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';
```

**解析**：
- `THREE`：Three.js 库，用于创建 CanvasTexture
- `FluidDynamics`：流体动力学库，提供流体模拟核心功能

---

### 2. 类定义与接口实现

```typescript
export class BulletFluidTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';
```

**解析**：
- 实现 `ITextureGenerator` 接口，表明这是一个纹理生成器
- `type` 属性标识为 `'canvas'` 类型，用于纹理管理器识别

---

### 3. 私有成员变量

```typescript
private canvas: HTMLCanvasElement;
private fluidDynamics: FluidDynamics;
private texture: THREE.CanvasTexture;
private lastTimestamp: number = 0;
```

**解析**：
| 变量 | 类型 | 作用 |
|-----|------|------|
| `canvas` | HTMLCanvasElement | 流体模拟的渲染画布 |
| `fluidDynamics` | FluidDynamics | 流体动力学引擎实例 |
| `texture` | THREE.CanvasTexture | 用于 Three.js 的纹理对象 |
| `lastTimestamp` | number | 上一帧时间戳，用于计算时间增量 |

---

### 4. 常量定义

```typescript
private readonly BULLET_X = 420;
private readonly BULLET_Y = 256;
private readonly TRAIL_LENGTH = 180;
```

**解析**：
| 常量 | 值 | 含义 |
|-----|-----|------|
| `BULLET_X` | 420 | 弹头在画布中的 X 坐标（画布宽度 512） |
| `BULLET_Y` | 256 | 弹头在画布中的 Y 坐标（画布中心） |
| `TRAIL_LENGTH` | 180 | 尾气延伸长度（像素） |

---

### 5. 构造函数

```typescript
constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
```

**解析**：
- 创建一个 512x512 的离屏画布
- 设置 `display: none` 隐藏画布（仅用于渲染纹理）
- 将画布添加到 DOM（某些浏览器需要此步骤）

```typescript
this.fluidDynamics = new FluidDynamics(this.canvas, {
    width: 512,
    height: 512,
    simScale: 1.0,
    dyeScale: 1.2,
    curl: 12,
    velocityDissipation: 0.05,
    dyeDissipation: 0.08,
    pressureIterations: 20
});
```

**解析**：初始化流体动力学引擎，参数说明：

| 参数 | 值 | 作用 |
|-----|-----|------|
| `width/height` | 512 | 模拟分辨率 |
| `simScale` | 1.0 | 模拟缩放因子 |
| `dyeScale` | 1.2 | 染料扩散放大倍数 |
| `curl` | 12 | 漩涡强度 |
| `velocityDissipation` | 0.05 | 速度消散系数（每帧减少5%） |
| `dyeDissipation` | 0.08 | 颜色消散系数（每帧减少8%） |
| `pressureIterations` | 20 | 压力求解迭代次数 |

```typescript
this.texture = new THREE.CanvasTexture(this.canvas);
this.lastTimestamp = performance.now();
this.animate();
```

**解析**：
- 将 Canvas 包装为 Three.js 可用的纹理
- 初始化时间戳
- 启动动画循环

---

### 6. generate() 方法

```typescript
generate(): THREE.Texture {
    return this.texture;
}
```

**解析**：实现 `ITextureGenerator` 接口，返回生成的纹理对象供外部使用

---

### 7. injectFluid() 方法（核心）

#### 7.1 全局背景推力

```typescript
private injectFluid(): void {
    const x = this.BULLET_X;
    const y = this.BULLET_Y;

    // 全局背景向后推力（模拟子弹高速运动时尾气被甩向后方）
    for (let bx = 0; bx < 512; bx += 40) {
    for (let by = 0; by < 512; by += 40) {
        this.fluidDynamics.setVelocity(bx, by, 0, 35, 35, -30, 0);
    }
    }
```

**解析**：
- 在整个画布上以 40px 间隔均匀施加向左的速度（-30）
- 模拟子弹高速运动时，周围空气相对向后流动的效果
- 参数：`setVelocity(x, y, radiusX, radiusY, velX, velY)`

#### 7.2 弹头高压区

```typescript
// 弹头高压区（白色椭圆形）
this.fluidDynamics.setVelocity(x, y, 0, 35, 25, 0, 0);
this.fluidDynamics.setDye(x, y, 0, 30, 20, [1, 1, 0.95]);
```

**解析**：
- 在 (420, 256) 位置创建一个高压区（速度为0表示压力积聚）
- 使用白色染料标记弹头位置
- `setDye()` 参数：`(x, y, radiusX, radiusY, [r, g, b])`

#### 7.3 前方弧形阻挡罩

```typescript
// 前方弧形阻挡罩（阻止尾气向前扩散）
for (let angle = -Math.PI * 0.5; angle <= Math.PI * 0.5; angle += Math.PI * 0.1) {
    const radius = 25;
    const shieldX = x + Math.cos(angle) * radius;
    const shieldY = y + Math.sin(angle) * radius;
    if (shieldX < 512 && shieldX > 0 && shieldY < 512 && shieldY > 0) {
    const pushX = -Math.cos(angle) * 100;
    const pushY = -Math.sin(angle) * 80;
    this.fluidDynamics.setVelocity(shieldX, shieldY, 0, 22, 22, pushX, pushY);
    }
}
```

**解析**：
- 在弹头前方 25px 处创建弧形速度场
- 角度范围：-90° 到 +90°（从下方到上方）
- 速度方向：向后并向中线汇聚，防止尾气向前扩散

#### 7.4 后方大范围引导罩

```typescript
// 后方大范围引导罩（把尾气限制在锥形区域内并向后引导）
for (let angle = Math.PI * 0.5; angle <= Math.PI * 1.5; angle += Math.PI * 0.06) {
    const radius = 80;
    const guideX = x + Math.cos(angle) * radius;
    const guideY = y + Math.sin(angle) * radius;
    if (guideX < 512 && guideX > 0 && guideY < 512 && guideY > 0) {
    const pushX = -60;
    const pushY = -Math.sin(angle) * 40;
    this.fluidDynamics.setVelocity(guideX, guideY, 0, 25, 25, pushX, pushY);
    }
}
```

**解析**：
- 在弹头后方 80px 处创建大范围弧形引导
- 角度范围：90° 到 270°（覆盖弹头后方整个半圆）
- 速度方向：主要向后（-60），同时向中线收紧

#### 7.5 尾气核心

```typescript
// 尾气核心（从弹头后方喷出，向左延伸，更强的向后速度）
const step = 12;
for (let dist = 20; dist <= this.TRAIL_LENGTH; dist += step) {
    const backX = x - dist;
    if (backX < 0) continue;
    const width = 6 + dist * 0.12;
    const intensity = 1 - (dist / this.TRAIL_LENGTH) * 0.5;

    this.fluidDynamics.setVelocity(backX, y, 0, width, width * 0.5,
    -150 * intensity, (Math.random() - 0.5) * 10);
    this.fluidDynamics.setDye(backX, y, 0, width * 0.7, width * 0.4,
    [0.2, 0.4, 1.0]);
}
```

**解析**：
- 从弹头后方 20px 开始，每隔 12px 注入染料和速度
- `width`：尾气宽度随距离增加（锥形扩散）
- `intensity`：速度强度随距离衰减
- 颜色：蓝色 `[0.2, 0.4, 1.0]`
- 添加小范围随机扰动（±5）增加自然感

#### 7.6 卡门涡街

```typescript
// 卡门涡街（尾气两侧的交替涡旋）
const vortexOffset = 15;
const vortexStrength = 200;
const alternating = Math.sin(performance.now() * 0.0015) > 0 ? 1 : -1;
```

**解析**：
- `vortexOffset`：涡旋距离中线的偏移量
- `vortexStrength`：涡旋强度
- `alternating`：基于时间的交替因子，使涡旋方向周期性变化

```typescript
const v1X = x - 40;
if (v1X > 0) {
    this.fluidDynamics.setVelocity(v1X, y + vortexOffset, 0, 18, 18,
    -vortexStrength * alternating, -20);
    this.fluidDynamics.setDye(v1X, y + vortexOffset, 0, 14, 14, [1.0, 0.2, 0.6]);
    this.fluidDynamics.setVelocity(v1X, y - vortexOffset, 0, 18, 18,
    -vortexStrength * alternating, 20);
    this.fluidDynamics.setDye(v1X, y - vortexOffset, 0, 14, 14, [0.1, 0.8, 0.9]);
}
```

**解析**：第一组涡旋（距离弹头 40px）
- 上方：粉色 `[1.0, 0.2, 0.6]`
- 下方：青色 `[0.1, 0.8, 0.9]`
- 速度方向交替变化

```typescript
const v2X = x - 80;
if (v2X > 0) {
    const alternating2 = Math.sin(performance.now() * 0.0015 + Math.PI) > 0 ? 1 : -1;
    // ... 第二组涡旋（距离80px），强度减弱70%
}

const v3X = x - 120;
if (v3X > 0) {
    const alternating3 = Math.sin(performance.now() * 0.0015 + Math.PI * 0.5) > 0 ? 1 : -1;
    // ... 第三组涡旋（距离120px），强度减弱50%
}
```

**解析**：
- 三组涡旋依次排列，距离越远强度越弱
- 相位偏移 `+Math.PI` 和 `+Math.PI * 0.5` 产生交错效果
- 符合卡门涡街的物理特性：交替脱落的涡旋

---

### 8. animate() 方法

```typescript
private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min(0.033, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;

    this.injectFluid();
    this.texture.needsUpdate = true;
};
```

**解析**：
- 使用 `requestAnimationFrame` 实现流畅的 60fps 动画
- `delta`：时间增量（秒），限制最大为 0.033（约30fps时的增量）
- 每帧注入新的流体并标记纹理需要更新

---

### 9. update() 方法

```typescript
update(delta?: number): void {
}
```

**解析**：实现 `ITextureGenerator` 接口的空方法，实际更新已在 `animate()` 中完成

---

### 10. dispose() 方法

```typescript
dispose(): void {
    this.texture.dispose();
    if (this.canvas && this.canvas.parentNode) {
    this.canvas.parentNode.removeChild(this.canvas);
    }
}
```

**解析**：资源清理方法，释放纹理和画布资源，防止内存泄漏

---

## 物理原理说明

### 卡门涡街（Kármán Vortex Street）

当流体绕过圆柱体（子弹）时，会在下游形成交替脱落的涡旋。本实现通过以下方式模拟：

1. **交替因子**：使用 `sin(performance.now())` 产生周期性变化
2. **相位偏移**：三组涡旋使用不同相位，形成交错排列
3. **强度衰减**：距离越远的涡旋强度越小

### 锥形尾气

子弹高速运动时，尾部形成低压区，空气被卷入形成锥形尾迹：

1. **速度梯度**：中心速度快，边缘速度慢
2. **扩散角度**：随距离增加宽度逐渐扩大
3. **颜色渐变**：使用蓝色表示低温尾气

---

## 文件结构关系

```
BulletFluidTexture.ts
    ↓ 生成纹理
TextureManager.ts       (纹理管理器，注册和管理)
    ↓ 获取纹理
BulletFluidEffect.ts    (特效类，应用到3D场景)
    ↓ 播放特效
EffectManager.ts        (特效管理器)
```

---

## 关键设计要点

| 设计点 | 实现方式 |
|-------|---------|
| 弹头固定 | `BULLET_X = 420` 固定在画布右侧 |
| 尾气向后 | 全局向左速度 + 局部引导 |
| 边界控制 | 弧形阻挡罩和引导罩 |
| 自然效果 | 随机扰动 + 衰减 |
| 性能优化 | `requestAnimationFrame` + 时间增量限制 |