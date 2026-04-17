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

## 12. 更新日志

### v1.0 - 当前版本
- 实现锁定式射击系统
- 添加动态补偿修正
- 实现锁定倒计时
- 优化多射线检测
- 添加视觉反馈圆环

---

*文档生成时间：2026-04-17*
*适用版本：paper3d-master*
