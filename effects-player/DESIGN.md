# effects-player — 特效播放器库设计文档

> 定位：一个**极简、引擎接入友好、可高频并行**的特效播放器库。
> 输入一个 `.scene.zip` 特效包（编辑器导出），输出"可被游戏反复调用的帧时间线播放实例"。
> 播放器只操作**帧索引与时间**，不操作帧内容；内容侧的位移动画与流体由库内移植的生成器/求解器完成。

---

## 1. 目标与非目标

### 1.1 目标

- 仅支持"导入特效包 → 播放"，不含任何编辑能力。
- 控制三个维度：**播放速度、播放顺序、播放时机**。
- 嵌入游戏后作为特效播放器，**使用极其频繁、并行实例众多**。
- 最终产物为**独立目录 / 独立构建**，与编辑器代码彻底分离，可整体拷入游戏工程。

### 1.2 非目标（明确不做）

- 不编辑帧内容、不编辑包数据。
- 不依赖编辑器代码（React / zustand / Canvas 编辑状态 / 历史栈）。
- 不含制作工具链（区域检测、色块提取、FTX 打包编码等）。

---

## 2. 交付形态

```
effects-player/
  src/
    core/            # 引擎无关纯逻辑（可单测）
      bundle.ts      # 读 zip（readZip）+ gzip 解压 + manifest / 帧 JSON 解析
      ftx.ts         # ftx3 解码（regionIdTex + 调色板 → 颜色纹理数据）
      time.ts        # 时间线状态机：速度 / 顺序 / 时机
      instance.ts    # 播放实例状态
      entity.ts      # RegionEntity 移植（boundary / transform / maskEffect / VAT 位移纹理生成）
    fluid/           # 流体求解器移植（fields + advection/pressure/reinit + manager）
    gl/              # three.js 适配层
      renderer.ts    # 实例 → 渲染提交
      materials.ts   # 共享材质 / uniform 管理
      VATVertexShader.ts
      text.ts        # Canvas 生成文字纹理（注释标签）
    index.ts         # 公共 API
  package.json       # 运行时依赖仅 three（peer dependency）
  tsconfig.json
  vite.config.ts     # lib 模式独立构建 → dist/ 可整体拷贝
```

**移植策略**：从编辑器 `另起的绘画网页/src/` 提取最小解码/生成路径**复制进库**（不是 import 编辑器路径）。所有被移植模块都是纯 TS / three 原生，剥离 React/store/Canvas 引用后即可独立。

---

## 3. 包格式（事实标准，冻结）

导出器 `exportMainCanvasAssetBundle` 产出的 `.scene.zip`（STORE 容器）固定三部分：

| 成员 | 内容 |
|---|---|
| `manifest.json` | 版本、帧序（`frameOrder`）、调色板数、独立注释数、fnv1a32 哈希 |
| `textures/frames.ftx3.gz` | 多帧基础色纹理（RGB565 HSL 量化 + 行差分 + 帧间预测） |
| `per_frame_data/frame_N.json` | 每帧：`regionEntities` + `physics` |
| `annotations.json`（可选） | **纯粹区域注释**（无匹配区域实体），独立存放，不进 per_frame_data |

**播放元数据（fps、每帧时长、播放顺序）不由包携带，一律播放器/调用方在 `play()` 时传入。** 包格式原则上冻结。

### 3.1 唯一的格式扩展：纯粹区域注释（内容扩展）

区域注释目前**不在导出包内**。为支持"区域注释可独立播放"且**独立于帧**（纯注释另有他用），导出器把**纯粹区域注释**单独写入包根目录 `annotations.json`：

```jsonc
// annotations.json（仅当存在纯粹注释时生成）
{
  "version": 1,
  "total": 1,
  "annotations": [
    {
      "id": "str",
      "layerId": "editor内部id",
      "layerName": "图层名",
      "displayId": 2,
      "text": "标签文字",
      "color": "#1890ff",
      "regionId": 3,               // 纯注释区域自身标识
      "polygon": [ [ {x,y}, ... ], ... ],   // 多环：外环 + 内洞
      "maskEffect": { /* transform + distortions，同编辑器结构 */ }
    }
  ]
}
```

**判定标准**：同层区域注释中，`regionId` 未命中任何区域实体 id（`Number(anno.regionId) !== entity.id`）的即"纯粹注释"。命中实体的注释数据（maskEffect/transform）已随 `regionEntities` 导出，不进此文件。

导出器配套改动（编辑器侧，已完成）：

1. `exportMainCanvasAssetBundle` 新增收集纯粹注释 → `annotations.json`；`AssetBundleExportResult` 增加 `annotationCount`。
2. manifest 增加 `annotationCount` / `annotationFile`；`annotations.json` 计入哈希校验。
3. "三样全空才跳过"的判断**不影响注释**——纯注释层的注释照常导出到 `annotations.json`（即使该层不进帧序）；仅当帧与注释**全部为空**才报错。
4. 明确：**未闭合的实线不导出**（本就不在导出数据内，天然满足）。

