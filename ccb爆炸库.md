明白了！你指出的这一点至关重要，是我之前架构设想中的重大疏漏。

核心分歧在于：我之前的方案将“爆炸效果”完全等同于“持续的散度/速度外力注入”，这在物理上确实能让水体膨胀、变形，但无法解决水平集（Level Set）模拟的固有问题——水体无法被外力“撕裂”成多个独立的拓扑碎片，也无法将一块大纹理分裂成多个独立的小纹理实体（液滴）。

要产生“炸裂、飞溅、碎片”的效果，必须在流体库内部执行纹理级的拓扑操作（生成裂缝掩码、切割纹理、实例化新模拟器）。因此，我完全同意你的观点：流体库内部的碎裂爆炸机制是必要的，且不可被外部纯物理力替代。

基于这个修正，我重新梳理完整的设计架构和改动方案如下：

一、修正后的核心设计原则（各模块职责再定义）
1. 爆炸库（Explosion 1D Solver）——纯粹的“物理引擎”
只做物理计算：求解欧拉方程，输出随时间和半径变化的 P(r)、ρ(r)、u(r)、T(r) 剖面。

不关心纹理拓扑：不知道什么是水平集、什么是纹理碎裂、什么是实体液滴。

输出物理信号：向外部提供冲击波半径 R_shock(t)、核心压力 P_core(t)、以及任意半径处的压力梯度 dP/dr 和速度 u(r)。

2. 流体库（FluidSimulator）——纹理绘制 + 纹理拓扑操作
接收外力：通过 addDivergenceImpulse 接收持续的“软力”（膨胀/收缩），驱动水体连续变形。

执行碎裂操作：当物理冲击波强度超过一定阈值时，内部主动调用纹理切割流程（generateCrackMaskGPU + applyCrackMask + clearSectorRegionsGPU），将一块大纹理撕裂成多个小纹理。

生成实体液滴：将切割后的小纹理，注入到新的 LightFluidEntity 实例中，实现“大水体炸裂成多个小水花”的效果。

可视化渲染：完全由内部的 renderMaterial 负责，与爆炸库无关。

3. 交互方式（爆炸库 → 流体库）
爆炸库不直接调用 FluidFragmentSystem。

爆炸库只将物理状态（shockRadius、corePressure、sample(r)）通过 IFluidForceTarget 传递给流体库。

流体库内部读取这些物理状态，自行决策何时、在何处、以多大力道触发碎裂机制。

二、修正后的具体架构改动方案
改动 1：FluidIntegrator 不再只产生“软力”，同时提供“物理参数查询接口”
当前 FluidIntegrator.buildFluidForce 只生成 divergenceInjection 和 worldImpulse。

改动：在 IFluidForceTarget 上增加一个可选方法 receiveExplosionState(explosion: Explosion1DSolver, centerX, centerY)，让流体目标（如 FluidSimulator）直接持有爆炸求解器的引用，而不是仅仅接收处理过的散度值。

这样，FluidSimulator 在每帧 update 时，可以：

调用 explosion.sample(dist) 获取当前帧任意半径处的物理量。

根据压力梯度决定软力注入强度（连续变形）。

根据压力梯度的峰值位置和幅度，判断冲击波前沿是否到达，并触发内部碎裂。

改动 2：FluidSimulator 内部保留碎裂机制，但由物理爆炸驱动参数
内部原有的 activeExplosions 和 explode() 保留，但改为“由外部物理爆炸驱动的执行单元”。

具体流程：

FluidSimulator 持有当前作用于它的 Explosion1DSolver 引用。
在每帧 buildExplosionDivergence 中，除了叠加散度源外，额外执行一个 “碎裂条件检测”：
检查爆炸的 getPressureGradient(r1, r2) 是否在某个半径范围超过阈值 fractureThreshold。
若是，则记录当前冲击波半径 R_shock 和中心位置 (cx, cy)。
一旦检测到冲击波前沿（如冲击波半径突然跃升或压力梯度峰值移动），立即调用内部的纹理切割方法，将冲击波扫过的外围水体切割成碎片。
切割出来的碎片纹理，用于生成新的 LightFluidEntity，并赋予由 explosion.sample(R_shock).u 计算的初速度。
改动 3：注入模式从“单次”改为“持续动态”，且软力与碎裂协同
软力注入（持续）：每帧根据 explosion.sample(r) 生成非均匀的径向散度场，推动水体整体膨胀，这与之前设想的“持续注入”一致。

碎裂触发（间歇性）：只在冲击波扫过某区域时触发一次（或几次）纹理切割，避免每帧都切导致碎片过多。

改动 4：坐标补偿统一由流体库内部处理
由于 FluidSimulator 自身持有 smoothedOffset（居中追踪偏移），当它从爆炸库接收中心坐标 (cx, cy) 时，在内部对爆炸中心应用反向偏移，确保切割和散度注入都落在正确的纹理位置。

外部 FluidIntegrator 不再需要计算 UV 坐标，只需传递世界空间坐标，由 FluidSimulator 自行换算。

改动 5：明确两套“爆炸”的层级关系
层级	组件	职责
物理层	Explosion1DSolver + ExplosionManager	计算物理状态，决定冲击波何时到达、强度多大。
转换层	FluidIntegrator	将物理状态转换为软力（散度/速度注入），传递给流体。
执行层	FluidSimulator（内部碎裂机制）	接收物理状态引用，自主决策软力注入量 + 触发纹理切割与碎片实例化。
流体库内部的 activeExplosions 不再独立产生爆炸，而是作为“执行单元”，由外部物理爆炸激活。

保留 explode() 方法作为 “便捷入口”，但内部实现改为向 FluidIntegrator 请求物理状态，而不是自己计算抛物线包络。

改动 6：调试可视化（与流体纹理无关）
在 Explosion1DSolver 中添加 getProfiles() 返回当前 r、p、ρ、u 数组。

提供一个独立的 DebugDrawer，在 Three.js 场景中绘制：

2D 曲线（压力/速度随半径变化）。

3D 半透明冲击波球壳（半径 = R_shock，颜色映射核心压力）。

该调试器不依赖 FluidSimulator 的任何纹理，可单独打开/关闭。

三、数据流时序（修正版）
text
每帧：
1. EntityManager 调用 explosionManager.updateAll(delta)
   → Explosion1DSolver 推进物理时间 t += delta
   → 更新内部 R_shock、P_core、profiles

2. ExplosionManager 遍历所有注册的 IFluidForceTarget
   → 调用 FluidIntegrator.inject(explosion, worldX, worldY)
   → FluidIntegrator 构建软力（divergenceInjection + worldImpulse）
   → 目标（如 FluidSimulatorAdapter）接收 soft forces

3. FluidSimulator.update() 执行：
   a. 应用软力（散度/速度注入）到纹理 → 水体膨胀变形
   b. 读取 explosion.sample(r) 检查冲击波前沿位置
   c. 如果冲击波强度 > 阈值，触发内部碎裂流程：
      - 生成裂缝掩码（基于冲击波各向异性参数）
      - 切割 phi/vel 纹理
      - 创建新的 LightFluidEntity 并赋予物理速度
   d. 清理原纹理中被切掉的区域（设为空气）

4. 新生成的 LightFluidEntity 独立运行自己的小模拟器
   （它们也可以被后续冲击波再次影响）
四、预期效果（修正后）
物理真实：爆炸冲击波驱动流体膨胀和碎裂，两者都由同一套物理数据驱动，时空一致。

拓扑自由：流体库内部的纹理切割机制弥补了水平集无法自然撕裂的缺陷，实现真正的“炸裂”。

职责清晰：爆炸库只管物理，流体库管纹理 + 拓扑，两者通过 IFluidForceTarget 传递物理引用，互不侵入。

调试便捷：独立的物理可视化帮助调参，不影响流体纹理渲染。

这个修正后的架构既保留了外部物理爆炸的精确性，又利用了内部纹理碎裂的拓扑能力，二者协同而非冲突。如果你认可这个方向，我们接下来可以针对 “FluidSimulator 如何持有和查询 Explosion1DSolver 引用” 以及 “碎裂条件的判断逻辑” 进行详细的接口设计和实现讨论。










非常好。既然你明确了当前只关注爆炸库，并且可视化必须是 3D 的，那我们完全聚焦于此。我会先详细罗列爆炸库（Explosion1DSolver + ExplosionManager + FluidIntegrator + types）现有的具体问题，然后给出架构级的改进方案，最后说明 3D 可视化调试的设计思路，以及我需要你提供哪些游戏侧的文件来精准对接。

