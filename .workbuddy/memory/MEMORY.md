# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 详细流水见同目录 `YYYY-MM-DD.md`；本文件只留长期不变的约定与铁律。

## ★ 环境 / 工程习惯（先看这条）
- **bash 工具链损坏**：`ls/head/cat/dirname/cd/wc` 全 command not found → 一律用托管 python
  `~/.workbuddy/binaries/python/versions/3.13.12/python.exe -c`，或 Write 一个 `.py` 再跑。
  ★ bash 会把 `python -c` 里的**反引号当命令替换**（写 md 日志会吞内容）→ 长文本必须 Write。
- **`cd` 也坏**（`cd: null directory`）→ 在项目根跑命令唯一可靠姿势：Write `_run.py`，
  `subprocess.run(cmd, cwd=ROOT, env={PATH: NODE_DIR+...}, shell=True)`，再 `python _run.py npm.cmd run build`。跑完删。
- **node/npx 用托管版** `~/.workbuddy/binaries/node/versions/22.22.2-3`（加 PATH 再 `cmd /c npx`）。
  tsc：`node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。
- **项目没有 git** → 删/改前备份 `.workbuddy/tmp/`；死代码证据留 `.workbuddy/deadcode/`。
- `vite.config.ts` **没设 base**（产物绝对路径 `/assets/...`，子目录托管会 404 白屏）。
- 沙箱**不能监听端口**（vite dev/preview 起不来）。无系统 ffmpeg → 用托管 venv 的 imageio-ffmpeg。
- **用户可能在玩游戏 → 不擅自跑游戏内实测**（抢 GPU、误归因）。要实测先问。
- 沟通：**直接、简短、可验证**，给数字，说清改了什么 / 踩了什么坑 / 回退了什么。

## ★ 时间 / 昼夜 + 阶段收口（2026-09-18）
- 唯一入口：`main.ts` 无条件调 `renderManager.update(dt)` → `SunCycle`。`DAY_SECONDS=900`、`START_HOUR=6`。
- ★★ 不变量：**禁止「敌人不动 + 时间照常流逝」**。舱内要么时间暂停要么敌人照跑 → 选了「全冻结」。
  凡 `WorldMode.update` 里直接 `return` 冻结世界的分支，必须同步 `setClockPaused(true)`。
- `setClockPaused` 只停太阳/昼夜，不影响 scaledDt（房间行走照常）。接线：enter 复位 / 进舱 true / 出舱 false / 船毁结算 true / revive false。
- `phase==='interior'` 与 `shipDestroyed` 时 update 直接 return → 实体/敌人/定时遗物全停。
- ★ **`WorldMode.setPhase(next)` 是 phase 变更唯一入口**（P0-a）：环境/飞行/昼夜冻结/水面/粗块/涉水轨/BGM 全在里面。
  改阶段**不要直接 `this.phase =`**，否则副作用不触发（护栏盯着）。音频三级优先：`syncSceneBgm()` = sail 静音 > battle(`spawner.warnShown`) > interior/explore。

## ★★ 刷怪子系统 `src/systems/spawn/WorldSpawner.ts`（2026-09-18 建立）
- 用户定调：**刷怪/波次必须与蜂群引擎解耦**（他后面要大改蜂群）。刷怪=玩法层，蜂群=引擎层，
  只通过 `SwarmSystem`+`swarmHooks` 对话。**改引擎别动 WorldSpawner**。
- WorldMode 只留 `private spawner!: WorldSpawner;`，构造在 `enter()` **最开头**
  （否则 `setPhase`→`syncSceneBgm`→`spawner.warnShown` 崩）。
- 依赖走 `SpawnDeps`（getter/setter 桥）拿实时值；★ 别改成构造时快照（WorldMode 会重赋 `this.enemies=[]`）。
- 回调三项 `showFloatingAt`/`syncSceneBgm`/`returnToBase`；`get warnShown()` 供 BGM 判战斗曲。
- **★ 加新刷怪逻辑 = 写进 WorldSpawner，别写回 WorldMode**（`npm run guard` 会 FAIL）。

### ★★ 症状「敌人不生成」排查顺序（实战）
先别怀疑代码搬移（已用「方法体归一化 difflib」证等价）。按闸门链自上而下：
1. `phase!=='explore'`（卡 sail 一只不刷）2. `testChunk||mobDefs.length===0` 3. `spawnedChunks`（每 chunk 一波，每局 reset）
4. **`quotaAllows()` = `quota − spawned > 0`** ★头号嫌疑 5. `preloadCap=ambientTarget/2`（扫描预铺只铺一半）6. `MAX_ALIVE=200`
- ★★ `spawned` 是**当天累计生成数**，只增不减、跨出击累计；只有换日（`everDeparted!==meta.day`）才 resetDayQuota。
  → **「一只都没有 + 删档就好」99% 是配额打满**。★ `meta.day++` 只在 `onReturn` → **刷新/强退不换日**。
- 已加兜底：`quota<=0`（未初始化）时放行 + warn，避免卡 0 永久不刷、换日也救不回。
- 已加配额耗尽提示（威胁标语「已肃清」+ 一次性公告 + 飘字）。

## ★ 敌人 LOD 三层（2026-09-17）
| 层 | 半径(距玩家) | 表示 |
|---|---|---|
| L3 实体 | 升 35m / 降 40m | EntityManager EntityBase |
| L2 代理 | 80m | `swarm.pool` |
| L1 回收 | 140m 外删除 | — |
- **索敌半径 > 35m 的单位「看不见敌人」**（查的是 EntityManager，远处只有代理）。
  修法：开代理层通道（查 pool + `swarm.damageAgent`），**别**把远处敌人升格（占满 `L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 代理下标**每帧重锁**，绝不跨帧缓存（v2 编队 id 同此约束）。

