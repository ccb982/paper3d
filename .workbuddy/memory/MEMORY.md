# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 本文件只留**长期铁律**。细节在 `topics/*.md`，流水在 `YYYY-MM-DD.md`（只增不改）。
> 专题：`hit-dye-fluid.md` / `spawn-quota-and-roster.md` / `ui-overlay-and-misc.md` / `arch-and-swarm-v2.md`
> 已沉淀技能：god-object-extraction · game-audio-sfx-pipeline · game-frame-budget-profiling ·
> shader-fit-from-reference · threejs-glb-model-swap · game-map-hud-overlay ·
> codebase-dead-code-audit · data-driven-roster-registration

## ★ 环境 / 工具

- **bash 工具链损坏**（ls/cat/dirname/cd 全 not found）→ 一律用托管 python `~/.workbuddy/binaries/python/versions/3.13.12/python.exe`。
- **PowerShell 工具会吞 stdout** → 重定向到 `$env:TEMP\x.txt`，再用 python 按 **utf-16** 解码读。
- 项目根 = `架构重置\全新的游戏`；`.workbuddy` 在工作区根 `架构重置\`（含 memory / tools / tmp / deadcode）。
- node 用托管 `22.22.2-3`。tsc：`node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。护栏：`node scripts/arch-guard.mjs`。
- **项目没有 git** → 改/删前备份到 `.workbuddy/tmp/`。无系统 ffmpeg → 用托管 venv 的 imageio-ffmpeg。
- **用户可能在玩游戏 → 不擅自跑游戏内实测**（抢 GPU、误归因）；要实测先问。
- 沟通：**直接、简短、可验证**，给数字，说清改了什么 / 踩了什么坑 / 回退了什么。

## ★★ 时间 / 昼夜 + 阶段

- 时间唯一入口：`main.ts` 无条件调 `renderManager.update(dt)` → `SunCycle`（`DAY_SECONDS=900`、`START_HOUR=6`）。
- ★★ 不变量：**禁止「敌人不动 + 时间照常流逝」** → 凡 `WorldMode.update` 里 `return` 冻结世界的分支，必须同步 `setClockPaused(true)`（该开关只停太阳，不影响 scaledDt）。
- ★ **`WorldMode.setPhase(next)` 是 phase 变更唯一入口**（环境/昼夜/水面/BGM 副作用全在里面），别直接 `this.phase =`。

## ★★ 刷怪 → 详见 `topics/spawn-quota-and-roster.md`

- **刷怪=玩法层、蜂群=引擎层**，只经 `SwarmSystem`+`swarmHooks`；新刷怪逻辑写 `WorldSpawner.ts`（写回 WorldMode 则 guard FAIL）。
- 症状「敌人不生成」头号嫌疑 = ★★ **`quotaAllows()` 配额打满**：`spawned` 当天累计、只增不减、跨出击累计，只有换日 `resetDayQuota` 才清零 ⇒ **「一只没有 + 删档就好」99% 是这个**。

## ★ 敌人 LOD 三层

| 层 | 半径(距玩家) | 表示 |
|---|---|---|
| L3 实体 | 升 35m / 降 40m | EntityManager EntityBase |
| L2 代理 | 80m | `swarm.pool` |
| L1 回收 | 140m 外删除 | — |

- **索敌半径 > 35m 的单位「看不见敌人」**（只查 EntityManager）→ 修法是开代理层通道（查 pool + `swarm.damageAgent`），**别**把远处敌人升格（占满 `L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 代理下标**每帧重锁**，绝不跨帧缓存。

## ★ 音频

- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`(warnShown 期间)。真源 `config/bgm.ts`；★ 加键必须同步手写 `BgmKey` 联合类型（漏=TS2353）。
- ★★ 实现细节（SFX 必须节流且 **`minGapMs` ≥ 素材时长**、循环轨**按 src 分轨** + `LoopTrack.target` 不能省 + `LOOP_FADE_MS=220`、涉水连续轨选段判据 = 40ms 窗 RMS 包络起伏、`acompressor` 救不了 peak 贴顶的短素材）见**技能 `game-audio-sfx-pipeline`**。

