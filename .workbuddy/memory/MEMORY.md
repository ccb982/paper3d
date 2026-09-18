# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 详细流水见同目录 `YYYY-MM-DD.md`；本文件只留长期不变的约定与铁律。
> 已沉淀技能：`god-object-extraction` / `game-audio-sfx-pipeline` / `game-frame-budget-profiling` /
> `shader-fit-from-reference` / `threejs-glb-model-swap` / `game-map-hud-overlay` / `codebase-dead-code-audit`。

## ★ 环境 / 工程习惯（先看这条）

- **bash 工具链损坏**（`ls/head/cat/dirname/cd/wc` 全 not found）+ bash 会把 `python -c` 里的**反引号当命令替换**
  → 一律用托管 python `~/.workbuddy/binaries/python/versions/3.13.12/python.exe`；长文本必须 Write 成 `.py` 再跑。
- **在项目根跑命令**：Write `_run.py` → `subprocess.run(cmd, cwd=ROOT, env={PATH:NODE_DIR+...}, shell=True)`，跑完删。
- node/npx 用托管版 `~/.workbuddy/binaries/node/versions/22.22.2-3`；
  tsc：`node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。
- **项目没有 git** → 删/改前备份 `.workbuddy/tmp/`；死代码证据留 `.workbuddy/deadcode/`。
- `vite.config.ts` 没设 base（子目录托管会 404 白屏）；沙箱**不能监听端口**（dev/preview 起不来）；
  无系统 ffmpeg → 用托管 venv 的 imageio-ffmpeg。
- **用户可能在玩游戏 → 不擅自跑游戏内实测**（抢 GPU、误归因）。要实测先问。
- 沟通：**直接、简短、可验证**，给数字，说清改了什么 / 踩了什么坑 / 回退了什么。

## ★★ 时间 / 昼夜 + 阶段收口（2026-09-18）

- 时间唯一入口：`main.ts` 无条件调 `renderManager.update(dt)` → `SunCycle`。`DAY_SECONDS=900`、`START_HOUR=6`。
- ★★ 不变量：**禁止「敌人不动 + 时间照常流逝」** → 凡 `WorldMode.update` 里直接 `return` 冻结世界的分支，
  必须同步 `setClockPaused(true)`。
- `setClockPaused` 只停太阳/昼夜，不影响 scaledDt（房间行走照常）。
- ★ **`WorldMode.setPhase(next)` 是 phase 变更唯一入口**：环境/飞行/昼夜冻结/水面/粗块/涉水轨/BGM 副作用全在里面。
  改阶段不要直接 `this.phase =`（护栏盯着）。音频三级优先：`syncSceneBgm()` = sail 静音 > battle(`spawner.warnShown`) > interior/explore。

## ★★ 刷怪子系统 `src/systems/spawn/WorldSpawner.ts`

- **刷怪/波次必须与蜂群引擎解耦**：刷怪=玩法层，蜂群=引擎层，只通过 `SwarmSystem`+`swarmHooks` 对话。**改引擎别动 WorldSpawner**。
- WorldMode 只留 `private spawner!`，构造在 `enter()` **最开头**（否则 `setPhase`→`syncSceneBgm`→`spawner.warnShown` 崩）。
- 依赖走 `SpawnDeps` 实时桥，**别改成构造时快照**（WorldMode 会重赋 `this.enemies=[]`）。
- **加新刷怪逻辑 = 写进 WorldSpawner**（写回 WorldMode 则 `npm run guard` FAIL）。

### 症状「敌人不生成」排查顺序
1. `phase!=='explore'` 2. `testChunk||mobDefs.length===0` 3. `spawnedChunks`（每 chunk 一波，每局 reset）
4. **`quotaAllows()` = `quota − spawned > 0`** ★头号嫌疑 5. `preloadCap=ambientTarget/2` 6. `MAX_ALIVE=200`
- ★★ `spawned` 是**当天累计**、只增不减、跨出击累计；只有换日才 resetDayQuota。
  → **「一只都没有 + 删档就好」99% 是配额打满**。`meta.day++` 只在 `onReturn` → **刷新/强退不换日**。

## ★ 敌人 LOD 三层

| 层 | 半径(距玩家) | 表示 |
|---|---|---|
| L3 实体 | 升 35m / 降 40m | EntityManager EntityBase |
| L2 代理 | 80m | `swarm.pool` |
| L1 回收 | 140m 外删除 | — |

- **索敌半径 > 35m 的单位「看不见敌人」**（查的是 EntityManager）。修法：开代理层通道（查 pool + `swarm.damageAgent`），
  **别**把远处敌人升格（占满 `L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 代理下标**每帧重锁**，绝不跨帧缓存。

