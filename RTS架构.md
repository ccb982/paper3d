# RTS 架构（当前态总纲 · 2026-09-25 重写）

> 单一真源：本文描述**现状架构**（已实现 + 已定稿待实现会标注）。
> 一句话总纲：**宏观有序、微观无序——"能在无序中稳步朝舰船方向推进，就是最理想的架构"**。

## 文档地图（敌人管线 / 蜂群引擎 · 2026-09-24 收敛）

> 📐 **重写进行时**：游戏逻辑四层（引擎 / 小队 / 代理 / 基类 / 寻路）重写方案见《**蜂群重写计划.md**》——
> 命令收敛：引擎「保护 / 行动 / 防御」→ 队长「巡逻 / 驻守 / 行军 / 行动」（行军=长寻路 / 行动=短跳）；
> `SectorManager`（扇形防区：安全度 / 在编 / 工兵派遣）+ `SquadManager`（每队一条记录 / 状态汇报 / 信息单源）显式化；
> 能力规范化（爬坡 / 爬掩体 / 脱困 / 计时销毁）；**队长不给代理下命令，代理只跟队长**。

| 文档 | 定位 |
|---|---|
| **本文（RTS架构.md）** | **唯一真源**：分层/命令链/寻路/工兵/时间尺度/参数/里程碑/验证防线 |
| 《蜂群重写计划.md》 | 重写施工图（P0~P3 已落，P4 收尾中）+ 铁律 G1~G9 |
| ~~《全新的游戏/敌人管线设计.md》等 5 篇~~ | **已删**（2026-09-25：旧指挥链/工兵链销毁后设计已收编进代码与本文；git 可回溯。5 篇 = 敌人管线设计 / 寻路与导航架构 / 小队战术与命令 / 工兵架构 / 实体架构） |
| ~~《全新的游戏/敌人管线重构总纲.md》~~ | **已删**（2026-09-24 收敛：P1-P5 施工图已完成；git 可回溯） |

> 代码注释中残留的《…》引用为**历史标注**，不再维护；以代码 + 本文为准。

---

## 0. 三条根本原则

1. **宏观有序（引擎统一设定）**：目标（朝舰推进）、边界（事态环）、分布（切向均匀）、序位（前/后排层级）。
2. **微观无序（队自决）**：各队自主寻路/走位/队形；允许绕、散、慢；不要求步调一致。
3. **引擎只在四类时刻介入**：① 事态变动 ② 队重伤（血比<0.5）③ 扎堆（同种兵<50m）④ 磨蹭（30s 净<3m 且路径>15m / 反转≥6）；其余时间**少发令**。
4. 验收看宏观：全队**离舰距离均值单调下降**；局部乱不扣分。

## 1. 分层

| 层 | 职责 | 代表 |
|---|---|---|
| 战略 | 事态函数/环形活动区/波次节奏（**数据面**） | `data/SwarmData`（frontP/ringBounds/t01/波次触发）；决策 = `engine/EngineBridge` |
| 战术 | 兵种角色纵深、队间分布（切向/扎堆/层级）、兜底 | `BattleLine`、`fallbackTick`（dawdle/tangent/rank_fix） |
| 队级 | **队长层（唯一执行）**：接令 → 长寻路/走廊 → 锚点 → 成员调遣（围队长）→ 汇报 | `squad/SquadCore`、`SquadNavigator`、`Anchor`、`Formation`、`Decompose` |
| 个体 | 移动/施工/攻击 | `SwarmSystem.move`、`EngineerCorps`、`EnemyBrain` |
| 底座 | 地形/实体/渲染/物理 | `PassTable`、`EntityManager`、`CharacterFxManager`、`PhysicsWorld` |

## 2. 模块地图（rts/src）

```
order/OrderBus.ts          命令单源 + 3D 令牌（红=引擎/橙=队长/蓝=玩家）
rts/FastLane.ts            快车道（代理直扣 / 实体走管线）
ui/EnemyManager.ts         选择（单击/框选/Shift/Esc）+ 红圈
ui/EnemyListPanel.ts       兵种→队长→代理 三级树 + 命令/指令显示
ui/NavDebugMap.ts          命令检视地图（走廊/起终点/扇区/上下限；可缩放）
ui/Timeline.ts             时间轴（06:00-18:00 拖动=绝对进度；,/. 调速 1~100×）
ui/SpawnSelect.ts          开局小地图选点（可换种子）
debug/AiTrace.ts           AI 可读记录（JSONL/中文摘要）
systems/swarm/data/SwarmData.ts 蜂群**数据面**（无指挥语义）：地形/表/L1-L2/事态环/t01/工事数据/编制与生成执行（CommanderSpawn）
systems/swarm/engine/      蜂群引擎（唯一指挥链）：EngineCore 相位 tick（perceive→situation→decide→write）/ 四兵种管理器（含 **EngineerManager：建造位置查询+施工计时+落地**）/ OrderWriter 唯一发令 / SquadManager 汇报 / OrderValidator+Spread / Protect / AttackQueues
systems/swarm/squad/       队长层：SquadCore 接令/距离分流/汇报（只导航，不给代理下命令）；Anchor/Formation/Abilities
systems/swarm/            地形/工事数据/寻路/刷怪（Commander 只剩事态环/波次/地形表/L1-L2/工事数据查询；战斗+工兵指挥链已删）
systems/swarm/squad/SquadCore.ts 队长核（**唯一执行层**）：接令→寻路→锚点→成员调遣（applyDirectivePort）→汇报
systems/swarm/squad/State.ts     队长执行态（路径缓存/锚点滞回）；Decompose.ts 分解矩阵（自旧黑板归位）
systems/swarm/engine/SquadView.ts UI/探针**只读视图**（引擎令+汇报+队长核执行态；旧镜像板已删）
systems/swarm/FortifyPlanner.ts 建造位置查询（危险点优先 → 扇区弧链随机可达点；新引擎经 engineerPort 消费）
systems/spawn/WorldSpawner.ts  刷怪 + 官方 tierPort（promote/demote）
systems/ai/               行为状态机（AISystem + behaviors）
systems/combat/           弹道/命中结算
services/map/**           地形管线（ChunkManager/RasterMap/…+5 worker）
services/physics/**       rapier 物理
entity/**                 实体基类/敌人/舰船/角色
entity/TerrainAssist.ts   爬山共享基础方法（坡正面混合 + 上岸爬岸；L2+L3 同内核）
modes/world/CommanderWiring.ts 指挥器端口接线
```

