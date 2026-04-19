# 射击系统技术文档

## 1. 系统概述

当前射击系统是一套完整的锁定式射击机制，包含目标检测、锁定倒计时、动态补偿修正、子弹管理等功能。系统仅在锁定状态下允许射击，通过1秒倒计时确保玩家确认目标后开火。

### 1.1 核心特性

- **锁定式射击**：仅在锁定目标后且倒计时结束才允许开火
- **动态补偿修正**：基于相机仰角和角色距离实时调整射线
- **多射线检测**：使用5条射线增大检测横截面积
- **视觉反馈**：蓝色圆环显示锁定进度
- **实时追踪**：锁定后子弹沿目标实时位置飞行

---

## 2. 核心函数详解

### 2.1 getCameraPitch - 获取相机仰角

```typescript
function getCameraPitch(camera: THREE.Camera): number {
  camera.updateMatrixWorld();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}
```

**功能**：计算相机的俯仰角（仰角）

**参数**：
- `camera: THREE.Camera` - Three.js相机对象

**返回值**：
- `number` - 仰角值，范围 [-π/2, π/2]

**调用位置**：
- `getCorrectedNDC` 函数内部
- `useFrame` 回调中射线检测前

**关键点**：
- 必须调用 `camera.updateMatrixWorld()` 确保获取最新方向
- 返回值用于计算补偿修正量

---

### 2.2 getCorrectedNDC - NDC坐标补偿修正

```typescript
function getCorrectedNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  characterPosition: THREE.Vector3,
  baseCompensation: number = 0.3
): THREE.Vector2
```

**功能**：基于相机仰角和角色距离实时计算修正后的NDC坐标

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| canvas | HTMLCanvasElement | Canvas元素 |
| clientX | number | 鼠标X坐标 |
| clientY | number | 鼠标Y坐标 |
| camera | THREE.Camera | Three.js相机对象 |
| characterPosition | THREE.Vector3 | 角色世界坐标 |
| baseCompensation | number | 基础补偿系数，默认0.3 |

**返回值**：
- `THREE.Vector2` - 修正后的NDC坐标

**补偿算法**：

1. **距离补偿**：
```typescript
const distanceToCamera = camera.position.distanceTo(characterPosition);
const distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera));
```
   - 角色距离相机越近，补偿强度越大
   - 范围限制在 [0.8, 1.2]

2. **俯角补偿**：
```typescript
const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
```
   - 俯角越大（向下看），补偿效果越好
   - 平视时无额外补偿

3. **综合补偿**：
```typescript
const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
const correction = -pitch * totalCompensation;
ndcY += correction;
```

**关键点**：
- 每帧实时计算，无累计误差
- 补偿方向与俯角方向相反（向下看时向上补偿）
- NDC坐标限制在 [-1, 1] 范围内

**调用位置**：
- `handleMouseMove` - 鼠标移动时
- `useFrame` 射线检测前
- 目标检测逻辑中

---

### 2.3 getBulletDirection - 子弹方向计算

```typescript
const getBulletDirection = (
  cameraElement: THREE.Camera,
  mouseX: number,
  mouseY: number,
  canvasElement: HTMLCanvasElement
): THREE.Vector3
```

**功能**：根据鼠标位置和相机计算子弹发射方向

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| cameraElement | THREE.Camera | Three.js相机对象 |
| mouseX | number | 鼠标X坐标 |
| mouseY | number | 鼠标Y坐标 |
| canvasElement | HTMLCanvasElement | Canvas元素 |

**返回值**：
- `THREE.Vector3` - 归一化的子弹方向向量

**计算流程**：
1. 获取Canvas边界矩形
2. 计算鼠标在Canvas上的物理像素位置
3. 转换为NDC坐标
4. 更新相机投影矩阵（如需要）
5. 创建射线并获取方向
6. 返回归一化方向向量

---

## 3. 状态管理系统

### 3.1 React状态 (useState)

```typescript
// 锁定相关状态
const [isLocking, setIsLocking] = useState(false);           // 是否正在锁定
const [lockCountdown, setLockCountdown] = useState(0);       // 锁定倒计时（毫秒）
const [lockedTarget, setLockedTarget] = useState<...>(null);  // 锁定目标

// 子弹相关状态
const [bullets, setBullets] = useState<Bullet[]>([]);         // 子弹数组

// 射线可视化状态
const [rayOrigin, setRayOrigin] = useState(new THREE.Vector3());
const [rayDirection, setRayDirection] = useState(new THREE.Vector3(0, 0, -1));
const [shootDirection, setShootDirection] = useState(new THREE.Vector3(0, 0, -1));
```

### 3.2 Ref引用 (useRef)

```typescript
// 射击常量
const bulletVelocity = 50;  // 子弹速度
const fireRate = 200;        // 发射间隔（毫秒）
const rayOffsets = [         // 十字形5射线偏移
  { x: 0, y: 0 },            // 中心
  { x: 0.05, y: 0 },        // 右
  { x: -0.05, y: 0 },       // 左
  { x: 0, y: 0.05 },        // 上
  { x: 0, y: -0.05 },       // 下
];

// 实时数据引用（避免闭包问题）
const isMouseDownRef = useRef(false);           // 鼠标按下状态
const lastFireTimeRef = useRef(0);              // 上次发射时间戳
const lockedTargetRef = useRef(lockedTarget);   // 实时锁定目标
const lockCountdownRef = useRef(0);             // 实时倒计时值
const isLockingRef = useRef(false);             // 实时锁定状态
const mousePosRef = useRef({ x: 0, y: 0 });     // 鼠标位置
const bulletIdRef = useRef(0);                  // 子弹ID计数器
const shootableObjectsRef = useRef<THREE.Object3D[]>([]); // 可射击物体列表
const targetDetectedRef = useRef<THREE.Object3D | null>(null); // 检测到的目标
```

