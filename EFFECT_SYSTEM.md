# 特效系统技术文档

## 概述

特效系统是一套基于 Three.js 程序化生成的视觉效果系统，完全不依赖外部贴图资源。系统采用模块化设计，通过抽象基类和管理器模式实现特效的创建、更新和销毁生命周期。

## 核心架构

### 1. BaseEffect 抽象基类

所有特效的基类，定义了特效的基本生命周期和接口。

**位置**: `src/core/BaseEffect.ts`

```typescript
export abstract class BaseEffect {
  public isActive: boolean = true;
  public duration: number = 0;      // 总时长(秒)
  public elapsed: number = 0;
  public onComplete?: () => void;

  constructor(duration: number, onComplete?: () => void) {
    this.duration = duration;
    this.onComplete = onComplete;
  }

  public update(delta: number): void {
    this.elapsed += delta;
    if (this.elapsed >= this.duration) {
      this.isActive = false;
      this.onComplete?.();
    } else {
      this.onUpdate(delta);
    }
  }

  protected abstract onUpdate(delta: number): void;
  public abstract dispose(): void;
}
```

**核心方法说明**:

| 方法 | 说明 |
|------|------|
| `update(delta)` | 每帧调用，更新特效状态，当 elapsed >= duration 时标记为非活跃 |
| `onUpdate(delta)` | 抽象方法，子类实现具体的动画逻辑 |
| `dispose()` | 销毁特效，释放 Three.js 资源 |

### 2. EffectManager 单例管理器

负责管理所有特效的生命周期，采用单例模式确保全局唯一。

**位置**: `src/core/EffectManager.ts`

```typescript
export class EffectManager {
  private static instance: EffectManager;
  private activeEffects: BaseEffect[] = [];

  private constructor() {}

  public static getInstance(): EffectManager {
    if (!EffectManager.instance) EffectManager.instance = new EffectManager();
    return EffectManager.instance;
  }

  public playHitFlash(position: THREE.Vector3, color?: number): void { ... }
  public playMuzzleFlash(position: THREE.Vector3): void { ... }
  public playExplosion(position: THREE.Vector3): void { ... }
  public playRingWave(position: THREE.Vector3, color?: number): void { ... }

  public update(delta: number): void { ... }
}
```

**核心方法说明**:

| 方法 | 说明 |
|------|------|
| `getInstance()` | 获取单例实例 |
| `playHitFlash()` | 播放命中闪光特效 |
| `playMuzzleFlash()` | 播放枪口闪光特效 |
| `playExplosion()` | 播放爆炸特效 |
| `playRingWave()` | 播放环形波特效 |
| `update(delta)` | 每帧更新所有活跃特效 |

## 特效类型详解

### 1. HitFlashEffect - 命中闪光特效

在命中点产生一个快速扩张的环形闪光。

**几何体**: `THREE.RingGeometry` - 环形几何体

**参数**:
- `position`: 特效位置（Vector3）
- `size`: 初始大小，默认 0.5
- `duration`: 持续时间，默认 0.2 秒
- `color`: 颜色，默认 0xffaa44（橙黄色）

**动画逻辑**:
```typescript
protected onUpdate(delta: number): void {
  const progress = this.elapsed / this.duration; // 0 → 1
  const scale = 1 + progress * 2;               // 逐渐放大 1 → 3
  this.mesh.scale.set(scale, scale, 1);
  this.material.opacity = 1 - progress;          // 淡出 1 → 0
}
```

**视觉效果**: 环形从中心向外扩张并逐渐透明消失

---

### 2. MuzzleFlashEffect - 枪口闪光特效

在枪口位置产生一个放射状的闪光效果。

**几何体**: 8 个 `THREE.BoxGeometry` 组成放射状结构

**参数**:
- `position`: 特效位置（Vector3）
- `duration`: 持续时间，默认 0.1 秒
- `color`: 颜色，默认 0xffaa66（橙黄色）

**动画逻辑**:
```typescript
protected onUpdate(delta: number): void {
  const progress = this.elapsed / this.duration;
  const scale = 1 - progress; // 快速缩小 1 → 0
  this.group.scale.set(scale, scale, 1);
  this.rays.forEach(ray => {
    (ray.material as THREE.MeshStandardMaterial).opacity = 1 - progress;
  });
}
```

**视觉效果**: 8 条光线向外放射并快速收缩消失

---

### 3. ExplosionEffect - 爆炸粒子特效

在指定位置产生爆炸效果，由 60 个粒子组成。

**几何体**: `THREE.Points` - 粒子系统

**参数**:
- `position`: 特效位置（Vector3）
- `duration`: 持续时间，默认 0.8 秒
- `color`: 颜色，默认 0xff6600（橙红色）

**粒子属性**:
```typescript
interface Particle {
  velocity: THREE.Vector3;  // 速度向量
  life: number;             // 生命值 0-1
}
```