## 3. 地形与语义表

- **一次性加载**：固定世界 ±4 chunk（480m）；`BUILD/PREFETCH=16`、`PARK/DESTROY=99`（**只建不删**）；近=细块（单档，无 LOD 切换）、远=粗块（固定世界内）。
- **PassTable（可行性表 · R41 重写）**：五值（自身高度 + 四向边 可走/净落差）；**边型 = 地形表裁决**（`Refinements.finalRuling`：`weld`/`cliff`，**与渲染同源**：`RasterMap.chunkSource` 的 refined 源）；**格原点对齐块格**（4m = `BLOCK_SIZE`，1:1 → 格心即块心，高度/角色/裁决逐位一致）。规则（用户定 2026-09-24）：
  - **坡面 `weld`**（水/坑无条件焊 + 30% 大落差产坡 + `smoothDirs`）→ **普通可行边**（双向，不特殊处理）；
  - **硬边 `cliff`**：落差 ≤ `EDGE_CLIFF_BAND`(0.6，**与移动层同源常量**) → 可走（平地地块间零落差也走这条）；落差 > 0.6 → **上不可行（墙）、下可行**；
  - **深坑边**（`role=pit && h<−1.2`）→ **始终不可行**（双向禁）。
  - 旧的"离散落差"启发式（`DS/STEP_RATIO/STEP_BIAS` + 0.4m 剖面采样）**已删**；建表 730ms → **3.5ms**。
  - 水=正常地块（可走；仅 `TerrainScore` 建表软降分 −0.6）。
- **评分动态化（不固定相加）**：
  - 空间混合：`k=1−shipD/DIST_SCALE`；近舰距离权重>地形（守家）、远舰地形>距离（野战）；`NEAR_DIST_BOOST=8`、`NEAR_TERRAIN_DAMP=0.35`。
  - **时间增益**：`distGain=1+24·t01`（日终 ×25，**彻底碾压地形**）。
- **待做**：破坏 → 表脏区重建（当前表一次性）。

## 4. 事态函数 = 环形活动区

**语义**：上限=最远允许、下限=最近允许（距舰半径）；收拢态（上限<下限）→ 上限主导。

**一日推进（`ringBounds`，用户定）**：
| 时段 | 环 | 含义 |
|---|---|---|
| 0.00-0.20 | 宽环 `(ffrontD−80, ffrontD+80)` | 开局 |
| 0.20-0.45 | → 大圆 `(0, 90)` | 收拢 |
| 0.45-0.62 | 大圆 `(0, 90)` | **第一波**：可到舰、不许跑远 |
| 0.62-0.72 | → 甜甜圈 `(60, 180)` | 回撤 |
| 0.72-0.80 | 甜甜圈 `(60, 180)` | 休整 |
| 0.80-0.88 | → 点 `(0, 0)` | **总攻**收拢 |
| 0.88-1.00 | 点 `(0, 0)` | 驻留 |

**硬约束（全链）**：
1. `clampToRing` 单源：引擎令（`OrderValidator`①）+ 队长核（`SquadCore` port.clampRing）+ **锚点/站位**（resolveAnchor 结果）全部夹环；撤退/`rear` 豁免。
2. 越界强制归位：~~已删（新引擎目标全程夹环）~~。
3. 第一波时段起停止新增施工（既有件收尾）。

**波次与兵力放行（2026-09-25 迁入引擎）**：`EngineBridge.situation` 按 `t01`（落地起算）+ `releaseAt(t01)` → `setReleaseCap` + `spawnBattalion(instant)`（第一波 0.45 / 总攻 0.80）；`t01` 回退（换落点/新一日）自动复位波次。**指挥官只留生成执行（`CommanderSpawn`）与地形/工事数据**；`wave1Active` 真源 = 引擎（抵舰驻留消费）。

## 5. 指挥与命令