**关键点**：
- React状态用于UI更新
- Ref用于高频更新的实时数据
- 射击逻辑使用Ref值，避免状态延迟

---

## 4. 射击流程

### 4.1 完整射击流程图

```
鼠标按下 → 检测目标 → 开始倒计时 → 倒计时结束 → 锁定完成 → 开始射击
    ↓
  鼠标松开 → 取消锁定
```

### 4.2 目标检测流程

```typescript
// 1. 射线检测可射击目标 (useFrame)
if (camera) {
  camera.updateMatrixWorld();
  const correctedNDC = getCorrectedNDC(...);

  // 2. 多射线检测（十字形布局）
  const rayOffsets = [
    { x: 0, y: 0 },      // 中心
    { x: 0.05, y: 0 },   // 右
    { x: -0.05, y: 0 },  // 左
    { x: 0, y: 0.05 },   // 上
    { x: 0, y: -0.05 },  // 下
  ];

  // 3. 同时计算修正前后的射线
  const rawIntersects = raycaster.intersectObjects(...);      // 原始射线
  const correctedIntersects = raycaster.intersectObjects(...); // 修正后射线

  // 4. 取最高位置的射线结果
  const finalIntersects = ...
}
```

### 4.3 锁定倒计时流程

```typescript
// 锁定开始条件
if (newLockedTarget && isMouseDownRef.current && !isLockingRef.current && !lockedTargetRef.current) {
  lockCountdownRef.current = 1000; // 1秒倒计时
  isLockingRef.current = true;
  setIsLocking(true);
}

// 倒计时更新 (useFrame)
if (isLockingRef.current && lockedTargetRef.current) {
  lockCountdownRef.current -= delta * 1000;

  if (lockCountdownRef.current <= 0) {
    // 倒计时结束
    lockCountdownRef.current = 0;
    isLockingRef.current = false;
    setIsLocking(false);
    console.log('锁定完成，可以射击');
  }
}

// 目标丢失时取消锁定
if (isLockingRef.current && !lockedTargetRef.current) {
  lockCountdownRef.current = 0;
  isLockingRef.current = false;
  setIsLocking(false);
}
```

### 4.4 射击执行流程

```typescript
// 射击条件：鼠标按下 + 有锁定目标 + 倒计时结束
if (isMouseDownRef.current && lockedTargetRef.current && !isLockingRef.current) {
  const now = Date.now();

  // 射击间隔控制
  if (now - lastFireTimeRef.current >= fireRate) {
    lastFireTimeRef.current = now;

    // 获取目标实时世界坐标
    const targetPosition = new THREE.Vector3();
    lockedTargetRef.current.object.getWorldPosition(targetPosition);

    // 计算子弹方向（从角色指向目标）
    const direction = new THREE.Vector3().subVectors(
      targetPosition,
      new THREE.Vector3(
        realTimeCharacterPos.x,
        realTimeCharacterPos.y + 1.2, // 发射高度
        realTimeCharacterPos.z
      )
    ).normalize();

    // 创建子弹
    const newBullet = {
      id: bulletIdRef.current++,
      position: { ... },
      direction,
    };

    setBullets(prev => [...prev, newBullet]);
  }
}
```

---

## 5. 补偿修正系统

### 5.1 补偿修正原理

**问题**：当相机俯视时，角色与相机的垂直偏移导致子弹轨迹与准星不一致

**解决方案**：基于实时计算的相机仰角和角色距离动态调整NDC坐标

### 5.2 补偿公式

```
修正后NDC_Y = 原始NDC_Y + 补偿值
补偿值 = -pitch × 基础补偿 × 距离补偿 × 俯角补偿
```

### 5.3 补偿参数表

| 参数 | 默认值 | 说明 |
|------|--------|------|
| baseCompensation | 0.3 | 基础补偿系数 |
| distanceCompensation | 0.8~1.2 | 距离补偿（距离越近越大） |
| pitchCompensation | 1.0~1.8 | 俯角补偿（俯角越大越大） |
| 总补偿范围 | ±0.5 | NDC_Y方向的最大偏移 |

### 5.4 补偿触发条件

**每帧实时计算**：
- `useFrame` 回调中的射线检测
- `handleMouseMove` 鼠标移动处理
- 目标检测逻辑

**关键点**：
- 不依赖累计转动量，避免误差累积
- 每次基于当前最新相机状态计算

---

## 6. 锁定倒计时系统

### 6.1 系统参数

| 参数 | 值 | 说明 |
|------|-----|------|
| LOCK_DURATION | 1000ms | 锁定倒计时时长 |
| 倒计时精度 | 16ms | 每帧更新（约60fps） |

### 6.2 状态转换图

```
[无目标] → (检测到目标+鼠标按下) → [开始锁定]
[开始锁定] → (倒计时结束) → [锁定完成]
[锁定完成] → (鼠标松开) → [无目标]
[开始锁定/锁定完成] → (目标丢失) → [无目标]
```

### 6.3 视觉反馈

