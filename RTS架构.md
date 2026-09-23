# RTS 架构（新项目总纲 · 2026-09-25 更新）

> 2026-09-24 立项；2026-09-25 第二轮更新（敌人全链路 + 事态环形 + 交互/可视化成型）。
> 目标：把"蜂群引擎"从**自走 AI** 改造成**可手动指挥的 RTS**；手动令与 AI 令**同一词表、同一链路**；
> 引擎/玩家/小队长三源命令**全部可视化**。地图生成与破坏管线**沿用**既有实现；掉落/背包**不移植**。

---

## 0. 验收口径

1. **先能玩，再聪明**：能走、能打、能造 → 之后才谈"惊讶感"。
2. **命令单源**：玩家手动令 = 蜂群引擎令 = 同一 `SquadOrder` + 同一 `issueChecked` 门检。
3. **三源可视**：引擎/小队长/玩家命令全程可看（列表 + 检视地图 + AI 记录器）。
4. **地形即底座**：AI 与手工都读同一张地形账本（PassTable/特征分）。
5. **事态函数硬约束**：活动区是**环**（上限/下限），命令与部队都必须服从。

---

## 1. 项目形态

- Web（Three.js + TS + Vite）；不换引擎；rapier 物理。
- 相机：2.5D 俯视为主，可压近水平；不绑定主角。
- 玩家 = 指挥官（发令）；敌方 = 蜂群引擎（同词表）。
- 不做：掉落/背包/拾取/主角操控。

## 2. 现状（已完成，均有自测）

### 2.1 地形（沿用 + 一次性加载改造）
- 管线整包移植：`services/map/**`（ChunkManager/RasterMap/ChunkGenerator/…）+ 5 个 worker + 流体。
- **一次性加载**：`BUILD/PREFETCH` 覆盖固定世界（±4 chunk=480m），`PARK/DESTROY=99`（**只建不删**）。
- **粗细两档**：近=细块（随视野），远=粗块（固定世界内、只建不删）；**细块无 LOD 切换**（单档 FINE_S_NEAR）。
- 选点阶段：2D 小地图（`ui/SpawnSelect.ts`，可拖动/缩放/换种子，`mapColorAt` 全彩无雾，按视野生成数据）。
- 破坏 → PassTable **脏区重建**：待做（当前表一次性）。

### 2.2 实体与敌人（完整移植）
- `EntityManager` + rapier `PhysicsWorld` + 真实 `ChunkGroundHost`（trimesh 分区/原位换 collider/封存）。
- `CharacterFxManager`（FTX 帧动画）+ `SwarmBatch`（代理 InstancedMesh 贴片，含 groundSink）+ `HealthBar`。
- `WorldSpawner`（官方 tierPort：promote/demote、掉落/enemyDefs/animMap 登记）+ `wireCommanderPorts`。
- **升格判据 = 视野**：`SwarmHooks.inView(x,z)`（RTS=相机视锥±15% 且 <220m；原游戏=玩家视野）；降格 `tickDemote` 以相机焦点为基准。
- AI 驱动：`aiSystem.updateAll(dt, aiCtx)`（移动/索敌/攻击；`aiCtx.attack` 路由 melee/aoe/projectile）。
- 舰船：`buildProceduralShip` 精细模型 + fixed 船体碰撞 + **常显大蓝圈**（脉冲）。

### 2.3 战斗
- `BulletManager`×3（敌箭/敌法球/玩家弹）+ `CombatSystem.resolveBulletHit` + `onAgentRanged` 真弹道。
- `ExplosionFx`（AOE）；死亡动画走 `CharacterBase.deathFx`。
- **快车道 `rts/FastLane.ts`**：代理直扣（`nearestAgentIndex+damageAgent`，倒序防 swap）+ 实体走伤害管线；`K`=中心 18m/15 伤害（测试口）。