一、爆炸库现有问题深度剖析（按模块分解）
1. ExplosionManager —— 生命周期与目标管理
问题	具体表现	后果
注入仅一次	hasInjected 标志导致只在爆炸创建后的第一帧调用 integrator.inject()，后续帧完全跳过。	爆炸物理在持续演化（冲击波半径增大、压力衰减），但流体只收到 t=0 时刻的力，完全无法体现冲击波的传播与衰减，效果失真。
目标查询静态化	findTargetsInRange 只在 create() 时执行一次，并将结果缓存。	爆炸发生后新生成的实体（例如碎片液滴）不会被爆炸影响；已存在的实体若移动出范围也不会被“释放”。
缺乏动态范围更新	maxInfluenceRadius 固定为创建时的值，不随物理冲击波半径变化。	爆炸初期冲击波小，后期冲击波大，固定半径要么早期覆盖过大（空洞），要么后期覆盖不足（漏掉外围实体）。
2. FluidIntegrator —— 物理 → 纹理 映射层（问题最严重）
问题	具体表现	后果
丢失径向剖面	只调用了一次 explosion.getPressureGradient(0.01, shockRadius * 0.8) 得到一个标量，然后生成一个均匀圆盘散度。	真实爆炸的 P(r) 具有尖锐的冲击波前沿、内部低压区和外围稀疏波，这些空间结构全部被抹平，只剩下一个“均匀膨胀的圆”。
散度强度随意	divergence = -min(grad * 0.001, 10.0)，0.001 的缩放系数没有任何物理依据。	参数完全靠“猜”，不同爆炸能量下需要反复试错，无法形成统一的物理映射规则。
冲量方向固定	force.worldImpulse = (shockSpeed * 0.05, shockSpeed * 0.05, 0)，方向固定为 45°。	爆炸应该是径向向外的冲量，即从爆炸中心指向目标的方向。固定方向导致液滴总是朝右上飞，完全错误。
坐标映射单一	centerUV 只考虑了 worldToUVScale 和 worldOffset，但未考虑流体纹理自身的居中追踪偏移（smoothedOffset）。	当 FluidSimulator 启用了 enableCentering 时，爆炸中心与水体实际位置产生漂移，注入落点不准。
3. Explosion1DSolver —— 物理内核（相对健康，但缺接口）
问题	具体表现	后果
缺时间导数输出	只能输出当前状态 sample(r)，无法输出 dP/dt 或 dR/dt 的瞬时变化率。	流体在判断“是否触发碎裂”时，需要知道冲击波的加速度（是否在加速扩张），目前无法获取。
缺归一化半径接口	外部调用者需要自己管理 r 与 shockRadius 的比值。	如果流体纹理分辨率变化（如从 512 降到 256），外部需要重新计算采样步长，耦合过紧。
4. types.ts —— 配置参数
问题	具体表现	后果
InjectionParams 语义模糊	divergenceStrength: 0.001 到底是什么单位？是压力梯度到散度的缩放，还是任意增益？	调参时完全不知道改大改小的物理后果，只能盲试。
fireballRadiusRatio 固定	火球半径固定为冲击波半径的 0.8，不随物理状态变化。	早期冲击波很小时，注入半径可能过大；晚期冲击波很大时，注入半径可能过小。
二、架构级改进方案（结构性重构）
原则
爆炸库只输出物理数据，不关心纹理格式、分辨率或颜色。

数据流是推式（Push）：ExplosionManager 每帧主动向所有注册目标推送“当前时刻的物理场描述符”。

目标是物理驱动（Physics-Driven）：所有注入参数（散度强度、注入半径、冲量方向）都从 Explosion1DSolver.sample(r) 的实时数据派生。

改进 1：ExplosionManager —— 持续动态注入 + 实时范围查询
移除 hasInjected，改为在 updateAll 中每帧对所有已注册目标执行距离检查。

maxInfluenceRadius 改为由 explosion.getShockRadius() * 1.5 动态计算，随着冲击波膨胀而自动扩大。

findTargetsInRange 改为每帧执行，支持动态进入/退出的实体。

改进 2：FluidIntegrator —— 基于径向剖面的力场生成（核心重构）
不再生成“单一圆盘”，而是生成一个可查询的力场描述符。buildFluidForce 改为返回一个包含以下内容的 ExplosionForceField 对象（新增类型）：

typescript
interface ExplosionForceField {
  centerWorld: THREE.Vector2;
  shockRadius: number;
  // 采样函数：输入物理半径 r，输出该半径处的压力、速度、密度
  sample: (r: number) => PhysicalState;
  // 纹理映射参数：由目标提供
  textureScale: number;
  textureOffset: THREE.Vector2;
}
FluidIntegrator 不再直接将力写入目标，而是将 ExplosionForceField 作为引用传递给目标。

真正的力映射（逐像素采样）由 FluidSimulator 内部的着色器完成，利用 GPU 并行计算每个像素到爆炸中心的距离，然后采样 sample(r) 计算该像素的散度/速度增量。

这样既保留了完整的径向剖面结构，又利用了 GPU 性能，避免 CPU 逐像素开销。

改进 3：坐标补偿 —— 由目标主动提供偏移
在 IFluidForceTarget 接口中增加：

typescript
getTextureOffset(): THREE.Vector2;  // 返回当前纹理的居中偏移量
getTextureScale(): number;          // 返回世界→UV 的缩放
FluidSimulator 实现这两个方法，返回 smoothedOffset 和 1/max(worldSize)。

FluidIntegrator 在构建 ExplosionForceField 时，自动从目标读取偏移并补偿到 centerWorld 中。

改进 4：Explosion1DSolver —— 增加归一化查询接口
新增方法：

typescript
// 返回归一化半径 ξ = r / R_shock 处的物理状态
public sampleNormalized(xi: number): PhysicalState {
  const r = xi * this.shockRadius;
  return this.sample(r);
}
这样外部调用者只需要关心 [0, 1] 范围，自动适应冲击波半径变化，无需重新计算物理半径。

改进 5：Explosion1DSolver —— 增加冲击波加速度输出
新增方法：

typescript
// 返回当前冲击波速度的变化率 dU/dt（通过有限差分近似）
public getShockAcceleration(): number {
  // 内部缓存上一帧的 shockSpeed，在 advanceBy 时更新
}
用于流体库判断冲击波是否在“加速膨胀”，从而决定是否触发纹理碎裂。

改进 6：参数语义重构 —— InjectionParams 重命名与重新定义
旧参数	新参数	含义
divergenceStrength	pressureToDivergenceScale	压力梯度 (Pa/m) → 散度 (1/s) 的转换系数，物理单位为 m²/(Pa·s)，可通过网格分辨率自动计算默认值。
velocityStrength	momentumTransferCoeff	动量传递系数（0~1），控制气体速度传递给液滴的效率。
fireballRadiusRatio	移除	改为动态从 sample(r).p > ambientP 条件计算实际火球半径。
三、3D 可视化调试设计（独立于流体纹理）
由于你的游戏是 3D 的，我们利用 Three.js 在场景中绘制爆炸的物理状态，完全不依赖流体纹理。

3.1 可视化内容
冲击波球壳：一个半透明的发光球体，半径为 shockRadius，颜色根据核心压力从红（高压）渐变到蓝（低压）。

压力场切片：在爆炸中心所在平面（如 XY 平面）绘制一个圆盘，圆盘上每个像素的颜色映射 P(r) 值（红=高压，蓝=常压），直观显示冲击波前沿。

速度箭头场：在几个特征半径（0.2R、0.5R、0.8R、1.0R）处绘制小箭头，方向径向向外，长度正比于 u(r)。

数值 HUD：在爆炸中心上方用 CSS2DRenderer 或 Sprite 显示 t、R_shock、P_core、U_shock。

3.2 实现方式（无需改动物理内核）
在 ExplosionManager 中新增一个 debugRenderer 属性：

typescript
public attachDebugRenderer(scene: THREE.Scene): void {
  // 创建用于可视化的 Mesh、Points、Line 等
}

public updateDebugVisuals(): void {
  // 每帧从 Explosion1DSolver 读取数据，更新几何体颜色/位置/大小
}
与流体完全隔离，可以独立开关。

所有几何体都在 Three.js 场景中，符合你的 3D 需求。

性能开销可控（几十个粒子/箭头，不是全屏纹理）。

四、我需要你提供的文件（为了精准对接你的 3D 场景）
为了确保调试可视化能正确适配你的游戏坐标系和渲染管线，我需要以下文件的内容（或关键片段）：

