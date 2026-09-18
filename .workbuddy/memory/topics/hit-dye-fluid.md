# 专题：受击染料流体（hit-dye）

> 从 `MEMORY.md` 拆出。涉及 `CharacterBase` / `FtxAsset` / `Asset` / `FluidSolver` / `FluidInjector` / `FTXQuad`。
> 最后更新 2026-09-18（本轮：持续注入 + 真晕开 + 限速 50）。

## ★★ 第一铁律：先确认实体走哪套资产

同一个 `createHitDyeEffect` **有两个完全不同的实现**，两个类都 `implements CharacterFxAssetSource`：

| 加载方式 | 谁在用 | 实现在哪 | 模式 | 关键参数 |
|---|---|---|---|---|
| `FtxAsset.load('.ftx3.gz')` | **主角**、**普通敌人** | `vendor/player/FtxAsset.ts` | `vector` | `velocityScale 0.97` / `maxVel 50` / `pressure ON(20)` / **无衰减** |
| `Asset.load('.scene.zip')` | **BOSS 普瑞赛斯**、无人机、祖宗、抽卡立绘、子弹/击中特效 | `vendor/player/index.ts`（`class Asset`） | **`scalar`** | **`decayRate 0.0588/步`** / `velocityScale 2` / `maxVel 50` / `viscosity 1000` / `pressure OFF` |

- 判据：`main.ts` 里该资产用哪种 `load()`（`FtxAsset.load('...ftx3.gz')` → FtxAsset 版）。
- ★ 踩坑记录（2026-09-18）：只读了 `FtxAsset` 版就断言"降频只省算、不影响观感"，漏了 `Asset` 版 ⇒ 结论被用户当场纠正。
  **改这类共享效果前，先 grep 所有同名实现 + 确认实例来源。**
- ★ 谁走哪条（grep 实证）：`main.ts` —— 主角 `维维美.ftx3.gz`、普通敌人 `enemyAssetUrl()` ⇒ **FtxAsset**；
  `普瑞赛斯.scene.zip`、`可露希尔的无人机.scene.zip`、`祖宗.scene.zip`、`主角子弹击中特效.scene.zip`、
  `GachaOverlay` 立绘 ⇒ **Asset(scalar)**。

## ★★ 持续注入（2026-09-18 用户定调："应该在注入点持续注入，注入量大才清楚"）

**为什么"量大"只能靠持续注入、不能靠调数字**（两条硬约束，都在 `FluidInjector.ts`）：

- `injectDensity`：`value` 与 `rate` **都被 clamp 到 ≤1.0**（`:417/459`）⇒ `density = 1.0` 已是**天花板**。
- `injectColor`：`mixed = mix(current, uTargetColor, rate)`，`rate` 同样 clamp ≤1.0（`:272/332`）
  ⇒ **重注入是"覆盖"不是"叠加"**。

**做法**：`CharacterBase` 缓存 `hitDyeAt` / `hitDyeVel` / `hitDyeActive`，
`updateHitDye` 在**每个解算步先 `queueHitDyeInjection()` 再 `step()`**。

- ★ 队列安全性：`step()` 开头 `processInjectionQueue()`、处理完立刻 `injectionQueue.length = 0`
  （`FluidSolver.ts:1020` / `:647`）⇒ **每步重塞不会累积**（同一帧塞两次才会叠加）。
- ★ 效果**按路径分**：
  | 路径 | 一次性注入 | 持续注入 |
  |---|---|---|
  | `scalar` | 注入后每步 ×0.9412 ⇒ 1s 后剩 **15.7%** | 每步钉回 1.0 ⇒ 渲染值 ≈**0.94**，**全程满强度** |
  | `vector` | 无衰减 ⇒ 静态印章 | 重注入**幂等** ⇒ 只加持续注入**零变化** |

  ⇒ **vector 路径要"看得见"必须有注入速度**（见下），不能只加持续注入。

## ★★ 真晕开（vector 路径）：注入速度 + 恢复压力投影 + 限速 50

- `FtxAsset` 新增 `readonly hitDyeSpreadSpeed = 40`（px/s）；`CharacterBase` 通过结构类型读
  `source.hitDyeSpreadSpeed ?? 0`。**`Asset`(scalar) 不声明 ⇒ 那条路径速度恒 {0,0}**（保持它自己的浓度扩散）。
- 方向 = **贴片中心 → 命中点**（"朝受击那一侧溅开"）；命中点正中时用随机方向（防零向量）。
- ★ `injectVelocity` 是**累加**（`FluidInjector.ts:532` `current + added`，不乘 dt）
  ⇒ 每步持续注入速度会让流速**顶到 `maxVelocity` 并保持** = 稳定水流 ⇒ 染料被水从注入点带走 = 晕开。