- **单源**：`SquadOrder{kind,target,mission,anchor,seq,ttl,source,roe}`；一切令走引擎 `OrderWriter`（`OrderValidator` 校验链：环内/密度/可达）。
- **发令冷却（替代时效）**：同队 **8 游戏分钟**内同签名同目标不再发；引擎令 TTL≥60 游戏分钟存活；例外：事态签名变 / 队血比<0.5。
- **四类介入**（§0）：事态变动 / 重伤 / 扎堆 / 磨蹭——各自 30 游戏分钟队级冷却。
- **成员分派归属（2026-09-25 换装定稿）**：**只有队长和蜂群引擎发命令**；成员只跟队长走。`squad/SquadCore.drive` = 队长层**唯一执行**（寻路/锚点/阵型/指令落地 `swarm.applyDirectivePort`：池列 + L3 `onDirective`）；引擎只发队令（`OrderWriter` / `EngineBridge`）。
- **成员指令门 `OrderGate` 已删**：成员目标 = **队长 + 槽位偏移**（相对队形，天然平滑），不再需要"绝对目标换令门"。
- **玩家令优先（R14 前置最小接线，2026-09-24）**：引擎发令门（`issueChecked`）与队长自主令遇**未过期玩家令**一律不覆盖；玩家令 TTL 30 游戏分钟。UI：**右键点地 = 强制移动令**（选中队全员 `advance`，`source='player'` + `OrderBus` 蓝令牌）。
- **手动放敌（调试接口，2026-09-24）**：`B` 切换放置模式 → **左键点地放一窝**（`WorldSpawner.spawnOne(..., force=true)`：忽略水/坑不可站与存活上限，**可放水里/坑里**）；用于手测"掉水里能不能出来"。探针同口：`__rts.placeEnemyAt(x,z)` / `__rts.forceMoveSelectionTo(x,z)`。
- **命令保护 `OrderGate`（已删，2026-09-25）**：旧"成员指令门/队长令门"随执行层换装移除；现由 `OrderWriter` 稳定门（进度≥50%/静止≥25s）+ 成员围队长（相对槽位）取代。
- **"到位 + 远目标"立即接（R43 修）**：已到旧目标（`dArrive ≤ arriveR`）且新目标远于 `retarget`（成员 8m / 队长 15m）→ **立即接**，不再等候选稳定 `persistS`（36 实秒 > 卡死窗口 25s → 队长到点冻结 → 全队冻结 → 先被回收）。
- **干预（磨蹭纠正，2026-09-25 迁入）**：`EngineBridge.interventionTick`（1Hz；观测窗 30 游戏分钟）净<3m 且路径>15m / 反转≥6 → 沿现令向前 20m → 走 `DecisionChain.intervention` 槽（工兵除外）。
- **第一波抵舰驻留（2026-09-25 迁入）**：`wave1` 后进攻令（act/march）抵舰 70m 内 → **驻守 45s**；期间血比 <0.45 → 后撤；到期交回常规；玩家令不覆盖（波次决策源，引擎内）。
- **换令稳定门（R45 用户定 2026-09-24）**：引擎发令口（`OrderWriter`）**换令**（kind/目标与现令不同）需 **①现令进度 ≥50%** 或 **②长时间静止**（无净推进 ≥25 实秒）——否则保持现令（`ORDER_STABLE`，`writer.dbg.kept/last` 可查）。同签名重发/玩家令/重伤（血比<0.5）照旧。
- **命令风暴根因与修（R45）**：引擎 1Hz 决策每拍重算目标/使命，原来任何字段差都算新令。已修：①驻守掩体 `coverIdx++ % len` 轮转（每拍换掩体）→ 改**最近掩体**；②`addPatrolSwing` 游弋摆动**写进命令**（每拍动 + 跨 far 滞回致 kind 翻）→ 命令只发**稳定驻守点**，摆动归执行层 `resolveAnchor`；③层级越位/扎堆纠正**每拍重发** → 改"**一次纠正 + 条件解除才允许再发**"（`rankFix/clumpFix`）。**实测：探针 `cmdChanges` 37 → 5（同窗口）**。
- **同兵种目标间距（用户定 2026-09-24）**：新引擎发令统一校验链 ②（`OrderValidator` + `Spread`）：同兵种目标 < `MIN=40m` → **只改切向 θ（极坐标，半径严格不变）**，目标点 = 径向 r（兵种策略）⊗ 切向 θ（间距）；几何不可满足（r<20m）→ θ 拉满 π。异兵种不约束。
- **施工件粘性（R45 修）**：`assignBuild` 已派未建件**保持**——事态闸门只管"新派"，不夺已派件（原 `!gated(cur)` 会让环推进把在途件判丢 → 重挑 → 目标瞬移百米 + 半路折返）。
- **仍待修**：护工锚=工程队实时质心（目标漂移）；派件弧链随机（设计内：件跳但被稳定门拦到过半）。
- **旧战斗指挥链已删（2026-09-25 用户定）**：`tacticalTick`/`dispatchMission`/`fallbackTick`/事态强制归位/`SquadLeaderAI`/`SquadDispatch`/`OrderGate`/`SquadTactics`/`CommandLedger` **全部删除，无回退开关**（`?swarm=old` 已移除）。数据面收编进 `data/SwarmData`（事态/环/t01/编制/工事数据/地形表/L1-L2）；**战斗队只由新引擎发令**。
  - **命令生命周期**：引擎 `OrderWriter` 为唯一发令器（换令稳定门：进度≥50% / 静止≥25s；玩家令 TTL 30 游戏分钟；到期释放交回引擎）。执行侧由队长核接令，无旧板续期。
  - **能力回流**：抵舰驻留已迁波次决策源；磨蹭纠正/守点粘性按用户要求**已删除**（层级越位/扎堆由 `Spread`/`RangedManager.STANDOFF` 天然承担）。

### 5.1 复合命令 → 原子能力（队长层条件表；唯一实现 `squad/AtomicSelect.ts`）