**动画逻辑**:
```typescript
protected onUpdate(delta: number): void {
  for (let i = 0; i < this.particleCount; i++) {
    if (this.particles[i].life <= 0) continue;

    // 更新位置（速度 * 时间）
    positions[i*3] += this.particles[i].velocity.x * delta;
    positions[i*3+1] += this.particles[i].velocity.y * delta;
    positions[i*3+2] += this.particles[i].velocity.z * delta;

    // 重力影响
    this.particles[i].velocity.y -= delta * 3;

    // 减少生命
    this.particles[i].life -= delta * 1.5;
  }

  positionsAttr.needsUpdate = true;
  this.material.opacity = 1 - (this.elapsed / this.duration);
}
```

**视觉效果**: 粒子向四周扩散并受重力影响下落，逐渐透明消失

**渲染特性**: 使用 `THREE.AdditiveBlending` 实现发光效果

---

### 4. RingWaveEffect - 环形波特效

产生一个向外扩张的环形波纹。

**几何体**: `THREE.RingGeometry` - 环形几何体

**参数**:
- `position`: 特效位置（Vector3）
- `duration`: 持续时间，默认 0.5 秒
- `color`: 颜色，默认 0x33aaff（蓝色）

**动画逻辑**:
```typescript
protected onUpdate(delta: number): void {
  const t = this.elapsed / this.duration; // 0→1
  const scale = 1 + t * 3;                // 放大 1 → 4
  this.mesh.scale.set(scale, scale, 1);
  this.material.opacity = 0.8 * (1 - t);   // 淡出 0.8 → 0
}
```

**视觉效果**: 环形波纹向外扩张并逐渐透明消失

## 游戏集成

### 在 App.tsx 中的集成

**1. 导入 EffectManager**
```typescript
import { EffectManager } from './core/EffectManager';
```

**2. 设置场景引用**
```typescript
<Canvas camera={{ position: [0, 2, 10] }}
  onCreated={({ scene }) => {
    (window as any).gameScene = scene;
  }}
>
```

**3. 在游戏循环中更新特效**
```typescript
useFrame(({ camera }, delta) => {
  // 更新特效系统
  EffectManager.getInstance().update(delta);
  // ... 其他游戏逻辑
});
```

**4. 触发特效**
```typescript
// 射击时触发枪口闪光
EffectManager.getInstance().playMuzzleFlash(
  new THREE.Vector3(x, y, z)
);

// 命中时触发命中特效
EffectManager.getInstance().playHitFlash(targetPosition);

// 爆炸效果
EffectManager.getInstance().playExplosion(explosionPosition);

// 环形波效果
EffectManager.getInstance().playRingWave(position, 0x33aaff);
```

## 资源管理

所有特效在生命周期结束后会自动调用 `dispose()` 方法释放资源：

```typescript
public dispose(): void {
  // 从场景移除
  if (scene && this.mesh.parent) {
    scene.remove(this.mesh);
  }
  // 释放几何体
  this.mesh.geometry.dispose();
  // 释放材质
  this.material.dispose();
}
```

**重要**: 每种特效的 `dispose()` 实现都包含两个步骤：
1. 从场景中移除 mesh/group/points
2. 释放 `geometry` 和 `material` 资源

## 扩展指南

### 添加新的特效类型

1. 创建新的特效类，继承 `BaseEffect`
2. 在构造函数中创建所需的 Three.js 对象并添加到场景
3. 实现 `onUpdate(delta)` 方法定义动画逻辑
4. 实现 `dispose()` 方法释放资源
5. 在 `EffectManager` 中添加对应的播放方法

**示例模板**:
```typescript
export class NewEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 0.5, color: number = 0xffffff) {
    super(duration);
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);

    const scene = (window as any).gameScene;
    if (scene) scene.add(this.mesh);
  }

  protected onUpdate(delta: number): void {
    // 实现动画逻辑
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.mesh.parent) scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
```

## 性能优化建议

1. **限制粒子数量**: ExplosionEffect 默认 60 个粒子，可根据需求调整
2. **控制特效时长**: 短暂的攻击特效（0.1-0.2秒）比长时间特效更节省资源
3. **及时释放资源**: 确保 `dispose()` 被正确调用
4. **使用对象池**: 对于高频触发的特效，可考虑对象池模式减少创建销毁开销

## 调试方法

可以通过以下方式调试特效系统：

```typescript
// 在浏览器控制台查看当前活跃特效数量
console.log('活跃特效:', EffectManager.getInstance().activeEffects.length);

// 查看特效更新日志（临时添加）
EffectManager.getInstance().update = (delta) => {
  console.log(`更新特效, delta: ${delta}`);
  // ... 原有逻辑
};
```

## 文件结构

```
src/
├── core/
│   ├── BaseEffect.ts       # 特效抽象基类
│   └── EffectManager.ts    # 特效管理器（含所有特效实现）
└── App.tsx                 # 游戏入口（集成特效系统）
```
