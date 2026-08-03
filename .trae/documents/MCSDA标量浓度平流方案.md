# MCSDA 标量浓度平流方案

## Context

当前流体编辑器平流 4 通道颜色场（HSLA），带宽高且无法独立控制各通道残差强度。用户希望：
1. 用 4 个独立变量分别控制 H/S/L/A 的残差浓度（含负值补色特效）
2. 保持高性能（1 通道平流替代 4 通道，约 3 倍提升）
3. 新增基准浓度（低于基准削弱、高于基准增强）
4. 3 个视口：速度、浓缩（density）、合成
5. 导出时残差×density×mul 烘焙为单帧 ftx3

**核心数学模型**：
```
强度因子 factor = density / baseline
finalH = fract(baseH + ΔH × factor × hMul)
finalS = clamp(baseS + ΔS × factor × sMul, 0, 1)
finalL = clamp(baseL + ΔL × factor × lMul, 0, 1)
finalA = clamp(baseA + ΔA × factor × aMul, 0, 1)
```
- `density`：1 通道 Uint8 动态场，参与平流（唯一动态场）
- `mul`（hMul/sMul/lMul/aMul）：4 个全局 uniform，-2~2，拖滑块即时响应
- `baseline`：基准浓度（0.01~1.0），density/baseline 为强度因子
- 残差（colorGrid）在标量模式下变为**静态源**（仅作 ΔHSL 增量）

## 实施步骤

### 1. FluidEditorConfig 扩展（[FluidEditor.ts:48-83](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts#L48-L83)）