> 引擎只发复合令（`engine/Composites`）与双点（`engine/Protect` 只给 G/P，不算锚）；
> **队长按现场选原子**（行军=长寻路 / 行动=短跳 / 驻守=原地 / 巡逻）；规则如下，改规则只改这一个文件。

| 复合（引擎→队长） | 条件 | 原子 | 目标点 |
|---|---|---|---|
| **protect**（保护：G=被保护队长位，P=玩家位） | `blockCheck(P,B,G,'block')` **已挡住** | `garrison` | 原地（保持阻挡，不挪窝） |
| | 离 P 太远（出 standoff 带） | `march` | **调整点**（P→G 线上、离 P=STANDOFF） |
| | 偏了 / 不在带内 | `act` | **调整点** |
| **act**（去某点） | 到锚点 d > 40m | `march` | 锚点（走廊前瞻） |
| | 1.5m < d ≤ 40m | `act` | 锚点 |
| | d ≤ 1.5m | `garrison` | 锚点（到位驻守） |
| **defend**（守对象/守原地） | 锚先过 `resolveAnchor`（绕掩体/反斜/掩体复核）→ 同 act 三分 | `march`/`act`/`garrison` | 对象 / 自身位 |
| **patrol**（原子直令） | 同 act；到位驻留口径由 `onArriveAtom` 定 | `march`/`act`/`garrison` | 锚点 |

> **调整点即寻路目标**（用户定 2026-09-24）：protect 未挡住时，队长把执行态目标覆盖为调整点 → 走廊朝调整点 → **到点再校验**（收敛到真挡住）。

## 6. 寻路

- **分工（用户定）**：**长行军=长寻路**（`FeasibilityPath`）；**短程（交战/巡逻/驻守/就近施工）=短寻路**（LOS 10m 贪心短跳）；判据 `LONG_PATH_DIST=40m`。
- **长寻路（爬山优化 2026-09-24）**：表图**坡度加权 A\***（八向 octile 启发，可采纳）+ LOS 拉直——**上坡 +0.6/米**（偏好缓坡/垭口，不再直爬陡面）、斜向 ×1.414；**可达性语义不变**（blocked/ok 与恒权 BFS 逐对一致，已用 80 随机对断言）；水=正常地块（无涉水加价）。
- **爬坡位显式标注（用户定 2026-09-24）**：可行性表每边存 `climb` 位（**坡面 weld 且净升 > 0.6**）→ 长寻路把走廊路点打 `climb` 标记（"到此点必须程序化爬坡"）；执行层按标记爬——L3 实体经 `steerEntities → moveTarget.climb → climbOrdered` 进**程序化爬坡态**（定速沿坡面梯度直推、免立面阻挡、跳过人群分离、到顶/超时退出）；**坡面不许驻留**（不朝上坡 → 下坡小推力，要么上要么下）；硬边（cliff）仍是墙不爬。实测山地走廊 21 路点 8 个带爬坡标。
- **上坡必须横平竖直（用户定 2026-09-24）**：斜向只许平/下坡（A\* 邻居 + LOS 拉直 `lineOk` + `walkableLine` 三处同规矩）——表只校 E/W/S/N 四向边，"两轴都开"≠斜线本身可走（可能切折面/脊）；`dropAt` 斜向取**更陡一轴**（原只读 E/W 轴 → 斜向上坡加价漏算）。实测：低→峰走廊 9 点斜线 → **22 点四向阶梯**；下坡仍 6 点直线。
- **短跳**：10m→6m 回落；推进>0.5m 硬门槛；安全项 `W_SAFE=4×(1−pathMul)`；**爬升加价 `W_RISE=2/米`**（偏好缓线）；**惯性**（同目标 5s 同向加分，选一个不反悔）。
- **脱困**：4s 距目标无净推进 6m → 走 LOS 长路径。
- **共享基础方法（用户定 2026-09-24）**：爬山是 **L2 代理与 L3 实体共用**的 `entity/TerrainAssist`（坡正面混合 + 上岸爬岸常量）——两载体同内核、同参数，不再各写各的。
- **执行层**：上坡走**坡正面**（fall line 混合）——**仅"明显爬坡"才拉直**（`up>0.45` 且 `mag>0.22`；混合 0.65 路径/0.35 梯度），横切缓坡不再被拉成直爬；最后一程直线被挡 → 回锚点（走廊绕）。
- **无质心 · 一切按队长（用户定 2026-09-24）**：锚点前瞻、编队朝向、寻路起点/触发（`SquadNavigator.ensurePath`）、L3 编队槽位（`steerEntities`）**全部从队长算**（`centroidOf` 不再参与跟随链）；**成员指令目标 = 队长 + 槽位偏移**，队长自己走走廊锚点——治"质心恒落后 ~8m → 锚点不前进 → 队长到位即停 → 全队冻结"。
- **成员跟队长 + 长寻路找队长（`squad/Follow.ts`）**：近 = 直线走向队长（5~8m 滞回停）；**掉队 >12m 且直线被挡**（崖/墙）→ 沿队走廊前瞻点（`squad/Anchor.corridorAhead`，队长正在走的同一条长路）绕行——不另起炉灶、不每帧 A\*。
- **锚点**：`currentTargetOf` 最近点后 **>8m 前瞻** + **锚点滞回**（新锚<6m 沿用旧锚）；长行军重算阈值 12m（短程 6m）。
- **水=正常地块（用户定 2026-09-24，彻底放开）**：涉水加价（A\* +0.35）/上岸权重（W_SHORE）/涉水限速 ×0.75/水中分离 ×0.3/出水逃逸/落水目标修正（`fixWaterTarget`）**全部去掉**——水可站可通行、同速同向。**唯一软处理**：建表阶段 `TerrainScore` 给水域格 **−0.6 软降分**（`WATER_PENALTY`；只影响选位偏好，不否决/不限速/不改向）。
- **上岸爬岸（保留，唯一水特例）**：**当前在水中**时，执行层台阶上限由 0.6m 放宽到 **`SHORE_CLIMB_MAX=2.5m`**（立面阻挡 + 位移回退同步放宽）——防"被岸坎挡住出不来"；陆地单位仍受 0.6m 限制。
- **命令纪元（`OrderGate.epoch`）**：成员指令记忆带"命令目标粗哈希"（8m）；命令目标变 = 新命令 → **记忆作废、立即接新目标**（治"改令后成员仍走旧目标"）。
- **承诺反向保护**：`pickSteer` 的承诺/迟滞**不保护与期望方向相反的方向**（`dot(held, desired) ≤ -0.2` → 重选）——治"下令往西却一直承诺往东"。
- **爬掩体（已实施）**：敌人开启，但**"沿路才爬"**——只有期望移动方向朝掩体（dot>0.6）才触发翻越，行军路过不再反复翻。
- **过掩体优化**：`SteerPick` 对**掩体脚印**候选加惩罚（`W_COVER=1.2`：优先绕行，沿路仍可顶上去爬）+ 翻越后 **1.2s 冷却**（防"翻过去又被推回来"来回翻）。
- **待做（§16 山地）**：短跳半径/角度自适应、台阶段落差聚合、拉直防贴崖。

