# FX 运行时统一设计（FX_RUNTIME_DESIGN）

> 版本：2026-11-08
> 范围：游戏内特效与动画播放层（`全新的游戏`）。**本轮只做设计，不改游戏代码，不动 `src/vendor/player`。**

## 0. 硬约束（先读这一段）

1. **项目内唯一的特效播放器是游戏内的 `src/fx`。** 不存在第二套运行时，不允许"另起炉灶"。
2. **`effects-player/` 目录冻结**：只作为参考实现与数据导出工具，**不参与游戏构建、不被游戏 import、不得再被复制进游戏**（`src/vendor/player` 是历史复制产物，迁移完成后按第 6 节删除）。
3. **一套解码模型**：`.ftx3.gz` 与 `.scene.zip` 本质是同一套东西——同一帧数据，zip 只是在帧数据外附带可选参数块。因此只有**一个解码器、一个资产模型**；禁止按容器划分资产类（不允许 `Asset` / `FtxAsset` 式的并列实现）。
4. `Asset` / `FtxAsset` / `MoonEffect` / `FluidEffect` 等旧类**不是新运行时的替代方案**，它们只能收敛为 `src/fx` 的调用方（迁移期 `legacy/` 适配器）或直接删除。
5. `src/fx/legacy/` 是**临时过渡层**：全部效果迁移完成即删除，不得演变成常驻的第二套实现。

> 结论先行：当前播放层是 **10 套自定义显示 shader + 3 类离屏烘焙路径 + 多个按容器分的资产入口** 的拼接状态；目标是在 `src/fx` 建立**唯一无头运行时**，显示 shader 收敛到 **2 套源码（4~5 个编译变体）**，资产解码/时间轴完全脱离 three/WebGL。

---

## 1. 现状清单（实际代码）

### 1.1 播放/渲染实现