**圆环动画**：
- 颜色：蓝色 (#2196F3)
- 大小：40x40 SVG，半径15
- 进度：strokeDashoffset 从满到空
- 动画：0.05s线性过渡 + 1s脉冲效果

```css
.crosshair-lock-progress {
  transition: stroke-dashoffset 0.05s linear;
  animation: pulse 1s infinite;
}
```

---

## 7. 射线检测优化

### 7.1 多射线检测

**布局**：十字形5射线
```
  ↑
  |
← ● →
  |
  ↓
```

**偏移量**：
```typescript
const rayOffsets = [
  { x: 0, y: 0 },      // 中心射线
  { x: 0.05, y: 0 },   // 右偏移
  { x: -0.05, y: 0 },  // 左偏移
  { x: 0, y: 0.05 },   // 上偏移
  { x: 0, y: -0.05 },  // 下偏移
];
```

### 7.2 修正前后射线融合

```typescript
// 原始射线
raycaster.setFromCamera(ndc, camera);
const rawDirection = raycaster.ray.direction.clone();

// 修正后射线
raycaster.setFromCamera(correctedNDC, camera);
const correctedDirection = raycaster.ray.direction.clone();

// 取Y分量较大的（更高的射线位置）
const finalDirection = rawDirection.y > correctedDirection.y
  ? rawDirection
  : correctedDirection;
```

---

## 8. 迁移指南

### 8.1 必要依赖

```json
{
  "three": "^0.x.x",
  "@react-three/fiber": "^8.x.x",
  "@react-three/drei": "^9.x.x"
}
```

### 8.2 必需的状态管理

确保目标平台支持以下状态管理方案之一：
- Zustand
- React Context + useReducer
- Redux

### 8.3 迁移步骤

1. **复制核心函数**：
   - `getCameraPitch`
   - `getCorrectedNDC`

2. **创建状态管理层**：
   - 锁定状态（isLocking, lockCountdown）
   - 子弹状态（bullets数组）
   - 射击状态（isMouseDown, lastFireTime）

3. **实现事件监听**：
   - 鼠标按下/松开事件
   - 鼠标移动事件（用于射线检测）

4. **集成到游戏循环**：
   - 在主更新循环中调用射线检测
   - 实现倒计时更新逻辑

5. **添加视觉组件**：
   - 十字准星组件
   - 锁定圆环组件
   - 子弹渲染组件

### 8.4 关键参数调优

| 参数 | 调整场景 |
|------|----------|
| LOCK_DURATION | 锁定时间过长/过短 |
| baseCompensation | 修正效果过强/过弱 |
| rayOffsets | 检测范围过小/过大 |
| fireRate | 射击间隔过密/过稀 |

---

## 9. 完整代码结构

```
App.tsx
├── 核心函数
│   ├── getCameraPitch(camera) → pitch
│   └── getCorrectedNDC(...) → Vector2
│
├── 状态管理
│   ├── React状态 (useState)
│   │   ├── isLocking, lockCountdown
│   │   ├── lockedTarget
│   │   └── bullets, rayOrigin, rayDirection
│   │
│   └── Ref引用 (useRef)
│       ├── isMouseDownRef
│       ├── lockedTargetRef
│       ├── lockCountdownRef
│       └── bulletIdRef
│
├── 事件处理
│   ├── handleMouseDown
│   │   ```typescript
│   │   const handleMouseDown = () => {
│   │     isMouseDownRef.current = true;
│   │     targetDetectedRef.current = null;
│   │     gameStore.setShootInfo({ isFiring: true });
│   │   };
│   │   ```
│   ├── handleMouseUp
│   │   ```typescript
│   │   const handleMouseUp = () => {
│   │     isMouseDownRef.current = false;
│   │     targetDetectedRef.current = null;
│   │     // 松开鼠标时取消锁定倒计时
│   │     lockCountdownRef.current = 0;
│   │     isLockingRef.current = false;
│   │     setLockCountdown(0);
│   │     setIsLocking(false);
│   │     gameStore.setShootInfo({ isFiring: false });
│   │   };
│   │   ```
│   └── handleMouseMove
│       ```typescript
│       const handleMouseMove = (event: MouseEvent) => {
│         mousePosRef.current = { x: event.clientX, y: event.clientY };
│         if (camera) {
│           // 相机矩阵更新
│           if (camera.aspect !== canvas.width / canvas.height) {
│             camera.aspect = canvas.width / canvas.height;
│             camera.updateProjectionMatrix();
│             camera.updateMatrixWorld();
│           }
│           // 使用基于仰角的NDC修正
│           const characterPos = new THREE.Vector3(
│             gameStore.character.position.x,
│             gameStore.character.position.y,
│             gameStore.character.position.z
│           );
│           const correctedNDC = getCorrectedNDC(
│             canvas, event.clientX, event.clientY, camera, characterPos, 0.3
│           );
│           // 创建射线并更新可视化数据
│           const raycaster = new THREE.Raycaster();
│           raycaster.setFromCamera(correctedNDC, camera);
│           setRayOrigin(raycaster.ray.origin.clone());
│           setRayDirection(raycaster.ray.direction.clone());
│           // ...
│         }
│       };
│       ```
│
├── 游戏循环 (useFrame)
│   ├── 锁定倒计时更新
│   │   ```typescript
│   │   if (isLockingRef.current && lockedTargetRef.current) {
│   │     lockCountdownRef.current -= delta * 1000;
│   │     if (lockCountdownRef.current <= 0) {
│   │       lockCountdownRef.current = 0;
│   │       isLockingRef.current = false;
│   │       setLockCountdown(0);
│   │       setIsLocking(false);
│   │     } else {
│   │       setLockCountdown(lockCountdownRef.current);
│   │     }
│   │   }
│   │   ```
│   ├── 射线检测
│   │   ```typescript
│   │   // 多射线检测
│   │   const allIntersects: THREE.Intersection[] = [];
│   │   const rayOrigins: THREE.Vector3[] = [];
│   │   const rayDirections: THREE.Vector3[] = [];
│   │
│   │   for (const offset of rayOffsets) {
│   │     // 原始射线（未修正）
│   │     raycaster.setFromCamera(
│   │       new THREE.Vector2(ndcX + offset.x, ndcY + offset.y), camera
│   │     );
│   │     const rawDirection = raycaster.ray.direction.clone();
│   │     const rawIntersects = raycaster.intersectObjects(
│   │       shootableObjectsRef.current, true
│   │     );
│   │
│   │     // 修正后的射线
│   │     raycaster.setFromCamera(
│   │       new THREE.Vector2(correctedNDC.x + offset.x, correctedNDC.y + offset.y), camera
│   │     );
│   │     const correctedDirection = raycaster.ray.direction.clone();
│   │     const correctedIntersects = raycaster.intersectObjects(
│   │       shootableObjectsRef.current, true
│   │     );
│   │
│   │     // 取两条射线中Y分量较大的方向
│   │     const finalDirection = rawDirection.y > correctedDirection.y
│   │       ? rawDirection
│   │       : correctedDirection;
│   │
│   │     // 使用最终方向重新设置射线进行检测
│   │     raycaster.set(camera.position, finalDirection);
│   │     const finalIntersects = raycaster.intersectObjects(
│   │       shootableObjectsRef.current, true
│   │     );
│   │     allIntersects.push(...finalIntersects);
│   │     rayOrigins.push(camera.position.clone());
│   │     rayDirections.push(finalDirection);
│   │   }
│   │   ```
│   ├── 目标锁定
│   │   ```typescript
│   │   // 锁定开始条件
│   │   if (newLockedTarget && isMouseDownRef.current &&
│   │       !isLockingRef.current && !lockedTargetRef.current) {
│   │     lockCountdownRef.current = 1000;
│   │     isLockingRef.current = true;
│   │     setIsLocking(true);
│   │   }
│   │
│   │   // 目标丢失时取消锁定
│   │   if (isLockingRef.current && !lockedTargetRef.current) {
│   │     lockCountdownRef.current = 0;
│   │     isLockingRef.current = false;
│   │     setLockCountdown(0);
│   │     setIsLocking(false);
│   │   }
│   │   ```
│   └── 射击执行
│       ```typescript
│       if (isMouseDownRef.current && lockedTargetRef.current && !isLockingRef.current) {
│         const now = Date.now();
│         if (now - lastFireTimeRef.current >= fireRate) {
│           lastFireTimeRef.current = now;
│           const targetPosition = new THREE.Vector3();
│           lockedTargetRef.current.object.getWorldPosition(targetPosition);
│           const direction = new THREE.Vector3().subVectors(
│             targetPosition,
│             new THREE.Vector3(
│               realTimeCharacterPos.x,
│               realTimeCharacterPos.y + 1.2,
│               realTimeCharacterPos.z
│             )
│           ).normalize();
│           const newBullet = { id: bulletIdRef.current++, position: {...}, direction };
│           setBullets(prev => [...prev, newBullet]);
│         }
│       }
│       ```
│
└── 子弹管理
    ├── 子弹更新
    │   ```typescript
    │   // 更新子弹位置
    │   setBullets(prev => prev.filter(bullet => {
    │     bullet.position.x += bullet.direction.x * bulletVelocity * delta;
    │     bullet.position.y += bullet.direction.y * bulletVelocity * delta;
    │     bullet.position.z += bullet.direction.z * bulletVelocity * delta;
    │     // 超出边界后移除
    │     return Math.abs(bullet.position.x) < 100 &&
    │            Math.abs(bullet.position.z) < 100 &&
    │            bullet.position.y < 50;
    │   }));
    │   ```
    ├── 碰撞检测
    └── 子弹过期处理
        ```typescript
        const handleBulletExpire = (id: number) => {
          setBullets(prev => prev.filter(bullet => bullet.id !== id));
        };
        ```

### 9.2 组件渲染

```typescript
// 子弹渲染
{bullets.map(bullet => (
  <Bullet
    key={bullet.id}
    position={bullet.position}
    direction={bullet.direction}
    velocity={bulletVelocity}
    onExpire={() => handleBulletExpire(bullet.id)}
  />
))}

// 射线可视化
<RayVisualizer
  origin={rayOrigin}
  direction={rayDirection}
  length={100}
  color={0xff0000}
/>

// 多射线可视化
<MultiRayVisualizer
  origins={multiRayOrigins}
  directions={multiRayDirections}
  length={100}
  color={0x00ffff}
/>
```

### 9.3 React状态完整定义

```typescript
// 锁定相关状态
const [isLocking, setIsLocking] = useState(false);
const [lockCountdown, setLockCountdown] = useState(0);
const [lockedTarget, setLockedTarget] = useState<{ point: THREE.Vector3; object: THREE.Object3D } | null>(null);

// 子弹相关状态
const [bullets, setBullets] = useState<Array<{
  id: number;
  position: { x: number; y: number; z: number };
  direction: THREE.Vector3
}>>([]);

// 射线可视化状态
const [rayOrigin, setRayOrigin] = useState(new THREE.Vector3());
const [rayDirection, setRayDirection] = useState(new THREE.Vector3(0, 0, -1));
const [shootDirection, setShootDirection] = useState(new THREE.Vector3(0, 0, -1));
const [multiRayOrigins, setMultiRayOrigins] = useState<THREE.Vector3[]>([]);
const [multiRayDirections, setMultiRayDirections] = useState<THREE.Vector3[]>([]);
```

---

## 10. 调试相关代码

### 10.1 调试组件导入

```typescript
import RayVisualizer, { MultiRayVisualizer } from './components/debug/RayVisualizer';
import ShootDirectionVisualizer from './components/debug/ShootDirectionVisualizer';
```

### 10.2 射线检测状态更新

```typescript
gameStore.setRaycastInfo({
  active: true,
  shootableObjects: shootableObjectsRef.current.length,
  intersects: allIntersects.length,
  locked: allIntersects.length > 0
});
```

### 10.3 射击状态更新

```typescript
gameStore.setShootInfo({ isFiring: true });
gameStore.setShootInfo({ isFiring: false });
gameStore.setShootInfo({
  isFiring: true,
  fireCount: gameStore.shootInfo.fireCount + 1
});
```

### 10.4 控制台调试日志

```typescript
console.log(`Pitch: ${pitch.toFixed(3)}, Distance: ${distanceToCamera.toFixed(2)}, ...`);
console.log(`倒计时: ${lockCountdownRef.current.toFixed(0)}ms`);
console.log('开始锁定倒计时');
console.log('锁定完成，可以射击');
console.log('目标丢失，取消锁定');
console.log('可射击物体数量:', shootableObjectsRef.current.length);
console.log('使用锁定目标射击');
console.log('发射子弹:', newBullet);
```

### 10.5 射线可视化组件

```typescript
<RayVisualizer origin={rayOrigin} direction={rayDirection} length={100} color={0xff0000} />
<MultiRayVisualizer origins={multiRayOrigins} directions={multiRayDirections} length={100} color={0x00ffff} />
<ShootDirectionVisualizer origin={...} direction={shootDirection} length={3} color={0x00ff00} thickness={0.1} />
```

### 10.6 射线可视化组件属性说明

| 组件 | 属性 | 类型 | 说明 |
|------|------|------|------|
| RayVisualizer | origin | Vector3 | 射线原点 |
| | direction | Vector3 | 射线方向 |
| | length | number | 射线长度 |
| | color | number | 射线颜色(HEX) |
| MultiRayVisualizer | origins | Vector3[] | 多条射线原点数组 |
| | directions | Vector3[] | 多条射线方向数组 |
| | length | number | 射线长度 |
| | color | number | 射线颜色(HEX) |
| ShootDirectionVisualizer | origin | Vector3 | 射击方向原点 |
| | direction | Vector3 | 射击方向 |
| | length | number | 方向箭头长度 |
| | color | number | 箭头颜色(HEX) |
| | thickness | number | 箭头粗细 |

---

## 11. 已知限制

1. **仅支持Lock式射击**：不支持常规自由射击
2. **单目标锁定**：同时只允许锁定一个目标
3. **固定发射高度**：子弹始终从角色头顶1.2单位处发射
4. **依赖R3F**：使用React Three Fiber生态

---

## 12. 鼠标锁定解除实现

### 12.1 锁定解除机制

**触发条件**：
- 松开鼠标按钮（`mouseup`事件）
- 目标丢失（射线检测未找到之前锁定的目标）

**实现代码**：

```typescript
// 鼠标松开事件处理
const handleMouseUp = () => {
  isMouseDownRef.current = false;
  targetDetectedRef.current = null; // 松开鼠标时销毁检测器
  // 松开鼠标时取消锁定倒计时
  lockCountdownRef.current = 0;
  isLockingRef.current = false;
  setLockCountdown(0);
  setIsLocking(false);
  console.log('取消锁定倒计时');
  // 更新射击状态
  gameStore.setShootInfo({ isFiring: false });
};

// 目标丢失时的处理（在useFrame中）
if (isLockingRef.current && !lockedTargetRef.current) {
  // 如果目标丢失，重置锁定状态
  lockCountdownRef.current = 0;
  isLockingRef.current = false;
  setLockCountdown(0);
  setIsLocking(false);
  console.log('目标丢失，取消锁定');
}
```

### 12.2 锁定解除流程

1. **用户松开鼠标**：触发`mouseup`事件
2. **重置状态**：
   - `isMouseDownRef.current = false`
   - `targetDetectedRef.current = null`
   - `lockCountdownRef.current = 0`
   - `isLockingRef.current = false`
   - 更新React状态`setLockCountdown(0)`和`setIsLocking(false)`
3. **更新游戏状态**：`gameStore.setShootInfo({ isFiring: false })`
4. **目标丢失处理**：在游戏循环中检测到目标丢失时同样重置锁定状态

---

## 13. 瞄准系统UI设计

### 13.1 核心UI组件 - Crosshair

**文件位置**：`src/components/UI/Crosshair.tsx`

**实现代码**：

```tsx
import React, { useState, useEffect, useRef } from 'react';
import './Crosshair.css';

interface CrosshairProps {
  isLocking?: boolean;
  lockProgress?: number; // 0-1
}

const Crosshair: React.FC<CrosshairProps> = ({ isLocking = false, lockProgress = 0 }) => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const crosshairRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div 
      ref={crosshairRef}
      className={`crosshair ${isLocking ? 'crosshair-locking' : ''}`}
      style={{
        left: `${mousePosition.x}px`,
        top: `${mousePosition.y}px`,
        transform: 'translate(-50%, -50%)'
      }}
    >
      <div className="crosshair-center"></div>
      <div className="crosshair-line crosshair-line-top"></div>
      <div className="crosshair-line crosshair-line-bottom"></div>
      <div className="crosshair-line crosshair-line-left"></div>
      <div className="crosshair-line crosshair-line-right"></div>
      
      {/* 锁定圆环 */}
      {isLocking && (
        <div className="crosshair-lock-ring">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle 
              cx="20" 
              cy="20" 
              r="15" 
              fill="none" 
              stroke="#2196F3" 
              strokeWidth="2"
              opacity="0.5"
            />
            <circle 
              cx="20" 
              cy="20" 
              r="15" 
              fill="none" 
              stroke="#2196F3" 
              strokeWidth="2"
              strokeDasharray={`${2 * Math.PI * 15}`}
              strokeDashoffset={`${2 * Math.PI * 15 * (1 - Math.max(0, Math.min(1, lockProgress)))}`}
              strokeLinecap="round"
              transform="rotate(-90 20 20)"
              className="crosshair-lock-progress"
            />
          </svg>
        </div>
      )}
    </div>
  );
};