## 7. 编队与层级

- **角色纵深**：盾/突击=前排、远程=后排、后勤/工兵=中后、飞行=空中层（`BattleLine` front/back + 车道）。
- **层级符合度（队形识别）**：成员位置沿队前进方向**投影纵深序**；应有序=角色 rank；指标=逆序对 + 前缘占用；越界→局部调整（不全队重排）。
- **槽位**：`formationOffset(squadType, rank)`；同槽冲突走横向车道。

## 8. 工兵（2026-09-25 收编进新引擎）

> **旧工事链已销毁**：`EngineerCorps` / `EngineerDispatch` / `CommanderAnchorSelect` / `Decide` / `BattleLine` / `MemberTaskBoard` / `MemberTaskNav` / `SquadDoctrine`（部署表）全部删除；
> 工兵由 **`engine/EngineerManager`** 全权（用户定）：位置查询 → 发令 → 到件计时 → 落地，一环不缺。

- **位置查询（唯一口径）**：`FortifyPlanner.targetOf` = **危险点（峰值需求 ≥ NEED_DONE）优先 → 否则扇区内弧链随机可达点**；由新引擎经 `data/SwarmData.engineerPort()` 消费（数据侧：分区/需求/环带/可达/落地端口）。
- **件必须在施工带内**：`[rLo, rHi] = fortifyBand`（含前推棘轮 pushM；rHi ≤ 环上限）——带外（查询螺旋兜底）宁可不派，防"环夹取挪目标 → 到不了件"。
- **派件节拍**：每拍 1 区摊销刷新（全区 ~4s）；任期内沿用（未建 + 需求仍有效）；建成/失效 → 下一拍重取；**第一波（生效日 ≥0.45）停止新增**。
- **施工**：队长到件 **3m 内**才计时（实秒；`ctx.now` 差）；**掩体 6s / 战壕 10s**（战壕每 2s 挖 1 遍 ≤5 遍，坑底硬阈值 −1.2m 封顶）；总攻只修掩体（战壕暂停）。
- **不入攻击队列**（用户定）：`live.attackables` 过滤工兵编制；统一计时仍看全体。
- **掩体校验**：点已被掩体保护（cover≥1）→ 由需求函数自然降分；连通/前推（8 区全达标 → 棘轮 ≤0.5m/拍）保留。

## 9. 战斗与快车道

- **开火闩锁（引擎消费；2026-09-25）**：`AttackQueues` 1Hz 就近入队 + 开火检验（射程≤25m）→ `TimerManager` 闩锁；`squad/SquadCore` 写成员指令前读锁（port.fireAllowed），未许可 → **软禁火**（`fire='hold'`，原子仍可执行）；许可后持续开火直到撤除。工兵不入队。
- **统一计时销毁（引擎执行；2026-09-25）**：`TimerManager` 1Hz 卡死窗口（包围盒<4m 持续 25s；**驻守/交战豁免**）→ `retire` 落地：L3 `retire('recycled')` / L2 `recycleByUid`（归还编制）；寿命 deadline → `despawned`。**旧 `SwarmRecovery` 已删除**（探针读 `newEngine().timers`）。
- **真弹道**：敌箭/敌法球/玩家弹三池 + `CombatSystem.resolveBulletHit`（敌人/静态世界分类结算）+ `ExplosionFx`。
- **快车道 `FastLane`**：代理直扣（`nearestAgentIndex`+`damageAgent`，倒序防 swap）；实体走伤害管线；屏幕外一律快车道。
- **升格判据=视野**：`SwarmHooks.inView`（RTS=相机视锥±15% 且 <220m）；降格 `tickDemote`（相机焦点基准）。
- **AI 激活焦点=相机**（2026-09-24 调试）：`aiCtx.focusX/Z = cam.tx/tz`（原=舰船）——`aiActiveRadius=75m` 外的单位休眠，RTS 手放/手测"看哪哪活"。
- **近战**：`hooks.melee`/`aiCtx.attack` 按 `AGENT_TARGET_SHIP` 扣舰船血（`shipState.hp`）。