---

## 4. 播放内容规格（每帧可播内容）

| 内容 | 来源 | 播放方式 |
|---|---|---|
| 区域基础色 | ftx3（regionIdTex + 调色板） | 帧切换，静态底图 |
| 实体位移 | `regionEntities`（boundary + transform + maskEffect） | VAT 顶点动画 |
| 流体 | `physics`（fluidConfig） | 可选连续模拟 |
| 区域注释 | 新增 `regionAnnotations` 字段 | 填充 + 描边 + 文字；有实体匹配则叠加动画 |

**明确不移植 / 不播放**：背景图、画笔像素缓冲、矢量 shapes、未闭合实线、虚线编辑工具、顶点固定、调试覆盖、网格坐标轴、历史撤销栈。

### 4.1 区域注释播放语义

- **填充**：注释 polygon 内部采样基础色纹理填充；无基础色的独立注释用 `annotation.color` 兜底（半透明）。
- **描边**：虚线边框 + 文字标签（`text`）。
- **动画**：maskEffect 即动画源。`buildDisplacementTexture` 不依赖实体——独立注释直接用自身 polygon 生成位移纹理；有实体匹配（regionId）则用实体 boundary。
- **独立可播**：仅注释、无实体/基础色的层也能导出并播放。

---

## 5. 运行时模型（三层职责分离）

### 5.1 Asset（一次性、共享、引用计数）

`load()` 时完成整条链路并冻结为不可变资源：

1. 读 zip（central directory 解析）→ 解 gzip → 解析 manifest / 帧 JSON。
2. 解码 ftx3：regionIdTex + 调色板 → 每帧 HSL 颜色纹理（GPU 上传）。
3. 生成并上传区域实体的 VAT 位移纹理（见 5.4 关键优化）。
4. 解析区域注释数据。
5. 建立 `regionId` ↔ 实体 / 注释 的匹配索引。

实例持有 Asset 引用（引用计数）；`dispose()` 释放全部 GPU 资源。

### 5.2 Instance（轻量、几十字节）

只持：`{ assetRef, localTime, state, frameIndex, uniforms, 位姿(位置/缩放/旋转) }`。**不持任何资源**。

### 5.3 Renderer（每帧驱动）

把实例状态写入共享材质 uniforms / 绑定帧纹理。由游戏主循环调用（显式驱动，不自带定时器）。

### 5.4 关键优化：VAT 位移纹理提升到 Asset 层

位移纹理由 `(boundary 或注释 polygon, maskEffect, 分辨率)` 确定性决定，与实例无关。因此在 **Asset 加载期**对每个实体/注释生成一次、以指纹缓存、引用计数共享；实例只持有 `uTime` 一个 uniform。

> 生成逻辑随库携带（运行时生成的能力在），但执行时机是加载期而非每实例每帧——这是并行高频的根本保障。

---

## 6. 时间线控制（core/time.ts）

纯函数状态机，时间只由引擎显式驱动：`instance.advance(dt)`。

### 6.1 速度

`localTime += dt * speed * direction`；`speed` 负 = 倒放，0 = 冻结。

### 6.2 顺序

`frameIndex = order(t, frameCount)`，纯函数集合：

- `'linear'` — 顺序播放
- `'reverse'` — 倒序
- `'loop'` — 循环
- `'pingpong'` — 往返
- `'sequence'` — 显式帧序数组（调用方指定）
- `'hold(idx)'` — 停在指定帧

### 6.3 时机

状态机 `idle → delay → playing ⇄ paused → done`：

- one-shot / 重复次数（`loop: n`）/ 无限循环
- `delay`（延迟起播）
- 随机起播偏移（并行错峰）
- `onFrame` / `onComplete` 回调

---

## 7. 并行高频的性能设计

1. **Asset/Instance 分离**：N 实例共享一份解码 + 上传后的资源。
2. **热路径零分配**：`advance(dt)` 不建对象、不产生字符串；帧序函数返回纯数字索引。
3. **脏标记**：仅当 `frameIndex` 变化时才写 uniform / 切换帧纹理；同帧连续多次 advance 零 GPU 写入。
4. **帧纹理预分配**：每个 Asset 预建 `frameCount` 张帧纹理，实例只做绑定切换。
5. **批量提交**：同类型特效共享材质；高频场景把 N 实例的 `(frameIndex, time)` 写入一张 `1×N` 参数纹理，一次 draw call 驱动 N 个实例。
6. **预算器**：`createPlayer({ maxConcurrent })`，超预算按策略排队或淘汰最旧实例。
7. **流体 LOD**：流体是唯一每实例动态状态，无法共享 → 实例级分辨率缩放 + 迭代上限，实例多时自动降级；且**惰性创建**（仅帧含 fluidConfig 且调用方开启才实例化求解器）。