- ★ `enablePressure` **必须为 true**（有速度才有散度）；代价 20 迭代 × 2 = 40 趟/step，由 1/30 降频抵消。
- ★ `velocityScale` 0.85 → **0.97**：0.85/步 @30 步/s 一秒只剩 0.76%，染料一注入就被刹住，看不到晕开。
- ★ `maxVelocity` 3000 → **50**（与 scalar 对齐）。副作用（正向）：子步数 `ceil(maxVel·dt/minGrid)`
  恒为 1 ⇒ 降频不会换来额外平流子步。

## ★★ scalar 路径关掉压力投影（净省预算，2026-09-18）

`Asset.createHitDyeEffect` 的 `enablePressure` **true → false**。依据与 vector 当初的推理完全同源：
该路径**不注入速度**（不声明 `hitDyeSpreadSpeed` ⇒ `hitDyeVel = {0,0}`）+ `gravity {0,0}` + 无持续源/爆炸
⇒ 速度场自 `initFields()` 清零后**恒为 0** ⇒ ∇·u ≡ 0 ⇒ 解 ∇²p = 0（Neumann）得 p ≡ 0
⇒ 「100 迭代 × 红黑两趟 = **200 趟/step**」全是恒等变换（纯白烧）。

⇒ 关掉后视觉零影响，**省下的预算 > vector 路径恢复压力投影的代价（40 趟/step）**，两边合起来仍是净省。
⚠ 若将来给这条路径也加注入速度，必须改回 `true`。

## ★★ 注入位置换算（`CharacterBase.hitUvOf`）

必须用 **`mesh.worldToLocal()`**，它一次处理三件事：

1. **位置** —— `mesh.position` 已是贴片中心（`FTXQuad.setPosition` 自动抬半高 − `groundSink`）；
2. **镜像** —— `FxRendererBase.applyFlip` 把 scale 取负 ⇒ worldToLocal 自动带符号（不必手乘 ±1）；
3. **竖牌朝向** —— `setBillboard` 每帧把贴片绕 Y 轴转向相机 ⇒ **世界 x 轴 ≠ 贴片局部 x 轴**；
   相机不在 +Z 轴上时（第三人称绕圈几乎总是如此），只用 `point.x − center.x` 会**横向偏移**。

几何是 `PlaneGeometry(1,1)` ⇒ 局部 ∈ [−0.5, 0.5] ⇒ **`u = 0.5 + local.x`、`v = 0.5 − local.y`**。
★ 这个 `(u,v)` **正好等于 `FTXQuad` 的 `texUV`**（`setFrameMapping` 传 `frameSize=bbox, bbox.xy=0` ⇒ `texUV = vec2(vUv.x, 1−vUv.y)`，
而 `uv = local + 0.5`），也就是采样流体纹理用的同一个坐标 ⇒ 无需再折算。
★ 夹取 [0.12,0.88] × [0.08,0.85]：命中点常在体外（挥击中心/远处射手）⇒ 落到"身体近侧边缘"。

## ★★ 竖直命中高度：`EntityBase.hitAnchorY()`

- 基类默认 `position.y + 1.0`（≈1.7m 人体的胸口）。
- **`CharacterBase` 覆写为贴片高度的 65%** = `mesh.position.y + 0.15 × |mesh.scale.y|`。
- ★★ **别再写死 `position.y + 1.0`**：3.67m 的敌人算出来 v≈0.73（**大腿**），4.8m 的 BOSS 更低
  ⇒ 染料/命中特效明显偏低。
- 调用点：`Attack.ts`（近战/AoE）、`WorldSpawner.ts`（代理近战 ×2）、`WorldMode.ts`（遗物法术 proc）。
- ★ `systems/ai/behaviors.ts` 的 `position.y + 1.0` **不用改**：那是 `meleeSwing` 的 `opts.y`，
  `Attack.ts:67` 只拿它做**同层过滤** `|t.position.y − opts.y| > 2`，**不进 hitPoint**。

## ★ 其他事实

- 贴片合成（`FTXQuad` 105–119）：`uUseFluid > 0.5` 时 `gl_FragColor = vec4(fluid.rgb, fa); return;`
  ⇒ **整张贴片被流体纹理替换，不是叠加**（想"叠一层红/发光"必须改 shader）。
- `uFluidClip > 0.5` 可把流体 alpha 裁到 base 轮廓（魂体模式用；受击染料默认关，为的是能溢出体外）。
- 残差空间语义：注入值写进 `colorGrid` = `uResidual`，**0.5 = 不变**。
  合成 `finalH = fract(baseH + (r−0.5))`、`finalS/L = clamp(baseS/L + (s/l−0.5))`、`finalA = max(base.a, a)`。
  ⇒ `h=0` 是**色相 −180°**（补色），不是"红"。用户 2026-09-18 定调：**不追求红，只要"受击处最大对比"**
  ⇒ `[0.0, 1.0, 0.8, 0.4]`。