### 2.4 RTS 交互与可视化
| 模块 | 文件 | 说明 |
|---|---|---|
| 命令单源 | `order/OrderBus.ts` | `SquadOrder{kind,target,mission,anchor,seq,ttl,source,roe}`；令牌（红=引擎/橙=队长/蓝=玩家）；`onIssue` 供记录 |
| 敌人管理 | `ui/EnemyManager.ts` | 统一句柄（L3 实体+L2 池）；单击/框选/Shift 加选/Esc；**红圈**每帧跟随 |
| 敌人列表 | `ui/EnemyListPanel.ts` | 兵种→队长→代理三级树；显示队令[来源]+令历史+成员受令；点队=全队红圈 |
| 检视地图 | `ui/NavDebugMap.ts` | 点列表命令→弹窗；地形语义底图+走廊/起始点/目标点/队令/历史；**8 扇区环带+认领队+需求+上下限圈**；滚轮缩放/拖拽 |
| 时间轴 | `ui/Timeline.ts` | 06:00–18:00 拖动=绝对进度（`scrubDay`）；第一波/总攻标记；拖动→小地图/列表立即重绘 |
| AI 记录器 | `debug/AiTrace.ts` | 命令/指令/寻路/生死事件流；`dump()` JSONL、`digest()` 中文摘要、`Y` 下载、`U` 控制台 |
| 选点小地图 | `ui/SpawnSelect.ts` | 开局选点；可换种子实时重绘 |

### 2.5 输入
- 左键=平移（Shift+左=旋转）、**右键=选/框选**、中键=发令（临时）、滚轮缩放、WASD 平移、`[ ]` 俯仰、`M` 全览地图、`Y/U` 记录器、`K` 快车道测试。

## 3. 命令系统（单源）

- 一切令走 `issueChecked`（可达核验/调账/台账）；`SquadTactics.issue` 内挂同一 `ringClamp`（**队长自主令同门**）。
- **事态环形闸门**：命令目标径向夹进 `[下限, 上限]`（撤退/`rear` 豁免），计数 `cmdLogRingClamps`。
- 优先级：`player > engine > leader`；玩家令不被 TTL 回落。
- 路径在寻路轨 `state.corridor`（覆盖式），命令对象只读。

## 4. 事态函数 = 环形活动区（2026-09-25 定稿）

- **上限 `frontMaxD`**（最远允许）：`0.20→0.45` **收拢到舰船点（0）** → 第一波全员压上（目标=舰船）。
- **下限 `frontMinD`**（最近允许）：`0.55→0.80` **收拢到舰船点（0）** → 下午可贴脸。
- **收拢态**（上限<下限）→ **上限主导**：全员必须收进舰旁。
- **硬约束**：
  1. `issueChecked` 夹环（上面）；
  2. 每拍巡检队质心，越界（太近/太远）连续 2s → **强制长寻路令**回环内（`force_in/force_out`）。
- 单源 getter `fortifyBand{rLo,rHi,minD,maxD,frontP,pushM}`（引擎 tick/小地图/时间轴共用）。
- 施工带 `rHi ≤ 上限`；第一波起停止新增施工（既有件收尾 → S1→S2）。

## 4.5 评分动态化 + 长短寻路分工（2026-09-25 定稿）

**A. 表的分数动态化（不固定相加）**
- 打分**不是**"地形分 + 距离分"的固定和；而是：
  `score = Σ w_i(事态) · feat_i`，其中**系数随事态变化**（posture/frontP/闸门阶段）动态重算。
- **距离混合（按距舰）**：`k = clamp01(1 − shipD / D_FAR)`（近舰 k→1、远舰 k→0）
  - 近舰（k→1）：**距离权重 > 地形权重**（守家：离舰越近分越高）
  - 远舰（k→0）：**地形权重 > 距离权重**（野战：地形价值主导）
  - 实现：`w_dist_eff = w_dist · (1 + (RN−1)·k)`；`w_terrain_eff = w_terrain · (1 − (1−RF)·k)`（RN>1、RF<1 可调）
- **动态重算**：系数变化（事态/掩体代次/闸门）→ 评分表按新系数重算（单源 `TerrainScore`）；
  探针 parity 口径随之改为"同系数下一致"。