## 10. 时序（每帧）

| 频率 | 内容 |
|---|---|
| 每帧 | 队长核 `SquadCore.drive`（寻路+锚点+成员调遣）、`swarm.update`（移动/模拟）、`syncRender`、`tickDemote`、`aiSystem.updateAll`、`charClamp`、`explosionFx`、`entities.simulate/present/renderAll`、子弹池、`CharacterFxManager` |
| 2Hz | 列表刷新、时间轴刷新、AiTrace 采样 |
| 2Hz | **新引擎相位 tick**（`EngineBridge.tick`：perceive→situation→decide→write；OrderWriter 唯一发令 + 执行板续期） |
| 1Hz | 新引擎慢拍：攻击队列（入队/去重/开火闩锁）+ 统一实体计时（卡死窗口/计时销毁） |
| 变速 | `,/.` 调速 1~100×（子步进 ≤0.05s/步；dayT01 走模拟时钟） |

### 10.1 命令侧时间尺度（用户定 2026-09-24）

> **下命令侧的时间比现实快 5 倍**（游戏内 5 秒 = 现实 1 秒）。代码换算口：`SwarmConfig.GAME_SEC = 0.2` / `GAME_MIN = 12`（1 游戏分钟 = 12 实秒）。

**只换算命令/规划层**（蜂群引擎发令 + 队长/成员命令）：

| 项 | 单位 |
|---|---|
| 成员指令门 / 队长令门 | ~~已删（OrderGate 随执行层换装移除）~~ | — |
| 命令 TTL（引擎令/指令/队长令/默认/使命下限） | 游戏分钟（`ttlLong` / `DIRECTIVE_TTL` / `LEADER_TTL` / `ORDER_TTL_DEFAULT` / `MISSION_TTL_FLOOR`） |
| 发令冷却 / 兜底冷却 / 使命重发 | 游戏分钟（`ISSUE_COOLDOWN_S` / `fallbackTick` / `RESEND`） |

**其他一律保持原实秒值**：日钟（`simT/720000`）、施工计时（掩体 6s/战壕 10s）、战斗（攻击冷却/挥击/撤退/狂暴）、寻路重算（12s）、A* 缓存（20s）、卡死回收（25s）、警戒窗口（6~20s）。

- 已知混合时钟：计时用 `performance.now()`（实秒），tick 节拍用模拟时间（`dt` 累加）→ 1× 下等价；高倍速时命令计时相对游戏时钟变短（后续可统一到模拟时钟）。

## 11. 关键参数（集中调参口）

| 参数 | 值 | 位置 |
|---|---|---|
| 环：大圆/甜甜圈 | 90 / (60,180) | `data/SwarmData.ringBounds` |
| 发令冷却 | 8 **游戏分钟**（仅工事链 `issueChecked`） | `ISSUE_COOLDOWN_S` |
| 命令 TTL | 引擎令 ≥60 / 指令 6 / 玩家令 30 **游戏分钟** | `ttlLong` / `DIRECTIVE_TTL` / `EngineBridge.PLAYER_ORDER_TTL` |
| 使命重发 / TTL 余量 | 10 / 5 **游戏分钟** | `RESEND`（引擎令已不重发：唯一发令器每拍续期） |
| 同兵种目标间距 | ≥40m（极坐标切向，r 不变；不可满足 θ→π） | `engine/Spread.MIN` |
| 长短寻路分界 | 40m | `SquadNavigator.NAV.LONG_PATH_DIST` |
| 长寻路加权 | 上坡 +0.6/米 · 斜向 ×1.414（水无加价） | `FeasibilityPath.find` |
| 上坡横平竖直 | 斜向仅平/下坡（A\*/拉直/短跳三处同规矩）；斜向落差取陡轴 | `FeasibilityPath` / `PassTable.dropAt` |
| 硬边台阶豁免 | 0.6m（与移动层 `EDGE_CLIFF_BAND` 同源）；> 0.6 上墙/下可行 | `PassTable.edge` |
| 跟随停步 / 远跟阈值 | 5~8m 滞回 / >12m 且直线被挡 → 走廊前瞻 4m | `Follow.followDir` |
| 爬坡减速 | L3 爬坡态 ×0.55；L2 上坡 ×(1−0.6·上坡分量) 下限 0.5 | `TerrainAssist.CLIMB_SPEED_MUL` / `SwarmSystem.move` |
| 成员目标基准 | **队长 + 槽位偏移**（无质心）；队长走锚点 | `squad/SquadCore` / `SquadNavigator` |
| 短跳爬升加价 | 2/米（W_RISE） | `SquadNavigator.greedyStep` |
| 坡正面拉直门槛 | up>0.45 且 mag>0.22（0.65 路径/0.35 梯度） | `entity/TerrainAssist.fallLineBlend` |
| 上岸爬岸上限 | 2.5m（仅"当前在水中"生效；陆地仍 0.6m） | `entity/TerrainAssist.SHORE_CLIMB_MAX` |
| 水 | **正常地块**；仅建表软降分 −0.6 | `TerrainScore.WATER_PENALTY` |
| 承诺反向保护 | dot(held, desired) ≤ -0.2 → 重选 | `SteerPick.pickSteer` |
| 掩体惩罚 / 翻越冷却 | W_COVER 1.2 / 1.2s | `SteerPick` / `CharacterBase.CLIMB_CD_MS` |
| 施工计时 / 开工距离 | 掩体 6s / 战壕 10s；**到件 3m 内**才计时（无扫描半径） | `EngineerCorps.WORK_R2` |
| 距离时间增益 | `1+24·t01` | `data/SwarmData.tick` |
| 升格视野 | 视锥±15% 且 <220m | `main.hooks.inView` |
| 成员指令门 | ~~已删（OrderGate 移除；成员围队长）~~ | — |
| 队长令门 | ~~已删（`SquadLeaderAI` 删除；队长只导航+汇报）~~ | ~~`SwarmConfig.LEADER_GATE`~~ |