## ★★ 蜂群 v2 设计（2026-09-18，文档 `全新的游戏/蜂群架构.md` §11~§21，待实施）
- 三级：**大编队 Battalion**（战术：任务/目标、跑 **一次** HPA*、姿态机、兵种配比）
  → **小编队 Squad**（执行：复用走廊 + 局部修正 + 分车道）→ 个体/代理。
- ★ 编队层次**正交于 LOD**：`squadId` 跨升降格持久（L3↔L2 切换必须携带 `squadId/uid/formSlot/corridorIdx`）。
- ★ 寻路升级为 **HPA\* + 走廊带**（现有 FlowField 只 324m 窗口、窗外直线撞墙 → 「找不到玩家」根因）。
  cluster 32m / portal 图 / 簇内路径缓存 / funnel 平滑 / `CorridorNode` 带 halfWidth（小编队据此分车道）。
  降级链：HPA* → FlowField → 直线（**绝不能「找不到路就不动」**）。
- ★ `AgentSnapshot` 必须补 `squadId/uid/formSlot/corridorIdx/intent/bias/aggro/wanderSpeed`。
- ★ 迁移 **F0（容器 + 调试可视化）先行**，再 F1~F5（编队 / P→HPA* / 车道 / 角色 / 远程兵）。
- ★ **地形战术 §21**（2026-09-18 追加）：序盘 `scout→seize→fortify→encircle→assault`，序盘**不开火**(ROE=hold)。
  ★★ **portal 图 = 山脚守点来源**（高地簇与邻簇的 portal 即隘口，前移 2~4m）；远程占顶缘、近战守隘口、
  突击做预备队；包围圈环上优先吸附高地**但必须闭合**。铁律：ROE≠停摆 / 据点必须给玩家解法（不许无解堵路）/
  选点只算一次不每帧重打分 / 任何姿态都要有超时兜底。
- ★ **防御工事 §22**（2026-09-18 追加）：「敌人会造工事」。`fortify` 时**杂兵兼任施工**（掩体/路障/火力点，
  ★ 用户裁定**不设工兵兵种**），★★ **两阵营通行掩码**：工事对玩家=阻挡，**对敌人己方=高代价但可通行**（否则 AI 自锁）；
  ★ 工事改导航**必须标脏 cluster**；**必须可摧毁 + 不许封死唯一通路**；随波次清理、不入存档。
- ★ **绕后偷袭 §23**（2026-09-18 追加）：★ **总攻必须有 1~2 组偷袭分队**（硬上限 2，
  抽调后正面不低于 `MAIN_FORCE_MIN`=60%）。路径 = **第二条侧翼走廊**（同一套 HPA* + 可见度代价），
  终点 = 目标背向 ±90°；`assault` 号令后**延迟 1~2s** 发动（正面先接火）。★ 两条兜底铁律：
  **必须给可察觉线索**（不许无提示背刺，12m 内隐蔽失效）/ `AMBUSH_TIMEOUT` 20s 到点并回正面。
  ★ §21.6「反斜面 assault」就是偷袭分队的预置形态 —— 不是新系统，是既有件重组。