| # | 实现 | 入口 / 关键符号 | 使用 shader / 材质 | 数据格式 | 被谁使用 |
|---|---|---|---|---|---|
| 1 | **FTXQuad 贴片** | `services/render/FTXQuad.ts:134` `class FTXQuad extends FxRendererBase`；材质 `:211` | 1 个自定义 ShaderMaterial：base HSL + residual + fluid + distort + fade + bbox | `FrameAssetSource`（FTX3 或 scene.zip 帧对） | Player/EnemyBase/ItemBase/NpcEntity/VisitorNpc（`EnemyBase.ts:477`、`Player.ts:74`）、EquipmentLayer、VehicleRide、BaseScene、DynamicIconAnimator、DroneCompositeRender |
| 2 | **BulletVisual 离屏合成** | `services/combat/BulletVisual.ts:69`；`makeCompositeMaterial():20` | 1 个自定义 ShaderMaterial + 1 个 `OffscreenBake` RT | 帧对 + 每实例 FluidEffect | `BulletManager.ts:83` 的子弹视觉 |
| 3 | **BulletRenderer 实例化绘制** | `services/render/BulletRenderer.ts:79`，材质 `:99` | 1 个自定义 ShaderMaterial（InstancedMesh 一次 draw） | 采样 #2 烘焙出的 RT | `BulletManager.ts:103` |
| 4 | **DeathAnimEffect** | `services/fx/DeathAnimEffect.ts:82`，材质 `:148` | 1 个自定义 ShaderMaterial（帧对 + 流体 + 淡出） | FTX3 帧对 + fluid | `CharacterFxManager` 死亡动画 |
| 5 | **vendor 网格/VAT 填充 pass** | `vendor/player/gl/renderer.ts:61 makeFillMaterial` | 1 个自定义 ShaderMaterial（逐顶点位移，写不透明遮罩） | `.scene.zip`（mesh + displacement + ftx） | `Asset` → Drone/Visitor/Icon/Moon |
| 6 | **vendor 网格/VAT 上色 pass** | 同上 `:103 makeColorMaterial`，`renderFrameData():296` | 1 个自定义 ShaderMaterial（VAT + 流体/扭曲） | 同上 | 同上 |
| 7 | **Drone RT 采样 blit** | `services/render/DroneCompositeRender.ts:66 class RtSamplerQuad`，材质 `:71` | 1 个自定义 ShaderMaterial（原样输出 RT，避免二次色彩空间） | RT | 无人机图标/合成 |
| 8 | **FtxAsset 单帧合成** | `vendor/player/FtxAsset.ts:118 static createCompositeMaterial()` | 1 个自定义 ShaderMaterial（HSL + residual） | `.ftx3.gz` 单帧 | 仅 `GachaOverlay.ts:1138` |
| 9 | **植被 VAT** | `services/map/decor/MapEntityDecorBase.ts:1079 getPlantMaterial()`；VAT 取样 `:1138`；`DataArrayTexture` `:939` | 1 个自定义 ShaderMaterial（实例化十字面片 + 帧数组 + 风场 VAT + dither LOD） | `.ftx3.gz` → `DataArrayTexture` | 所有草/花/树（`buildPropLayer:427`） |
| 10 | **流体合成显示** | `vendor/player/fluid/FluidSolver.ts` composite（`:1227/:1295`）+ `FluidEffect.ts:24` 包装 | 1 个显示 ShaderMaterial（求解器内部另有 ~6-8 个计算 source） | 帧 + physics + region entities | BulletVisual、DynamicIconAnimator、DeathAnimEffect、CharacterHitDye |
| 11 | **命中形状** | `vendor/player/hitEffect/HitEffectView.ts:72` | **无自定义 shader**：CPU Canvas 逐帧烘焙 + `MeshBasicMaterial` | `.scene.zip` 的 hitEffects 形状 | `main.ts` `attachHitEffect` |
| 12 | **几何爆炸** | `services/fx/ExplosionFx.ts:22` | **无自定义 shader**：`InstancedMesh` + `MeshBasicMaterial` | 纯程序化 | `CombatSystem` 爆炸回调 |
| 13 | **访客/掩体/舰船专用网格** | `VisitorModelRenderer.ts:356`、`VisitorBodyRenderer.ts:93`、`CoverRenderer.ts:91`、`ShipRenderer.ts:25`，均 `extends FxRendererBase` | 复用 #5/#6 的 vendor 材质或内置材质 | `.scene.zip` / 纹理 | 访客、掩体、舰船 |

**结论：显示侧当前有 10 套自定义 shader 源码**（#1-#10），其中 #1/#2/#4/#7/#8 是同一件事（"帧纹理合成到屏幕"）的五次重写；#5/#6 是同一件事的两 pass；#9 是它们的一个性能特化；#10 是流体显示。

### 1.2 资产入口与真实耦合

- **历史遗留的按容器划分的资产入口（迁移期对象，非目标形态）**：`vendor/player/index.ts:42 class Asset implements CharacterFxAssetSource`（scene.zip，`load():161`）与 `FtxAsset.ts:24`（FTX3）。二者读的是同一套帧数据、只是参数块有无不同，却各写一份加载/上传逻辑——这是要按 4.1 收敛掉的重复，不是要保留的分工。
- **"无头"只是命名**：`Asset` 构造时（`index.ts:68-141`）直接 `decodeMultiFrame` → `buildFrameTexture` → 创建 `THREE.DataTexture` → `buildEntityMesh` → `buildDisplacementTextureData`，解码、上传、几何装配全在一个构造函数里。`FtxAsset.load()` 同样在加载阶段创建 `DataTexture`。
- **解码本身已是纯数据**：`vendor/player/core/ftx.ts:22 decodeMultiFrame`、`:139 buildBaseHslData`、`:176 buildResidualData` 都不碰 three；只有 `:238 buildFrameTexture` 碰。这说明"拆出无头解码层"成本很低。
- **帧控制器**：`core/controller.ts` + `core/time.ts` 是纯时间轴（无 three）；`FrameAnimatorBase` 在游戏侧做 LOD 节流。
- **流体绑定在资产类里**：`Asset.getFluidEffect():312`、`createDeathFluid():334`、`createHitDyeFluid():380` 直接把 solver 与帧数据绑死；流体生命周期、reset、共享实例（`services/fx/FluidShared.ts`）散落在各消费方。
- **重复的色彩转换**：GPU 在 #1/#8 各自实现 HSL→RGB；CPU 在 `BasicMaterialsIcons.ts:26` 又实现一份"与 createCompositeMaterial 相同"的转换。