Three.js 场景初始化文件（通常包含 scene、camera、renderer 的创建）：

我需要知道你的坐标系约定（Y-up 还是 Z-up？）。

相机类型（透视/正交？FOV？）。

场景根节点是否有缩放/旋转变换。

游戏主循环（update 或 tick）文件：

每帧 delta 是如何计算的？

ExplosionManager 当前在哪个模块被调用（是 EntityManager 还是更上层的 Game 类）？

EntityManager 或类似容器类（如果它包含了 ExplosionManager 的实例）：

我只需要知道 ExplosionManager 是如何被创建和持久的，不需要完整的 Entity 系统。

你希望的爆炸触发方式：

是由玩家按键触发？还是由子弹命中触发？还是自动生成用于测试？

这个会影响我设计 ExplosionManager.create 的调用入口。

下一步
你可以先确认以上问题分析和改进方向是否符合你的预期，然后提供我需要的文件片段。收到后，我将：

先完善 Explosion1DSolver 的接口（归一化采样、加速度输出）。

重构 ExplosionManager（持续注入 + 动态范围查询）。

重构 FluidIntegrator（改为输出 ExplosionForceField 引用，而非直接生成 FluidExternalForce）。

实现 3D 调试可视化模块，直接在场景中绘制冲击波球壳和压力场。














完全理解了。“注册只在爆炸前进行一次，爆炸期间不接受新目标” —— 这是最严格、最高效的设计模式。这意味着：

爆炸创建时一次性锁定影响范围内的所有目标，形成一个静态快照列表。

在这个爆炸的整个生命周期内，只遍历这个静态列表，不新增、不删除（除了目标自身被销毁时被动移除）。

爆炸之后新产生的任何物体（包括碎片），都不受本次爆炸影响——它们会被后续的爆炸（如果有）捕获。

这完全消除了动态注册带来的复杂性和开销，是最干净的设计。基于这个约束，我重新梳理架构改动方案。

一、核心设计原则（最终版）
原则	说明
注册发生在爆炸瞬间，仅一次	ExplosionManager.create 时，执行一次范围查询，将范围内所有有效目标存入 registeredTargets: Set。此后该列表不再变化（除非目标被销毁）。
持续注入仅针对静态列表	每帧遍历 registeredTargets，对每个目标调用 inject，传递当前时刻的物理状态。
不提供动态注册接口	爆炸开始后，不接受任何新目标加入。新生成的碎片如果想要被爆炸影响，必须由下一次爆炸捕获。
被动清理失效目标	如果目标被外部销毁（isActive = false），在遍历时检测到并跳过（不移除，只是跳过，因为列表不会重建）。
二、ExplosionManager 架构改动（精简化）
2.1 ExplosionEntry 结构（最终版）
typescript
interface ExplosionEntry {
  solver: Explosion1DSolver;
  position: THREE.Vector3;
  maxInfluenceRadius: number;
  // ★ 静态列表：爆炸创建时一次性填充，之后不再修改
  registeredTargets: IFluidForceTarget[];
}
2.2 create() 流程
typescript
public create(
  id: string,
  params: ExplosionParams,
  worldX: number,
  worldY: number,
  maxInfluenceRadius: number = 10.0
): Explosion1DSolver {
  // 1. 创建物理求解器
  const explosion = new Explosion1DSolver(params);
  
  // 2. 执行一次范围查询，锁定目标
  const center = new THREE.Vector3(worldX, worldY, 0);
  const affectedTargets = this.findTargetsInRange(center, maxInfluenceRadius);
  
  // 3. 构造条目（直接存入数组，不再使用 Set）
  const entry: ExplosionEntry = {
    solver: explosion,
    position: center,
    maxInfluenceRadius,
    registeredTargets: affectedTargets,
  };
  
  this.explosions.set(id, entry);
  
  // 4. 为每个目标预创建 Integrator（避免在 update 中延迟创建）
  for (const target of affectedTargets) {
    if (!this.integrators.has(target)) {
      this.integrators.set(target, new FluidIntegrator(target));
    }
  }
  
  console.log(`[ExplosionManager] 爆炸已创建: id=${id}, 锁定目标数=${affectedTargets.length}`);
  return explosion;
}
2.3 updateAll() 流程（每帧）
typescript
public updateAll(graphicsDelta: number): void {
  const clampedDelta = Math.min(graphicsDelta, 0.033);
  this.graphicsTime += clampedDelta;

  this.explosions.forEach((entry, id) => {
    const explosion = entry.solver;
    if (!explosion.isActive()) return;

    // 1. 推进物理
    explosion.advanceBy(clampedDelta);

    // 2. 遍历静态列表，持续注入
    for (const target of entry.registeredTargets) {
      // 检查目标是否仍然有效（被动检测）
      if (!this.isTargetValid(target)) continue;
      
      const integrator = this.integrators.get(target);
      if (integrator) {
        integrator.inject(explosion, entry.position.x, entry.position.y);
      }
    }
  });

  this.cleanupInactive();
}
2.4 新增辅助方法
typescript
// 检查目标是否仍然有效（不被销毁）
private isTargetValid(target: IFluidForceTarget): boolean {
  try {
    // 如果目标实现了 isActive（如 Entity），检查它
    if (typeof (target as any).isActive === 'boolean') {
      return (target as any).isActive;
    }
    // 否则尝试获取位置，失败则视为无效
    target.getPosition();
    return true;
  } catch {
    return false;
  }
}
2.5 移除方法
移除 registerTarget(target) —— 不再支持动态注册。

移除 unregisterTarget(target) —— 目标不会从列表中移除（只是被跳过）。

移除 setWorldBounds、setWorldOffset、setWorldToUVScale —— 因为力映射改为由 FluidSimulator 内部采样，不再需要外部坐标转换。

三、FluidIntegrator 改动（与静态注册配合）
FluidIntegrator 不再负责坐标映射和生成 FluidExternalForce，而是直接将爆炸求解器引用传递给目标，由目标自己决定如何采样。

typescript
public inject(explosion: Explosion1DSolver, worldCenterX: number, worldCenterY: number): void {
  if (this.destroyed || !this.target || !explosion.isActive()) return;

  // 构建一个"力场描述符"，目标自行采样
  const field = {
    centerWorld: new THREE.Vector2(worldCenterX, worldCenterY),
    shockRadius: explosion.getShockRadius(),
    sample: (r: number) => explosion.sample(r),
    sampleNormalized: (xi: number) => explosion.sampleNormalized(xi),
    getShockAcceleration: () => explosion.getShockAcceleration(),
    getCorePressure: () => explosion.getCorePressure(),
  };

  // 目标需要实现接收力场的方法（在 IFluidForceTarget 中增加）
  this.target.applyExplosionField(field);
}
新的接口方法（需要在 IFluidForceTarget 中增加）：

typescript
interface IFluidForceTarget {
  // ... 现有方法 ...
  applyExplosionField(field: ExplosionForceField): void;
}
这样 FluidSimulator 可以直接持有力场引用，在内部着色器中逐像素采样，完全保留径向剖面结构。

四、EntityManager 适配（调用简化）
typescript
public createExplosion(
  id: string,
  worldPosition: THREE.Vector3,
  maxInfluenceRadius: number = 10.0,
  params?: Partial<ExplosionParams>
): void {
  // 直接调用，ExplosionManager 内部自己查询并锁定目标
  this.explosionManager.create(
    id,
    { ...DEFAULT_EXPLOSION_PARAMS, ...params },
    worldPosition.x,
    worldPosition.y,
    maxInfluenceRadius
  );
}
不再需要 this.explosionManager.registerTarget(target) 等前置调用。

五、3D 调试可视化（独立实现）
由于 ExplosionManager 已经自包含所有爆炸实例和物理数据，调试可视化直接读取：

typescript
// 在 Game 或 EntityManager 中
const debugVis = new ExplosionDebugVisualizer(scene, explosionManager);
// 每帧调用 debugVis.update()
ExplosionDebugVisualizer 内部遍历 explosionManager.getAllExplosions()，读取每个 Explosion1DSolver 的 getProfiles() 和 getShockRadius()，绘制：

半透明冲击波球壳（半径 = shockRadius，颜色随核心压力变化）。

压力切片圆盘（在 XY 平面，映射 P(r)）。

速度箭头（在 0.2R、0.5R、0.8R、1.0R 处）。

数值 HUD（t、R_shock、P_core、U_shock）。

六、你需要提供的信息（精简版）
基于以上精简化设计，我现在只需要：

Three.js 场景坐标系：Y-up 还是 Z-up？（用于确定压力切片在哪个平面绘制）