export default Crosshair;
```

### 13.2 样式文件 - Crosshair.css

**文件位置**：`src/components/UI/Crosshair.css`

**实现代码**：

```css
/* 准星基础样式 */
.crosshair {
  position: fixed;
  pointer-events: none;
  z-index: 1000;
  transform: translate(-50%, -50%);
}

/* 准星中心 */
.crosshair-center {
  width: 4px;
  height: 4px;
  background-color: #ffffff;
  border: 2px solid #333333;
  border-radius: 50%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
}

/* 准星线条 */
.crosshair-line {
  position: absolute;
  background-color: #ffffff;
  box-shadow: 0 0 3px rgba(255, 255, 255, 0.6);
}

.crosshair-line-top {
  width: 2px;
  height: 10px;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}

.crosshair-line-bottom {
  width: 2px;
  height: 10px;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
}

.crosshair-line-left {
  width: 10px;
  height: 2px;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
}

.crosshair-line-right {
  width: 10px;
  height: 2px;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}

/* 锁定状态样式 */
.crosshair-locking .crosshair-center {
  background-color: #2196F3;
  box-shadow: 0 0 10px rgba(33, 150, 243, 0.8);
}

.crosshair-locking .crosshair-line {
  background-color: #2196F3;
  box-shadow: 0 0 5px rgba(33, 150, 243, 0.8);
}