### 1.3 vendor/player 的死代码判定

`src/vendor/player` 共 **26 个 TS 文件 / 5,945 行**，逐个核对 import 后：**当前没有整文件死代码**。
- `index.ts(Asset)`、`gl/renderer.ts`、`fluid/*`、`hitEffect/*`、`core/*` 都有游戏侧或内部消费者（`FtxAsset` 被 8 个服务 import；`Asset/renderFrameData` 被 Drone/Visitor/Gacha/Moon 使用）。
- 仅 `FtxAsset.createCompositeMaterial()` 只剩 `GachaOverlay` 一个消费者；`core/time.ts` 只被 `controller.ts` 使用。
- `effects-player` 侧未拷入游戏的 `core/ftxAsset.ts`、`gl/ftxRenderer.ts` 不在本次范围：该目录已冻结，不做清理。

---

## 2. 目标形态：`src/fx` 唯一无头运行时

### 2.1 分层（硬边界）

```
src/fx/
  core/      纯 TS：资产解码 + 时间轴 + 效果描述       ← 禁止 import 'three'
  assets/    包识别 / 缓存 / 路径映射 / 校验            ← 只依赖 core
  gpu/       CPU 数据 → DataTexture / Geometry          ← 唯一允许 new DataTexture 的地方
  render/    2 套 shader + 通道提交 + 批处理            ← 依赖 gpu + core
  fluid/     流体求解器（先适配 vendor，后迁入）         ← 依赖 gpu
  runtime/   FxRuntime 门面（spawn/update/render/dispose）
  legacy/    迁移期适配器（临时过渡，全部效果迁移完成即整体删除）← 只允许包住旧实现，不允许新增能力
```

- **解码层**只产出 `FxAsset`（CPU 数组 + 描述），可在 Node / Worker / 测试里跑；不允许出现 `THREE.*`。
- **采样层**只回答"时刻 t 的 `FxSample`"：帧索引、帧时间、透明度、扭曲参数、事件（命中帧/循环点）。LOD 节流策略由调用方注入（`lodThrottle`），不在播放器里写死。
- **渲染层**只认 `FxChannel` + `FxSample` + GPU 纹理句柄；不认识 FTX/scene/plant/moon 等业务名词。
- 用 `arch-guard.mjs` 增加一条硬规则：`src/fx/core/**` 与 `src/fx/assets/**` 不得 import `three`；否则守卫失败。

### 2.2 渲染通道与 shader 预算

目标：**2 套 shader 源码**，编译期变体 4 个（quad-direct / quad-instanced / quad-raw / vat），加上 1 个 foliage 变体（同一 vat 源码的 `#define`）。

| Shader 源码 | 职责 | 覆盖现状 |
|---|---|---|
| `fx.quad` | 屏幕对齐/实例化四边形：采样 base HSL + residual、流体纹理、扭曲、淡出、bbox 裁切；`uMode=raw` 时直出 RT | #1 FTXQuad、#2 BulletVisual 合成、#3 BulletRenderer 实例化、#4 DeathAnim、#7 Drone blit、#8 FtxAsset 合成、#11 CPU 烘焙帧、#12 图标/抽卡 |
| `fx.vat` | 网格与实例化顶点动画：逐顶点位移纹理、帧纹理数组或帧对、`uPass` 区分遮罩/上色、模板裁剪 | #5/#6 vendor 网格、#9 植被（`#define FOLIAGE` 风场 + dither LOD）、#13 访客/掩体/舰船网格 |

