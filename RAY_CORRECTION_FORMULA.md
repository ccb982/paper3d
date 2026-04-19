# 射线修正公式详解

## 目录

1. [问题背景](#1-问题背景)
2. [修正公式组成](#2-修正公式组成)
3. [相机仰角计算](#3-相机仰角计算)
4. [距离补偿机制](#4-距离补偿机制)
5. [俯角补偿机制](#5-俯角补偿机制)
6. [综合修正计算](#6-综合修正计算)
7. [修正方向分析](#7-修正方向分析)
8. [参数调优指南](#8-参数调优指南)
9. [效果验证](#9-效果验证)
10. [代码实现](#10-代码实现)

---

## 1. 问题背景

在第三人称射击游戏中，相机与角色位置分离，当相机俯角变化时，会出现以下问题：

- **视角偏差**：相机射线与角色实际发射方向存在偏差
- **瞄准困难**：玩家感觉准星指向与子弹轨迹不一致
- **补偿需求**：需要根据相机仰角和距离动态调整射线方向

### 核心问题

当相机向下俯视时，相机射线与角色发射点的连线会形成一个角度差，导致子弹轨迹与玩家预期不符。

---

## 2. 修正公式组成

### 2.1 公式架构

```
修正后的 NDC Y 坐标 = 原始 NDC Y 坐标 + 修正值

其中：
修正值 = -相机仰角 × 综合补偿系数

综合补偿系数 = 基础补偿系数 × 距离补偿系数 × 俯角补偿系数
```

### 2.2 数学表达式

```
correctedNDC.y = ndcY + correction

correction = -pitch × totalCompensation

totalCompensation = baseCompensation × distanceCompensation × pitchCompensation

distanceCompensation = clamp(20 / distanceToCamera, 0.8, 1.2)

pitchCompensation = 1.0 + max(0, pitch) × 0.5
```

---

## 3. 相机仰角计算

### 3.1 仰角定义

相机仰角（pitch）是相机视线与水平平面的夹角：

- **正值**：相机向下看（俯视）
- **负值**：相机向上看（仰视）
- **0**：相机平视

### 3.2 计算方法

```typescript
function getCameraPitch(camera: THREE.Camera): number {
  // 强制更新相机矩阵，确保获取到最新的方向
  camera.updateMatrixWorld();
  
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}
```

### 3.3 几何原理

1. **相机方向向量**：`camera.getWorldDirection(direction)` 返回相机在世界空间中的朝向
2. **垂直分量**：`direction.y` 表示相机朝向的垂直分量
3. **反正弦函数**：`Math.asin(direction.y)` 将垂直分量转换为角度

### 3.4 仰角范围

| 相机状态 | direction.y | 仰角（弧度） | 仰角（度） |
|---------|------------|------------|-----------|
| 水平向前 | 0 | 0 | 0° |
| 45°俯视 | -0.707 | -0.785 | -45° |
| 45°仰视 | 0.707 | 0.785 | 45° |
| 垂直向下 | -1 | -1.571 | -90° |
| 垂直向上 | 1 | 1.571 | 90° |

> **注意**：在代码实现中，由于 THREE.js 的坐标系定义，实际返回的仰角符号与上述表格相反。当相机向下看时，`direction.y` 为负值，`Math.asin(direction.y)` 也为负值。

---

## 4. 距离补偿机制

### 4.1 设计原理

- **近距离**：角色与相机距离近，视角差异大，需要更强的补偿
- **远距离**：角色与相机距离远，视角差异小，需要较弱的补偿

### 4.2 补偿公式

```
distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera))
```

### 4.3 补偿效果

| 距离 (distanceToCamera) | 20/distance | 补偿系数 (distanceCompensation) | 效果 |
|------------------------|-------------|---------------------------------|------|
| 5 | 4.0 | 1.2 | 最强补偿 |
| 10 | 2.0 | 1.2 | 强补偿 |
| 20 | 1.0 | 1.0 | 基准补偿 |
| 30 | 0.67 | 0.8 | 弱补偿 |
| 50 | 0.4 | 0.8 | 最弱补偿 |

### 4.4 限制范围

- **最小值**：0.8（确保即使在远距离也有基础补偿）
- **最大值**：1.2（避免近距离补偿过度）

---

## 5. 俯角补偿机制

### 5.1 设计原理

- **俯视**：相机向下看，需要更多补偿
- **平视**：相机水平，不需要额外补偿
- **仰视**：相机向上看，不需要额外补偿

### 5.2 补偿公式

```
pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5
```

### 5.3 补偿效果

| 仰角 (pitch) | max(0, pitch) | 补偿系数 (pitchCompensation) | 效果 |
|-------------|---------------|------------------------------|------|
| -0.785 (-45°) | 0 | 1.0 | 无额外补偿 |
| 0 (0°) | 0 | 1.0 | 无额外补偿 |
| 0.393 (22.5°) | 0.393 | 1.2 | 20% 额外补偿 |
| 0.785 (45°) | 0.785 | 1.4 | 40% 额外补偿 |
| 1.571 (90°) | 1.571 | 1.8 | 80% 额外补偿 |

### 5.4 关键特性

- **只对俯视有效**：`Math.max(0, pitch)` 确保只有当相机向下看时才增加补偿
- **线性增长**：补偿强度随俯角增大而线性增加

---

## 6. 综合修正计算

### 6.1 基础补偿系数

```
baseCompensation = 0.3 // 默认值
```

### 6.2 综合补偿系数

```
totalCompensation = baseCompensation × distanceCompensation × pitchCompensation
```

### 6.3 修正值计算

```
correction = -pitch × totalCompensation
```

### 6.4 应用修正

```
ndcY += correction
ndcY = Math.max(-1, Math.min(1, ndcY)) // 限制范围
```

---

## 7. 修正方向分析

### 7.1 方向修正原理

| 相机状态 | pitch 符号 | correction 符号 | ndcY 变化 | 射线方向 |
|---------|-----------|----------------|-----------|---------|
| 俯视 | 负 | 正 | 增加 | 向上偏移 |
| 平视 | 0 | 0 | 不变 | 不变 |
| 仰视 | 正 | 负 | 减少 | 向下偏移 |

### 7.2 修正效果

**俯视时**（pitch < 0）：
- `correction = -pitch × totalCompensation` → 正值
- `ndcY += correction` → NDC Y 坐标增加
- 射线方向向上偏移，补偿相机与角色的高度差

**仰视时**（pitch > 0）：
- `correction = -pitch × totalCompensation` → 负值
- `ndcY += correction` → NDC Y 坐标减少
- 射线方向向下偏移，补偿相机与角色的高度差

---

## 8. 参数调优指南

### 8.1 基础补偿系数 (baseCompensation)

| 值 | 效果 | 适用场景 |
|-----|------|----------|
| 0.1-0.2 | 弱补偿 | 远距离、轻微视角变化 |
| 0.3 | 标准补偿 | 通用场景 |
| 0.4-0.5 | 强补偿 | 近距离、大幅视角变化 |

### 8.2 距离补偿参数

- **参考距离 (20)**：可根据游戏场景大小调整
- **限制范围 (0.8-1.2)**：保持不变以确保稳定效果

### 8.3 俯角补偿参数

- **系数 (0.5)**：可根据游戏视角灵敏度调整
- **最大值**：建议不超过 1.0 以避免过度补偿

### 8.4 调优步骤

1. **初始设置**：使用默认值 `baseCompensation = 0.3`
2. **测试场景**：在不同距离和视角下测试
3. **微调参数**：根据实际效果调整 `baseCompensation`
4. **验证效果**：确保在各种场景下瞄准都准确

---

## 9. 效果验证

### 9.1 验证方法

1. **可视化验证**：使用 `RayVisualizer` 观察射线方向变化
2. **日志验证**：查看控制台输出的补偿参数
3. **实际测试**：在游戏中测试不同场景的瞄准效果

### 9.2 预期效果

| 场景 | 预期效果 |
|------|----------|
| 近距离俯视 | 明显向上偏移，确保子弹命中目标 |
| 中距离平视 | 轻微调整，保持瞄准准确 |
| 远距离仰视 | 轻微向下偏移，补偿视角差异 |

### 9.3 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|----------|
| 补偿不足 | baseCompensation 过小 | 增加 baseCompensation |
| 补偿过度 | baseCompensation 过大 | 减小 baseCompensation |
| 方向错误 | 补偿符号错误 | 确保使用 `-pitch` |
| 视角变化时错位 | 相机矩阵未更新 | 确保调用 `camera.updateMatrixWorld()` |

---

## 10. 代码实现

### 10.1 相机仰角计算

```typescript
function getCameraPitch(camera: THREE.Camera): number {
  // 强制更新相机矩阵，确保获取到最新的方向
  camera.updateMatrixWorld();
  
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}
```

### 10.2 修正公式实现

```typescript
function getCorrectedNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  characterPosition: THREE.Vector3,
  baseCompensation: number = 0.3
): THREE.Vector2 {
  // 1. 计算基础 NDC 坐标
  const rect = canvas.getBoundingClientRect();
  const pixelWidth = canvas.width;
  const pixelHeight = canvas.height;
  const scaleX = pixelWidth / rect.width;
  const scaleY = pixelHeight / rect.height;
  const pixelX = (clientX - rect.left) * scaleX;
  const pixelY = (clientY - rect.top) * scaleY;
  let ndcX = (pixelX / pixelWidth) * 2 - 1;
  let ndcY = -(pixelY / pixelHeight) * 2 + 1;
  
  // 2. 计算相机仰角
  const pitch = getCameraPitch(camera);
  
  // 3. 计算角色到相机的距离
  const distanceToCamera = camera.position.distanceTo(characterPosition);
  
  // 4. 距离补偿
  const distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera));
  
  // 5. 俯角补偿
  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
  
  // 6. 综合补偿系数
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
  
  // 7. 计算修正值
  const correction = -pitch * totalCompensation;
  
  // 8. 应用修正
  ndcY += correction;
  ndcY = Math.max(-1, Math.min(1, ndcY)); // 限制范围
  
  // 9. 调试日志
  console.log(`Pitch: ${pitch.toFixed(3)}, Distance: ${distanceToCamera.toFixed(2)}, DistanceComp: ${distanceCompensation.toFixed(3)}, PitchComp: ${pitchCompensation.toFixed(3)}, Total: ${totalCompensation.toFixed(3)}, Correction: ${correction.toFixed(3)}`);
  
  return new THREE.Vector2(ndcX, ndcY);
}
```

### 10.3 使用示例

```typescript
// 在鼠标移动处理中使用
const handleMouseMove = (event: MouseEvent) => {
  const mousePos = { x: event.clientX, y: event.clientY };
  mousePosRef.current = mousePos;
  
  if (cameraRef.current) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // 计算角色位置
    const characterPos = new THREE.Vector3(
      gameStore.character.position.x,
      gameStore.character.position.y,
      gameStore.character.position.z
    );
    
    // 获取修正后的 NDC 坐标
    const correctedNDC = getCorrectedNDC(
      canvas, mousePos.x, mousePos.y, cameraRef.current, characterPos, 0.3
    );
    
    // 使用修正后的 NDC 创建射线
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(correctedNDC, cameraRef.current);
    
    // 执行射线检测
    // ...
  }
};
```

---

## 11. 附录：坐标系统说明

### 11.1 NDC 坐标范围

| 坐标 | 范围 | 说明 |
|------|------|------|
| ndcX | [-1, 1] | 屏幕水平方向，-1 左，1 右 |
| ndcY | [-1, 1] | 屏幕垂直方向，-1 下，1 上 |

### 11.2 相机坐标系

- **X 轴**：向右
- **Y 轴**：向上
- **Z 轴**：向后（相机朝向的反方向）

### 11.3 修正效果示例

| 原始 NDC Y | 修正值 | 修正后 NDC Y | 效果 |
|------------|--------|--------------|------|
| 0.0 | 0.1 | 0.1 | 射线向上偏移 |
| 0.0 | -0.1 | -0.1 | 射线向下偏移 |
| 0.5 | 0.2 | 0.7 | 射线向上偏移更多 |
| -0.5 | -0.2 | -0.7 | 射线向下偏移更多 |

---

*文档生成时间：2026-04-18*
*适用版本：paper3d-master*