- ★ **两级火力 + 陷阱 §22.9 / §24**（2026-09-18 追加）：**普通远程兵 = 机动单位**（`ranged`）；
  **高危火力点 = 固定工事，高位 + 藏在工事之后**（纵深两层：外层工事吃伤害遮视线 → 内层火力点，
  `FP_LOS_BLOCK`）。★ 铁律：**不许"看不见又打不到"的死角**（解法=侧面/绕后·间接火力·拆外层，
  ★ 正好由 §23 偷袭从背向端掉）。**陷阱**=诡雷/绊线/陷坑，**不是障碍**（★ **不参与 HPA*、不标脏 cluster**，
  与工事相反），**己方无害**（`passFaction`），**必须可察觉**（线索/敌人绕开轨迹/可侦察/可提前引爆）；
  ★★ **工事缺口就是最好的陷阱位**。
- ★ **飞行兵 §25**（2026-09-18 追加）：★ 用户主动要的**减法** —— **只做轰炸、绝不缠斗**（持续空中攻击"怪恶心"）。
  出击循环：待机→进场→**投弹一次**→撤离→冷却 12~20s；单组上限 `MAX_AIR_SQUADS=1`。
  ★★ **不参与地面寻路**（独立空中层：直线+避障；飞越工事、不踩陷阱）→ SoA 加 `isAir`/`altitude`。
  ★ 落点**预警 + 延迟引信**（玩家可躲）；投弹航段最脆。★ 必须有**防空威慑**（火力点兼对空），否则万能解。

## ★ 音频（BGM / SFX / 循环轨）
- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`(warnShown 期间)。
- 曲目真源 `src/config/bgm.ts`；★ 加键必须同步手写 `BgmKey` 联合类型（漏了=TS2353，踩过两次）。
- SFX：`src/config/sfx.ts` + `Sfx.playSfx(id,minGapMs,rate?)`，**必须节流**（触发点在 update）。
  ★★ **`minGapMs` ≥ 素材时长**，否则叠着响=糊（涉水 0.73s/330ms 就是这坑）；`rate<1` 拉长时长，间隔同步放大。
  rate 走 WebAdapter `a.playbackRate`（**必须 play() 之前设**）。
- 循环轨：`playLoopSfx/stopLoopSfx` + `LOOP_SFX` 表，**按 src 分轨**（`loopTracks: Map`）可多轨同响。
  ★★ `LoopTrack.target` 不能省 —— 每帧调 `playLoopSfx` 时只有目标真变才重 fade，否则每帧打断=指数逼近=短动作没声。
  ★ `LOOP_FADE_MS=220`；循环素材必须做过无缝循环（主体 + 尾淡出 amix 叠回）。
- ★ 水里持续游动 = **连续循环轨**（`WorldMode.updateWadeLoop` 每帧裁决）；入水随机 rate/volume、轨内固定。
  ★★ 循环轨硬经验：①选**平坦段**（判据=40ms 窗 RMS 包络起伏，不是 LUFS）；**动作层做主层**、连续层只填空隙；
  ②音量别给太低（一次性音效默认 vol=1.0）→ 现随机 vol 0.45~0.62 + rate 0.80~0.92；
  ③这版 ffmpeg `acompressor` 救不了 peak 贴顶的短素材 → 换选段/调音量，别死磕压缩。

## ★ 遗物 / 物品 / 抽卡 / 文案播报
- **新增遗物改三处**：`config/relics.ts`（效果走 `core/RelicEffects.ts` 注册表，核心零改）+
  `services/item/ItemIconRegistry.ts` 的 `FTX_ICON_SOURCES`（**图标唯一真源**，漏=空白）+
  `config/gachaPool.json` 的 `outOfRunItems`（否则抽不到）。
  ★ 别把 `FTX_ICON_SOURCES` 改成从 relics 派生（值导入拖进 core 初始化链 → 全灭，试过回退）。
- 查 id 是否合法：`items.json`(普通) / `relics.ts`(遗物) / `ItemIconRegistry.ts`(图标) / `gachaPool.json`(能否抽) / `Session.ts`(开局自带)。
- ★★ **遗物绝不进背包**：只住 `session.outOfRun.owned`。对话 kind 写错会双写 → `applyEffects` 有双向防呆（勿删）。
  ★ 老存档矫正走 `SaveSystem.sanitize()`（load 里调，幂等）：**改配置不改存档 = 用户那边看着没修好**。
- 抽卡分档：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%（BOSS 独立优先判定不占权重）。
- ★ **用户贴的剧情文本一律逐字照抄，禁止润色**。落地后必须机器校验（一次性 .py 与 `dialogues.json` 深比较 + difflib，跑完删）。
  真源 `config/dialogues.json`（顶层 `trees`）；effects 五种 `item/relic/random_relic/flag/heal`；随机遗物用 `random_relic`。
- ★ 给玩家东西 = 走 `WorldUIManager.showPickupResult`（唯一播报渠道），成功再 `flashItemAndRefresh`；
  取名走 `displayNameOf()`（否则播报成 `black_crown`）。`DialogueSystem` 零 DOM，只回调 `onGrant` 给模式层上屏。

## ★ 其他模块约定
- 访客：加访客只改 2 config（`config/visitors.ts` + `dialogues.json`）；模型 Quaternius Cube Guy（7 名共用，CC0），
  `faceMode:'plate'` 换脸；模型轴 `y`=前后(脸朝 -y)、`z`=高、`x`=左右。详见技能 `threejs-glb-model-swap`。
- 小游戏：加新游戏 = 丢文件进 `src/minigames/games/`（零索引改动，`import.meta.glob` 自注册）。
  壳 `MiniGameOverlay` z-index 300；`exit()` 第一件事 `closeMiniGame()`。
- UI：「关闭/返回上一级」统一 `ui/components/BackButton.ts`；设置入口仅基地显示，z-index > 遮罩；性能 HUD 默认隐藏。
- 房间/基地视觉：`RoomDecoGeo` + `RoomSurfaceMaterial` + `ui/base/RoomDecor.ts`。
  ★ ShaderMaterial 检查清单：frag 用到的每个自定义 uniform 都要声明（含 uTime）；GLSL 禁尾随逗号；末尾 `#include <colorspace_fragment>`。
  漏一条 = 该材质全部 mesh 不渲染（房间整片消失）。