**为什么不能再少：**

1. quad 与 vat 的顶点阶段本质不同：quad 不读顶点纹理、可实例化批量；vat 必须逐顶点读位移纹理并需要 stencil 两 pass。合并成一个程序会让所有贴片都付出顶点纹理采样 + stencil 状态，破坏当前"贴片 1 draw/材质共享"的性能结构。
2. quad 内部必须保留 `uMode` 分支（合成 / raw blit / 实例化），但它们是同一段 fragment 代码，属于"一个源码多 define"，不增加维护面。
3. 流体的 **计算 pass**（advection/pressure/levelset 等 ~6-8 个）不是"播放 shader"，不纳入收敛目标；显示侧只通过 `uFluidTex` 复用 quad/vat，不再新增显示程序。

几何类效果（爆炸、命中形状）**不新增 shader**：爆炸作为 `geo` 通道由 `FxRuntime` 统一调度（几何+内置材质，t 驱动，不引入自定义程序）；命中形状在 `core` 里烘焙为帧序列后走 quad。

---

## 3. 统一模型

### 3.1 概念映射

| 效果 | 资产形态（同一帧数据 + 可选参数块） | 是否帧序列 | 运行时通道 |
|---|---|---|---|
| 角色/敌人/物品/载具贴片 | 帧数据（无参数块） | 是 | `quad` |
| 访客/无人机/舰船/掩体 | 帧数据 + 参数块（mesh/VAT） | 是 | `vat` |
| 月亮 | 帧数据 + 参数块（mesh/VAT + annotations） | 是 | `vat`（离屏 RT 输出） |
| 花草树 | 帧数据 + 十字面片几何（几何由代码生成，非参数块） | 是 | `vat`（FOLIAGE） |
| 敌方箭矢/法球 | 程序化帧（CPU 生成） | 是（合成后） | `quad` |
| 命中特写 | 帧数据 + 参数块（hitShapes） | 是（CPU 烘焙） | `quad` |
| 爆炸 | 程序化几何参数 | 否（t 驱动） | `geo`（内置材质） |
| 受击染色/死亡流体 | 帧数据 + 参数块（fluid 配置） | 是 + 流体 | `quad` + `FluidSim` |

### 3.2 主要接口（签名草案）

```ts
// src/fx/core/types.ts —— 纯数据，不 import three
export type FxChannel = 'quad' | 'vat' | 'geo';

// 一套解码模型：帧数据恒存在，参数块可选（zip 只是多带参数，不是另一种格式）
export interface FxAsset {
  readonly id: string;                 // 内容哈希（缓存键）
  readonly resolution: number;
  readonly palette: Rgb01[];           // 解码后的调色板
  readonly frames: FxFrame[];          // 0..n-1（两个容器解出的结构完全相同）
  readonly params?: FxParams;          // 可选参数块
}

export interface FxParams {
  readonly geometry?: FxGeometry;      // vat 才有
  readonly clips?: Record<string, FxClip>; // 'idle'|'hit'|'death'|...
  readonly fluid?: FxFluidSpec;        // 逐帧 physics/区域实体
  readonly hitShapes?: FxHitShape[];   // 命中形状（纯数据）
  readonly annotations?: FxAnnotation[];
}

export interface FxFrame {
  readonly name: string;
  readonly bbox: { x: number; y: number; w: number; h: number };
  readonly baseHsl: Raster;            // Uint8/Float32，w*h*4（HSLA）
  readonly residual: Raster;           // Uint8 w*h*4（RGBA 中性 128）
  readonly regionId?: Uint8Array;
  readonly physics?: FxFluidPhysics;
  readonly duration?: number;
}

export interface FxGeometry {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly displacement?: Raster;      // VAT：每帧每顶点位移
  readonly frameCount: number;
}

export interface FxClip { name: string; from: number; to: number; fps: number; loop: boolean; events?: FxEvent[]; }

export interface FxSample {
  readonly clip: string;
  readonly frameIndex: number;
  readonly frameTime: number;          // 0..1 帧内插值
  readonly frameFraction: number;
  readonly elapsed: number;
  readonly alpha: number;
  readonly distort?: FxDistortParams;
  readonly transform?: FxFrameTransform; // offset/scale/rotation（命中形状用）
}

export interface FxPlayerOptions {
  clip?: string; loop?: boolean; speed?: number;
  lod?: 0 | 1 | 2; lodThrottle?: boolean;
  onEvent?: (e: FxEvent) => void;
}

export class FxPlayer {                // 可在 Node 跑；无 three
  constructor(asset: FxAsset, opts?: FxPlayerOptions);
  update(dt: number): FxSample;
  play(clip: string, opts?: { restart?: boolean; loop?: boolean }): void;
  seek(frame: number | string): void;
  readonly finished: boolean;
  dispose(): void;
}
```