## ★ 受击染料流体 → 详见 `topics/hit-dye-fluid.md`

- ★★ **两个 `createHitDyeEffect` 实现，配置完全不同，改前先确认实体走哪条**：
  `FtxAsset.load('.ftx3.gz')`（**主角/普通敌人**，`vector`、无衰减、**有注入速度**）
  vs `Asset.load('.scene.zip')`（**BOSS/无人机/祖宗/抽卡立绘**，`scalar`、**`decayRate 0.0588/步`**、无速度）。
- ★★ **"注入量大"只能靠持续注入**（`injectDensity`/`injectColor` 的 rate 都 clamp ≤1.0，重注入=**覆盖非叠加**）
  ⇒ 每个解算步**先重注入再 `step`**。★ **降频影响按路径分**：scalar 的 `decayRate` 是每步的 ⇒ 30 步/s 比 60 步/s 亮 **6.4×**；vector 无衰减 ⇒ 只省算。
- ★★ **流体特效解算统一 1/30 降频**（受击染料 / 死亡动画 / 祖宗流体 / 图标动画）。
  **`maxVelocity`：受击染料 50、死亡动画 200 px/s**（死亡动画原 20000 太猛、50 太温）。
  **压力投影开关的判据 = 速度场是否恒 0**。
- ★★ **调"力度"前先算稳态流速**：`v_eq ≈ g / (步率 × (1 − velocityScale))`（死亡动画 ≈ **1.63g**）。
  **`v_eq` 必须 < `maxVelocity`**，否则被钳位、怎么调都是同一个结果（踩过：g=160 ⇒ v_eq≈261 ⇒ 仍顶格）。
- ★★ **散度注入 = `FluidSolver.explode()`**（step 3.6，**压力投影之前**）：**`strength` 必须为负才是"向外"**；
  散度场每步 4.5 `clearGrid` = 一次性消费 ⇒ **别每帧调**；只在 `enablePressure = true` 时有效。
- ★★ **散度爆炸与"降频"的关系（易漏）**：`processExplosions` 只在 `step()` 里跑 ⇒ 也是 30 次/s。
  `duration` 不失真（`elapsed += dt` 累积真实 dt），但 `envelope ×= decay` 是**按调用次数**衰减，
  且散度源 `strength × envelope` **不乘 dt** ⇒ **总注入量按节拍缩水**（0.25s 内 30/s 只 7 次、
  60/s 是 14 次 ⇒ 约 **68%**）。而 `radialSpeed × dt` / `velImpulse × dt` 都**乘 dt** ⇒ 那两项节拍无关。
  当前 strength 大到一步即顶 `maxVelocity` ⇒ 峰值相同、只是尾巴短；strength 调小后才显形。
- ★ **levelSet**：`surfaceTension > 0` 才真的施加（负值 = 等效关闭）、`reinitIterations` **无兜底**必须给全、
  开启后压力求解切成**自由表面模式**。详见 `topics/hit-dye-fluid.md`。
- ★★ **注入位置用 `mesh.worldToLocal()`**（位置 + 镜像 scale + `setBillboard` 竖牌朝向一并处理），`u=0.5+local.x`、`v=0.5−local.y`；
  **竖直高度问 `EntityBase.hitAnchorY()`**（覆写 = 贴片 65%），**别再写死 `position.y + 1.0`**（3.67m 敌人落大腿）。
- ★ 注入值在**残差空间**（0.5 = 不变，`h=0` 是色相 −180° 不是"红"）；贴片是**整体替换**流体纹理，不是叠加。

## ★ 遗物 / 物品 / 抽卡 / 文案

