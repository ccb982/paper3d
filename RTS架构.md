# RTS 架构（当前态总纲 · 2026-09-25 重写）

> 单一真源：本文描述**现状架构**（已实现 + 已定稿待实现会标注）。历史设计过程见《敌人管线设计.md》《寻路与导航架构.md》。
> 一句话总纲：**宏观有序、微观无序——"能在无序中稳步朝舰船方向推进，就是最理想的架构"**。

---

## 0. 三条根本原则

1. **宏观有序（引擎统一设定）**：目标（朝舰推进）、边界（事态环）、分布（切向均匀）、序位（前/后排层级）。
2. **微观无序（队自决）**：各队自主寻路/走位/队形；允许绕、散、慢；不要求步调一致。
3. **引擎只在四类时刻介入**：① 事态变动 ② 队重伤（血比<0.5）③ 扎堆（同种兵<50m）④ 磨蹭（30s 净<3m 且路径>15m / 反转≥6）；其余时间**少发令**。
4. 验收看宏观：全队**离舰距离均值单调下降**；局部乱不扣分。

## 1. 分层

| 层 | 职责 | 代表 |
|---|---|---|
| 战略 | 事态函数/环形活动区/波次节奏 | `SwarmCommander`（frontP/ringBounds/波次） |
| 战术 | 兵种角色纵深、队间分布（切向/扎堆/层级）、兜底 | `BattleLine`、`fallbackTick`（dawdle/tangent/rank_fix） |
| 队级 | 命令拆步、走廊、锚点、编队槽位 | `SquadTactics`、`SquadNavigator`、`Formation` |
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
systems/swarm/            蜂群引擎（Commander/Tactics/Navigator/Fortify/Engineer/…）
systems/spawn/WorldSpawner.ts  刷怪 + 官方 tierPort（promote/demote）
systems/ai/               行为状态机（AISystem + behaviors）
systems/combat/           弹道/命中结算
services/map/**           地形管线（ChunkManager/RasterMap/…+5 worker）
services/physics/**       rapier 物理
entity/**                 实体基类/敌人/舰船/角色
modes/world/CommanderWiring.ts 指挥器端口接线
```

## 3. 地形与语义表

- **一次性加载**：固定世界 ±4 chunk（480m）；`BUILD/PREFETCH=16`、`PARK/DESTROY=99`（**只建不删**）；近=细块（单档，无 LOD 切换）、远=粗块（固定世界内）。
- **PassTable**：五值（自身高度 + 四向边 可走/净落差）；边型 ABS（>3m 悬崖，双向禁）/ DOWN（>0.6m 单向，只可下）/ OPEN；深坑=绝对墙；水可走（软代价+催促上岸）；**坡是正常通路**。
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
1. `clampToRing` 单源：引擎令（`issueChecked`）+ 队长令（`SquadTactics.ringClamp`）+ **锚点/站位**（`applyOrders` 内对 resolveAnchor 结果）全部夹环；撤退/`rear` 豁免。
2. 越界强制归位：队质心越界连续 2s → 强制长寻路令回环内（`force_in/out`）；**命令目标已合规则不重发**。
3. 第一波时段起停止新增施工（既有件收尾）。

## 5. 指挥与命令

- **单源**：`SquadOrder{kind,target,mission,anchor,seq,ttl,source,roe}`；一切令走 `issueChecked`（可达核验/调账/台账）。
- **发令冷却（替代时效）**：同队 **8s** 内同签名同目标不再发；引擎令 TTL≥60s 存活；例外：事态签名变 / 队血比<0.5。
- **四类介入**（§0）：事态变动 / 重伤 / 扎堆 / 磨蹭——各自 30s 队级冷却。
- **兜底动作**（`fallbackTick` 1Hz）：
  - 磨蹭 → 沿队令方向**向前 20m**；无令 → **兵力最稀处**（20m 格计数，<60m）；
  - 扎堆（同 mobKind <50m）→ **横向拉开 20/35/50m + 向舰内收 20/10/0m**（离邻居远侧优先）；
  - 层级越位（远程比前排更靠敌 >15m）→ 后排队**拉后 15m**（`rank_fix`）；
  - 所有候选过 **四校验**：环内 + 可站(`scoreAt`) + 直线可走(`walkableLine`) + 有向可达(`reachable`)，不行换下一个。

## 6. 寻路

- **分工（用户定）**：**长行军=长寻路**（`FeasibilityPath`：表图 BFS + LOS 拉直）；**短程（交战/巡逻/驻守/就近施工）=短寻路**（LOS 10m 贪心短跳）；判据 `LONG_PATH_DIST=40m`。
- **短跳**：10m→6m 回落；推进>0.5m 硬门槛；安全项 `W_SAFE=4×(1−pathMul)`；**惯性**（同目标 5s 同向加分，选一个不反悔）。
- **脱困**：4s 距目标无净推进 6m → 走 LOS 长路径。
- **执行层**：上坡走**坡正面**（fall line 混合）；最后一程直线被挡 → 回锚点（走廊绕）。
- **锚点**：`currentTargetOf` 最近点后 **>8m 前瞻** + **锚点滞回**（新锚<6m 沿用旧锚）；长行军重算阈值 12m（短程 6m）。
- **待做（§16）**：涉水（目标落水→最近岸上点；水中降分离）、山地（短跳半径/角度自适应、台阶段落差聚合、拉直防贴崖）。

## 7. 编队与层级

- **角色纵深**：盾/突击=前排、远程=后排、后勤/工兵=中后、飞行=空中层（`BattleLine` front/back + 车道）。
- **层级符合度（队形识别）**：成员位置沿队前进方向**投影纵深序**；应有序=角色 rank；指标=逆序对 + 前缘占用；越界→局部调整（不全队重排）。
- **槽位**：`formationOffset(squadType, rank)`；同槽冲突走横向车道。

## 8. 工兵

- **区域任务**：引擎只派区（扇区）；`spot` **粘性**（本区未建件还在且可达就不重取）；`buildIssued` 记录派件下标 → 只在无令/玩家令/件变化/将到期时换令。
- **施工计时（用户定）**：抵近 **40m** 即开工；每 2s 拍 +2s；**掩体 6s / 战壕 10s 计时满即建成**；**无冷却**（RTS 未接每帧递减，已去掉）。
- **掩体校验**：点已被掩体保护（cover≥1）→ 不再重复造；非总攻转战壕、总攻跳过。
- **连通/前推**：8 区全达标才前推（棘轮 ≤0.5m/拍，封顶 frontP×120m）；施工带 rHi ≤ 环上限。

## 9. 战斗与快车道

- **真弹道**：敌箭/敌法球/玩家弹三池 + `CombatSystem.resolveBulletHit`（敌人/静态世界分类结算）+ `ExplosionFx`。
- **快车道 `FastLane`**：代理直扣（`nearestAgentIndex`+`damageAgent`，倒序防 swap）；实体走伤害管线；屏幕外一律快车道。
- **升格判据=视野**：`SwarmHooks.inView`（RTS=相机视锥±15% 且 <220m）；降格 `tickDemote`（相机焦点基准）。
- **近战**：`hooks.melee`/`aiCtx.attack` 按 `AGENT_TARGET_SHIP` 扣舰船血（`shipState.hp`）。

## 10. 时序（每帧）

| 频率 | 内容 |
|---|---|
| 每帧 | `swarm.update`→`syncRender`→`tickDemote`→`aiSystem.updateAll`→`charClamp`→`explosionFx`→`entities.simulate/present/renderAll`→子弹池→`CharacterFxManager` |
| 2Hz | `applyOrders`（命令分解/寻路）、列表刷新、时间轴刷新、AiTrace 采样 |
| 1Hz | `fallbackTick`（磨蹭/扎堆/层级）、`tacticalTick`（战役闭环） |
| 变速 | `,/.` 调速 1~100×（子步进 ≤0.05s/步；dayT01 走模拟时钟） |

## 11. 关键参数（集中调参口）

| 参数 | 值 | 位置 |
|---|---|---|
| 环：大圆/甜甜圈 | 90 / (60,180) | `SwarmCommander.ringBounds` |
| 发令冷却 / 兜底冷却 | 8s / 30s | `ISSUE_COOLDOWN_S` / `fallbackTick` |
| 扎堆阈值 / 横纵步长 | 50m / 20·35·50 + 20·10·0 | `fallbackTick` |
| 层级越位 / 修正 | >15m / 拉后 15m | `fallbackTick` |
| 长短寻路分界 | 40m | `SquadNavigator.NAV.LONG_PATH_DIST` |
| 施工计时 | 掩体 6s / 战壕 10s / 开工 40m | `EngineerCorps` |
| 距离时间增益 | `1+24·t01` | `SwarmCommander.tick` |
| 升格视野 | 视锥±15% 且 <220m | `main.hooks.inView` |

## 12. 里程碑

| 期 | 内容 | 状态 |
|---|---|---|
| R0-R13 | 相机/选点/地形一次性；命令单源；实体管线；AI+战斗；选择/列表/检视地图/记录器；区域任务/视野升格/快车道/环形活动区/时间轴 | ✅ |
| R14 发令闭环 | 框选→移动/攻击/驻守/建造（玩家令走同链） | ⬜ 下一步 |
| R15 行为体检 | 到达率/卡死率/工事完成率基线 | ⬜ |
| R16 蜂群优化 | 队长决策与寻路调优 | ⬜ |
| R17 战术层级/队形/兜底 | 已实施大半（扎堆/磨蹭/层级/施工计时）；剩"沿路才爬掩体" | ⚠️ |
| §16 涉水/山地 | 目标落水→岸上点；短跳自适应；拉直防贴崖 | ⬜ |

## 13. 词汇表（UI 中英码对照）

- 命令：advance 推进 / retreat 撤退 / protect 护卫 / flank 包抄 / bound 跃迁 / focus 集火 / regroup 集结 / garrison 驻守
- 指令：push 推进 / suppress 压制 / screen 掩护 / fallback 后撤 / boundBack 交替后撤 / guardWard 护卫 / block 拦截 / intercept 截击 / sneak 潜行 / pin 钉住 / strike 突击 / bound 跃进 / cover 掩体 / focusFire 集火 / regroup 收拢
- 来源：engine 引擎 / leader 队长 / player 玩家
