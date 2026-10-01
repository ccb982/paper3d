# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 只当索引：留「触发 + 结论」，细节在 `topics/*.md`（hit-dye-fluid · spawn-quota-and-roster ·
> relics-and-items · ui-overlay-and-misc · arch-and-swarm-v2），流水在 `YYYY-MM-DD.md`。

## ★ 环境 / 工具
- **bash 损坏**（ls/cat/head/dirname/cd 全 not found）→ 用托管 python/node（3.13.12 / 22.22.2-3），把 `node -e` 当 shell。项目根 `架构重置\全新的游戏`；**无 git** → 改前备份 `.workbuddy/tmp/`。
- ★★ 改完必跑 `tsc --noEmit -p tsconfig.json` + `node scripts/arch-guard.mjs`（要 cwd=项目根 → `process.chdir()` 包装）。同文件多处改**串行**发 Edit。
- ★ 用户在玩游戏时**不擅自跑游戏内实测**（抢 GPU/误归因），先问；优先离屏验收（node 直跑真实模块 + 反射/正则断言）。
- 沟通：直接简短可验证；给数字；说清改了什么/踩了什么坑/回退了什么。

## ★★ 时间 / 阶段
- 时间唯一入口 = `main.ts` 无条件 `renderManager.update(dt)` → `SunCycle`（900s/天，6 点起）。
- ★★ **禁止「敌人不动 + 时间照常流逝」**：`WorldMode.update` 里 `return` 冻结世界的分支必须同步 `setClockPaused(true)`。阶段变更只走 `setPhase(next)`。

## ★★ 渲染 / 离屏烘焙
- ★★ **离屏相机视锥 = `[0,1]²`**（`OffscreenBake`）→ 加进离屏 scene 的 quad **必须放 (0.5,0.5)**；`PlaneGeometry(1,1)` 默认居中于原点 → 被裁到**左下 1/4**。
  **症状**：`BulletVisual` 全幅路径（无蒙版实体 = **程序化弹**）烘焙只剩 1/4 → 敌方箭/火球**看着没画**（真素材 `.scene.zip` 走实体路径，网格跨度本就 0..1，故正常）。
  **判据**：`readRenderTargetPixels` 的 alpha>127 占比应等源纹理（箭 26.5% / 火球 48.8%）。自检页 `dev-bullets.html`。
- ★★ **两个 `createHitDyeEffect` 配置不同**：`.ftx3.gz`（主角/普通敌人：vector、无衰减、有注入速度）vs `.scene.zip`（BOSS/无人机/祖宗/立绘：scalar、每步衰减、无速度）→「降频有无观感影响」**按路径答**。
- ★ 流体调参公式（`v_eq`/`explode`/残差空间注入/`reinitIterations` 无兜底）→ `topics/hit-dye-fluid.md`。

## ★★ 刷怪 / 名册 / 索敌 → topics/spawn-quota-and-roster.md
- **刷怪=玩法层 → 写 `WorldSpawner.ts`**（写回 WorldMode = guard FAIL）。★★「敌人不生成」头号嫌疑 = **`quotaAllows()` 配额打满**（当天累计、只增不减、跨出击累计，仅换日清零）。
- ★★ **索敌候选必须是「活对象」**（`WorldMode.candSlots`）：`ctx.target` 只在 patrol 的 `seePlayer` 里赋值，chase/attack 不重索敌 → 候选一旦写成坐标拷贝，ctx.target 就冻成快照。**远程兵 `attackFinished → chase` 永不回 patrol ⇒ 永久朝空气射击**（已修 + arch-guard 护栏）。「远程不攻击」先查这条，别疑弹道。
- ★ **底座验收工具：`?roster=1`**（缺省开）→ 落地每种敌人各铺一只（不含普瑞赛斯）+ 头顶名字；离屏探针在 `.workbuddy/tmp/2026-09-18_ai-target/`。
- 名册真源 `config/enemyRoster.ts`：**加敌军 = 帧包 + 一条**；顺序 = 加载顺序 = `mobIndex`；★★ **禁取模复用数值**。
- ★★ 远程兵**同时给 `attackRadius`（刹车）与 `attackRange`（真判定）**；可见弹道走 `MobAIParams.ranged` → `rangedShot` → 按 camp 路由 `enemyBullets`/`enemyBolts`。
- ★★ **空中层**：名册 `isAir:true`+`airAltitude` → 悬停/不绕坑水/不掉坑判死/直线导航；L2+L3 高度口径同源。只在引擎层开洞（AgentPool SoA）。
- ★★ 新素材必查接地：FTX bbox 不保证贴脚底 → `FootAnchor.ts` + `MobDef.groundSink`，**L3 与 L2 两条渲染路径（含血条）都要补**。
- ★★ 命中/瞄准高度**别写死 `position.y+1.0`** → 问 `hitAnchorY()`。