```ts
// src/fx/gpu —— 唯一接触 DataTexture 的层
export interface FxGpuFrame { base: DataTexture; residual: DataTexture; region?: DataTexture; }
export interface FxGpuAsset {
  readonly asset: FxAsset;
  readonly frames: FxGpuFrame[];
  readonly geometry?: FxMesh;          // BufferGeometry + 位移纹理
  readonly atlas?: DataArrayTexture;   // foliage / 帧数组
}
export class FxGpuCache {
  get(asset: FxAsset): FxGpuAsset;
  release(id: string): void;
  dispose(): void;
}
```

```ts
// src/fx/render —— 只认通道，不认业务
export type FxPlacement = 'billboardYaw' | 'billboardScreen' | 'world';

export interface FxInstanceSpec {
  asset: FxAsset;
  channel: FxChannel;
  clip?: string; loop?: boolean; speed?: number;
  placement: FxPlacement;
  transform: FxTransform;              // 世界位置/缩放/锚点
  tint?: Rgb01; fade?: number;
  fluid?: FluidHandle;                 // 逐实例流体（可选）
  overrides?: Partial<FxUniforms>;     // 扭曲/透明等，不新增 shader
}

export interface FxDrawItem {
  readonly gpu: FxGpuAsset;
  readonly sample: FxSample;
  readonly world: Matrix4;
  readonly textures: { base: Texture; residual: Texture; fluid?: Texture; vat?: Texture };
  readonly params: FxUniforms;         // alpha/distort/bbox/frame/flags
  readonly pass: 'fill' | 'color';
}

export interface FxRenderBatch {
  readonly channel: FxChannel;
  readonly program: 'fx.quad' | 'fx.vat';
  readonly variant: 'direct' | 'instanced' | 'raw' | 'mesh' | 'foliage';
  readonly items: FxDrawItem[];
}

export class FxRuntime {
  constructor(renderer: WebGLRenderer, scene: Scene, opts: FxRuntimeOptions);
  register(asset: FxAsset): FxGpuAsset;
  spawn(spec: FxInstanceSpec): FxHandle;      // 返回 update/dispose/kill
  update(dt: number, view: FxView): void;     // 只推进 sample，不 draw
  render(view: FxView): void;                 // 按通道批处理提交
  dispose(): void;
}
```

```ts
// src/fx/fluid —— 求解器保持独立；显示走 quad/vat 的 uFluidTex
export interface FluidHandle {
  readonly display: Texture;
  step(dt: number): void;
  reset(frame: FxFrame): void;
  dispose(): void;
}
export interface FxFluidSpec { physics: FxFluidPhysics; regions: FxRegionEntity[]; fps: number; }
```

**统一的关键**：`FxAsset` 是唯一资产类型，`FxSample` 是唯一时间输出，`FxDrawItem` 是唯一渲染输入；四类效果只差"有没有 geometry / 有没有 fluid / 是不是程序化生成帧"，不再各有各的类与 shader。