- **新增遗物改三处**：`config/relics.ts` + `ItemIconRegistry.ts`（`FTX_ICON_SOURCES` = **图标唯一真源**，漏=空白）+ `config/gachaPool.json`（`outOfRunItems`，否则抽不到）。
  ★ 别把 `FTX_ICON_SOURCES` 改成从 relics 派生（值导入拖进 core 初始化链 → 全灭，试过回退）。
- 查 id 合法：`items.json`(普通) / `relics.ts`(遗物) / `ItemIconRegistry.ts`(图标) / `gachaPool.json`(能否抽) / `Session.ts`(开局自带)。
- ★★ **遗物绝不进背包**：只住 `session.outOfRun.owned`。`applyEffects` 有双向防呆（勿删）；老存档矫正走 `SaveSystem.sanitize()`（load 里调，幂等）——**改配置不改存档 = 用户看着没修好**。
- 抽卡分档：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%（BOSS 独立优先判定不占权重）。
- ★ **用户贴的剧情文本逐字照抄，禁止润色**；落地后机器校验（一次性 .py 深比较 + difflib，跑完删）。真源 `config/dialogues.json`（顶层 `trees`）；effects `item/relic/random_relic/flag/heal`，随机遗物用 `random_relic`。
- ★ 给玩家东西 = `WorldUIManager.showPickupResult`（唯一播报渠道），成功再 `flashItemAndRefresh`；取名走 `displayNameOf()`。

## ★★ 敌军名册 → 详见 `topics/spawn-quota-and-roster.md`

- 唯一真源 `src/config/enemyRoster.ts`：**加敌军 = 放帧包 + 名册加一条，零其他改动**；顺序 = `main.ts` 加载顺序 = `mobIndex`。
- ★★ **禁「取模复用数值」**（第 4 个起变换皮）→ 按 id `ENEMY_BY_ID.get()` 一一对应。**远程兵种必须同时给 `attackRadius` 与 `attackRange`**（真正判定半径是 `meleeSwing.params.range`，缺省 1.8）。
- ★★ **贴片接地新素材必查**：FTX bbox 不保证贴脚底 → `FootAnchor.ts` 自动量 + `MobDef.groundSink`；**L3 `FTXQuad.setGroundSink` 与 L2 `SwarmBatch` 实例 y（含血条 `offsetY`）两条路径都要补**。

## ★ 其他模块 → 详见 `topics/ui-overlay-and-misc.md`

- ★★ **UI 入口显隐两级**：`settingsAllowed`（只有 BaseMode）× `settingsSuppressed`（页面级）；**凡左上角有返回键的全屏页 `show()/hide()` 必须成对压制/恢复齿轮**。返回统一 `ui/components/BackButton.ts`。
- 小游戏：**丢文件进 `src/minigames/games/` 零索引改动**（`import.meta.glob` 自注册）；壳 z-index 300。
- 访客：只改 `visitors.ts` + `dialogues.json` 两 config。
- 房间视觉：`RoomDecoGeo` + `RoomSurfaceMaterial` + `ui/base/RoomDecor.ts`；★ ShaderMaterial 漏声明一个 uniform = 该材质全部 mesh 不渲染。

## ★ 架构治理 / 蜂群 v2 → 详见 `topics/arch-and-swarm-v2.md`

- 头部过重（上限 1200，仅 warn）：`WorldMode.ts` 4129→**3570**、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。**下一刀 `ChunkManager.ts`**。
- ★ **真正让项目膨胀的是「人肉同步」**：不变量靠注释 + 记得改 N 处；`WorldMode` 是默认垃圾桶。拆大类流程见技能 `god-object-extraction`（**tsc 通过 ≠ 行为一致**，须方法体 difflib 比对）。
- 蜂群 v2（设计稿 `蜂群架构.md` §11~§25，待实施）：寻路升 **HPA\*+走廊带**（现 FlowField 只 324m 窗口 = 「找不到玩家」根因）；硬不变量 = 两阵营通行掩码 / 陷阱不参与 HPA\* / 飞行兵不参与地面寻路。**细节一律查该文档**。