爆炸触发方式：你希望我绑定到什么事件？（键盘按键、子弹命中、还是自动测试）

ExplosionManager 实例所在位置：在 EntityManager 中，还是更上层？

如果你确认这个“纯静态注册 + 持续注入”的设计方向，我就开始生成代码：

修改 ExplosionManager（静态列表 + 持续遍历）。

修改 IFluidForceTarget（增加 applyExplosionField）。

实现 ExplosionDebugVisualizer（Three.js 3D 调试可视化）。









好的，我们将按照既定计划生成代码。为了确保不遗漏，我们先列出需要修改/新增的文件清单，然后逐个给出完整代码。

需要修改或新增的文件
文件	操作	说明
Explosion1DSolver.ts	修改	新增 sampleNormalized 和 getShockAcceleration 方法
types.ts	修改	新增 ExplosionForceField 类型，调整 InjectionParams
FluidExternalForce.ts	修改	在 IFluidForceTarget 中增加 applyExplosionField 方法
ExplosionManager.ts	重构	改为“预注册静态目标列表 + 持续注入”
FluidIntegrator.ts	修改	改为传递力场描述符（简化版）
ExplosionDebugVisualizer.ts	新增	3D 调试可视化类
EntityManager.ts	修改	简化 createExplosion 方法
FluidSimulatorAdapter.ts	修改	实现 applyExplosionField（暂空或简易实现）
LightFluidEntity.ts	修改	实现 applyExplosionField（暂空或简易实现）
我将依次生成上述文件的完整代码（只给出修改/新增的部分，对于未改动的部分用 // ... existing code ... 省略）。

1. Explosion1DSolver.ts（新增方法）
在类的末尾（destroy 方法之前）添加：

typescript
// ... existing code ...

  /**
   * 返回归一化半径 ξ = r / R_shock 处的物理状态
   * ξ 范围建议 [0, 1.5]，超出部分自动截断到边界
   */
  public sampleNormalized(xi: number): PhysicalState {
    const r = xi * this.shockRadius;
    // 限制 r 在有效网格范围内，避免越界
    if (r <= this.r[0]) return this.sample(this.r[0]);
    if (r >= this.r[this.N - 1]) return this.sample(this.r[this.N - 1]);
    return this.sample(r);
  }

  /**
   * 获取当前冲击波加速度（dU/dt 的有限差分近似）
   * 需要在 advanceBy 中缓存上一帧速度
   */
  private prevShockSpeed: number = 0;
  private prevTime: number = 0;

  public getShockAcceleration(): number {
    if (this.t - this.prevTime < 1e-9) return 0;
    const accel = (this.getShockSpeed() - this.prevShockSpeed) / (this.t - this.prevTime);
    return accel;
  }

  // 在 advanceBy 中更新缓存
  public advanceBy(deltaTime: number): void {
    // ... 原有逻辑 ...
    // 在调用 advanceTo 之前记录当前状态
    const oldSpeed = this.getShockSpeed();
    const oldTime = this.t;
    // 调用 advanceTo
    this.advanceTo(Math.min(this.t + deltaTime, this.duration));
    // 更新缓存
    this.prevShockSpeed = oldSpeed;
    this.prevTime = oldTime;
  }

// ... 其余代码 ...
注意：需要将 prevShockSpeed 和 prevTime 声明为私有成员变量（放在类的顶部）。

2. types.ts（新增类型和调整参数）
typescript
// ... 原有的 ExplosionParams, PhysicalState 等 ...

/**
 * 爆炸力场描述符：包含爆炸中心、冲击波半径和采样函数。
 * 由 FluidIntegrator 生成，传递给 IFluidForceTarget。
 */
export interface ExplosionForceField {
  /** 爆炸中心世界坐标（已补偿纹理偏移） */
  centerWorld: THREE.Vector2;
  /** 当前冲击波半径（物理单位） */
  shockRadius: number;
  /** 核心压力（Pa） */
  corePressure: number;
  /** 核心温度（K） */
  coreTemperature: number;
  /** 采样函数：输入物理半径 r，返回该处的物理状态 */
  sample: (r: number) => PhysicalState;
  /** 归一化采样函数：ξ = r / R_shock，返回物理状态 */
  sampleNormalized: (xi: number) => PhysicalState;
  /** 冲击波加速度 (m/s²) */
  shockAcceleration: number;
  /** 冲击波速度 (m/s) */
  shockSpeed: number;
}

/**
 * 注入参数（重命名并明确语义）
 */
export interface InjectionParams {
  /** 压力梯度 (Pa/m) → 散度 (1/s) 的转换系数，物理单位为 m²/(Pa·s) */
  pressureToDivergenceScale: number;
  /** 动量传递系数（0~1），控制气体速度传递给液滴的效率 */
  momentumTransferCoeff: number;
  /** 水体生成强度（0~1），控制高温产生水花的量 */
  waterGenerationStrength: number;
  /** 是否启用调试可视化（默认 false） */
  debugVisualization?: boolean;
}

export const DEFAULT_INJECTION_PARAMS: InjectionParams = {
  pressureToDivergenceScale: 1.0,  // 需要根据网格分辨率调整，但作为物理单位，1.0 表示直接映射
  momentumTransferCoeff: 0.3,
  waterGenerationStrength: 0.0,
  debugVisualization: false,
};
注意：原 DEFAULT_INJECTION_PARAMS 被替换。

3. FluidExternalForce.ts（修改接口）
typescript
// ... 原有导入和类型 ...

import type { ExplosionForceField } from '@lib/explosion-processor/types';

/**
 * 目标接口 - 所有可接受外力的流体目标都需实现
 */
export interface IFluidForceTarget {
  /** 是否可以在世界空间移动 */
  isMovable(): boolean;
  /** 应用一个统一外力，内部自动分派 */
  applyFluidForce(force: FluidExternalForce): void;
  /** 获取目标在世界空间的位置 */
  getPosition(): THREE.Vector3;
  /** 获取目标的碰撞半径（用于空间查询优化） */
  getBoundingRadius(): number;

  /**
   * ★ 新增：接收爆炸力场描述符，由目标自行采样并应用。
   * 这是为了保留完整的径向剖面结构，避免在 FluidIntegrator 中丢失信息。
   * 如果目标不支持精细场采样，可以忽略此方法或转换为传统外力。
   */
  applyExplosionField?(field: ExplosionForceField): void;
}
4. ExplosionManager.ts（重构）
typescript
import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { ExplosionParams } from '@lib/explosion-processor/types';
import { FluidIntegrator } from '../integration/FluidIntegrator';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';

interface ExplosionEntry {
  solver: Explosion1DSolver;
  position: THREE.Vector3;
  maxInfluenceRadius: number;
  // ★ 静态列表：爆炸创建时一次性填充，之后不再修改
  registeredTargets: IFluidForceTarget[];
}

export class ExplosionManager {
  private explosions: Map<string, ExplosionEntry> = new Map();
  private targets: Set<IFluidForceTarget> = new Set(); // 全局注册的目标集合（用于查询）
  private integrators: Map<IFluidForceTarget, FluidIntegrator> = new Map();
  private graphicsTime: number = 0;

  // 注册全局目标（由外部调用，如 EntityManager）
  public registerTarget(target: IFluidForceTarget): void {
    this.targets.add(target);
  }

  // 注销全局目标
  public unregisterTarget(target: IFluidForceTarget): void {
    this.targets.delete(target);
    // 移除关联的集成器
    const integrator = this.integrators.get(target);
    if (integrator) {
      integrator.destroy();
      this.integrators.delete(target);
    }
  }

  /**
   * 创建爆炸，并立即锁定影响范围内的目标
   */
  public create(
    id: string,
    params: ExplosionParams,
    worldX: number,
    worldY: number,
    maxInfluenceRadius: number = 10.0
  ): Explosion1DSolver {
    if (this.explosions.has(id)) {
      console.warn(`Explosion with id "${id}" already exists, removing old one`);
      this.remove(id);
    }

    const explosion = new Explosion1DSolver(params);
    const center = new THREE.Vector3(worldX, worldY, 0);

    // 执行一次范围查询，锁定目标
    const affectedTargets = this.findTargetsInRange(center, maxInfluenceRadius);

    const entry: ExplosionEntry = {
      solver: explosion,
      position: center,
      maxInfluenceRadius,
      registeredTargets: affectedTargets,
    };

    this.explosions.set(id, entry);

    // 为每个目标预创建 Integrator（确保它们存在）
    for (const target of affectedTargets) {
      if (!this.integrators.has(target)) {
        this.integrators.set(target, new FluidIntegrator(target));
      }
    }

    console.log(`[ExplosionManager] 爆炸已创建: id=${id}, 锁定目标数=${affectedTargets.length}`);
    return explosion;
  }

