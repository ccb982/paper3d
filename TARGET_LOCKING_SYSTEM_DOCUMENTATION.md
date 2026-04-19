# 目标锁定与射线检测系统技术文档

## 目录

1. [目标锁定机制](#1-目标锁定机制)
2. [射线检测系统](#2-射线检测系统)
3. [射线可视化系统](#3-射线可视化系统)
4. [修正公式详解](#4-修正公式详解)
5. [核心算法实现](#5-核心算法实现)
6. [调试与验证](#6-调试与验证)

---

## 1. 目标锁定机制

### 1.1 锁定流程概述

目标锁定是一套从射线检测到射击许可的完整状态机：

```
[无目标] → 检测到目标 → [锁定中] → 倒计时结束 → [已锁定] → 射击
                ↑              ↓
                └──── 目标丢失 ┘
```

### 1.2 状态定义

```typescript
// 锁定状态枚举
enum LockState {
  IDLE = 'idle',           // 空闲状态，无目标
  LOCKING = 'locking',     // 锁定中，倒计时进行
  LOCKED = 'locked',       // 已锁定，可射击
  LOST = 'lost'            // 目标丢失
}

// 锁定信息接口
interface LockInfo {
  state: LockState;
  target: THREE.Object3D | null;
  distance: number;
  lockStartTime: number;
  countdown: number;       // 剩余倒计时（毫秒）
}
```

### 1.3 锁定条件

**开始锁定的条件**：
1. 鼠标处于按下状态（`isMouseDownRef.current === true`）
2. 射线检测到可攻击目标
3. 当前没有正在锁定的目标（`lockedTargetRef.current === null`）
4. 不在锁定倒计时中（`!isLockingRef.current`）

**维持锁定的条件**：
1. 目标持续被射线检测到
2. 锁定倒计时未结束

**锁定解除的条件**：
1. 用户松开鼠标（`mouseup`事件）
2. 目标脱离射线检测范围
3. 目标被其他障碍物遮挡

### 1.4 倒计时机制

```typescript
const LOCK_DURATION = 1000; // 锁定倒计时：1秒

// 在 useFrame 中更新倒计时
if (isLockingRef.current && lockedTargetRef.current) {
  lockCountdownRef.current -= delta * 1000; // delta 单位是秒，转为毫秒

  if (lockCountdownRef.current <= 0) {
    // 倒计时结束，锁定完成
    lockCountdownRef.current = 0;
    isLockingRef.current = false;
    setLockCountdown(0);
    setIsLocking(false);
    console.log('锁定完成，可以射击');
  } else {
    setLockCountdown(lockCountdownRef.current);
  }
}
```

### 1.5 目标更新逻辑

```typescript
// 处理检测结果
if (allIntersects.length > 0) {
  // 按距离排序，取最近的目标
  allIntersects.sort((a, b) => a.distance - b.distance);
  const closestIntersect = allIntersects[0];

  const target: Target = {
    object: closestIntersect.object,
    distance: closestIntersect.distance
  };

  // 目标检测状态管理
  if (!targetDetectedRef.current) {
    targetDetectedRef.current = true;

    // 开始锁定倒计时
    if (!lockedTargetRef.current) {
      lockCountdownRef.current = 1000;
      isLockingRef.current = true;
      setLockCountdown(1000);
      setIsLocking(true);
    }
  }

  // 更新锁定目标
  lockedTargetRef.current = target;
  setLockedTarget(target);
} else {
  // 未检测到目标
  targetDetectedRef.current = false;

  // 如果正在锁定中但目标丢失，取消锁定
  if (isLockingRef.current) {
    lockCountdownRef.current = 0;
    isLockingRef.current = false;
    setLockCountdown(0);
    setIsLocking(false);
    console.log('目标丢失，取消锁定');
  }

  lockedTargetRef.current = null;
  setLockedTarget(null);
}
```

---

## 2. 射线检测系统

### 2.1 基础射线检测

THREE.Raycaster 是 Three.js 提供的射线检测工具，用于从相机发出射线并检测与场景中物体的相交情况。

```typescript
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(ndcX, ndcY);

// 从相机通过鼠标位置创建射线
raycaster.setFromCamera(mouse, camera);

// 执行射线检测
const intersects = raycaster.intersectObjects(scene.children, true);
```

### 2.2 NDC 坐标转换

屏幕像素坐标转换为归一化设备坐标（NDC）：

```typescript
function screenToNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();

  // 考虑 CSS 尺寸与实际 canvas 尺寸的差异
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  // 转换为像素坐标
  const pixelX = (clientX - rect.left) * scaleX;
  const pixelY = (clientY - rect.top) * scaleY;

  // 转换为 NDC 坐标
  const ndcX = (pixelX / canvas.width) * 2 - 1;
  const ndcY = -(pixelY / canvas.height) * 2 + 1;

  return new THREE.Vector2(ndcX, ndcY);
}
```

### 2.3 多射线检测（增大检测面积）

单射线检测的命中率较低，使用十字形布局的 5 条射线来增大检测横截面积：

```typescript
// 射线偏移量（十字形布局）
const rayOffsets = [
  { x: 0, y: 0 },      // 中心
  { x: 0.05, y: 0 },   // 右
  { x: -0.05, y: 0 },  // 左
  { x: 0, y: 0.05 },   // 上
  { x: 0, y: -0.05 },  // 下
];

const allIntersects: THREE.Intersection[] = [];

for (const offset of rayOffsets) {
  // 创建射线
  raycaster.setFromCamera(
    new THREE.Vector2(ndcX + offset.x, ndcY + offset.y),
    camera
  );

  // 执行检测
  const intersects = raycaster.intersectObjects(shootableObjects, true);

  // 合并结果
  allIntersects.push(...intersects);
}

// 按距离排序
allIntersects.sort((a, b) => a.distance - b.distance);
```

### 2.4 射线融合策略

当多条射线同时检测到目标时，采用以下策略：

```typescript
// 策略：取 Y 分量较大的方向（更高的射线位置）
const finalDirection = rawDirection.y > correctedDirection.y
  ? rawDirection
  : correctedDirection;
```

这确保了在修正后，如果原始射线位置更高，则使用原始射线，避免过度修正。

### 2.5 可射击对象管理

```typescript
const shootableObjectsRef = useRef<THREE.Object3D[]>([]);

// 在对象创建时注册
<mesh
  position={[5, 1, 0]}
  onCreated={(mesh) => {
    shootableObjectsRef.current.push(mesh);
  }}
>
  <sphereGeometry args={[0.5]} />
  <meshStandardMaterial color={0x00ff00} />
</mesh>
```

---

## 3. 射线可视化系统

### 3.1 RayVisualizer 组件

单条射线的可视化组件：

```tsx
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface RayVisualizerProps {
  origin: THREE.Vector3;      // 射线起点
  direction: THREE.Vector3;   // 射线方向
  length?: number;            // 射线长度
  color?: number;             // 射线颜色
}

const RayVisualizer: React.FC<RayVisualizerProps> = ({
  origin,
  direction,
  length = 100,
  color = 0xff0000
}) => {
  const lineRef = useRef<THREE.Line>(null);

  useEffect(() => {
    if (lineRef.current) {
      // 计算射线终点
      const end = new THREE.Vector3()
        .copy(origin)
        .add(direction.clone().multiplyScalar(length));

      // 更新几何体
      const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);

      // 更新材质
      const material = new THREE.LineBasicMaterial({ color });

      // 应用更新
      lineRef.current.geometry.dispose();
      lineRef.current.geometry = geometry;
      lineRef.current.material = material;
    }
  }, [origin, direction, length, color]);

  return (
    <line ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([0, 0, 0, 0, 0, 0])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color={color} />
    </line>
  );
};

export default RayVisualizer;
```

### 3.2 MultiRayVisualizer 组件

多条射线的可视化组件，用于显示十字形布局：

```tsx
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { gameStore } from '../../store';

const MultiRayVisualizer: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (groupRef.current) {
      // 清除现有线条
      groupRef.current.clear();

      // 获取射线数据
      const { origins, directions } = gameStore.raycastInfo;

      // 为每条射线创建可视化线条
      origins.forEach((origin, index) => {
        const direction = directions[index];
        if (origin && direction) {
          // 计算射线终点
          const end = new THREE.Vector3()
            .copy(origin)
            .add(direction.clone().multiplyScalar(100));

          // 创建几何体
          const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);

          // 中心射线用红色，其他用蓝色
          const material = new THREE.LineBasicMaterial({
            color: index === 0 ? 0xff0000 : 0x0000ff,
            linewidth: index === 0 ? 2 : 1
          });

          // 创建线条并添加到组
          const line = new THREE.Line(geometry, material);
          groupRef.current.add(line);
        }
      });
    }
  }, [gameStore.raycastInfo]);

  return <group ref={groupRef} />;
};

export default MultiRayVisualizer;
```

### 3.3 射线状态存储

使用 Zustand store 存储射线数据：

```typescript
// store.ts
interface RaycastInfo {
  origins: THREE.Vector3[];
  directions: THREE.Vector3[];
}

interface GameState {
  // ... 其他状态
  raycastInfo: RaycastInfo;
  setRaycastInfo: (info: RaycastInfo) => void;
}

// 在组件中更新射线数据
gameStore.setRaycastInfo({
  origins: rayOrigins,
  directions: rayDirections
});
```

### 3.4 可视化使用示例

```tsx
// 在 Canvas 中使用
<Canvas
  camera={{ position: [0, 5, 10], fov: 75 }}
  onCreated={({ gl, camera }) => {
    gl.setClearColor(0x87ceeb, 1);
    cameraRef.current = camera as THREE.PerspectiveCamera;
  }}
>
  {/* 单射线可视化 */}
  {rayOrigin && rayDirection && (
    <RayVisualizer
      origin={rayOrigin}
      direction={rayDirection}
      length={100}
      color={0xff0000}
    />
  )}

  {/* 多射线可视化 */}
  <MultiRayVisualizer />
</Canvas>
```

### 3.5 可视化效果说明

| 射线类型 | 颜色 | 线宽 | 说明 |
|---------|------|------|------|
| 中心射线 | 红色 (#FF0000) | 2 | 主检测射线 |
| 边缘射线 | 蓝色 (#0000FF) | 1 | 扩大检测面积 |

---

## 4. 修正公式详解

### 4.1 问题背景

在第三人称射击游戏中，相机与角色位置分离，当相机俯角变化时，射线检测方向与角色实际发射方向存在偏差，需要动态补偿。

### 4.2 相机仰角计算

```typescript
function getCameraPitch(camera: THREE.Camera): number {
  camera.updateMatrixWorld(); // 确保获取最新方向
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y); // 返回俯角，范围 [-π/2, π/2]
}
```

**几何解释**：
- `getWorldDirection()` 获取相机在世界空间中的朝向向量
- `direction.y` 是朝向向量的垂直分量
- `Math.asin()` 将垂直分量转换为角度

### 4.3 动态补偿公式

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
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const pixelX = (clientX - rect.left) * scaleX;
  const pixelY = (clientY - rect.top) * scaleY;
  let ndcX = (pixelX / canvas.width) * 2 - 1;
  let ndcY = -(pixelY / canvas.height) * 2 + 1;

  // 2. 计算相机俯角
  const pitch = getCameraPitch(camera);

  // 3. 计算角色到相机距离
  const distanceToCamera = camera.position.distanceTo(characterPosition);

  // 4. 距离补偿系数
  const distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera));

  // 5. 俯角补偿系数
  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;

  // 6. 综合补偿系数
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;

  // 7. 应用补偿修正
  const correction = -pitch * totalCompensation;
  ndcY += correction;

  // 8. 限制范围
  ndcY = Math.max(-1, Math.min(1, ndcY));

  return new THREE.Vector2(ndcX, ndcY);
}
```

### 4.4 补偿公式分解

#### 4.4.1 距离补偿

```
distanceCompensation = clamp(20 / distanceToCamera, 0.8, 1.2)
```

| 距离 | 补偿系数 | 效果 |
|------|---------|------|
| 10 | 2.0 → 1.2 | 强补偿 |
| 20 | 1.0 | 基准 |
| 30 | 0.67 → 0.8 | 弱补偿 |
| 50 | 0.4 → 0.8 | 弱补偿 |

**设计原理**：角色距离相机越近，相机与角色的视角差异越大，需要更强的补偿。

#### 4.4.2 俯角补偿

```
pitchCompensation = 1.0 + max(0, pitch) * 0.5
```

| 俯角 | 补偿系数 | 效果 |
|------|---------|------|
| 0° (平视) | 1.0 | 无额外补偿 |
| -30° (俯视) | 1.15 | 15% 增强 |
| -45° (深俯视) | 1.32 | 32% 增强 |
| -60° (极限俯视) | 1.5 | 50% 增强 |

**设计原理**：俯角越大（向下看），角色与相机的高度差越明显，需要更强的补偿。

#### 4.4.3 综合补偿

```
totalCompensation = baseCompensation × distanceCompensation × pitchCompensation
correction = -pitch × totalCompensation
ndcY += correction
```

**符号说明**：
- `correction` 为负值时：向上修正 NDC（射线向下偏移）
- `correction` 为正值时：向下修正 NDC（射线向上偏移）
- 负号 `-pitch` 确保：俯视时（pitch < 0）修正量为正，实现正确的向下补偿

### 4.5 修正效果示意

```
俯视角度大 (-45°)
相机
  \
   \  ← 原始射线
    \
     [目标]

  \
   \  ← 修正后射线（更向下）
    \
     [目标]

修正量 = -(-45°) × (0.3 × 1.32 × 1.32) ≈ 0.23
```

### 4.6 修正参数调优

| 参数 | 默认值 | 建议范围 | 说明 |
|------|-------|---------|------|
| baseCompensation | 0.3 | 0.2-0.5 | 基础补偿强度 |
| distanceCompensation | 20/distance | 固定公式 | 距离补偿 |
| pitchCompensation | 1+max(0,pitch)*0.5 | 固定公式 | 俯角补偿 |

**调优建议**：
1. 如果角色在近距离抬头看目标时子弹偏下 → 减小 baseCompensation
2. 如果远距离俯视时补偿不足 → 增加 baseCompensation 或 pitchCompensation 系数
3. 如果补偿过度 → 减小 baseCompensation

---

## 5. 核心算法实现

### 5.1 完整射击逻辑

```typescript
// 游戏循环中的射击逻辑
useFrame((state, delta) => {
  const { camera } = state;
  camera.updateMatrixWorld();

  // === 锁定倒计时更新 ===
  if (isLockingRef.current && lockedTargetRef.current) {
    lockCountdownRef.current -= delta * 1000;

    if (lockCountdownRef.current <= 0) {
      lockCountdownRef.current = 0;
      isLockingRef.current = false;
      setLockCountdown(0);
      setIsLocking(false);
    } else {
      setLockCountdown(lockCountdownRef.current);
    }
  }

  // === 射线检测 ===
  if (isMouseDownRef.current && camera && canvasRef.current) {
    const canvas = canvasRef.current;
    const mousePos = mousePosRef.current;

    // 计算 NDC 坐标
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pixelX = (mousePos.x - rect.left) * scaleX;
    const pixelY = (mousePos.y - rect.top) * scaleY;
    const ndcX = (pixelX / canvas.width) * 2 - 1;
    const ndcY = -(pixelY / canvas.height) * 2 + 1;

    // 计算角色位置
    const characterPosition = new THREE.Vector3(
      gameStore.character.position.x,
      gameStore.character.position.y,
      gameStore.character.position.z
    );

    // 获取修正后的 NDC
    const correctedNDC = getCorrectedNDC(
      canvas, mousePos.x, mousePos.y, camera, characterPosition, 0.3
    );

    // 多射线检测
    const raycaster = new THREE.Raycaster();
    const allIntersects: THREE.Intersection[] = [];
    const rayOrigins: THREE.Vector3[] = [];
    const rayDirections: THREE.Vector3[] = [];

    const rayOffsets = [
      { x: 0, y: 0 },
      { x: 0.05, y: 0 },
      { x: -0.05, y: 0 },
      { x: 0, y: 0.05 },
      { x: 0, y: -0.05 },
    ];

    for (const offset of rayOffsets) {
      // 原始射线
      raycaster.setFromCamera(
        new THREE.Vector2(ndcX + offset.x, ndcY + offset.y),
        camera
      );
      const rawDirection = raycaster.ray.direction.clone();

      // 修正后射线
      raycaster.setFromCamera(
        new THREE.Vector2(correctedNDC.x + offset.x, correctedNDC.y + offset.y),
        camera
      );
      const correctedDirection = raycaster.ray.direction.clone();

      // 融合策略
      const finalDirection = rawDirection.y > correctedDirection.y
        ? rawDirection
        : correctedDirection;

      // 执行检测
      raycaster.set(camera.position, finalDirection);
      const intersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
      allIntersects.push(...intersects);

      // 存储射线数据
      rayOrigins.push(raycaster.ray.origin.clone());
      rayDirections.push(finalDirection.clone());
    }

    // 更新射线可视化
    gameStore.setRaycastInfo({ origins: rayOrigins, directions: rayDirections });

    // 处理检测结果
    if (allIntersects.length > 0) {
      allIntersects.sort((a, b) => a.distance - b.distance);
      const closestIntersect = allIntersects[0];

      const target: Target = {
        object: closestIntersect.object,
        distance: closestIntersect.distance
      };

      if (!targetDetectedRef.current) {
        targetDetectedRef.current = true;

        if (!lockedTargetRef.current) {
          lockCountdownRef.current = 1000;
          isLockingRef.current = true;
          setLockCountdown(1000);
          setIsLocking(true);
        }
      }

      lockedTargetRef.current = target;
      setLockedTarget(target);
    } else {
      targetDetectedRef.current = false;

      if (isLockingRef.current) {
        lockCountdownRef.current = 0;
        isLockingRef.current = false;
        setLockCountdown(0);
        setIsLocking(false);
      }

      lockedTargetRef.current = null;
      setLockedTarget(null);
    }
  }

  // === 射击执行 ===
  if (isMouseDownRef.current && lockedTargetRef.current && !isLockingRef.current) {
    const now = Date.now();

    if (now - lastFireTimeRef.current >= FIRE_RATE) {
      lastFireTimeRef.current = now;

      // 获取目标实时位置
      const targetPosition = new THREE.Vector3();
      lockedTargetRef.current.object.getWorldPosition(targetPosition);

      // 计算子弹方向
      const direction = new THREE.Vector3()
        .subVectors(
          targetPosition,
          new THREE.Vector3(
            gameStore.character.position.x,
            gameStore.character.position.y + 1.2,
            gameStore.character.position.z
          )
        )
        .normalize();

      // 创建子弹
      const newBullet = {
        id: bulletIdRef.current++,
        position: {
          x: gameStore.character.position.x,
          y: gameStore.character.position.y + 1.2,
          z: gameStore.character.position.z
        },
        direction,
      };

      setBullets(prev => [...prev, newBullet]);

      // 更新射击状态
      gameStore.setShootInfo({
        isFiring: true,
        lastFired: now,
        bulletCount: (gameStore.shootInfo.bulletCount || 0) + 1
      });
    }
  }

  // === 子弹更新 ===
  setBullets(prevBullets => {
    return prevBullets
      .map(bullet => ({
        ...bullet,
        position: {
          x: bullet.position.x + bullet.direction.x * BULLET_SPEED * delta,
          y: bullet.position.y + bullet.direction.y * BULLET_SPEED * delta,
          z: bullet.position.z + bullet.direction.z * BULLET_SPEED * delta
        }
      }))
      .filter(bullet => {
        const distance = Math.sqrt(
          Math.pow(bullet.position.x - gameStore.character.position.x, 2) +
          Math.pow(bullet.position.y - gameStore.character.position.y, 2) +
          Math.pow(bullet.position.z - gameStore.character.position.z, 2)
        );
        return distance < 100;
      });
  });
});
```

### 5.2 鼠标事件处理

```typescript
// 鼠标按下
const handleMouseDown = () => {
  isMouseDownRef.current = true;
  targetDetectedRef.current = null;
  gameStore.setShootInfo({ isFiring: true });
};

// 鼠标松开 - 关键：解除锁定
const handleMouseUp = () => {
  isMouseDownRef.current = false;
  targetDetectedRef.current = null;

  // 重置锁定状态
  lockCountdownRef.current = 0;
  isLockingRef.current = false;
  setLockCountdown(0);
  setIsLocking(false);

  // 更新射击状态
  gameStore.setShootInfo({ isFiring: false });
};

// 鼠标移动
const handleMouseMove = (event: MouseEvent) => {
  mousePosRef.current = { x: event.clientX, y: event.clientY };

  if (cameraRef.current && canvasRef.current) {
    const canvas = canvasRef.current;

    // 更新相机矩阵
    if (cameraRef.current.aspect !== canvas.width / canvas.height) {
      cameraRef.current.aspect = canvas.width / canvas.height;
      cameraRef.current.updateProjectionMatrix();
      cameraRef.current.updateMatrixWorld();
    }

    // 计算修正后的 NDC
    const characterPos = new THREE.Vector3(
      gameStore.character.position.x,
      gameStore.character.position.y,
      gameStore.character.position.z
    );

    const correctedNDC = getCorrectedNDC(
      canvas,
      event.clientX,
      event.clientY,
      cameraRef.current,
      characterPos,
      0.3
    );

    // 更新射线可视化
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(correctedNDC, cameraRef.current);
    setRayOrigin(raycaster.ray.origin.clone());
    setRayDirection(raycaster.ray.direction.clone());
  }
};
```

---

## 6. 调试与验证

### 6.1 控制台日志

```typescript
// 补偿参数日志
console.log(`Pitch: ${pitch.toFixed(3)},
             Distance: ${distanceToCamera.toFixed(2)},
             DistanceComp: ${distanceCompensation.toFixed(3)},
             PitchComp: ${pitchCompensation.toFixed(3)},
             Total: ${totalCompensation.toFixed(3)},
             Correction: ${correction.toFixed(3)}`);

// 锁定状态日志
console.log('开始锁定倒计时');
console.log('锁定完成，可以射击');
console.log('目标丢失，取消锁定');
console.log('取消锁定倒计时');

// 射击日志
console.log(`射击！目标位置: (${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z})`);
```

### 6.2 射线可视化检查

1. **观察射线颜色**：
   - 红色中心射线表示主检测方向
   - 蓝色边缘射线表示辅助检测方向

2. **检查射线是否穿墙**：
   - 如果射线穿过障碍物，可能是 `intersectObjects` 的递归检测未正确设置

3. **验证修正方向**：
   - 俯视时射线应向下偏移
   - 仰视时射线应向上偏移

### 6.3 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 射线不显示 | 可视化组件未启用 | 检查 `<RayVisualizer>` 和 `<MultiRayVisualizer>` 是否在 Canvas 中 |
| 射线方向错误 | 相机矩阵未更新 | 在射线检测前调用 `camera.updateMatrixWorld()` |
| 补偿效果不明显 | baseCompensation 过小 | 增加 baseCompensation 值 |
| 补偿过度 | baseCompensation 过大 | 减小 baseCompensation 值 |
| 目标检测不稳定 | 射线偏移量过小 | 增加 rayOffsets 中的偏移值 |

### 6.4 调试检查清单

- [ ] 射线可视化是否正常显示
- [ ] 中心射线是否指向鼠标位置
- [ ] 俯视/仰视时射线偏移方向是否正确
- [ ] 锁定倒计时是否正确（1秒）
- [ ] 锁定环是否正确显示
- [ ] 目标丢失后锁定是否正确解除
- [ ] 松开鼠标后所有状态是否正确重置

---

## 附录：常量定义

```typescript
// 射击常量
const FIRE_RATE = 100;        // 射击间隔（毫秒）
const BULLET_SPEED = 10;      // 子弹速度
const LOCK_DURATION = 1000;    // 锁定倒计时（毫秒）

// 射线检测常量
const RAY_OFFSETS = [
  { x: 0, y: 0 },
  { x: 0.05, y: 0 },
  { x: -0.05, y: 0 },
  { x: 0, y: 0.05 },
  { x: 0, y: -0.05 },
];

// 补偿公式常量
const BASE_COMPENSATION = 0.3;
const DISTANCE_REF = 20;      // 参考距离
const MIN_DISTANCE_COMP = 0.8;
const MAX_DISTANCE_COMP = 1.2;
const PITCH_FACTOR = 0.5;      // 俯角补偿系数
```

---

*文档生成时间：2026-04-18*
*适用版本：paper3d-master*