---

## 4. 资产与编辑器边界

### 4.1 一套解码模型：同一帧数据 + 可选参数块

`.ftx3.gz` 与 `.scene.zip` **不是两种格式，而是同一套东西的两种落盘形态**：前者只带帧数据；后者在同一份帧数据之外多带一个可选参数块（mesh/VAT、annotations、hitShapes、per-frame physics 配置）。因此解码侧只能有一套模型：

- **一个解码器 `FxPackageReader`**：先定位帧数据（裸 `.ftx3` 或包内 `ftx3.gz`，字节结构相同），再尝试读取可选参数块（`manifest.json` / `per_frame_data/*.json` / mesh / annotations）。读不到 → 参数块缺省；读得到 → 挂到同一个 `FxAsset.params` 上。**不允许按容器走两条解码分支。**
- **一个资产模型 `FxAsset`**：`frames` 恒为同一结构，`params` 可选。播放侧只判断"有没有 geometry / fluid / hitShapes"，不认识容器名、路径后缀或 zip 条目。
- **禁止出现按容器划分的资产类**：`Asset` / `FtxAsset` 这类并列类要么收敛成 `FxAsset` 的调用方（迁移期 `legacy/` 适配器），要么删除；不得新增任何"XXAsset"变体。
- **不重导资源**：字节格式与路径保持不变（`.ftx3.gz` / `.scene.zip` URL 原样复用）；统一发生在解码后的数据模型，而不是改字节容器。

### 4.2 现有资源零重导

- 路径与文件名保持不变；`main.ts` 里的 `.scene.zip` / `.ftx3.gz` URL 原样复用。
- 只在需要时增加**可选** `fx.json` sidecar（clip 名称/循环点/事件帧）；缺省从 `PerFrameData.name` 与 annotations 推导，缺失也能播。
- 资源哈希校验沿用 `LoadOptions.verifyHashes`；解码产物按内容哈希缓存，避免重复解码。

### 4.3 `effects-player`：冻结为参考与数据导出

- **游戏内唯一的特效播放器就是 `src/fx`**，没有第二套运行时；任何新播放逻辑只能加进 `src/fx`。
- `effects-player/` 目录**冻结**：只作为参考实现与数据导出工具（编辑器侧产出 `.ftx3.gz` / `.scene.zip`），**不参与游戏构建、不被 `全新的游戏` import、不得再被复制进游戏**。
- `src/vendor/player` 是历史上从 effects-player 复制进来的一份代码副本，属于被收敛对象：迁移完成后整体删除（见第 6 节），不得以"参考实现"为名留在构建里。
- 游戏不再从 effects-player 同步代码；后续行为差异只允许 `src/fx` 单向吸收（对照参考实现验证一致性，而不是复制其实现）。

---

## 5. 迁移路径（适配器 → 逐效果切换）

### 阶段 0：基线固化（不改运行时）

- 对 21 套角色 + 47 个特效资产做**解码哈希**（帧数、bbox、palette、残差直方图）。
- 对 8 类代表性效果做**像素基线**（固定相机/固定 dt/固定随机种子）：爆炸、月亮、箭矢、命中、角色贴片、植被、受击染色、死亡流体。
- 记录当前 draw call / GPU 时间 / 实例数。

### 阶段 1：无头 core + FxPlayer

- 把 `vendor/player/core/{ftx,bundle,types,controller,time,frameResolver}` 的纯逻辑迁入 `src/fx/core`，`buildFrameTexture` 拆成"CPU Raster → gpu 层上传"。
- 用 `FxPlayer` 替换 `FramePlaybackController`；用 10,000 组 dt 序列做帧索引/事件 parity。
- 回退：适配器 `LegacyPlayerAdapter` 继续调用旧 controller，按效果开关切换。

### 阶段 2：quad 通道