  /**
   * 更新所有爆炸，持续影响已注册的目标
   */
  public updateAll(graphicsDelta: number): void {
    const clampedDelta = Math.min(graphicsDelta, 0.033);
    this.graphicsTime += clampedDelta;

    if (this.explosions.size === 0) return;

    this.explosions.forEach((entry, id) => {
      const explosion = entry.solver;
      if (!explosion.isActive()) return;

      // 推进物理
      explosion.advanceBy(clampedDelta);

      // 遍历静态列表，持续注入
      for (const target of entry.registeredTargets) {
        // 检查目标是否仍然有效（被动检测）
        if (!this.isTargetValid(target)) continue;

        const integrator = this.integrators.get(target);
        if (integrator) {
          integrator.inject(explosion, entry.position.x, entry.position.y);
        }
      }
    });

    // 清理失效的爆炸
    this.cleanupInactive();
  }

  /**
   * 查找范围内的目标（使用全局 targets 集合）
   */
  private findTargetsInRange(center: THREE.Vector3, radius: number): IFluidForceTarget[] {
    const result: IFluidForceTarget[] = [];
    for (const target of this.targets) {
      try {
        const targetPos = target.getPosition?.();
        if (!targetPos) continue;
        const distance = targetPos.distanceTo(center);
        const boundingRadius = target.getBoundingRadius?.() || 0;
        if (distance - boundingRadius <= radius) {
          result.push(target);
        }
      } catch (e) {
        console.warn('Error checking target distance:', e);
      }
    }
    return result;
  }

  /**
   * 检查目标是否仍然有效（未被销毁）
   */
  private isTargetValid(target: IFluidForceTarget): boolean {
    try {
      // 如果目标实现了 isActive（如 Entity），检查它
      if (typeof (target as any).isActive === 'boolean') {
        return (target as any).isActive;
      }
      // 否则尝试获取位置，失败则视为无效
      target.getPosition();
      return true;
    } catch {
      return false;
    }
  }

  // 获取爆炸求解器
  public get(id: string): Explosion1DSolver | undefined {
    const entry = this.explosions.get(id);
    return entry?.solver;
  }

  // 获取爆炸位置
  public getPosition(id: string): THREE.Vector3 | undefined {
    const entry = this.explosions.get(id);
    return entry?.position;
  }

  // 移除爆炸
  public remove(id: string): void {
    const entry = this.explosions.get(id);
    if (entry) {
      entry.solver.destroy();
      this.explosions.delete(id);
      console.log(`[ExplosionManager] 爆炸已销毁: id=${id}, 剩余爆炸数=${this.explosions.size}`);
    }
  }

  public has(id: string): boolean {
    return this.explosions.has(id);
  }

  public advanceTo(targetTime: number): void {
    this.graphicsTime = targetTime;
    this.explosions.forEach((entry) => {
      if (entry.solver.isActive()) {
        entry.solver.advanceTo(targetTime);
      }
    });
  }