## 12. 里程碑

| 期 | 内容 | 状态 |
|---|---|---|
| R0-R13 | 相机/选点/地形一次性；命令单源；实体管线；AI+战斗；选择/列表/检视地图/记录器；区域任务/视野升格/快车道/环形活动区/时间轴 | ✅ |
| R14 发令闭环 | 框选→移动/攻击/驻守/建造（玩家令走同链） | ⬜ 下一步 |
| R15 行为体检 | 到达率/卡死率/工事完成率基线 | ⬜ |
| R16 蜂群优化 | 队长决策与寻路调优 | ⬜ |
| R17 战术层级/队形/兜底 | 已实施大半（扎堆/磨蹭/层级/施工计时）；剩"沿路才爬掩体" | ⚠️ |
| R30 验证防线 | tsconfig 全量检查 + arch-guard + smoke/probe 基线断言（各 6 项，失败退出码 1） | ✅ 2026-09-24 |
| R31 命令保护 | `OrderGate` 时间+距离+记忆（成员指令 / 队长令）：指令变化 -60%、反向拉扯 -31%、绕圈比 5.7→3.3 | ✅ 2026-09-24 |
| R32 分派收编 | 成员指令写口从引擎移到队长层 `SquadDispatch`（引擎只发队令+兜底；SwarmSystem 1274→1193） | ✅ 2026-09-24 |
| R33 工兵收编 | 引擎只分区；成员任务 `taskX/Z` 移到队长层 `EngineerDispatch`（被击/非施工使命清任务） | ✅ 2026-09-24 |
| R34 派件收编 | 派件也归队长：位置查询（危险点优先→弧链随机可达点）+ 沿用/注入件 + assign/focus；引擎只给数据端口 | ✅ 2026-09-24 |
| R35 命令侧时间 | 下命令侧比现实快 5 倍 → 只有引擎发令/队长/成员命令计时按**游戏分钟**（`GAME_MIN=12` 实秒）；其余保持实秒 | ✅ 2026-09-24 |
| R36 爬山/涉水寻路 | 长寻路 BFS→**坡度/涉水加权 A\***（可达性逐对一致）；短跳爬升加价；坡正面拉直去敏；水中限速+分离抑制 | ✅ 2026-09-24 |
| R37 共享地形辅助 | `entity/TerrainAssist`（坡正面/出水/涉水常量）**L2+L3 同内核**；出水两级搜索（实测 6/6 上岸）；过掩体惩罚+翻越冷却 | ✅ 2026-09-24 |
| R38 上岸爬岸 | 水中台阶上限放宽到 2.5m（治"卡死在岸边"）：陡岸实测从卡死 20s+ → 全员上岸 | ✅ 2026-09-24 |
| R39 手动放敌+玩家令 | `B` 放置模式（可放水里）/右键强制移动令（玩家源优先）；AI 焦点=相机；修表外 `slopeGradAt` NaN → 原地转圈；湖心手测 8/8 走出 | ✅ 2026-09-24 |
| R40 水=正常地块 | 涉水加价/上岸权重/涉水限速/出水逃逸/落水目标修正全去；只留建表软降分 −0.6；补 `OrderGate.epoch` + 承诺反向保护（治"往西却承诺往东"） | ✅ 2026-09-24 |
| R41 可行性表重写 | **边型 = 地形表裁决**（`finalRuling` weld/cliff，与渲染同源）；格对齐块格（4m=块）；weld=普通可行；cliff≤0.6 可走、>0.6 上墙/下可行；深坑恒禁；删离散落差启发式（建表 730→3.5ms） | ✅ 2026-09-24 |
| R42 上坡横平竖直 | 长寻路/拉直/短跳：斜向仅平/下坡；`dropAt` 斜向取陡轴；低→峰走廊 9→22 点四向阶梯（下坡仍 6 点直线） | ✅ 2026-09-24 |
| R43 去质心·跟队长 | 锚点/编队/寻路起点/实体槽位全按**队长**；成员围队长；掉队+直线被挡 → 沿走廊长寻路找队长（`Follow.ts`）；`OrderGate` "到位+远目标"立即接（解队长冻结） | ✅ 2026-09-24 |
| R44 山地探针 | `probe:mountain`（扫地形挑高原↔低地 → 舰船搬高原 → 低地放敌 → 强制移动令 → 到达/回收/计时）；seed1 130m/+17m：L2 3/12 到达、9/12 到 13~17m 被回收；L3 全员 13~26m | ✅ 2026-09-24 |
| R45 命令稳定门 | 换令稳定门（进度≥50% / 静止≥25s）；驻守轮换改最近掩体 / 游弋归执行层 / 越位扎堆一次纠正；实测 cmdChanges 37→5 | ✅ 2026-09-24 |
| R46 单写口收口 | **旧战斗指挥链删除**（`tacticalTick`/`dispatchMission`/`fallbackTick`/抵舰驻留/强制归位/`SquadLeaderAI`；`?swarm=old` 移除）+ 唯一发令器**执行板续期** + 玩家令 TTL 30 游戏分钟 + 切向散开精确解（余弦定理，r 严格不变）；自检 148/148 | ✅ 2026-09-25 |
| R47 执行层换装 | **队长核接管**：`SquadCore.drive`（寻路→锚点→分解→成员调遣）+ `State/Decompose` 归位；`SquadDispatch/OrderGate/SquadTactics/CommandLedger` 删除；UI/探针改读 `engine/SquadView`（唯一只读口）；`SwarmSystem.applyOrders/dirGateDbg` 删除；执行层读核态走廊；开火闩锁/计时回收落地 | ✅ 2026-09-25 |
| R48 能力回流 | 磨蹭纠正迁入 `DecisionChain.intervention`（1Hz，30 游戏分钟窗）；第一波抵舰驻留迁入引擎波次决策源（`wave1` + 45s 驻守 / 血比<0.45 后撤）；扎堆/越位由 `Spread`/`RangedManager.STANDOFF` 天然承担 | ✅ 2026-09-25 |
| R49 波次迁入 | **波次判定 + 兵力放行**迁 `EngineBridge.situation`（t01/releaseAt → setReleaseCap + spawnBattalion；t01 回退自动复位）；指挥官只留生成执行 + 地形/工事数据；磨蹭纠正/守点粘性按用户要求删除 | ✅ 2026-09-25 |
| R50 数据面归位 | `SwarmCommander` → **`data/SwarmData`**（纯数据/查询/端口，无指挥语义）：地形/表/L1-L2/事态环/t01/工事数据/编制与生成执行；`swarm.commander` 全部改 `swarm.data`（引擎/UI/探针/接线）；指挥链概念从代码中消失 | ✅ 2026-09-25 |
| R51 复合→原子下放 | **条件表 = `squad/AtomicSelect.ts`**（protect: blockCheck ok→驻守 / 太远→行军 / 偏了→行动；act/defend/patrol: 距离三分）；引擎 `Protect` 只给 **G/P 双点**（不再代算锚）；`SquadCore` 按原子驱动队长；自检 153/153 | ✅ 2026-09-25 |
| §16 山地 | 短跳半径/角度自适应；台阶段落差聚合；拉直防贴崖；**舰船/落点周围强制产坡**（保舰船可达，待定）；`TerrainScore.cls` 标定对齐（坡不扣分、硬边才扣，待定） | ⬜ |