/* 锁定圆环 */
.crosshair-lock-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.crosshair-lock-progress {
  transition: stroke-dashoffset 0.05s linear;
  animation: pulse 1s infinite;
}

@keyframes pulse { 
  0% { opacity: 0.7; } 
  50% { opacity: 1; } 
  100% { opacity: 0.7; } 
}
```

### 13.3 UI组件使用

**在App.tsx中的调用**：

```tsx
<Crosshair 
  isLocking={isLocking} 
  lockProgress={1 - (lockCountdown / 1000)}
/>
```

### 13.4 视觉反馈效果

1. **常规状态**：白色准星，中心为白色圆点
2. **锁定状态**：
   - 准星变为蓝色（`#2196F3`）
   - 中心圆点和线条都变为蓝色
   - 显示蓝色锁定圆环，大小为40x40像素
   - 圆环有脉冲动画效果
   - 圆环进度条随倒计时实时更新

---

## 14. 完整射击系统代码

### 14.1 App.tsx 完整代码

```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import Crosshair from './components/UI/Crosshair';
import { gameStore } from './store';
import RayVisualizer from './components/debug/RayVisualizer';
import MultiRayVisualizer from './components/debug/MultiRayVisualizer';
import ShootDirectionVisualizer from './components/debug/ShootDirectionVisualizer';

// 射击常量
const FIRE_RATE = 100; // 射击间隔（毫秒）
const BULLET_SPEED = 10; // 子弹速度
const LOCK_DURATION = 1000; // 锁定倒计时（毫秒）

// 获取相机仰角
function getCameraPitch(camera: THREE.Camera): number {
  camera.updateMatrixWorld();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}

// 基于相机仰角的NDC坐标修正
function getCorrectedNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  characterPosition: THREE.Vector3,
  baseCompensation: number = 0.3
): THREE.Vector2 {
  // 计算基础NDC坐标
  const rect = canvas.getBoundingClientRect();
  const pixelWidth = canvas.width;
  const pixelHeight = canvas.height;
  const scaleX = pixelWidth / rect.width;
  const scaleY = pixelHeight / rect.height;
  const pixelX = (clientX - rect.left) * scaleX;
  const pixelY = (clientY - rect.top) * scaleY;
  let ndcX = (pixelX / pixelWidth) * 2 - 1;
  let ndcY = -(pixelY / pixelHeight) * 2 + 1;
  
  // 计算相机仰角
  const pitch = getCameraPitch(camera);
  
  // 计算角色到摄像机的距离
  const distanceToCamera = camera.position.distanceTo(characterPosition);
  
  // 动态距离补偿：距离越近，补偿强度越大
  const distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera));
  
  // 俯角补偿：俯角越高，补偿效果越好
  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
  
  // 综合补偿系数
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
  
  // 应用补偿
  const correction = -pitch * totalCompensation;
  ndcY += correction;
  ndcY = Math.max(-1, Math.min(1, ndcY));
  
  // 调试日志
  console.log(`Pitch: ${pitch.toFixed(3)}, Distance: ${distanceToCamera.toFixed(2)},
               DistanceComp: ${distanceCompensation.toFixed(3)},
               PitchComp: ${pitchCompensation.toFixed(3)},
               Total: ${totalCompensation.toFixed(3)},
               Correction: ${correction.toFixed(3)}`);
  
  return new THREE.Vector2(ndcX, ndcY);
}

// 计算子弹方向
function getBulletDirection(
  characterPosition: THREE.Vector3,
  targetPosition: THREE.Vector3
): THREE.Vector3 {
  return new THREE.Vector3()
    .subVectors(targetPosition, new THREE.Vector3(characterPosition.x, characterPosition.y + 1.2, characterPosition.z))
    .normalize();
}

// 子弹类型
interface Bullet {
  id: number;
  position: { x: number; y: number; z: number };
  direction: THREE.Vector3;
}

// 目标类型
interface Target {
  object: THREE.Object3D;
  distance: number;
}

const App: React.FC = () => {
  // 状态管理
  const [isLocking, setIsLocking] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [lockedTarget, setLockedTarget] = useState<Target | null>(null);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  
  // 调试状态
  const [rayOrigin, setRayOrigin] = useState<THREE.Vector3 | null>(null);
  const [rayDirection, setRayDirection] = useState<THREE.Vector3 | null>(null);
  
  // Ref引用
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const characterRef = useRef<THREE.Object3D>(null);
  const shootableObjectsRef = useRef<THREE.Object3D[]>([]);
  
  // 射击相关Ref
  const isMouseDownRef = useRef(false);
  const lockedTargetRef = useRef<Target | null>(null);
  const lockCountdownRef = useRef(0);
  const isLockingRef = useRef(false);
  const lastFireTimeRef = useRef(0);
  const bulletIdRef = useRef(0);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const targetDetectedRef = useRef<boolean | null>(null);
  
  // 鼠标事件处理
  const handleMouseDown = () => {
    isMouseDownRef.current = true;
    targetDetectedRef.current = null; // 点击时重置检测状态
    gameStore.setShootInfo({ isFiring: true });
  };
  
  const handleMouseUp = () => {
    isMouseDownRef.current = false;
    targetDetectedRef.current = null; // 松开鼠标时销毁检测器
    // 松开鼠标时取消锁定倒计时
    lockCountdownRef.current = 0;
    isLockingRef.current = false;
    setLockCountdown(0);
    setIsLocking(false);
    console.log('取消锁定倒计时');
    // 更新射击状态
    gameStore.setShootInfo({ isFiring: false });
  };
  
  const handleMouseMove = (event: MouseEvent) => {
    const mousePos = { x: event.clientX, y: event.clientY };
    mousePosRef.current = mousePos;
    
    // 计算鼠标在游戏世界中的位置
    if (cameraRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      // 相机矩阵更新
      if (cameraRef.current.aspect !== canvas.width / canvas.height) {
        cameraRef.current.aspect = canvas.width / canvas.height;
        cameraRef.current.updateProjectionMatrix();
        cameraRef.current.updateMatrixWorld();
      }
      
      // 使用基于仰角的NDC修正
      const characterPos = new THREE.Vector3(
        gameStore.character.position.x,
        gameStore.character.position.y,
        gameStore.character.position.z
      );
      
      const correctedNDC = getCorrectedNDC(
        canvas, mousePos.x, mousePos.y, cameraRef.current, characterPos, 0.3
      );
      
      // 创建射线并更新可视化数据
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(correctedNDC, cameraRef.current);
      setRayOrigin(raycaster.ray.origin.clone());
      setRayDirection(raycaster.ray.direction.clone());
    }
  };
  
  // 监听鼠标事件
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
      
      return () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('mousemove', handleMouseMove);
      };
    }
  }, []);
  
  // 游戏循环
  useFrame((state, delta) => {
    const { camera } = state;
    
    // 确保相机矩阵已更新
    camera.updateMatrixWorld();
    
    // 锁定倒计时逻辑
    if (isLockingRef.current && lockedTargetRef.current) {
      lockCountdownRef.current -= delta * 1000; // 将delta转换为毫秒
      if (lockCountdownRef.current <= 0) {
        // 倒计时结束，锁定完成
        lockCountdownRef.current = 0;
        isLockingRef.current = false;
        setLockCountdown(0);
        setIsLocking(false);
        console.log('锁定完成，可以射击');
      } else {
        // 更新倒计时状态
        setLockCountdown(lockCountdownRef.current);
      }
    } else if (isLockingRef.current && !lockedTargetRef.current) {
      // 如果目标丢失，重置锁定状态
      lockCountdownRef.current = 0;
      isLockingRef.current = false;
      setLockCountdown(0);
      setIsLocking(false);
      console.log('目标丢失，取消锁定');
    }
    
    // 检测可射击目标
    if (isMouseDownRef.current && camera && canvasRef.current) {
      const canvas = canvasRef.current;
      const mousePos = mousePosRef.current;
      
      // 计算基础NDC坐标
      const rect = canvas.getBoundingClientRect();
      const pixelWidth = canvas.width;
      const pixelHeight = canvas.height;
      const scaleX = pixelWidth / rect.width;
      const scaleY = pixelHeight / rect.height;
      const pixelX = (mousePos.x - rect.left) * scaleX;
      const pixelY = (mousePos.y - rect.top) * scaleY;
      const ndcX = (pixelX / pixelWidth) * 2 - 1;
      const ndcY = -(pixelY / pixelHeight) * 2 + 1;
      
      // 计算角色位置
      const characterPosition = new THREE.Vector3(
        gameStore.character.position.x,
        gameStore.character.position.y,
        gameStore.character.position.z
      );
      
      // 获取修正后的NDC坐标
      const correctedNDC = getCorrectedNDC(
        canvas, mousePos.x, mousePos.y, camera, characterPosition, 0.3
      );
      
      // 多射线检测
      const raycaster = new THREE.Raycaster();
      const allIntersects: THREE.Intersection[] = [];
      const rayOrigins: THREE.Vector3[] = [];
      const rayDirections: THREE.Vector3[] = [];
      
      // 射线偏移量（十字形布局）
      const rayOffsets = [
        { x: 0, y: 0 },      // 中心
        { x: 0.05, y: 0 },   // 右
        { x: -0.05, y: 0 },  // 左
        { x: 0, y: 0.05 },   // 上
        { x: 0, y: -0.05 },  // 下
      ];
      
      for (const offset of rayOffsets) {
        // 原始射线（未修正）
        raycaster.setFromCamera(new THREE.Vector2(ndcX + offset.x, ndcY + offset.y), camera);
        const rawDirection = raycaster.ray.direction.clone();
        
        // 修正后的射线
        raycaster.setFromCamera(new THREE.Vector2(correctedNDC.x + offset.x, correctedNDC.y + offset.y), camera);
        const correctedDirection = raycaster.ray.direction.clone();
        
        // 取Y分量较大的方向（更高的射线位置）
        const finalDirection = rawDirection.y > correctedDirection.y ? rawDirection : correctedDirection;
        
        // 使用最终方向检测
        raycaster.set(camera.position, finalDirection);
        const finalIntersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
        allIntersects.push(...finalIntersects);
        
        // 存储射线数据用于可视化
        rayOrigins.push(raycaster.ray.origin.clone());
        rayDirections.push(finalDirection.clone());
      }
      
      // 更新射线可视化数据
      gameStore.setRaycastInfo({
        origins: rayOrigins,
        directions: rayDirections
      });
      
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
            lockCountdownRef.current = 1000; // 1秒倒计时
            isLockingRef.current = true;
            setLockCountdown(1000);
            setIsLocking(true);
            console.log('开始锁定倒计时');
          }
        }
        
        // 更新锁定目标
        lockedTargetRef.current = target;
        setLockedTarget(target);
      } else {
        // 未检测到目标
        targetDetectedRef.current = false;
        lockedTargetRef.current = null;
        setLockedTarget(null);
      }
    }
    
    // 射击逻辑
    if (isMouseDownRef.current && cameraRef.current && lockedTargetRef.current && !isLockingRef.current) {
      const now = Date.now();
      if (now - lastFireTimeRef.current >= FIRE_RATE) {
        lastFireTimeRef.current = now;
        
        // 获取目标实时世界坐标
        const targetPosition = new THREE.Vector3();
        lockedTargetRef.current.object.getWorldPosition(targetPosition);
        
        // 计算子弹方向
        const direction = new THREE.Vector3().subVectors(
          targetPosition,
          new THREE.Vector3(gameStore.character.position.x, gameStore.character.position.y + 1.2, gameStore.character.position.z)
        ).normalize();
        
        // 创建子弹
        const newBullet = {
          id: bulletIdRef.current++,
          position: { x: gameStore.character.position.x, y: gameStore.character.position.y + 1.2, z: gameStore.character.position.z },
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
    
    // 更新子弹位置
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
          // 简单的子弹生命周期管理
          const distance = Math.sqrt(
            Math.pow(bullet.position.x - gameStore.character.position.x, 2) +
            Math.pow(bullet.position.y - gameStore.character.position.y, 2) +
            Math.pow(bullet.position.z - gameStore.character.position.z, 2)
          );
          return distance < 100; // 100单位后销毁
        });
    });
  });
  
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Canvas
        ref={canvasRef}
        camera={{ position: [0, 5, 10], fov: 75 }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x87ceeb, 1);
          cameraRef.current = camera as THREE.PerspectiveCamera;
        }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        
        {/* 角色 */}
        <mesh 
          ref={characterRef}
          position={[0, 0, 0]}
          onCreated={(mesh) => {
            shootableObjectsRef.current.push(mesh);
          }}
        >
          <boxGeometry args={[1, 2, 1]} />
          <meshStandardMaterial color={0xff0000} />
        </mesh>
        
        {/* 目标 */}
        <mesh 
          position={[5, 1, 0]}
          onCreated={(mesh) => {
            shootableObjectsRef.current.push(mesh);
          }}
        >
          <sphereGeometry args={[0.5]} />
          <meshStandardMaterial color={0x00ff00} />
        </mesh>
        
        <mesh 
          position={[-3, 1, 2]}
          onCreated={(mesh) => {
            shootableObjectsRef.current.push(mesh);
          }}
        >
          <sphereGeometry args={[0.5]} />
          <meshStandardMaterial color={0x00ff00} />
        </mesh>
        
        {/* 子弹 */}
        {bullets.map(bullet => (
          <mesh key={bullet.id} position={[bullet.position.x, bullet.position.y, bullet.position.z]}>
            <sphereGeometry args={[0.1]} />
            <meshStandardMaterial color={0xffff00} />
          </mesh>
        ))}
        
        {/* 轨道控制器 */}
        <OrbitControls enableDamping dampingFactor={0.1} />
        
        {/* 调试可视化 */}
        {rayOrigin && rayDirection && (
          <RayVisualizer origin={rayOrigin} direction={rayDirection} length={100} color={0xff0000} />
        )}
        
        {/* 多射线可视化 */}
        <MultiRayVisualizer />
        
        {/* 射击方向可视化 */}
        <ShootDirectionVisualizer />
      </Canvas>
      
      {/* 准星 */}
      <Crosshair 
        isLocking={isLocking} 
        lockProgress={1 - (lockCountdown / 1000)}
      />
    </div>
  );
};

export default App;
```

