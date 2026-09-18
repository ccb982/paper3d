# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 详细流水见同目录 `YYYY-MM-DD.md`（只增不改）；本文件只留**长期铁律**。
> 已沉淀技能：god-object-extraction / game-audio-sfx-pipeline / game-frame-budget-profiling / shader-fit-from-reference /
> threejs-glb-model-swap / game-map-hud-overlay / codebase-dead-code-audit / data-driven-roster-registration。

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
  音频优先：`syncSceneBgm()` = sail 静音 > battle(`spawner.warnShown`) > interior/explore。

## ★★ 刷怪 `src/systems/spawn/WorldSpawner.ts`

- **刷怪=玩法层、蜂群=引擎层**，只经 `SwarmSystem`+`swarmHooks`；改引擎别动 WorldSpawner；新刷怪逻辑写这里（写回 WorldMode 则 guard FAIL）。
- `spawner` 构造在 `enter()` **最开头**（否则 `setPhase`→`syncSceneBgm`→`spawner.warnShown` 崩）；依赖走 `SpawnDeps` 实时桥，别做构造时快照。
- 症状「敌人不生成」排查：`phase!=='explore'` → `mobDefs.length===0` → `spawnedChunks` → ★**`quotaAllows()`（`quota−spawned>0`，头号嫌疑）** → `MAX_ALIVE=200`。
  ★★ `spawned` 是**当天累计**、只增不减、跨出击累计，只有换日 `resetDayQuota`（`meta.day++` 只在 `onReturn`）⇒ **「一只没有 + 删档就好」99% 是配额打满**。

## ★ 敌人 LOD 三层

| 层 | 半径(距玩家) | 表示 |
|---|---|---|
| L3 实体 | 升 35m / 降 40m | EntityManager EntityBase |
| L2 代理 | 80m | `swarm.pool` |
| L1 回收 | 140m 外删除 | — |

- **索敌半径 > 35m 的单位「看不见敌人」**（只查 EntityManager）→ 修法是开代理层通道（查 pool + `swarm.damageAgent`），**别**把远处敌人升格（占满 `L3_CAP=30`）。
  ★★ AgentPool 是 **swap-remove** → 代理下标**每帧重锁**，绝不跨帧缓存。

## ★ 音频

- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`(warnShown 期间)。真源 `config/bgm.ts`；★ 加键必须同步手写 `BgmKey` 联合类型（漏=TS2353）。
- SFX：`Sfx.playSfx(id,minGapMs,rate?)`，**必须节流**。★★ **`minGapMs` ≥ 素材时长**（否则新实例叠着响=糊）；`rate<1` 拉长时长、间隔同步放大；rate 必须在 `play()` 前设。
- 循环轨：`playLoopSfx/stopLoopSfx` + `LOOP_SFX` 表，**按 src 分轨**可多轨同响。
  ★★ `LoopTrack.target` 不能省（否则每帧重 fade = 指数逼近 = 短动作没声）；`LOOP_FADE_MS=220`；素材须无缝循环。
- ★ 涉水持续游动 = `WorldMode.updateWadeLoop` 每帧裁决的连续轨。硬经验：①选**平坦段**（判据 = 40ms 窗 RMS 包络起伏，不是 LUFS），**动作层做主层**、连续层只填空隙；②循环轨音量别太低 → 随机 vol 0.45~0.62 + rate 0.80~0.92；③这版 ffmpeg `acompressor` 救不了 peak 贴顶的短素材，换选段/调音量。

## ★ 受击染料流体（`CharacterBase` / `FtxAsset.createHitDyeEffect`）

- ★★ **降频解算 = 既省算又更清楚**：`velocityScale:0.85` 是**每 step 乘一次**（不按 dt 折算）→ 1s 衰减 0.85^N。
  60 步/s ≈ 6e-5（速度秒归零、红团糊住）vs 30 步/s ≈ 7.6e-3（留存 **≈130×** → 真会"流"开）。
  现 `hitDyeStep=1/30` 累积步进，单步 dt 用累积量（**物理时间守恒**）+ 上限 1/10s。
- ★ 注入点 = **真实命中点**换算成 bbox 归一化（`DamageOptions.hitPoint` → `onTakeDamage(dmg,src,hitPoint)` → `hitUvOf`），拿不到才回退。`hitDyeRadius` 越小越像局部血点（现 0.45 偏大，待定）。

## ★ 遗物 / 物品 / 抽卡 / 文案

- **新增遗物改三处**：`config/relics.ts` + `ItemIconRegistry.ts`（`FTX_ICON_SOURCES` = **图标唯一真源**，漏=空白）+ `config/gachaPool.json`（`outOfRunItems`，否则抽不到）。
  ★ 别把 `FTX_ICON_SOURCES` 改成从 relics 派生（值导入拖进 core 初始化链 → 全灭，试过回退）。
- 查 id 合法：`items.json`(普通) / `relics.ts`(遗物) / `ItemIconRegistry.ts`(图标) / `gachaPool.json`(能否抽) / `Session.ts`(开局自带)。
- ★★ **遗物绝不进背包**：只住 `session.outOfRun.owned`。`applyEffects` 有双向防呆（勿删）；老存档矫正走 `SaveSystem.sanitize()`（load 里调，幂等）——**改配置不改存档 = 用户看着没修好**。
- 抽卡分档：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%（BOSS 独立优先判定不占权重）。
- ★ **用户贴的剧情文本逐字照抄，禁止润色**；落地后机器校验（一次性 .py 深比较 + difflib，跑完删）。真源 `config/dialogues.json`（顶层 `trees`）；effects `item/relic/random_relic/flag/heal`，随机遗物用 `random_relic`。
- ★ 给玩家东西 = `WorldUIManager.showPickupResult`（唯一播报渠道），成功再 `flashItemAndRefresh`；取名走 `displayNameOf()`。

## ★★ 敌军名册（唯一真源 `src/config/enemyRoster.ts`）

- **加敌军 = 放帧包 + 名册加一条，零其他改动**；`ENEMY_ROSTER` 顺序 = `main.ts` 加载顺序 = `mobIndex`。
- ★★ **禁止「取模复用数值」**（旧 `MOB_BLUEPRINTS[i%3]` = 第 4 个起变换皮）→ 现按 id `ENEMY_BY_ID.get()` 一一对应，查不到 warn+回退。
- ★★ **远程兵种必须同时给 `attackRadius` 与 `attackRange`**：前者只是刹车距离，真正判定半径是 `meleeSwing.params.range`（缺省 1.8）→ 只放大 attackRadius 会站远处挥空。
- 素材缺失只 warn 跳过；`npm run guard` 校验 file/掉落 id/id 唯一/public 漏登记。引擎缺口：远程无弹道／飞行怪无空中层／海怪不下水。
- ★★ **贴片接地：新素材必查**。FTX bbox 不保证贴脚底（导出留白）→ 底部锚点 ⇒ 留白 = 悬空。`services/fx/FootAnchor.ts` 运行时自动量（读 alpha）；`MobDef.groundSink = ratio×scale + 手调`。
  ★★ **L3 `FTXQuad.setGroundSink` 与 L2 `SwarmBatch` 实例 y（含血条 `offsetY`）两条路径都要补**，否则"远看接地近看悬空"。★ 名册 `scale` = **quad 宽**，身高 = `scale×(bbox.h/bbox.w)`。工具 `.workbuddy/tools/ftx_foot_measure.py`。

## ★ 其他模块

- 访客：加访客只改 2 config（`visitors.ts` + `dialogues.json`）；模型轴 `y`=前后(脸朝 -y)、`z`=高、`x`=左右（详见技能 `threejs-glb-model-swap`）。
- 小游戏：加新游戏 = 丢文件进 `src/minigames/games/`（`import.meta.glob` 自注册）；壳 `MiniGameOverlay` z-index 300；`exit()` 先 `closeMiniGame()`。★ 素材降级两坑：`<img>` 无 src 时 **onerror 不触发** → 显式判 `!tex`；`replaceWith` 后旧字段引用失效。
- ★★ **UI 入口显隐两级控制**：`settingsAllowed`（只有 BaseMode true）+ `settingsSuppressed`（页面级）→ `applySettingsVisible()` = `setVisible(allowed && !suppressed)`，页面调 `globalThis.setSettingsSuppressed(bool)`。
  ★★ **凡左上角有返回键的全屏页，show()/hide() 必须成对压制/恢复齿轮**（已接 `CraftingOverlay`、`GachaOverlay`）。返回按钮统一 `ui/components/BackButton.ts`；性能 HUD 默认隐藏。
- 房间/基地视觉：`RoomDecoGeo` + `RoomSurfaceMaterial` + `ui/base/RoomDecor.ts`。★ ShaderMaterial：frag 每个自定义 uniform 都要声明（含 uTime）、GLSL 禁尾随逗号、末尾 `#include <colorspace_fragment>`——漏一条 = 该材质全部 mesh 不渲染。

## ★ 架构治理

- 头部过重（上限 1200，已知债务 warn）：`WorldMode.ts` 4129→**3570**、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。下一刀建议 `ChunkManager.ts`。
- ✅ P0-a（setPhase 收口）/ P1（拆 WorldSpawner）/ P2（删死代码 + guard）已完成；未做 P0-b（BgmKey 改 keyof 派生）。
- **真正让项目膨胀的是「人肉同步」**：不变量靠注释 + 记得改 N 处；WorldMode 是默认垃圾桶。
- 拆大类见技能 `god-object-extraction`：★ 成员起止行别用花括号配平 → 断言式迁移脚本 → ★ 验证用 .py 方法体归一化 difflib 比对（**tsc 通过 ≠ 行为一致**）。

## ★ 蜂群 v2（设计稿 `全新的游戏/蜂群架构.md` §11~§25，待实施）

- 三级 Battalion→Squad→个体/代理；★ 编队层次**正交于 LOD**。★ 寻路升 **HPA\*+走廊带**（现 FlowField 324m 窗口 = 「找不到玩家」根因），降级链 HPA*→FlowField→直线（**绝不能不动**）。
- 硬不变量：**两阵营通行掩码**（对玩家=阻挡、对己方=高代价可通行，否则 AI 自锁）；陷阱**不参与 HPA\***；飞行兵**不参与地面寻路**（独立空中层 `isAir`/`altitude`），★ 用户主动要的**减法：只轰炸、绝不缠斗**。
- 其余（序盘五阶段 / 工事 / 偷袭分队 / 两级火力 / 落点预警）细节一律查该文档，勿凭记忆。
