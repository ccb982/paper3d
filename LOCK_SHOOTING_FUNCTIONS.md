# 锁定射击系统函数详解

## 目录

1. [概述](#概述)
2. [getBulletDirection 函数](#getbulletdirection-函数)
3. [锁定目标射击逻辑](#锁定目标射击逻辑)
4. [锁定流程详解](#锁定流程详解)
5. [开火流程详解](#开火流程详解)
6. [完整代码示例](#完整代码示例)

---

## 概述

本射击系统采用**锁定式射击机制**，核心流程如下：

1. **锁定阶段**：通过射线检测找到目标，开始1秒倒计时
2. **倒计时阶段**：显示蓝色锁定环动画
3. **射击阶段**：倒计时结束后，持续向目标位置射击

射击方向计算有两种模式：
- **自由射击**（未实现）：根据鼠标位置直接计算方向
- **锁定射击**（当前使用）：根据锁定目标的世界坐标计算方向

---

## getBulletDirection 函数

### 函数签名

```typescript
const getBulletDirection = (
  camera: THREE.Camera,
  characterPos: { x: number; y: number; z: number },
  mouseX: number,
  mouseY: number,
  canvasElement: HTMLCanvasElement
): THREE.Vector3
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| camera | THREE.Camera | Three.js 相机对象 |
| characterPos | { x, y, z } | 角色世界坐标 |
| mouseX | number | 鼠标屏幕X坐标 |
| mouseY | number | 鼠标屏幕Y坐标 |
| canvasElement | HTMLCanvasElement | Canvas DOM元素 |

### 返回值

- `THREE.Vector3`：标准化后的子弹飞行方向向量

### 实现代码

```typescript
const getBulletDirection = (
  camera: THREE.Camera,
  characterPos: { x: number; y: number; z: number },
  mouseX: number,
  mouseY: number,
  canvasElement: HTMLCanvasElement
): THREE.Vector3 => {
  // 1. 获取 canvas 相对坐标并考虑物理像素尺寸
  const rect = canvasElement.getBoundingClientRect();

  // 正确计算鼠标在canvas物理像素上的位置
  const pixelX = (mouseX - rect.left) * (canvasElement.width / rect.width);
  const pixelY = (mouseY - rect.top) * (canvasElement.height / rect.height);

  // 转换为标准化设备坐标
  const ndcX = (pixelX / canvasElement.width) * 2 - 1;
  const ndcY = -(pixelY / canvasElement.height) * 2 + 1;

  // 确保相机投影矩阵已更新
  if (camera.aspect !== canvasElement.width / canvasElement.height) {
    camera.aspect = canvasElement.width / canvasElement.height;
    camera.updateProjectionMatrix();
  }

  // 2. 创建射线
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // 3. 直接使用相机射线方向作为子弹方向
  // 这样可以确保射击方向与鼠标射线完全一致
  return raycaster.ray.direction.clone().normalize();
};
```

### 工作流程图

```
鼠标位置 (mouseX, mouseY)
         │
         ▼
┌─────────────────────────┐
│ 计算 Canvas 相对坐标    │
│ pixelX = (mouseX - rect.left) * (width / rect.width)
│ pixelY = (mouseY - rect.top) * (height / rect.height)
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 转换为 NDC 坐标         │
│ ndcX = pixelX / width * 2 - 1
│ ndcY = -pixelY / height * 2 + 1
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 更新相机投影矩阵        │
│ camera.updateProjectionMatrix()
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 创建射线                │
│ raycaster.setFromCamera(NDC, camera)
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 返回射线方向            │
│ raycaster.ray.direction.clone().normalize()
└─────────────────────────┘
```

### 使用场景

此函数主要用于**自由射击模式**（当前系统未启用），根据鼠标位置直接计算射击方向。

---

## 锁定目标射击逻辑

### 核心代码

```typescript
// 传统开火检测（只在锁定状态且倒计时结束后射击）
if (isMouseDownRef.current && cameraRef.current && lockedTargetRef.current && !isLockingRef.current) {
  const now = Date.now();
  if (now - lastFireTimeRef.current >= fireRate) {
    lastFireTimeRef.current = now;

    // 实时获取最新值
    const realTimeCharacterPos = gameStore.character.position;

    // 有锁定目标：从角色位置指向锁定目标的击中点
    console.log('使用锁定目标射击');

    // 获取目标的世界位置，确保使用最新位置
    const targetPosition = new THREE.Vector3();
    lockedTargetRef.current.object.getWorldPosition(targetPosition);

    // 计算方向：从角色(头顶+1.2)指向目标
    const direction = new THREE.Vector3().subVectors(
      targetPosition,
      new THREE.Vector3(realTimeCharacterPos.x, realTimeCharacterPos.y + 1.2, realTimeCharacterPos.z)
    ).normalize();

    // 更新射击方向
    setShootDirection(direction.clone());

    // 更新射击状态
    gameStore.setShootInfo({
      isFiring: true,
      fireCount: gameStore.shootInfo.fireCount + 1
    });

    // 创建子弹
    const newBullet = {
      id: bulletIdRef.current++,
      // 子弹从角色头顶1.2单位处发射
      position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z },
      direction,
    };
    setBullets(prev => [...prev, newBullet]);
    console.log('发射子弹:', newBullet);
  }
}
```

### 射击条件

| 条件 | 变量 | 说明 |
|------|------|------|
| 鼠标按下 | `isMouseDownRef.current === true` | 玩家按住鼠标 |
| 相机就绪 | `cameraRef.current !== null` | 相机已初始化 |
| 目标已锁定 | `lockedTargetRef.current !== null` | 锁定倒计时已结束 |
| 不在倒计时中 | `isLockingRef.current === false` | 1秒倒计时已完成 |
| 射击间隔 | `now - lastFireTime >= fireRate` | 距上次射击超过100ms |

### 子弹方向计算

```
目标世界位置 (targetPosition)
         │
         │  subVectors
         ▼
    ┌─────────────────┐
    │  targetPosition - CharacterTop │ = direction
    └─────────────────┘
         │
         ▼ normalize
    标准化方向向量
```

**计算公式**：
```
direction = normalize(targetPosition - characterTop)

其中 characterTop = (characterPos.x, characterPos.y + 1.2, characterPos.z)
```

### 子弹发射位置

```typescript
position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z }
```

- 角色头顶上方 **1.2 单位**处
- 这是为了确保子弹初始位置高于角色中心，避免与角色碰撞

---

## 锁定流程详解

### 锁定状态机

```
         ┌──────────────────────────┐
         │       IDLE (空闲)        │
         │  无目标，不进行任何操作   │
         └───────────┬──────────────┘
                     │ 射线检测到目标
                     ▼
         ┌──────────────────────────┐
    ──▶  │     LOCKING (锁定中)     │◀──┐
    │    │  开始1秒倒计时，显示蓝环  │   │
    │    └───────────┬──────────────┘   │
    │                │ 倒计时结束        │ 目标丢失
    │                ▼                   │
    │    ┌──────────────────────────┐   │
    │    │     LOCKED (已锁定)       │   │
    │    │   可持续射击，更新目标位置  │───┘
    │    └───────────┬──────────────┘
    │                │ 松开鼠标
    └────────────────┘
```

### 锁定开始条件

```typescript
// 在射线检测逻辑中
if (allIntersects.length > 0) {
  // 检测到目标

  // 开始锁定的条件：
  // 1. 之前没有检测到目标 (!targetDetectedRef.current)
  // 2. 之前没有锁定目标 (!lockedTargetRef.current)
  if (!targetDetectedRef.current && !lockedTargetRef.current) {
    targetDetectedRef.current = true;

    // 开始1秒倒计时
    lockCountdownRef.current = 1000;
    isLockingRef.current = true;
    setLockCountdown(1000);
    setIsLocking(true);

    // 更新锁定目标
    lockedTargetRef.current = target;
  }
}
```

### 倒计时更新逻辑

```typescript
// 在 useFrame 中
if (isLockingRef.current && lockedTargetRef.current) {
  // 倒计时递减
  lockCountdownRef.current -= delta * 1000;

  if (lockCountdownRef.current <= 0) {
    // 倒计时结束
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

### 目标丢失处理

```typescript
// 射线未检测到目标时
if (allIntersects.length === 0) {
  // 重置检测状态
  targetDetectedRef.current = false;

  // 如果正在锁定中，取消锁定
  if (isLockingRef.current) {
    lockCountdownRef.current = 0;
    isLockingRef.current = false;
    setLockCountdown(0);
    setIsLocking(false);
    console.log('目标丢失，取消锁定');
  }

  // 清除锁定目标
  lockedTargetRef.current = null;
}
```

---

## 开火流程详解

### 完整开火流程图

```
用户按住鼠标
     │
     ▼
┌─────────────────────────┐
│ 射线检测目标            │
│ intersectObjects()      │
└───────────┬─────────────┘
            │
            ▼
    ┌───────────────┐
    │ 检测到目标？   │
    └───────┬───────┘
        Yes │        No
      ┌─────┴─────┐
      ▼           ▼
┌──────────┐  ┌────────────────┐
│ 开始倒计时 │  │ 重置锁定状态   │
│ 1000ms   │  │ 不射击         │
└────┬─────┘  └────────────────┘
      │
      │ 倒计时中
      ▼
┌───────────────┐
│ 倒计时结束？   │
└───────┬───────┘
   Yes  │   No
  ┌─────┴─────┐
  ▼           ▼
┌──────────┐ ┌────────────────┐
│ 可射击   │ │ 继续倒计时     │
└────┬─────┘ └────────────────┘
     │
     │ 检查射击间隔
     ▼
┌───────────────┐
│ 间隔≥100ms？  │
└───────┬───────┘
   Yes  │   No
  ┌─────┴─────┐
  ▼           ▼
┌──────────┐ ┌────────────────┐
│ 创建子弹 │ │ 等待间隔结束   │
└────┬─────┘ └────────────────┘
     │
     ▼
┌─────────────────────────┐
│ 更新子弹位置            │
│ 每帧移动 direction * velocity * delta
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 检查子弹是否超出边界    │
│ |x| < 100, |z| < 100, y < 50
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      ▼           ▼
   超出        范围内
     │           │
     ▼           ▼
┌──────────┐ ┌────────────────┐
│ 移除子弹 │ │ 继续更新位置   │
└──────────┘ └────────────────┘
```

### 开火条件检查顺序

```typescript
// 1. 检查鼠标是否按下
if (isMouseDownRef.current) {

  // 2. 检查是否有锁定目标
  if (lockedTargetRef.current) {

    // 3. 检查是否不在倒计时中
    if (!isLockingRef.current) {

      // 4. 检查射击间隔
      const now = Date.now();
      if (now - lastFireTimeRef.current >= fireRate) {
        // 执行射击
      }
    }
  }
}
```

### 射击间隔控制

```typescript
const fireRate = 100; // 毫秒

// 在 useFrame 中
const now = Date.now();
if (now - lastFireTimeRef.current >= fireRate) {
  // 可以射击
  lastFireTimeRef.current = now; // 重置计时器
}
```

### 子弹创建

```typescript
const newBullet = {
  id: bulletIdRef.current++,           // 唯一ID
  position: {                          // 发射位置
    x: characterPos.x,
    y: characterPos.y + 1.2,          // 头顶1.2单位
    z: characterPos.z
  },
  direction: direction,               // 飞行方向（标准化）
};
```

### 子弹位置更新

```typescript
// 在 useFrame 中更新所有子弹位置
setBullets(prev => prev.map(bullet => ({
  ...bullet,
  position: {
    x: bullet.position.x + bullet.direction.x * velocity * delta,
    y: bullet.position.y + bullet.direction.y * velocity * delta,
    z: bullet.position.z + bullet.direction.z * velocity * delta
  }
})));
```

### 子弹生命周期

```typescript
// 子弹超出范围后移除
setBullets(prev => prev.filter(bullet => {
  return Math.abs(bullet.position.x) < 100 &&
         Math.abs(bullet.position.z) < 100 &&
         bullet.position.y < 50;
}));
```

---

## 完整代码示例

### 1. 射击方向计算函数

```typescript
function calculateShootDirection(
  targetPosition: THREE.Vector3,
  characterPosition: { x: number; y: number; z: number },
  heightOffset: number = 1.2
): THREE.Vector3 {
  // 角色头顶位置
  const characterTop = new THREE.Vector3(
    characterPosition.x,
    characterPosition.y + heightOffset,
    characterPosition.z
  );

  // 计算方向向量并标准化
  return new THREE.Vector3()
    .subVectors(targetPosition, characterTop)
    .normalize();
}
```

### 2. 射击执行函数

```typescript
function executeShooting(
  lockedTarget: Target,
  characterPosition: { x: number; y: number; z: number },
  fireRate: number,
  lastFireTime: number
): { shouldFire: boolean; direction: THREE.Vector3 } | null {

  const now = Date.now();

  // 检查射击间隔
  if (now - lastFireTime < fireRate) {
    return null;
  }

  // 获取目标世界位置
  const targetPosition = new THREE.Vector3();
  lockedTarget.object.getWorldPosition(targetPosition);

  // 计算射击方向
  const direction = calculateShootDirection(targetPosition, characterPosition);

  return {
    shouldFire: true,
    direction
  };
}
```

### 3. 完整射击循环

```typescript
useFrame((state, delta) => {
  const { camera } = state;
  camera.updateMatrixWorld();

  // === 1. 锁定倒计时更新 ===
  if (isLockingRef.current && lockedTargetRef.current) {
    lockCountdownRef.current -= delta * 1000;

    if (lockCountdownRef.current <= 0) {
      lockCountdownRef.current = 0;
      isLockingRef.current = false;
      setLockCountdown(0);
      setIsLocking(false);
    }
  }

  // === 2. 射线检测目标 ===
  if (isMouseDownRef.current && camera) {
    // ... 射线检测逻辑 ...

    if (allIntersects.length > 0) {
      const target = allIntersects[0];

      if (!targetDetectedRef.current && !lockedTargetRef.current) {
        // 开始锁定
        targetDetectedRef.current = true;
        lockCountdownRef.current = 1000;
        isLockingRef.current = true;
        setLockCountdown(1000);
        setIsLocking(true);
      }

      lockedTargetRef.current = target;
    }
  }

  // === 3. 执行射击 ===
  if (isMouseDownRef.current && lockedTargetRef.current && !isLockingRef.current) {
    const result = executeShooting(
      lockedTargetRef.current,
      gameStore.character.position,
      fireRate,
      lastFireTimeRef.current
    );

    if (result) {
      lastFireTimeRef.current = Date.now();

      const newBullet = {
        id: bulletIdRef.current++,
        position: {
          x: gameStore.character.position.x,
          y: gameStore.character.position.y + 1.2,
          z: gameStore.character.position.z
        },
        direction: result.direction,
      };

      setBullets(prev => [...prev, newBullet]);
    }
  }

  // === 4. 更新子弹 ===
  setBullets(prev => prev
    .map(bullet => ({
      ...bullet,
      position: {
        x: bullet.position.x + bullet.direction.x * BULLET_SPEED * delta,
        y: bullet.position.y + bullet.direction.y * BULLET_SPEED * delta,
        z: bullet.position.z + bullet.direction.z * BULLET_SPEED * delta
      }
    }))
    .filter(bullet =>
      Math.abs(bullet.position.x) < 100 &&
      Math.abs(bullet.position.z) < 100 &&
      bullet.position.y < 50
    )
  );
});
```

---

## 关键变量说明

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `lockedTargetRef.current` | `Target \| null` | 当前锁定的目标对象 |
| `isLockingRef.current` | `boolean` | 是否处于锁定倒计时中 |
| `lockCountdownRef.current` | `number` | 剩余倒计时（毫秒） |
| `targetDetectedRef.current` | `boolean \| null` | 是否检测到目标 |
| `isMouseDownRef.current` | `boolean` | 鼠标是否按下 |
| `lastFireTimeRef.current` | `number` | 上次射击时间戳 |

---

*文档生成时间：2026-04-18*
*适用版本：paper3d-master*