- `fx.quad` 覆盖 #1 FTXQuad / #2 BulletVisual / #3 BulletRenderer / #4 DeathAnim / #7 Blit / #8 FtxAsset 合成 / #11 CPU 烘焙帧。
- 先做"direct" 变体（角色/敌人/物品），再做 instanced/raw（子弹、无人机 RT）。

### 阶段 3：vat 通道

- `fx.vat` 覆盖 #5/#6 vendor 网格与 #13 访客/掩体/舰船；`uPass` 承担 fill/color，模板状态由渲染层统一管理。
- 风险点：stencil 与深度顺序、离屏 RT 尺寸（bbox）、sRGB 输出（Drone 的 RtSamplerQuad 教训）。

### 阶段 4：foliage 变体

- 把 `getPlantMaterial` 的实例矩阵 + DataArrayTexture + 风场 VAT + dither LOD 搬进 `fx.vat #define FOLIAGE`；保留分块实例与纹理共享。
- 风险点：chunk 生命周期/dispose、纹理数组显存、LOD 切换阈值。

### 阶段 5：流体接入（最后）

- **先包后用**：`FluidHandle` 适配现有 `vendor/player/fluid`，一行不改求解器；`fx.quad` 只接 `uFluidTex`。
- 再逐个切 `CharacterHitDye`、`DeathAnimEffect`、`BulletVisual`、`DynamicIconAnimator`。
- 风险点：per-frame 固定步长（BulletVisual 1/30s）、共享 vs 独立实例、`reset()` 时机、区域 mask 与 levelset 顺序。

### 效果切换顺序与回退

| 顺序 | 效果 | 风险 | 回退方式 |
|---|---|---|---|
| 1 | 爆炸（`ExplosionFx`） | 低：纯几何、无资产、无流体；混合顺序/实例化批次 | 保留旧类，开关切回 |
| 2 | 月亮（`MoonEffect`） | 低-中：单实例 + scene.zip VAT + 离屏 RT；天空合成/尺寸 | `MoonEffect` 原样保留，开关切回 |
| 3 | 命中特写（`HitEffectView`） | 中低：CPU 形状烘焙与变体种子，视觉差异 | 旧 Canvas 烘焙路径保留 |
| 4 | 图标/抽卡（FtxAsset 合成、DynamicIconAnimator） | 中：UI 可见面广，但无战斗时序 | 旧材质/烘焙 |
| 5 | 子弹（BulletVisual + BulletRenderer） | 中高：高频 spawn、共享流体、实例化批次 | 旧两段式渲染 |
| 6 | 角色/敌人/物品/载具贴片（FTXQuad） | 高：数量最大，LOD/渐隐/深度/流体共享 | FTXQuad 保留，按实体类型灰度 |
| 7 | 植被（plant VAT） | 高：性能与 chunk 生命周期 | 旧 `getPlantMaterial` 保留 |
| 8 | 受击染色/死亡（FluidEffect + DeathAnim） | 最高：求解器状态、reset、共享实例 | 旧 `FluidEffect` 保留，最后切换 |

统一灰度：`FxRuntime` 维护 `legacyFor(effectKind)` 注册表；每个消费方只改一行"取渲染器"，不做双实现并存。

### `legacy/` 的退出条件（必须可判定）

`src/fx/legacy/` 只是临时过渡，不是第二套运行时：

1. 第 1~8 项效果全部切到 `src/fx` 原生通道，且每项在灰度开关的 legacy 分支上连续运行 1 周无回退事故；
2. 旧实现文件按第 6 节删除，`src/fx/legacy/` 不再有任何被 `runtime/` 或游戏侧 import 的符号；
3. `arch-guard` 增加硬规则：`src/fx/legacy/**` 一旦被 `src/fx` 之外（游戏业务代码）import 即失败；迁移完成后该目录整体删除，守卫规则同步移除。

未满足以上三条前，`legacy/` 只能新增"包住旧实现"的适配器，禁止在其中实现新效果或复制 shader。