## ★ 敌人 LOD 三层
L3 实体（升 35 / 降 40m，EntityManager）> L2 代理（80m，`swarm.pool`）> L1 回收（>140m 删）。
- **索敌半径 > 35m 者「看不见敌人」** → 开代理层通道，别升格（`L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 下标每帧重锁；**加 SoA 字段必须同步 `push/copy/snapshot`**。

## ★ 遗物 / 物品 / 抽卡 / 文案 → topics/relics-and-items.md
- **新增遗物改三处**：`config/relics.ts`（效果走 `RelicEffects`）+ `ItemIconRegistry.ts` 的 `FTX_ICON_SOURCES`（**图标唯一真源**）+ `gachaPool.json`。★ 别改成从 relics 派生（值导入拖进 core 链 → 全灭）。
- ★★ **遗物绝不进背包**；`applyEffects` 双向防呆**勿删**；**改配置不改存档 = 用户看着没修好** → 老档走 `SaveSystem.sanitize()`。
- ★ **用户贴的文本逐字照抄禁润色** + 机器校验；给东西只走 `WorldUIManager.showPickupResult`。

## ★ 音频
- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`。真源 `config/bgm.ts`；★ 加键同步手写 `BgmKey`（漏 = TS2353）。
- ★★ SFX 必须节流且 **`minGapMs` ≥ 素材时长**；循环轨按 src 分轨 + `LoopTrack.target` 不能省 + 淡入淡出 220ms + 素材无缝 + 动作层当主层（→ 技能 `game-audio-sfx-pipeline`）。

## ★ 其他 → topics/ui-overlay-and-misc.md
- ★★ **UI 显隐两级**：`settingsAllowed`（只 BaseMode）× `settingsSuppressed`（页面级）；凡有返回键的全屏页 `show()/hide()` 必须成对压制/恢复齿轮；返回统一 `createBackButton()`。
- 小游戏**丢文件进 `src/minigames/games/` 零索引改动**；访客只改 `visitors.ts` + `dialogues.json`；房间三件套（★ ShaderMaterial 漏声明 uniform = 该材质全部 mesh 不渲染）。

## ★ 架构治理 / 蜂群 v2 → topics/arch-and-swarm-v2.md
- 头部过重（上限 1200，仅 warn）：`WorldMode.ts`≈3636、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。**下一刀 `ChunkManager.ts`**。
- ★ **让项目膨胀的是「人肉同步」**；拆类见技能 `god-object-extraction`（**tsc 通过 ≠ 行为一致**，须 difflib 比对）。
- 蜂群 v2：HPA\* + 走廊带；硬不变量 = 两阵营通行掩码 / 陷阱不入 HPA\* / 飞行兵不入地面寻路。

## ★★ stickman-lab（独立小项目：物理火柴人 → 隐藏 boss）→ 流水 2026-10-01.md
路径 `架构重置\stickman-lab`。Rapier3D 关节骨架 + 进化学习，几何从 `海猫_抠图` 素材**反推**（相邻组件 bbox 重叠区 = 关节），
质量取 Dempster 1955、力矩上限取 MuJoCo humanoid.xml gear。**10 刚体 / 9 关节（无踝，脚与小腿同刚体双 collider）**。
- ★★ **关节马达必须自实现**（成对等大反向 Z 轴力矩冲量）。Rapier 自带马达 factor 1→20 不出力、30 爆炸，无可用区间；硬关节限位同样兜不住马达。
- ★★ 两条硬不变量：**限加速度**（`|imp| ≤ α·|err|·Ieff`，α≈0.35）+ **限位也自己实现**（位置感知软限位，越界强制回程）。缺任一条 → 峰|v| 284 m/s 级爆炸。
- ★ **`Sim.begin()` 不是干净重置**：Rapier 约束/接触**暖启动缓存**残留，同一基因组连跑从 **step1** 就分叉 → 适应度被个体间残留污染。修法方向 = 每轮重建 World。
- ★ **「自主扫描地形/避障」目前完全没有**：输入 27 维无任何地形量，地面是纯平 `cuboid(60,0.5,4)`。别误以为有。
- ★★ 该项目的 `node_modules` 是 junction → **`vite-plugin-wasm` + `vite-plugin-top-level-await` 必需**（rapier 包内有裸 `.wasm` 导入），
  且 **必须设 `cacheDir:'.vite'`**，否则与本体共用 `node_modules/.vite/deps` 互相清缓存（会被环境护栏拦成 dev server 启崩）。