---

## 8. 依赖与洁净

- 运行时依赖：**仅 three.js**（peer dependency）。无 React / zustand / DOM 依赖。
- 移植时必须剥净编辑器对 store / React / Canvas 的间接引用；移植后以 tsc 严格模式 + 仅 three peer 依赖验证。

---

## 9. 从编辑器移植清单（精确到模块）

| 编辑器源文件 | 移植内容 | 裁剪 |
|---|---|---|
| `src/assetBundle/zipStore.ts` | `packZip` 反向：**新增 readZip**（central directory 解析）+ `crc32`/`fnv1a32` | 保留 zip 容器逻辑 |
| `src/utils/binaryCompression.ts` | `decompressFromGzip`、`unpackMultiFrameFromBinary`、`invertDelta8` | 只取解码侧，弃编码侧 |
| `src/core/ftxCore.ts` | `unpackRGB565`、`getAdaptiveBlockIndex`、`getRangeForBlock`、`dequantizeH/S/L` | 只取解码原语，弃 quantize/encode |
| `src/core/RegionEntity.ts` | `RegionEntity` 构造 + `boundary`/`transform`/`maskEffect` + `buildDisplacementTexture`/`getDisplacementTexture` | 弃编辑方法（toggleFixedVertex 等） |
| `src/fluid/**` | 求解器移植：fields + advection/pressure/reinit + manager + 材质/着色器 | 弃编辑器 UI / 导入导出 |
| `src/components/MainCanvas.tsx` | VAT 顶点着色器 `VAT_VERTEX_SHADER`、区域实体渲染管线、`renderRegionEntityMesh` 等 | 仅 GL 渲染段 |
| `src/types/index.ts` | `Point`、`RegionAnnotation`（含 maskEffect）、`RegionEntity` 相关类型 | 裁剪编辑器字段 |

**编辑器侧配套改动**（导出器）：

1. `per_frame_data` 增加 `regionAnnotations` 字段（见 3.1）。
2. 跳过条件加入"注释非空"。

---

## 10. 游戏接入契约（API 草案）

```ts
// 加载（进程内共享，一次）
const fx = await EffectsPlayer.load(url /* 或 ArrayBuffer */, {
  resolution: 512,          // VAT / 特效渲染分辨率（编辑器 canvas 尺寸参数化的替代）
});

// 播放（可并行多实例）
const p = fx.play({
  order: 'pingpong',        // 或 { type:'sequence', frames:[2,5,0] }
  speed: 1.2,
  direction: 1,
  loop: true,
  delay: 0,
  randomStartOffset: 0.2,   // 并行错峰
  physics: { enabled: true, lod: 'auto' },
  position, scale, rotation, // 实例位姿
  showAnnotations: true,     // 区域注释 填充+描边+文字
  onComplete,
});

// 游戏主循环驱动（可批量）
p.advance(dt);
manager.renderAll(dt, renderer);   // 或 p.apply(renderer)

// 生命周期
p.pause(); p.resume(); p.stop();
p.dispose();                       // 释放实例引用
fx.dispose();                      // 释放共享资源（引用计数）
```

位移动画帧率 / 基础帧率由调用方传入（默认 30fps），与"包不携带播放元数据"一致。

---

## 11. 实施阶段（各步独立可交付）

1. **bundle.ts**：`readZip` + gzip + manifest / 帧 JSON 解析（对齐 STORE 格式）→ 单测。
2. **ftx.ts**：ftx3 解码移植 + 帧纹理上传 → 与编辑器解码结果**对拍验证**。
3. **time.ts**：时间线状态机（纯逻辑，最大单测覆盖）。
4. **entity.ts + gl/**：VAT 生成 + 渲染（基础纹理帧 + 位移动画）。
5. **regionAnnotations**：注释填充 / 描边 / 文字标签渲染 + 独立注释播放。
6. **fluid/**：求解器移植挂接（LOD + 惰性创建）。
7. **独立构建**：lib 模式打包 + 独立目录落地 + tsc 严格模式 / 仅 three peer 验证。

---

## 12. 风险与待定

- **文字标签**：three.js 内文字渲染（Canvas 生成纹理）有分辨率/缩放限制，需定朝向（屏幕对齐 vs 世界对齐）与字号策略。
- **注释与基础色叠加层级**：注释填充在基础色之上/之下、透明度，需定。
- **VAT 分辨率参数化**：编辑器 canvas 尺寸在游戏里语义为"特效渲染分辨率"，作为 Asset 加载级参数传入。
- **流体体积**：唯一重依赖，靠 LOD + 惰性创建缓解；必要时允许调用方整体关闭。