### 14.2 调试组件代码

#### RayVisualizer.tsx

```tsx
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface RayVisualizerProps {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length?: number;
  color?: number;
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
      const end = new THREE.Vector3().copy(origin).add(direction.clone().multiplyScalar(length));
      const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
      const material = new THREE.LineBasicMaterial({ color });
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

#### MultiRayVisualizer.tsx

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
      
      // 添加新线条
      const { origins, directions } = gameStore.raycastInfo;
      origins.forEach((origin, index) => {
        const direction = directions[index];
        if (origin && direction) {
          const end = new THREE.Vector3().copy(origin).add(direction.clone().multiplyScalar(100));
          const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
          const material = new THREE.LineBasicMaterial({ 
            color: index === 0 ? 0xff0000 : 0x0000ff, // 中心射线红色，其他蓝色
            linewidth: index === 0 ? 2 : 1
          });
          const line = new THREE.Line(geometry, material);
          groupRef.current!.add(line);
        }
      });
    }
  }, [gameStore.raycastInfo]);

  return <group ref={groupRef} />;
};

export default MultiRayVisualizer;
```

#### ShootDirectionVisualizer.tsx

```tsx
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { gameStore } from '../../store';

const ShootDirectionVisualizer: React.FC = () => {
  const lineRef = useRef<THREE.Line>(null);

  useEffect(() => {
    if (lineRef.current && gameStore.shootInfo.isFiring) {
      const characterPos = new THREE.Vector3(
        gameStore.character.position.x,
        gameStore.character.position.y + 1.2,
        gameStore.character.position.z
      );
      
      // 简单的射击方向可视化
      const direction = new THREE.Vector3(0, 0, -1); // 示例方向
      const end = new THREE.Vector3().copy(characterPos).add(direction.multiplyScalar(10));
      
      const geometry = new THREE.BufferGeometry().setFromPoints([characterPos, end]);
      const material = new THREE.LineBasicMaterial({ color: 0x00ff00 });
      
      lineRef.current.geometry.dispose();
      lineRef.current.geometry = geometry;
      lineRef.current.material = material;
    }
  }, [gameStore.shootInfo, gameStore.character.position]);

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
      <lineBasicMaterial color={0x00ff00} />
    </line>
  );
};

export default ShootDirectionVisualizer;
```

---

## 15. 更新日志

### v1.0 - 当前版本
- 实现锁定式射击系统
- 添加动态补偿修正
- 实现锁定倒计时
- 优化多射线检测
- 添加视觉反馈圆环

---

*文档生成时间：2026-04-18*
*适用版本：paper3d-master*