新增字段：
```typescript
advectionMode: 'vector' | 'scalar';   // 默认 'vector'（旧模式）
scalarConfig: {
  hMultiplier: number;    // 默认 1.0, 范围 -2~2
  sMultiplier: number;    // 默认 1.0
  lMultiplier: number;    // 默认 1.0
  aMultiplier: number;    // 默认 1.0
  baselineDensity: number;// 默认 1.0, 范围 0.01~1.0
  decayRate: number;      // 默认 0, 范围 0~0.99
};
```
默认值在 [useFluidEditor.ts:19](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/useFluidEditor.ts#L19) 和 [FluidEditorUI.tsx:1216](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L1216) 的 config 初始化处同步加入。

### 2. FluidEditor 核心层（[FluidEditor.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts)）

- **densityGrid**: 新增 `private densityGrid!: FluidGrid`，在 `rebuildGrids()`（[:893](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts#L893)）用 `new FluidGrid(resolution, 1, 'uint8')` 创建（FluidGrid 支持 channels=1 RedFormat，见 [FluidGrid.ts:62](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/core/FluidGrid.ts#L62)）
- **initFields()**（[:920](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts#L920)）：density 初始化为 0
- **advectDensity(dt)**：复用 `advectionSolver.advect`，mask=`{r:true,g:false,b:false,a:false}`，wrapHue=false，boundaryMode='clamp'，CFL 子步同 advectColor
- **decayDensity()**：GPU Pass 把 density × (1-decayRate)，decayRate=0 时跳过
- **step()**（[:294](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts#L294)）分支：
  - `advectionMode==='scalar'`：跳过 `advectColor`，执行 `advectDensity` + `decayDensity`
  - `advectionMode==='vector'`：保持原逻辑
- **getDensityTexture()**：返回 `densityGrid.read`
- **bakeResidual(): Uint8Array**：GPU 烘焙 Pass，读 colorGrid（残差）× density × mul，输出调制后残差 Uint8Array（RGBA），用于导出。着色器：`out = clamp(residual × (density/baseline) × mul, 0, 255)`，逐通道 mul
- **processQueue/processContinuousSources**：scalar 模式下，注入 config 带 density 字段时，调 `injector.injectDensity(densityGrid, ...)`

### 3. FluidInjector 新增 injectDensity（[FluidInjector.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/core/FluidInjector.ts)）

复用 `gpu.getMaterial` 模式（参考 injectColor [:141](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/core/FluidInjector.ts#L141)），新 key `'injectDensity'`：
```typescript
injectDensity(grid: FluidGrid, value: number, rate: number, options: InjectionOptions): void
```
着色器：`gl_FragColor.r = mix(current.r, value, rate * maskVal)`，只写 R 通道（densityGrid 是 RedFormat 单通道）。mask 复用圆形 smoothstep + 可选外部 mask。

### 4. FluidOperations 扩展（[FluidOperations.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidOperations.ts)）

- `InjectionConfig` 新增可选字段 `density?: number`
- `applyOneShotInjection` / `applyInjection`：若 `config.density !== undefined`，调 `injector.injectDensity(gridVelocity... 不对，densityGrid)` —— 需要把 densityGrid 传入
- 方案：`processQueue` / `processContinuousSources` 签名加 `gridDensity: FluidGrid | null` 参数，scalar 模式传入 densityGrid，vector 模式传 null。注入时若 config.density 有值且 gridDensity 非 null，调 injectDensity

### 5. FluidEditorUI 视口与合成（[FluidEditorUI.tsx](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx)）

- **ViewMode 类型**（[FluidEditor.ts:13](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditor.ts#L13)）：`'color' | 'velocity' | 'composite' | 'density'`
- **viewMode 按钮**（[:748-770](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L748-L770)）：加"🧪 浓缩"按钮
- **densityScene + densityMat**：参考 velMat（[:1521](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L1521)），灰度显示 density 场（density.r → 灰度），可加基准线参考
- **合成着色器改造**（compositeMat [:1580-1630](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L1580-L1630)）：
  - 新增 uniforms：`uDensity`, `uChannelMul(vec4)`, `uBaseline`, `uScalarMode(int)`
  - scalar 模式分支：`factor = density.r / uBaseline; finalH = fract(baseH + dH × factor × uChannelMul.x)` 等
  - vector 模式分支：保持原逻辑（`finalH = fract(baseH + dH)`）
- **渲染循环**（[:1937-1949](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L1937-L1949)）：加 `else if (viewMode === 'density') targetScene = densityScene`；composite 模式下根据 advectionMode 设置 uScalarMode 和 density uniform

### 6. GeneralPanel 模式切换与滑块（[FluidEditorUI.tsx:580-870](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L580-L870)）

- 新增"平流模式"切换：向量模式（旧）/ 标量浓度模式（新）—— 两个按钮
- 标量模式下显示控件组：
  - 4 个 mul 滑块（H/S/L/A 强度，-2.0~2.0）
  - 基准浓度滑块（0.01~1.0）
  - 衰减速率滑块（0~0.99）
- props 已有 config/onConfigChange，直接用 `config.advectionMode` 和 `config.scalarConfig`

### 7. 摇杆同时注入 density（[FluidEditorUI.tsx handlePointerDown](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/fluid/editor/FluidEditorUI.tsx#L1306)）

- `buildInjectionConfig` 在 `advectionMode==='scalar'` 时加 `density` 字段（浓度值，如 1.0，或随摇杆距离）
- scalar 模式下摇杆按下：注入 density（位置=按下点）+ 注入速度（方向=摇杆）—— density 被速度推动流动
- 速度方向仍由摇杆控制，density 浓度可固定（如 1.0）或随摇杆拖动距离增强
- 注入路径：editor.queueInjection/addContinuousInjection 的 config 带 density，FluidOperations 识别并调 injectDensity

### 8. 烘焙导出按钮（FluidEditorUI OperationsPanel 或 GeneralPanel）

- scalar 模式下显示"📤 导出烘焙残差"按钮
- 点击调 `editor.bakeResidual()` 得到调制后残差 Uint8Array（RGBA，分辨率同 colorGrid）
- 序列化为单帧 ftx3 下载：复用 `packMultiFrameToBinary`（[Toolbar.tsx:634](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/components/Toolbar.tsx#L634)）单帧包装，或简单导出为 .bin/.png。实施时确认 packMultiFrameToBinary 是否支持单帧，若不支持则导出原始 RGBA Uint8 + 元信息 JSON

## 关键设计决策

1. **density 场**：1 通道 Uint8，RedFormat，LinearFilter（双线性平流），初始 0
2. **残差静态化**：scalar 模式下 colorGrid 不平流，仅作 ΔHSL 源；density 平流驱动视觉流动
3. **baseline 模型**：`factor = density / baseline`（baseline=1 时 factor=density，等同原方案；baseline 越小，同 density 放大越大）
4. **模式隔离**：vector 模式完全保留旧逻辑，scalar 模式走新分支，互不影响
5. **导出独立路径**：FluidEditor.bakeResidual → 单帧导出，不触碰 BaseColorEditor 多帧导出
6. **摇杆复用**：scalar 模式摇杆同时完成"注入 density + 给速度方向"，一个手势两件事

## 验证

1. **模式切换**：切到标量模式，旧功能（向量模式）不受影响
2. **density 流动**：导入残差 → density=0 时合成=base → 摇杆注入 density → 浓缩视口看到 density 流动 → 合成视口看到残差按 density 显现
3. **mul 实时调参**：拖 H 滑块到 -1，合成色相反转（补色）；拖滑块即时响应，无卡顿
4. **基准浓度**：baseline=0.5 时，density=0.5→原样，density=1→增强 2 倍，density=0.25→削弱 0.5 倍
5. **衰减**：decayRate=0.1 时 density 逐帧消散，合成残差渐隐
6. **烘焙导出**：导出烘焙残差 → 重新导入 → 合成结果与导出前一致（density=1、mul=1 还原）
7. **性能**：标量模式平流带宽 1ch vs 向量模式 4ch，帧率应明显提升

## 实施顺序

1. FluidEditorConfig + 默认值（基础）
2. FluidEditor densityGrid + advectDensity + decay + step 分支 + getter（核心模拟）
3. FluidInjector injectDensity + FluidOperations density 队列（注入）
4. FluidEditorUI density 视口 + 合成着色器改造（显示）
5. GeneralPanel 模式切换 + 滑块（UI 控件）
6. 摇杆同时注入 density（交互）
7. bakeResidual + 烘焙导出按钮（导出）
8. 类型检查 + 端到端验证