---

## 6. 可删除清单（全部切换完成后）

**vendor/player（26 文件，5,945 行）全部可删**，因为它的每个入口都会被 `src/fx` 取代：
- 解码：`core/{ftx,bundle,types,entity,mask}.ts`、`frameResolver.ts`、`controller.ts`、`time.ts`
- 渲染：`gl/renderer.ts`、`index.ts(Asset)`、`FtxAsset.ts`、`MoonEffect.ts`
- 命中：`hitEffect/{HitEffectView,variantGenerator,types}.ts`
- 流体：`fluid/FluidSolver.ts`、`fluid/solvers/*`、`fluid/core/*`、`fluid/{FluidEffect,rasterize,regionWallMask,config}.ts`

**游戏侧旧实现**：
- `services/render/FTXQuad.ts`、`FxRendererBase.ts`（容器职责拆入 `FxInstance`/`FxRuntime`）
- `services/combat/BulletVisual.ts`、`services/render/BulletRenderer.ts`（并入 `quad` 通道与实例化批次）
- `services/fx/DeathAnimEffect.ts`、`services/fx/ExplosionFx.ts`（改为 `FxInstance` / 程序化 spec）
- `services/render/DroneCompositeRender.ts` 的 `RtSamplerQuad`（并入 `quad raw` 变体）
- `MapEntityDecorBase.ts` 的 `getPlantMaterial/getPlantTexture/SHARED_PLANT_MAT`（保留 props 规划/placement，渲染搬入 `fx.vat`）
- `services/fx/FtxAssetCache.ts` → `src/fx/assets/FxAssetCache`
- `services/fx/FluidShared.ts` → `src/fx/fluid` 的共享调度

**保留但改职责**：`VisitorModelRenderer`/`VisitorBodyRenderer`/`CoverRenderer`/`ShipRenderer` 只保留业务姿态，绘制改 `FxInstance`；`BasicMaterialsIcons` 的 CPU HSL 转换改为共享 `core/color.ts`。

**当前即可删（与迁移无关，仅限游戏内）**：无。`effects-player` 已冻结，其内部死文件不在本次清理范围（属于参考目录，不做改动）。

---

## 7. 明确不做

- 不重构地形（`ChunkManager`/`MapEntityDecorBase` 的地形/装饰规划部分只保留调用点）。
- 不重构角色骨骼/物理（`CharacterBase`、`stickman-lab-v2` 不动）。
- 不重构 AI / 蜂群 / 战斗判定。
- 不改编辑器 UI 与导出流程；不重导现有资源。
- 不重写流体算法；阶段 5 只做生命周期与通道接入。

---

## 8. 验收标准

1. **无头**：`node` 环境可完成 68 个资产的解码 + 10,000 组 dt 的 `FxPlayer.update`，结果与基线逐帧一致；`src/fx/core` 无 `three` import（arch-guard 硬校验）。
2. **像素**：每类效果固定场景截图，平均通道差 ≤ 1%，最大差 ≤ 3/255；月亮/流体允许单独白名单但需记录差异。
3. **shader 收敛**：显示侧自定义程序源码从 10 套降到 2 套；编译变体 ≤ 5；不得新增流体显示程序。
4. **性能不回退**：draw call ≤ 现状；GPU 时间 ≤ +10%；植被/子弹实例数不变。
5. **唯一运行时**：游戏构建产物中不存在 `src/fx` 之外的播放器（`src/vendor/player` 从构建中消失；`effects-player` 目录不被 import、不进 `dist`；不存在第三套播放路径）。
6. **单资产模型**：全仓只有 `FxAsset` 一种资产类型，`Asset` / `FtxAsset` 不再作为并列类型存在；解码侧只有一个 `FxPackageReader`。
7. **legacy 退场**：`src/fx/legacy/` 全部删除，`arch-guard` 中不再需要 legacy 白名单。