**B. 长短寻路分工**
| 场景 | 寻路 |
|---|---|
| **长行军**（换区/集结/抵舰） | **长寻路**：`FeasibilityPath`（表图 BFS + LOS 拉直）全走廊 |
| 交战 / 巡逻 / 驻守 / 换位 | **短寻路**：LOS 10m 贪心短跳（滚动重算） |
| **工兵就近施工**（去不远处造件） | 短寻路（目标近 → 自然走短跳） |
- 判据：目标距离 > `LONG_PATH_DIST`（默认 40m）→ 长寻路；否则短寻路（`SquadNavigator.ensurePath` 分流）。

## 5. 工兵 = 区域任务（引擎只派区）

- 引擎把**区（扇区）**派给队；区内活由队自循环。
- `spot` **粘性**（本区未建件还在且可达就不重取）；`buildIssued` 记录派件下标 → **只在无令/玩家令/件变化/将到期时换令**（不再反复下"前进"）。
- 第一波抵舰驻留：进攻队进 70m → 转「驻守」45s；血比<0.45 → 撤退；到期回正常决策。

## 6. 里程碑

| 期 | 内容 | 状态 |
|---|---|---|
| R0 相机/选点/地形一次性 | 2.5D 相机、选点小地图、固定世界只建不删 | ✅ |
| R1 命令单源 + 令牌 | OrderBus/三源令牌 | ✅ |
| R2 实体管线 | rapier/EntityManager/ChunkGroundHost/舰船/FTX/血条/L3 闭环 | ✅ |
| R3 AI 驱动 + 战斗 | aiSystem/弹道/命中/爆炸/近战扣舰 | ✅ |
| R5 选择与列表 | EnemyManager/EnemyListPanel/红圈 | ✅ |
| R7-R8 检视地图 + 记录器 | NavDebugMap/AiTrace | ✅ |
| R9-R13 引擎改造 | 区域任务/视野升格/快车道/环形活动区/时间轴/硬约束 | ✅ |
| **R14 发令闭环** | 选中 → 下命令（移动/攻击/驻守/建造），走同一 `issueChecked` | ⬜ 下一步 |
| **R15 行为体检** | 行军到达率/卡死率/工事完成率基线 | ⬜ |
| **R16 蜂群优化** | 队长决策与寻路调优（终目标） | ⬜ |

## 7. 目录（rts/src）

```
order/      命令单源（OrderBus）
rts/        快车道（FastLane）
ui/         相机/选点/敌人管理/列表/检视地图/时间轴/cn 中文化
debug/      AiTrace 记录器
systems/    swarm（引擎：指挥/工事/寻路）、spawn（WorldSpawner）、ai、combat、world（CharacterClamp）
entity/     实体基类/敌人/舰船/角色
services/   map（地形管线）、render、fx、physics、ui（原项目小地图等）
modes/world/CommanderWiring（指挥器端口接线）
```

## 8. 非目标与风险

- 非目标：掉落/背包/主角；联网；旧存档兼容。
- 风险：桩依赖（session/director/UI）逐个清账中；环形硬约束与寻路失败的交互（force 令可能反复）需观测；L3 容量 36 与大战场的取舍。
- **寻路专项（待做）**：涉水/山地爬坡抽象（岸线上下水抖动、阶地换向、崖带截断）——计划见《寻路与导航架构.md》§16。

## 9. 复用清单（已接）

- `PassTable` / `FeasibilityPath` / `SquadNavigator` / `SwarmSystem.move`（坡正面+最后一程）
- `FortifyPlanner` / `EngineerCorps` / `RosterController` / `CommanderSpawn` / `SwarmCommander`
- `SwarmDanger` / `TerrainScore` / `TerrainSemantics`
- 地形渲染与破坏：`ChunkManager` / `TerrainPatch` / `Tiles` / `TerrainMaterial` / 流体
- 探针/诊断：`diag-rts`（自测脚本）；原项目 `probe-abstract` 等