  public getActiveExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values())
      .filter((entry) => entry.solver.isActive())
      .map((entry) => entry.solver);
  }

  public getAllExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values()).map((entry) => entry.solver);
  }

  public getCount(): number {
    return this.explosions.size;
  }

  public getActiveCount(): number {
    return this.getActiveExplosions().length;
  }

  public getTargetCount(): number {
    return this.targets.size;
  }

  public clear(): void {
    this.explosions.forEach((entry) => entry.solver.destroy());
    this.explosions.clear();
    for (const integrator of this.integrators.values()) {
      integrator.destroy();
    }
    this.integrators.clear();
    this.targets.clear();
    this.graphicsTime = 0;
  }

  public getGraphicsTime(): number {
    return this.graphicsTime;
  }

  public forEach(callback: (explosion: Explosion1DSolver, id: string) => void): void {
    this.explosions.forEach((entry, id) => {
      callback(entry.solver, id);
    });
  }

  private cleanupInactive(): void {
    const toRemove: string[] = [];
    this.explosions.forEach((entry, id) => {
      if (!entry.solver.isActive()) {
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => this.remove(id));
  }

  // 为外部提供注册目标的方法（由 EntityManager 等调用）
  public addGlobalTarget(target: IFluidForceTarget): void {
    this.registerTarget(target);
  }

  public removeGlobalTarget(target: IFluidForceTarget): void {
    this.unregisterTarget(target);
  }
}
5. FluidIntegrator.ts（改为传递力场）
typescript
import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { InjectionParams, ExplosionForceField } from '@lib/explosion-processor/types';
import { DEFAULT_INJECTION_PARAMS } from '@lib/explosion-processor/types';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';

export class FluidIntegrator {
  private target: IFluidForceTarget | null = null;
  private injectionParams: InjectionParams;
  private destroyed: boolean = false;

  // 复用对象减少 GC
  private centerWorld: THREE.Vector2 = new THREE.Vector2();

  constructor(target: IFluidForceTarget, injectionParams?: Partial<InjectionParams>) {
    this.target = target;
    this.injectionParams = { ...DEFAULT_INJECTION_PARAMS, ...injectionParams };
  }

  public setInjectionParams(params: Partial<InjectionParams>): void {
    if (this.destroyed) return;
    this.injectionParams = { ...this.injectionParams, ...params };
  }

  /**
   * 注入爆炸力场描述符（而不是直接生成外力）
   */
  public inject(explosion: Explosion1DSolver, worldCenterX: number, worldCenterY: number): void {
    if (this.destroyed || !this.target || !explosion.isActive()) return;

    // 如果目标支持精细场接口，直接传递力场
    if (typeof this.target.applyExplosionField === 'function') {
      const field = this.buildForceField(explosion, worldCenterX, worldCenterY);
      this.target.applyExplosionField(field);
    } else {
      // 降级方案：转换为传统外力（兼容旧接口）
      // 但我们仍然可以生成一个简单的外力，但会丢失径向剖面
      // 此处可以调用原有的 buildFluidForce，但为了简洁，我们只打个警告
      console.warn('[FluidIntegrator] 目标不支持 applyExplosionField，无法传递精细力场。');
    }
  }

  /**
   * 构建爆炸力场描述符
   */
  private buildForceField(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): ExplosionForceField {
    this.centerWorld.set(worldCenterX, worldCenterY);
    const shockRadius = explosion.getShockRadius();

    return {
      centerWorld: this.centerWorld,
      shockRadius: shockRadius,
      corePressure: explosion.getCorePressure(),
      coreTemperature: explosion.getCoreTemperature(),
      sample: (r: number) => explosion.sample(r),
      sampleNormalized: (xi: number) => explosion.sampleNormalized(xi),
      shockAcceleration: explosion.getShockAcceleration(),
      shockSpeed: explosion.getShockSpeed(),
    };
  }

  public setTarget(target: IFluidForceTarget): void {
    if (this.destroyed) return;
    this.target = target;
  }

  public getTarget(): IFluidForceTarget | null {
    return this.target;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target = null;
    this.injectionParams = undefined as any;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }
}
6. ExplosionDebugVisualizer.ts（新增）
typescript
import * as THREE from 'three';
import { ExplosionManager } from './manager/ExplosionManager';
import { Explosion1DSolver } from './Explosion1DSolver';
import type { PhysicalState } from './types';

/**
 * 爆炸调试可视化工具
 * 在 Three.js 场景中绘制冲击波球壳、压力切片、速度箭头和 HUD
 */
export class ExplosionDebugVisualizer {
  private scene: THREE.Scene;
  private manager: ExplosionManager;
  private enabled: boolean = false;

  // 可视化对象缓存
  private shockSphereMap: Map<string, THREE.Mesh> = new Map();
  private pressureDiskMap: Map<string, THREE.Mesh> = new Map();
  private arrowHelpers: Map<string, THREE.ArrowHelper[]> = new Map();
  private hudSprites: Map<string, THREE.Sprite> = new Map();

  // 材质与几何体共享
  private sphereGeometry: THREE.SphereGeometry;
  private diskGeometry: THREE.CircleGeometry;
  private shockMaterial: THREE.ShaderMaterial;
  private diskMaterial: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, manager: ExplosionManager) {
    this.scene = scene;
    this.manager = manager;

    // 预创建几何体（可在更新时复用）
    this.sphereGeometry = new THREE.SphereGeometry(1, 32, 24);
    this.diskGeometry = new THREE.CircleGeometry(1, 48);

    // 冲击波材质（半透明，颜色渐变）
    this.shockMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 0.2, 0.2) },
        uOpacity: { value: 0.3 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(uColor * intensity, uOpacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 压力切片材质（使用纹理或顶点颜色，这里简单使用颜色渐变）
    this.diskMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 1.0 },
        uColors: { value: null }, // 实际会传入颜色数组或纹理
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec2 uCenter;
        uniform float uRadius;
        uniform vec3 uColors[64]; // 简化版，实际可用纹理
        varying vec2 vUv;
        void main() {
          vec2 dir = vUv - uCenter;
          float dist = length(dir);
          if (dist > uRadius) discard;
          float t = dist / uRadius;
          // 简单的红-蓝渐变
          vec3 color = mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), t);
          gl_FragColor = vec4(color, 0.6);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.enabled = true;
  }

  /**
   * 启用或禁用调试可视化
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearAll();
    }
  }

  /**
   * 每帧更新所有爆炸的可视化
   */
  public update(): void {
    if (!this.enabled) return;

    const allExplosions = this.manager.getAllExplosions();
    const activeIds = new Set<string>();

    for (const [id, entry] of (this.manager as any).explosions) {
      activeIds.add(id);
      const solver = entry.solver;
      if (!solver.isActive()) continue;

      // 更新或创建可视化元素
      this.updateShockSphere(id, solver);
      this.updatePressureDisk(id, solver);
      this.updateArrows(id, solver);
      this.updateHUD(id, solver);
    }

    // 清理不再活跃的爆炸的可视化
    for (const [id] of this.shockSphereMap) {
      if (!activeIds.has(id)) {
        this.removeVisualsFor(id);
      }
    }
  }

  private updateShockSphere(id: string, solver: Explosion1DSolver): void {
    const radius = solver.getShockRadius();
    const corePressure = solver.getCorePressure();
    const ambientP = solver.getAmbientPressure();
    const pressureRatio = Math.min(corePressure / ambientP, 10) / 10; // 0~1

    // 颜色从红到蓝
    const color = new THREE.Color().setHSL(0.0 + pressureRatio * 0.6, 1.0, 0.5);

    let mesh = this.shockSphereMap.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.sphereGeometry, this.shockMaterial.clone());
      this.scene.add(mesh);
      this.shockSphereMap.set(id, mesh);
    }

    mesh.scale.set(radius, radius, radius);
    (mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color);
    (mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.3;

    // 位置：爆炸中心
    const pos = this.manager.getPosition(id);
    if (pos) mesh.position.copy(pos);
  }

  private updatePressureDisk(id: string, solver: Explosion1DSolver): void {
    const radius = solver.getShockRadius();
    let mesh = this.pressureDiskMap.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.diskGeometry, this.diskMaterial.clone());
      // 让圆盘在 XY 平面（假设 Y-up）
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      this.pressureDiskMap.set(id, mesh);
    }

    mesh.scale.set(radius, radius, 1);
    const pos = this.manager.getPosition(id);
    if (pos) mesh.position.copy(pos);
    // 注意：材质 uniform 需要更新，但为了简单，我们只使用静态颜色渐变
  }

  private updateArrows(id: string, solver: Explosion1DSolver): void {
    const radius = solver.getShockRadius();
    const positions = [0.2, 0.5, 0.8, 1.0].map(xi => xi * radius);
    const center = this.manager.getPosition(id);
    if (!center) return;

    let arrows = this.arrowHelpers.get(id);
    if (!arrows) {
      arrows = [];
      this.arrowHelpers.set(id, arrows);
    }

    // 确保箭头数量与位置匹配
    while (arrows.length < positions.length) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0xffaa00);
      this.scene.add(arrow);
      arrows.push(arrow);
    }
    while (arrows.length > positions.length) {
      const removed = arrows.pop();
      if (removed) this.scene.remove(removed);
    }

    // 更新每个箭头
    for (let i = 0; i < positions.length; i++) {
      const r = positions[i];
      const state = solver.sample(r);
      const speed = state.u;
      const dir = new THREE.Vector3(1, 0, 0); // 径向方向
      const pos = new THREE.Vector3(center.x + r, center.y, 0);
      const length = Math.max(speed * 0.1, 0.1);
      arrows[i].position.copy(pos);
      arrows[i].setDirection(dir);
      arrows[i].setLength(length, 0.2, 0.1);
      // 颜色随速度变化
      const color = new THREE.Color().setHSL(0.0 + Math.min(speed / 10, 1) * 0.5, 1, 0.5);
      arrows[i].setColor(color);
    }
  }

  private updateHUD(id: string, solver: Explosion1DSolver): void {
    // 使用 Sprite 显示文本（简化版，实际可用 CSS2DRenderer）
    // 这里略去具体实现，可以在后期按需添加
  }

  private removeVisualsFor(id: string): void {
    const sphere = this.shockSphereMap.get(id);
    if (sphere) { this.scene.remove(sphere); this.shockSphereMap.delete(id); }
    const disk = this.pressureDiskMap.get(id);
    if (disk) { this.scene.remove(disk); this.pressureDiskMap.delete(id); }
    const arrows = this.arrowHelpers.get(id);
    if (arrows) { arrows.forEach(a => this.scene.remove(a)); this.arrowHelpers.delete(id); }
    // HUD 类似
  }

  private clearAll(): void {
    for (const [id] of this.shockSphereMap) {
      this.removeVisualsFor(id);
    }
    // 清理所有 Map
    this.shockSphereMap.clear();
    this.pressureDiskMap.clear();
    this.arrowHelpers.clear();
    this.hudSprites.clear();
  }

  public dispose(): void {
    this.clearAll();
    this.sphereGeometry.dispose();
    this.diskGeometry.dispose();
    this.shockMaterial.dispose();
    this.diskMaterial.dispose();
  }
}
7. EntityManager.ts（简化 createExplosion）
typescript
// ... 在 EntityManager 类中修改 createExplosion 方法 ...

  public createExplosion(
    id: string,
    worldPosition: THREE.Vector3,
    maxInfluenceRadius: number = 10.0,
    params?: Partial<ExplosionParams>
  ): void {
    console.log(`[EntityManager] 创建爆炸: ${id} at (${worldPosition.x.toFixed(2)}, ${worldPosition.y.toFixed(2)}), radius: ${maxInfluenceRadius}`);
    this.explosionManager.create(
      id,
      { ...DEFAULT_EXPLOSION_PARAMS, ...params },
      worldPosition.x,
      worldPosition.y,
      maxInfluenceRadius
    );
  }

// 移除原先的 findTargetsInRange 和 registerTarget 调用（因为现在内部处理）
8. FluidSimulatorAdapter.ts 和 LightFluidEntity.ts（实现 applyExplosionField）
由于本阶段我们只关注爆炸库本身，且调试可视化不依赖于这些目标实际处理力场，我们可以提供一个空实现或简单日志，以便测试。

在 FluidSimulatorAdapter.ts 中添加：

typescript
// ... 在类中实现接口方法 ...
  applyExplosionField(field: ExplosionForceField): void {
    // 阶段二才会真正实现，目前只做日志
    console.log(`[FluidSimulatorAdapter] 收到爆炸力场: center=(${field.centerWorld.x.toFixed(2)}, ${field.centerWorld.y.toFixed(2)}), R=${field.shockRadius.toFixed(3)}`);
  }
在 LightFluidEntity.ts 中添加：

typescript
  applyExplosionField(field: ExplosionForceField): void {
    console.log(`[LightFluidEntity:${this.id}] 收到爆炸力场: center=(${field.centerWorld.x.toFixed(2)}, ${field.centerWorld.y.toFixed(2)}), R=${field.shockRadius.toFixed(3)}`);
  }
9. 需要同步修改 index.ts 导出新类型
在爆炸库的 index.ts 中，确保导出 ExplosionForceField 和更新后的 InjectionParams：

typescript
export type {
  ExplosionParams,
  PhysicalState,
  ExplosionProfiles,
  ExplosionVisualData,
  InjectionParams,
  ExplosionForceField,  // 新增
} from './types';
其他需要注意的改动
Explosion1DSolver 的 advanceBy 修改：需要缓存前一帧的速度，以计算加速度。我已在代码中给出修改提示，但注意要同步修改 advanceTo 以避免重复计算。

ExplosionManager 的 findTargetsInRange 使用 this.targets 集合，需要确保所有可能的流体目标在爆炸创建前已被注册到 ExplosionManager。在 EntityManager 中添加实体时，应调用 explosionManager.registerTarget(entity)（如果实体实现了 IFluidForceTarget）。