## ★ 架构治理 + 拆大类（2026-09-18，全仓 240 文件 / 66.6k 行）
- 头部过重：`WorldMode.ts` **~~4129~~→3563**（P1 后）、`map/ChunkManager.ts` 3480、`ui/base/GachaOverlay.ts` 1760、`vendor/.../FluidSolver.ts` 1504。
- ✅ 已完成：P0-a（setPhase 收口）/ P1（拆 WorldSpawner）/ P2（删死代码 + `npm run guard`：行数上限 + 不变量退化 + 配置三处同步）。
- ⏸ 未做 P0-b（BgmKey 改 keyof 派生）；下一刀建议 `ChunkManager.ts`。
- **真正让项目膨胀的是「人肉同步」**：不变量靠注释 + 记得改 N 处；配置真源不单点；WorldMode 是默认垃圾桶。
- 拆大类流程：①备份 ②用**成员起止行**定位（声明 → 下一个 2 空格缩进 `  }`；★别用花括号配平，多行签名里的 `{...}` 会提前结束）
  ③顺带搬走「声明在原类、只被搬走段引用」的字段 ④迁移脚本每段**断言首尾行文本** ⑤★ **验证**：.py 把方法体归一化后
  difflib 逐行比对，跑出「N/N 一致」才算没搬坏 —— **tsc 通过 ≠ 行为一致**。
  → 已沉淀技能 `god-object-extraction`（含 `member-ranges.py` / `verify-move.py`，本项目实战跑通）。

## ★ 音效素材 / 加工
- Mixkit 直链：分类页 `https://mixkit.co/free-sound-effects/<tag>/`；**拿 id** = 抓 HTML，标题文字往前回溯最近的
  `active_storage/sfx/<id>/`；**下载** `https://assets.mixkit.co/active_storage/sfx/<id>/<id>-preview.mp3`（preview=完整素材）。
- ffmpeg：裁段 → `amix` 分层 → 尾 0.2~0.3s 淡出叠回（无缝循环）→ volume 归一 -1.5dBFS → 64kbps 单声道。
  ★ `afade=t=out:st=S:d=D` 是**从 S 起一直静音**，要淡出必须 `st=<末尾时刻>`；`loudnorm` 对 1~2s 短音效失效；
  `alimiter` 不生效 → 用 `volume=<target/current>` 手动归一；不能原地写文件（临时文件 + move）。