- 离屏验收：`node tools/run.mjs <verify-core|probe-motor|probe-reset|probe-spike|probe-fitness|probe-ground|probe-fight|probe-forces>`（esbuild 打包后直跑真实模块）。
- ★★ **已整体重写为真 3D**（2D 平面方案废弃，用户定调）：**球关节 ×9 = 27 转动自由度**、六自由度全开；
  世界轴 `+X=前 / +Y=上 / +Z=侧向`；画布 x→Z 且**取负**（否则左右镜像）；关节三轴 `0=外展(×0.6) 1=扭转(×0.35) 2=屈伸(×1.0)`。
  网络 **70→32→27（3163 参数）**。★ 三轴口径必须 `brain.ts` / `ragdoll.driveMotors` / `sim.ts` 三处一致（改一处 = 动作错乱且**无编译错误**）。
  架构真源 = **`stickman-lab/架构设计.md`**（13 章，含移植契约 `BossController`）。
- ★★ **确定性只能靠整世界重建**：`Sim.buildWorld()`（free + new World + new Ragdoll）。`reset()` 清不掉暖启动缓存（偏差 1.84e-3 m）；删关节重建也清不掉（地面接触缓存）。修后偏差 **0.00e+0 m**。
- ★★ **被动姿态张力 `restTension`（默认 9.0）**：网络输出的是**角速度**目标 ⇒ 零输出 = 纯阻尼，**不抵抗静态力矩**，重力会把膝盖压到限位（躯干 1.128→0.693 m）。
  修法 = 目标速度里叠加 `−k·θ`。k 判据 = **静息接触力应 ≈ 体重**（k=6→88%，k=9→105%，k=12→106% 饱和）。**不要改成直接加弹簧力矩**（显式积分必发散，k 上限只有 7.2）。
- ★★ **软限位禁止加提前量**（踩过最重的坑）：膝限位 [−145°,+2°]，静止 0° 本就在界内；加 17° 提前量 ⇒ 一开局就判越界全力后掰、人形自己跪下。**只在越界之后介入**。
- ★★ **Rapier 0.14 没有关节冲量/反力读回接口** ⇒ 关节力只能反推（重力 + 接触流形 + **`Ragdoll.motorImpulse` 自己记账**）。
  ★ `contactImpulse` **系统性偏高 3~5%**（含求解器位置偏置/穿透恢复冲量，不产生净动量变化）⇒ 用动量法 `Σm·(Δv/Δt+g)` 做第二路径，**±8% 内算对账，别期待 0**。
  工具 `probe-forces`：子树动量收支求关节传递力（站桩校验：neck=+55.6=头颈自重、hip_l=−257=该腿地面反力−腿自重，全部对账）。
- ★ **用户不认截图**（原话"截图0作用"）—— 证明改好了要给**逐组件受力/力矩读数**，不是图片。
- ★ **项目目标 = 产出能正常行走+攻击的敌人，作为特殊 boss 移植回本体**。移植契约：实验室**不产生玩法级副作用**，
  只输出"身体做了什么"（`rootPos / rootQuat / phase / hits`），玩法数值留在本体。内核只需 4 文件（skeleton/ragdoll/brain/sim）+ 16.5 KB 基因组。
- ★ 已知限制：**自主避障/3D 地形完全没有**（L1，移植前必须补）；行走 40 代最佳 6.20 但**仍在边走边倒**；战斗命中通道已通（25 代 0→4）但被"站立没学会"阻塞。