- ★★ **`residual.a` 只削"溢出体外的色雾"，不动身上染色**（免费杠杆）：`buildBaseHslData` 体内 `a=1`/体外 `a=0`
  ⇒ `finalA = max(base.a, residual.a)` ⇒ 体内恒 1、体外 = residual.a。
- **`scalar` 路径的 `hitDyeColor` 与 `rate` 完全被忽略** —— `processInjectionQueue` 在 scalar 走
  `injectDensity(densityGrid, inj.density, 1.0, opts)`（rate 硬编码 1.0，color 不读）。
  真正旋钮：`density` + `scalarConfig.{h,s,l,a}Multiplier` + `decayRate` + `radius`。
  合成 = `combineMode 'sub'` ⇒ `offL = −abs(factor×0.8)` ⇒ **整块变近黑，再被 `decayRate` 缓慢消化**。
- ★★ **`decayRate` 是"每步"的 ⇒ 降频直接改变 scalar 路径观感**（用户是对的）：
  `keep = 1 − 0.0588 = 0.9412`

  | 频率 | 1.0s 后残留 | 1.2s 后残留 |
  |---|---|---|
  | 60 步/s | `0.9412^60` = **2.5%** | 1.3% |
  | 30 步/s | `0.9412^30` = **15.7%** | 10.5% |

  ⇒ **30/s 比 60/s 亮 6.4 倍**。★ 但这条**只对 scalar 成立**；vector 路径无衰减 ⇒ 降频只省算。
- 降频解算：`CharacterBase.hitDyeStep = 1/30` 累积步进，单步 dt 用累积量（**物理时间守恒**）+ 上限 1/10s。
- `density` 在 `vector` 模式被忽略；`hitDyeColor` 在 `scalar` 模式被忽略。
- ★ 反面教训（**自我验证陷阱**）：曾用 112 项断言"验证" `hitUvOf`，但那只证明了**公式自洽**，
  没证明它与渲染管线一致 —— 真正的验证是**从 `texUV` 的表达式反推**（见上）。
- ★ 反面教训：**"降频有没有视觉影响"必须按路径回答**，不能拿一条路径的结论套全局；
  也不能用"物理上应该更明显"替代**在代码里找非零量**（vector 路径 0 × 0.85 = 0）。

---

# 死亡动画流体（`DeathAnimEffect` + `createDeathFluidEffect`）

> 与受击染料共用同一套 `FluidSolver`，但走**独立实例**（不缓存、不与共享实例隔离）。
> 最后更新 2026-09-18（第三版定稿）。

## 现状配置（两个资产各一份：`FtxAsset.ts` / `index.ts` 的 `createDeathFluidEffect`）

| 参数 | 值 | 备注 |
|---|---|---|
| `advectionMode` | `vector` | 强制 |
| `enablePressure` | `true` | ★ 散度爆炸与自由表面都靠它 |
| `pressureIterations` | 30 | |
| `gravity` | `{0, 20}`（初值） | `play()` 立刻 `updateConfig` 覆盖成随机方向 20 |
| `velocityScale` | 0.98 | 每步乘一次 |
| `maxVelocity` | **200 px/s** | 原 20000（太猛）→ 50（太温）→ 200 |
| `levelSetConfig.enabled` | **true** | 原未配置 = 关 |

**力度（`DeathAnimEffect` 常量）**：推力 `DEATH_PUSH_FORCE = 20` px/s²、冲量 `DEATH_IMPULSE_MIN/MAX = 20~40` px/s。
判据 = 稳态流速 `v_eq ≈ g/(30×0.02) ≈ 1.63g ≈ 33 px/s` 必须 < `maxVelocity`。

## ★★ 散度注入 = `FluidSolver.explode(ExplosionConfig)`

- 位置：`processExplosions(dt)` 在 **step 3.6**（`FluidSolver.ts:1095`），**压力投影（step 4）之前**
  ⇒ 写进 `divergenceGrid` 的源项被压力方程消费（∇²p = ∇·u + f）。
- ★ **符号：`strength` 必须为负才是"向外爆炸（源）"**。两条独立证据：
  · `ExplosionConfig.strength` 文档："负 = 向外爆炸（源），正 = 向内收缩（汇）"；
  · `radialSpeed = -strength × envelope × 0.12`，而 `injectRadialVelocity` 的约定是"正 = 向外推"。