## 12.5 验证防线（四关 · 2026-09-24 建立）

> 改动后依次过：`npm run typecheck` → `npm run guard` → `npm run smoke` / `npm run probe`（需 dev server 已启动）→ 文档标 ✅/⏳。
> 旧项目 `scripts/tmp/diag-rts.mjs` 为历史探针（依赖旧项目 puppeteer-core），rts 内已自带等价探针。

| 关 | 命令 | 内容 | 失败口径 |
|---|---|---|---|
| 类型 | `npm run typecheck` | `tsc --noEmit`，`include: ["src"]` **全量源码**（含迁移残骸） | 非 0 退出 |
| 架构 | `npm run guard` | ①文件膨胀（1200 软限/3800 硬顶，KNOWN_BIG 只警告）②命令单源（`board.issue` 唯一写口；`issueOrder` 只从蜂群引擎出）③迁移不回潮（main.ts 不得重长刷怪函数；索敌候选须活对象）④配置真源（遗物三处/BGM 表与类型/敌军名册素材与掉落/isAir 配对） | 非 0 退出 |
| 冒烟 | `npm run smoke` | 选点页 → 换种子 99 → 换回 → 确认进世界；断言 phase/池/存活/绘制/无 pageerror | 6 项全过，否则退出 1 |
| 行为 | `npm run probe` | seed 4242 直进世界，T+8/20/40/70 采样（阶段/环/命令/寻路/工事/轨迹比/**销毁率**）+ 基线断言 | 6 项全过，否则退出 1 |
| 山地 | `npm run probe:mountain` | 扫地形挑"高原↔低地"（`SCAN_ONLY=1` 只扫）→ 舰船搬高原 → 低地放敌 → 强制移动令 → 到达/回收/计时；`CAMFAR=1` 相机远离（纯 L2 代理） | 打印结算（诊断口，无断言） |
| 合并 | `npm run check` | typecheck + guard（本地快速关） | 非 0 退出 |

环境变量：`RTS_URL`（默认 `http://localhost:5175/`）、`CHROME_PATH`、`SEED`。

## 13. 词汇表（UI 中英码对照）

- 命令：advance 推进 / retreat 撤退 / protect 护卫 / flank 包抄 / bound 跃迁 / focus 集火 / regroup 集结 / garrison 驻守
- 指令：push 推进 / suppress 压制 / screen 掩护 / fallback 后撤 / boundBack 交替后撤 / guardWard 护卫 / block 拦截 / intercept 截击 / sneak 潜行 / pin 钉住 / strike 突击 / bound 跃进 / cover 掩体 / focusFire 集火 / regroup 收拢
- 来源：engine 引擎 / leader 队长 / player 玩家