调试可视化：需要在游戏主循环中调用 debugVis.update()，并确保 ExplosionDebugVisualizer 的构造函数传入正确的 scene 和 manager。

FluidIntegrator 的降级方案：如果目标不支持 applyExplosionField，可以选择静默忽略或转换为传统外力。由于我们未来会全部支持精细场，目前可以只打警告。

types.ts 中的 InjectionParams 旧参数：确保所有使用 DEFAULT_INJECTION_PARAMS 的地方更新为新结构。目前只有 FluidIntegrator 使用，且未实际应用，所以可以直接替换。

后续集成建议
在游戏初始化时，创建 ExplosionManager 实例，并传给 EntityManager（或 EntityManager 内部创建）。

注册所有可能的流体目标到 ExplosionManager（在 addEntity 时判断）。

在需要触发爆炸的地方调用 entityManager.createExplosion(...)。

在游戏主循环中调用 explosionManager.updateAll(delta)，并更新调试可视化。




好的，完全理解你的要求。核心改动如下：

取消“每帧注入”：改为基于时间累积的“间隔注入”。

注入间隔由物理时间 delta t 驱动：每次物理推进后累加时间，达到阈值才执行注入。

坐标映射职责分离：FluidIntegrator 只传递力场描述符，不负责坐标转换。

设计方案
注入策略（间隔注入）
在 ExplosionEntry 中新增：

injectionAccumulator: number —— 累积的物理时间。

injectionInterval: number —— 注入间隔（默认 0.016 秒，约 1 帧）。

注入逻辑：

每帧 updateAll 中，物理推进 clampedDelta 后，累加到 accumulator。

当 accumulator >= injectionInterval 时，执行一次注入（对所有已注册目标）。

执行后，accumulator -= injectionInterval（允许累积多次，避免误差累积）。

这样注入频率由 injectionInterval 控制，既不是每帧也不是仅一次。

完整代码生成
1. types.ts —— 新增 ExplosionForceField 和调整参数
typescript
// types.ts
import * as THREE from 'three';

export interface ExplosionParams {
  totalEnergy: number;
  initialRadius: number;
  ambientDensity: number;
  ambientPressure: number;
  gamma?: number;
  N?: number;
  rMin?: number;
  rMax?: number;
  cfl?: number;
  shockThreshold?: number;
  duration?: number;
  injectionInterval?: number;  // 注入间隔（秒），默认 0.016
}

export interface PhysicalState {
  rho: number;
  u: number;
  p: number;
  T: number;
}

export interface ExplosionProfiles {
  r: Float64Array;
  rho: Float64Array;
  u: Float64Array;
  p: Float64Array;
  T: Float64Array;
}

export interface ExplosionVisualData {
  shockRadius: number;
  shockSpeed: number;
  coreTemperature: number;
  corePressure: number;
  profiles: ExplosionProfiles;
}

/**
 * 爆炸力场描述符：由 FluidIntegrator 生成，传递给 IFluidForceTarget
 * 坐标映射由目标（FluidSimulator）内部自行处理
 */
export interface ExplosionForceField {
  /** 爆炸中心世界坐标（原始世界坐标，不包含纹理偏移） */
  centerWorld: THREE.Vector2;
  /** 当前冲击波半径（物理单位） */
  shockRadius: number;
  /** 核心压力（Pa） */
  corePressure: number;
  /** 核心温度（K） */
  coreTemperature: number;
  /** 环境压力（Pa） */
  ambientPressure: number;
  /** 采样函数：输入物理半径 r，返回该处的物理状态 */
  sample: (r: number) => PhysicalState;
  /** 归一化采样函数：ξ = r / R_shock，返回物理状态 */
  sampleNormalized: (xi: number) => PhysicalState;
  /** 冲击波加速度 (m/s²) */
  shockAcceleration: number;
  /** 冲击波速度 (m/s) */
  shockSpeed: number;
}

export interface InjectionParams {
  /** 压力梯度 (Pa/m) → 散度 (1/s) 的转换系数 */
  pressureToDivergenceScale: number;
  /** 动量传递系数（0~1） */
  momentumTransferCoeff: number;
  /** 水体生成强度（0~1） */
  waterGenerationStrength: number;
  /** 是否启用调试可视化 */
  debugVisualization?: boolean;
}

export const DEFAULT_INJECTION_PARAMS: InjectionParams = {
  pressureToDivergenceScale: 1.0,
  momentumTransferCoeff: 0.3,
  waterGenerationStrength: 0.0,
  debugVisualization: false,
};

export const DEFAULT_EXPLOSION_PARAMS: Required<ExplosionParams> = {
  totalEnergy: 500000,
  initialRadius: 0.02,
  ambientDensity: 1.225,
  ambientPressure: 101325,
  gamma: 1.4,
  N: 128,
  rMin: 0.002,
  rMax: 10.0,
  cfl: 0.4,
  shockThreshold: 1.5,
  duration: 2.0,
  injectionInterval: 0.016,  // 默认约 1 帧（60fps）
};
2. Explosion1DSolver.ts —— 新增方法
在类的顶部添加缓存成员：

typescript
private prevShockSpeed: number = 0;
private prevTime: number = 0;
在 advanceBy 中更新缓存：

typescript
public advanceBy(deltaTime: number): void {
  if (!this.active || this.t >= this.duration || deltaTime <= 0) return;
  const oldSpeed = this.getShockSpeed();
  const oldTime = this.t;
  const target = Math.min(this.t + deltaTime, this.duration);
  this.advanceTo(target);
  this.prevShockSpeed = oldSpeed;
  this.prevTime = oldTime;
}
在 destroy 之前新增：

typescript
public sampleNormalized(xi: number): PhysicalState {
  const r = xi * this.shockRadius;
  if (r <= this.r[0]) return this.sample(this.r[0]);
  if (r >= this.r[this.N - 1]) return this.sample(this.r[this.N - 1]);
  return this.sample(r);
}

public getShockAcceleration(): number {
  const dt = this.t - this.prevTime;
  if (dt < 1e-9) return 0;
  return (this.getShockSpeed() - this.prevShockSpeed) / dt;
}
3. FluidExternalForce.ts —— 修改接口
typescript
import * as THREE from 'three';
import type { ExplosionForceField } from '@lib/explosion-processor/types';

export interface FluidInternalInjection {
  centerUV?: THREE.Vector2;
  radius?: number;
  falloff?: 'linear' | 'gaussian';
}

export interface FluidVelocityInjection extends FluidInternalInjection {
  velocity: THREE.Vector2;
}

export interface FluidDivergenceInjection extends FluidInternalInjection {
  divergence: number;
}

export interface FluidWaterInjection extends FluidInternalInjection {
  amount: number;
}

export interface FluidExternalForce {
  worldImpulse?: THREE.Vector3;
  worldAcceleration?: THREE.Vector3;
  velocityInjection?: FluidVelocityInjection;
  divergenceInjection?: FluidDivergenceInjection;
  waterInjection?: FluidWaterInjection;
}

export interface IFluidForceTarget {
  isMovable(): boolean;
  applyFluidForce(force: FluidExternalForce): void;
  getPosition(): THREE.Vector3;
  getBoundingRadius(): number;

  /**
   * 接收爆炸力场描述符（由目标自行采样并映射到纹理空间）
   * 坐标映射由目标内部完成，FluidIntegrator 只传递原始物理数据
   */
  applyExplosionField?(field: ExplosionForceField): void;
}
4. ExplosionManager.ts —— 核心重构（间隔注入 + 静态列表）
typescript
import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { ExplosionParams } from '@lib/explosion-processor/types';
import { FluidIntegrator } from '../integration/FluidIntegrator';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';
import { DEFAULT_EXPLOSION_PARAMS } from '../types';

interface ExplosionEntry {
  solver: Explosion1DSolver;
  position: THREE.Vector3;
  maxInfluenceRadius: number;
  registeredTargets: IFluidForceTarget[];   // 静态列表，创建时锁定
  injectionAccumulator: number;              // 累积物理时间
  injectionInterval: number;                // 注入间隔（秒）
}

export class ExplosionManager {
  private explosions: Map<string, ExplosionEntry> = new Map();
  private targets: Set<IFluidForceTarget> = new Set();
  private integrators: Map<IFluidForceTarget, FluidIntegrator> = new Map();
  private graphicsTime: number = 0;

  public registerTarget(target: IFluidForceTarget): void {
    this.targets.add(target);
  }