- ★ **一次性消费**：step 4.5 有 `clearGrid(this.divergenceGrid)`（`FluidSolver.ts:1106`）
  ⇒ 散度场不参与平流/衰减、不会跨步累积。**但仍不要每帧调 `explode()`** ——
  `duration`(0.25s) 内它自带指数包络（`decay 0.9/步`）持续注入，重复调用会叠加成极端压力。
- ★ **只在 `enablePressure = true` 时有效**（散度源是压力方程的源项；压力关掉 = 白写）。
  注意 **timing 陷阱**：压力投影跑在 `velCap`/限幅**之前**？——不，顺序是 3.6 爆炸 → 4 压力 → 4.5 清散度 → 5 `velocityScale` → 6 限幅
  ⇒ 爆炸产生的速度**最终仍被 `maxVelocity` 钳到 200**，所以 `strength` 决定"多快拉满"，不是峰值。
- `ExplosionConfig` 全字段：`cx/cy/radius/strength`（必填）+ `createWater/waterColor/duration/decay/waterMultiplier/perturbation/velCap/velCapDuration/velCapRecovery`。
  死亡动画只用前 4 个 + `duration`。**不设 `velCap`**（`maxVelocity` 已是 200，不需要临时抬升）。

## ★★ 散度爆炸与"降频 1/30"的关系（用户 2026-09-18 追问的点）

`processExplosions()` 只在 `step()` 内被调（step 3.6）⇒ **它跟着 step 的节拍走 = 30 次/s**，不是 60。

| 项 | 是否乘 dt | 降频后 |
|---|---|---|
| `strength × envelope`（散度源） | **否** | **总注入量缩水** |
| `radialSpeed × dt`（径向速度） | 是 | 节拍无关 |
| `velImpulse × dt`（抖动冲量） | 是 | 节拍无关 |

- `duration` **不失真**：`ex.elapsed += dt`，dt 是**累积真实时间** ⇒ 仍为 0.25s 墙钟。
- `envelope ×= decay` 是**按调用次数**衰减的 ⇒ 0.25s 窗口内：
  · 30 步/s ⇒ 注入 **7 次**，Σenvelope = 9×(1−0.9⁷) ≈ **4.70**
  · 60 步/s ⇒ 注入 **14 次**，Σenvelope = 9×(1−0.9¹⁴) ≈ **6.94**
  ⇒ **总散度注入量 ≈ 60fps 时的 68%**。
- ★ 但**峰值相同**：当前 `strength = -30000` 大到「一步就把流速顶到 `maxVelocity = 200`」，
  所以两种节拍的峰值都被钳在 200，只是 30/s 的**尾巴短约 30%**。
  **只有把 strength 调到不再饱和时，这 68% 才会真的显形。**
- 想精确复刻 60fps 设计量：`strength × (6.94/4.70) = ×1.48` ⇒ **-30000 → -44000**。
- 另：`applyPressureGradient()` **不带 dt**（`FluidSolver.ts:871`）⇒ 压力链路每步的量也是固定的，
  所以"降频 ⇒ 每步步长翻倍"并不会放大单步的压力推动。

## ★★ levelSet 开启的三个坑

1. **`surfaceTension > 0` 才真的施加**（`FluidSolver.ts:1080` `if (ls.surfaceTension > 0)`）
   ⇒ **负值是"等效关闭"的写法**。scalar hit-dye 用 `-5000000` 就是这个意思，别以为是"强力张力"。
2. **`reinitIterations` 在 step 里没有兜底**（`:1050` `const iterations = ls.reinitIterations;`）
   ⇒ 必须显式给全（其余字段有 `??` 兜底，但 `FluidSolver` 构造里 `levelSetConfig: {...config.levelSetConfig}` 是**浅拷贝不并默认值**
   ⇒ 干脆整块给全，照 `Asset.createHitDyeEffect` 的字段集抄）。
3. **开启后压力求解切成"自由表面模式"**（`:1100` 传 `phiGrid.read` 给 `solvePressure`）
   ⇒ 只在液体内部解压力（更真实）。这会让整体观感变化，不只是"多一个张力"。
- 另外：`reinitInterval` 的单位是**解算步**，降频 1/30 后 10 步 ≈ **0.33s**（不是 60fps 下的 0.17s）。
- φ 的来源：vector 模式取 `colorGrid.alpha`（`initPhiField`）——死亡帧的残差 alpha 正好是角色剪影。
- 开销：约 2 趟/步（`advectPhi` + `applySurfaceTension`）+ 每 10 步一次重建（≈0.4 趟/步）⇒ 很轻。

## 死亡动画的寿命/淡出（未改）

`maxLifetime 2.5s`、`fadeDuration 1.2s`、`fadeStart = pushDuration(0.3) + 0.15`；
`elapsed` 走真实 dt（降频不改变寿命）。`uOpacity` 线性衰减，`<=0.02` 提前结束。