## ★★ 蜂群 v2 设计（文档 `全新的游戏/蜂群架构.md` §11~§25，待实施）

- 三级：**大编队 Battalion**（战术/跑一次 HPA*）→ **小编队 Squad**（复用走廊+局部修正+分车道）→ 个体/代理。
  ★ 编队层次**正交于 LOD**（升降格必须携带 `squadId/uid/formSlot/corridorIdx`）。
- ★ 寻路升级 **HPA\* + 走廊带**（现有 FlowField 只 324m 窗口 → 「找不到玩家」根因）；
  降级链 HPA*→FlowField→直线（**绝不能「找不到路就不动」**）。★ 迁移 **F0（容器+调试可视化）先行**。
- 铁律速查（详见文档）：
  - §21 地形战术：序盘 `scout→seize→fortify→encircle→assault`，序盘 ROE=hold（不开火）；portal 图=山脚守点来源；
    据点必须给玩家解法（不许无解堵路）；选点只算一次不每帧重打分。
  - §22 防御工事：fortify 时**杂兵兼任施工**（不设工兵兵种）；★★ **两阵营通行掩码**（对玩家=阻挡、对己方=高代价可通行，
    否则 AI 自锁）；必须可摧毁 + 不许封死唯一通路；随波次清理、不入存档。
  - §23 绕后偷袭：总攻**必带 1~2 组偷袭分队**（硬上限 2，正面不低于 60%）；路径=第二条侧翼走廊；
    `assault` 后**延迟 1~2s**；★ 必须有可察觉线索（12m 内隐蔽失效）+ `AMBUSH_TIMEOUT` 20s 回正面。
  - §24 两级火力 + 陷阱：普通远程=**机动单位**；高危火力点=**固定工事**（纵深两层，`FP_LOS_BLOCK`）；
    ★ 不许"看不见又打不到"的死角。陷阱**不是障碍** → **不参与 HPA\*、不标脏 cluster**（与工事相反）、己方无害、必须可察觉；
    ★★ 工事缺口就是最好的陷阱位。
  - §25 飞行兵：★ 用户主动要的**减法** —— **只做轰炸、绝不缠斗**；出击循环待机→进场→投弹一次→撤离→冷却 12~20s；
    ★★ **不参与地面寻路**（独立空中层，SoA 加 `isAir`/`altitude`）；落点**预警 + 延迟引信**；必须有防空威慑。

## ★ 音频（BGM / SFX / 循环轨）

- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`(warnShown 期间)。
- 曲目真源 `src/config/bgm.ts`；★ 加键必须同步手写 `BgmKey` 联合类型（漏了=TS2353）。
- SFX：`src/config/sfx.ts` + `Sfx.playSfx(id,minGapMs,rate?)`，**必须节流**（触发点在 update）。
  ★★ **`minGapMs` ≥ 素材时长**（否则每次 new 新实例叠着响=糊）；`rate<1` 拉长时长，间隔同步放大；
  rate 必须在 `play()` 之前设。
- 循环轨：`playLoopSfx/stopLoopSfx` + `LOOP_SFX` 表，**按 src 分轨**（`loopTracks: Map`）可多轨同响。
  ★★ `LoopTrack.target` 不能省（每帧调时只有目标真变才重 fade，否则每帧打断=指数逼近=短动作没声）；
  `LOOP_FADE_MS=220`；素材必须做过无缝循环。
- ★ 水里持续游动 = 连续循环轨（`WorldMode.updateWadeLoop` 每帧裁决）。硬经验：
  ①选**平坦段**（判据=40ms 窗 RMS 包络起伏，不是 LUFS）；**动作层做主层**、连续层只填空隙；
  ②音量别给太低（一次性音效默认 vol=1.0）→ 现随机 vol 0.45~0.62 + rate 0.80~0.92；
  ③这版 ffmpeg `acompressor` 救不了 peak 贴顶的短素材 → 换选段/调音量，别死磕压缩。

## ★ 遗物 / 物品 / 抽卡 / 文案播报

- **新增遗物改三处**：`config/relics.ts` + `services/item/ItemIconRegistry.ts`（`FTX_ICON_SOURCES`=**图标唯一真源**，漏=空白）
  + `config/gachaPool.json`（`outOfRunItems`，否则抽不到）。
  ★ 别把 `FTX_ICON_SOURCES` 改成从 relics 派生（值导入拖进 core 初始化链 → 全灭，试过回退）。
- 查 id 是否合法：`items.json`(普通) / `relics.ts`(遗物) / `ItemIconRegistry.ts`(图标) / `gachaPool.json`(能否抽) / `Session.ts`(开局自带)。
- ★★ **遗物绝不进背包**：只住 `session.outOfRun.owned`。`applyEffects` 有双向防呆（勿删）；
  老存档矫正走 `SaveSystem.sanitize()`（load 里调，幂等）——**改配置不改存档 = 用户看着没修好**。
- 抽卡分档：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%（BOSS 独立优先判定不占权重）。
- ★ **用户贴的剧情文本一律逐字照抄，禁止润色**；落地后必须机器校验（一次性 .py 深比较 + difflib，跑完删）。
  真源 `config/dialogues.json`（顶层 `trees`）；effects `item/relic/random_relic/flag/heal`；随机遗物用 `random_relic`。
- ★ 给玩家东西 = 走 `WorldUIManager.showPickupResult`（唯一播报渠道），成功再 `flashItemAndRefresh`；
  取名走 `displayNameOf()`（否则播报成 `black_crown`）。`DialogueSystem` 零 DOM，只回调 `onGrant`。

## ★ 其他模块约定

- 访客：加访客只改 2 config（`config/visitors.ts` + `dialogues.json`）；模型 Quaternius Cube Guy，`faceMode:'plate'` 换脸；
  模型轴 `y`=前后(脸朝 -y)、`z`=高、`x`=左右。详见技能 `threejs-glb-model-swap`。
- 小游戏：加新游戏 = 丢文件进 `src/minigames/games/`（零索引改动，`import.meta.glob` 自注册）；
  壳 `MiniGameOverlay` z-index 300；`exit()` 第一件事 `closeMiniGame()`。
- ★★ **UI 入口显隐＝两级控制**：`settingsAllowed`（模式级，只有 BaseMode 为 true）+ `settingsSuppressed`（页面级）
  → `applySettingsVisible()` = `setVisible(allowed && !suppressed)`；页面调 `globalThis.setSettingsSuppressed(bool)` 压制。
  ★★ **凡左上角有返回键的全屏页，show()/hide() 必须成对压制 / 恢复齿轮**（已接：`CraftingOverlay`、`GachaOverlay`）。
  返回按钮统一 `ui/components/BackButton.ts`；性能 HUD 默认隐藏。
- 房间/基地视觉：`RoomDecoGeo` + `RoomSurfaceMaterial` + `ui/base/RoomDecor.ts`。
  ★ ShaderMaterial 检查清单：frag 每个自定义 uniform 都要声明（含 uTime）；GLSL 禁尾随逗号；末尾 `#include <colorspace_fragment>`。
  漏一条 = 该材质全部 mesh 不渲染（房间整片消失）。

## ★ 架构治理

- 头部过重：`WorldMode.ts` ~~4129~~→3565（P1 后）、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。
- ✅ 已完成：P0-a（setPhase 收口）/ P1（拆 WorldSpawner）/ P2（删死代码 + `npm run guard`：行数上限 + 不变量退化 + 配置三处同步）。
- ⏸ 未做 P0-b（BgmKey 改 keyof 派生）；下一刀建议 `ChunkManager.ts`。
- **真正让项目膨胀的是「人肉同步」**：不变量靠注释 + 记得改 N 处；WorldMode 是默认垃圾桶。
- 拆大类流程见技能 `god-object-extraction`：成员起止行定位（★别用花括号配平，多行签名会提前结束）→ 断言式迁移脚本
  → ★ **验证**：.py 方法体归一化后 difflib 逐行比对，「N/N 一致」才算没搬坏（**tsc 通过 ≠ 行为一致**）。