  public unregisterTarget(target: IFluidForceTarget): void {
    this.targets.delete(target);
    const integrator = this.integrators.get(target);
    if (integrator) {
      integrator.destroy();
      this.integrators.delete(target);
    }
  }

  public create(
    id: string,
    params: ExplosionParams,
    worldX: number,
    worldY: number,
    maxInfluenceRadius: number = 10.0
  ): Explosion1DSolver {
    if (this.explosions.has(id)) {
      console.warn(`Explosion with id "${id}" already exists, removing old one`);
      this.remove(id);
    }

    const fullParams = { ...DEFAULT_EXPLOSION_PARAMS, ...params };
    const explosion = new Explosion1DSolver(fullParams);
    const center = new THREE.Vector3(worldX, worldY, 0);

    const affectedTargets = this.findTargetsInRange(center, maxInfluenceRadius);

    const entry: ExplosionEntry = {
      solver: explosion,
      position: center,
      maxInfluenceRadius,
      registeredTargets: affectedTargets,
      injectionAccumulator: 0,
      injectionInterval: fullParams.injectionInterval ?? 0.016,
    };

    this.explosions.set(id, entry);

    // 为每个目标预创建 Integrator
    for (const target of affectedTargets) {
      if (!this.integrators.has(target)) {
        this.integrators.set(target, new FluidIntegrator(target));
      }
    }

    console.log(`[ExplosionManager] 爆炸创建: id=${id}, 锁定目标=${affectedTargets.length}, 注入间隔=${entry.injectionInterval}s`);
    return explosion;
  }

  /**
   * 更新所有爆炸
   * 核心改动：累积物理时间，达到注入间隔时才执行注入
   */
  public updateAll(graphicsDelta: number): void {
    const clampedDelta = Math.min(graphicsDelta, 0.033);
    this.graphicsTime += clampedDelta;

    if (this.explosions.size === 0) return;

    this.explosions.forEach((entry, id) => {
      const explosion = entry.solver;
      if (!explosion.isActive()) return;

      // 1. 推进物理
      explosion.advanceBy(clampedDelta);

      // 2. 累积物理时间
      entry.injectionAccumulator += clampedDelta;

      // 3. 达到注入间隔 → 执行注入
      if (entry.injectionAccumulator >= entry.injectionInterval) {
        const injectCount = Math.floor(entry.injectionAccumulator / entry.injectionInterval);
        // 执行注入（可执行多次，但一次就够了，因为状态是连续的）
        this.performInjection(entry);
        // 更新累加器，保留余数避免误差累积
        entry.injectionAccumulator -= injectCount * entry.injectionInterval;
        // 如果累加器还大于间隔，继续注入（防止帧率波动导致积压）
        if (entry.injectionAccumulator >= entry.injectionInterval) {
          this.performInjection(entry);
          entry.injectionAccumulator = 0;
        }
      }
    });

    this.cleanupInactive();
  }

  /**
   * 执行一次注入：遍历静态列表，向所有有效目标注入力场
   */
  private performInjection(entry: ExplosionEntry): void {
    const explosion = entry.solver;
    if (!explosion.isActive()) return;

    for (const target of entry.registeredTargets) {
      if (!this.isTargetValid(target)) continue;
      const integrator = this.integrators.get(target);
      if (integrator) {
        integrator.inject(explosion, entry.position.x, entry.position.y);
      }
    }
  }

  private findTargetsInRange(center: THREE.Vector3, radius: number): IFluidForceTarget[] {
    const result: IFluidForceTarget[] = [];
    for (const target of this.targets) {
      try {
        const targetPos = target.getPosition?.();
        if (!targetPos) continue;
        const distance = targetPos.distanceTo(center);
        const boundingRadius = target.getBoundingRadius?.() || 0;
        if (distance - boundingRadius <= radius) {
          result.push(target);
        }
      } catch (e) {
        console.warn('Error checking target distance:', e);
      }
    }
    return result;
  }

  private isTargetValid(target: IFluidForceTarget): boolean {
    try {
      if (typeof (target as any).isActive === 'boolean') {
        return (target as any).isActive;
      }
      target.getPosition();
      return true;
    } catch {
      return false;
    }
  }

  // ... 其余公共方法（get, remove, has, advanceTo, getActiveExplosions, clear, forEach, cleanupInactive 等）保持不变 ...
  // 参考之前给出的代码，这里省略重复内容
}
5. FluidIntegrator.ts —— 只传递力场，不处理坐标
typescript
import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { InjectionParams, ExplosionForceField } from '@lib/explosion-processor/types';
import { DEFAULT_INJECTION_PARAMS } from '@lib/explosion-processor/types';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';

export class FluidIntegrator {
  private target: IFluidForceTarget | null = null;
  private injectionParams: InjectionParams;
  private destroyed: boolean = false;
  private centerWorld: THREE.Vector2 = new THREE.Vector2();

  constructor(target: IFluidForceTarget, injectionParams?: Partial<InjectionParams>) {
    this.target = target;
    this.injectionParams = { ...DEFAULT_INJECTION_PARAMS, ...injectionParams };
  }

  public setInjectionParams(params: Partial<InjectionParams>): void {
    if (this.destroyed) return;
    this.injectionParams = { ...this.injectionParams, ...params };
  }

  /**
   * 注入爆炸力场描述符（仅传递原始物理数据，不进行任何坐标映射）
   */
  public inject(explosion: Explosion1DSolver, worldCenterX: number, worldCenterY: number): void {
    if (this.destroyed || !this.target || !explosion.isActive()) return;

    if (typeof this.target.applyExplosionField === 'function') {
      const field = this.buildForceField(explosion, worldCenterX, worldCenterY);
      this.target.applyExplosionField(field);
    } else {
      // 降级：目标不支持精细力场，静默忽略（后续可升级）
      // console.debug('[FluidIntegrator] 目标不支持 applyExplosionField，跳过');
    }
  }

  private buildForceField(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): ExplosionForceField {
    this.centerWorld.set(worldCenterX, worldCenterY);
    return {
      centerWorld: this.centerWorld.clone(),
      shockRadius: explosion.getShockRadius(),
      corePressure: explosion.getCorePressure(),
      coreTemperature: explosion.getCoreTemperature(),
      ambientPressure: explosion.getAmbientPressure(),
      sample: (r: number) => explosion.sample(r),
      sampleNormalized: (xi: number) => explosion.sampleNormalized(xi),
      shockAcceleration: explosion.getShockAcceleration(),
      shockSpeed: explosion.getShockSpeed(),
    };
  }

  public setTarget(target: IFluidForceTarget): void {
    if (this.destroyed) return;
    this.target = target;
  }

  public getTarget(): IFluidForceTarget | null {
    return this.target;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target = null;
    this.injectionParams = undefined as any;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }
}
6. ExplosionDebugVisualizer.ts —— 3D 调试可视化（不变，参考上一轮）
7. EntityManager.ts —— 简化调用
typescript
public createExplosion(
  id: string,
  worldPosition: THREE.Vector3,
  maxInfluenceRadius: number = 10.0,
  params?: Partial<ExplosionParams>
): void {
  this.explosionManager.create(
    id,
    { ...DEFAULT_EXPLOSION_PARAMS, ...params },
    worldPosition.x,
    worldPosition.y,
    maxInfluenceRadius
  );
}
8. FluidSimulatorAdapter.ts 和 LightFluidEntity.ts —— 空实现 applyExplosionField
typescript
applyExplosionField(field: ExplosionForceField): void {
  // 阶段二实现，目前只记录调试信息
  if (this.injectionParams.debugVisualization) {
    console.log(`[${this.constructor.name}] 收到力场: R=${field.shockRadius.toFixed(3)}, P=${field.corePressure.toFixed(0)}`);
  }
}
配置示例
typescript
// 创建一个注入间隔为 0.05 秒（约每 3 帧注入一次）的爆炸
entityManager.createExplosion(
  'test_explosion',
  new THREE.Vector3(0, 0, 0),
  10.0,
  {
    totalEnergy: 500000,
    initialRadius: 0.02,
    duration: 2.0,
    injectionInterval: 0.05,  // 每 0.05 秒注入一次
  }
);
总结
改动	说明
注入策略	改为间隔注入，由 injectionInterval 控制频率，默认 0.016s
累积机制	每帧累加物理时间 clampedDelta，达到间隔才触发注入
坐标映射	完全从 FluidIntegrator 移除，由目标内部处理
参数配置	injectionInterval 在 ExplosionParams 中可配置
向后兼容	旧接口保留，新增 applyExplosionField 为可选方法
如有其他需要调整的地方，请告诉我。

