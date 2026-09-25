# RTS 架构（正式版 · 2026-09-25）

> **本文是 rts 的唯一架构真源。** 重写（R46~R51）已完成：旧命令链 / 旧工事链 / 旧黑板 / 指挥官概念全部删除，
> 代码结构 = **engine（决策）→ squad（执行）→ data（数据）→ nav/entity/services（底座）**。
> 一句话总纲：**宏观有序、微观无序——"能在无序中稳步朝舰船方向推进，就是最理想的架构"**。
>
> 历史施工图《蜂群重写计划.md》已**归档**（铁律 G1~G9 与验收基线已并入本文 §12/§13）。

---

## 0. 三条根本原则

1. **宏观有序（引擎统一设定）**：目标（朝舰推进）、边界（事态环）、分布（切向均匀）、序位（前/后排层级）。
2. **微观无序（队自决）**：各队自主寻路/走位/队形；允许绕、散、慢；不要求步调一致。
3. **引擎只在四类时刻介入**：① 事态变动 ② 队重伤（整队血比<0.5）③ 扎堆（同兵种目标<40m，发令时切向散开）④ 磨蹭/到环上限；
   其余时间**少发令**。验收看宏观：全队**离舰距离均值单调下降**；局部乱不扣分。

---

## 1. 分层与模块地图（rts/src）

| 层 | 职责 | 代表模块 |
|---|---|---|
| **引擎（决策）** | 事态→决策→唯一发令；四兵种策略；攻击队列/计时 | `systems/swarm/engine/**`（21 文件） |
| **队长（执行）** | 接令→复合→原子→导航→成员围队长→汇报 | `systems/swarm/squad/**`（10 文件） |
| **数据** | 地形/表/L1-L2/事态环/t01/工事/编制/生成执行（**只读被消费**） | `systems/swarm/data/SwarmData.ts` |
| **寻路** | 可行性表 + 长短寻路 + 走廊 | `systems/swarm/nav/**` + `SquadNavigator.ts` |
| **代理/实体** | SoA 代理池、移动内核、L3 实体三件套、基类能力 | `AgentPool/SwarmSystem`、`entity/**` |
| **服务（保留地基）** | 地形管线/渲染/物理/战斗/UI | `services/**`、`systems/combat/**`、`ui/**` |

```
systems/swarm/
  engine/   EngineCore EngineBridge OrderWriter OrderValidator DecisionChain CommandLang
            Protect AttackQueues TimerManager Positions SquadManager SquadView SectorManager
            RoleManager+四兵种(Melee/Ranged/Flyer/Engineer)Manager Spread contracts
  squad/    SquadCore SquadRegistry CommandLang State Decompose Anchor Follow Formation Abilities MarchAction
  data/     SwarmData（地形/表/L1/L2/事态环/t01/工事数据/编制与生成执行）
  nav/      PassTable LongPath Corridor（含 ShortHop 短跳）
  根        SwarmSystem（代理移动/渲染/LOD）、AgentPool、SquadTable、TerrainScore/TerrainSemantics/HoleMask/HoleTable、
            PostureFn、FortifyPlanner、CommanderSpawn、SwarmLedger、SwarmBatch、SwarmConfig、SwarmDanger、UnitTactics/UnitStrategy
```

> **已删（不再存在）**：`SquadDispatch / OrderGate / SquadTactics / CommandLedger / EngineerCorps / EngineerDispatch /
> CommanderAnchorSelect / Decide / BattleLine / MemberTaskBoard / MemberTaskNav / SquadDoctrine / SwarmRecovery / SwarmCommander`；
> `?swarm=old` 回退开关与 5 篇旧设计文档一并删除（git 可回溯）。

---

## 2. 引擎（决策层 `engine/`）

### 2.1 EngineCore —— 固定相位 tick（2Hz）
```
perceive → situation → decide(单源) → write → debug
```
- 时间从参数传入（**实秒**，main 用 `performance.now()/1000`）；`hz=2`（`setHz` 可调）。
- 引擎**不含策略**（策略在各管理器）、**不直接发令**（只经 `OrderWriter`）。

### 2.2 四兵种管理器（`RoleManager` 基类）
| 管理器 | 策略 | 参数 |
|---|---|---|
| `MeleeManager` | 压上接敌（朝玩家方向压到接敌距离） | `ENGAGE=12m` |
| `RangedManager` | 保距到射程环（带内不动） | `STANDOFF=18m`（±BAND） |
| `FlyerManager` | 空中航线（绕玩家四相位） | `ORBIT=10m` |
| `EngineerManager` | 建造位置查询 + 施工计时 + 落地（见 §7） | `WORK_R=3m`、掩体 6s / 战壕 10s |
- 各自维护本兵种小队的编成与目标分配（`sync()` 缓存），目标统一夹进事态环；**互不越权**。
- `requestSpawn(n)`：引擎决策"补几队"→ 本管理器投放（生成端口由接线层注入）。

### 2.3 DecisionChain —— 显式优先链（单源决策）
```
① 玩家令在身（未过期） → 引擎不产令
② 整队血比 <0.5       → march 到后撤点（无后撤点 → 保持现状）
③ 到事态环上限         → defend（守原地）
   被打（playerAttacking/保护关系） → protect
④ 干预（intervention） → act 到纠正点（当前恒 null；磨蹭纠正已按用户要求删除）
⑤ 常规部署（兵种管理器目标） → act
全不成立 → null（保持现状，不发令）
```
> 规则集中一处（`DecisionChain.ts`），**不靠调用顺序**；`kind` 只产 `act/march/garrison/defend/protect`。

### 2.4 复合与统一校验
- **复合选择（`DecisionChain`）**：到环上限 → `defend`；有保护关系/被打 → `protect`；否则 `act`。
  **复合 → 原子**的解释器在 `squad/CommandLang.ts`（队长层唯一实现，见 §3.2）；
  引擎侧命令语法/解释器在 `engine/CommandLang.ts`（见 §2.10）。
- **发令统一校验链（`OrderValidator.ts`，一处实现、不许旁路）**：
  ① **事态范围**：目标夹进 `[ringMin, ringMax]`；到上限 → `suggest='defend'`；
  ② **密度**：同兵种目标 <`SPREAD.MIN=40m` → **切向 θ 散开（径向 r 严格不变）**；工兵不参与；
  ③ **可达**：`canReach` 注入核验（不可达 → 不发/调用方缩近）。
- **Spread（`Spread.ts`）**：极坐标、**只解 θ**；目标角差用**余弦定理精确解**（弦长=min）；几何不可满足（min≥r1+r2）→ θ 拉满 π（**无径向推力**）；点按 id 定序 → 各队各自校验也收敛到同一全局解。

### 2.5 OrderWriter —— 唯一发令器（G1/G2）
- 唯一写口 `SquadOrderStore`（**只有本文件能写**）。
- **稳定门**：同签名重发豁免；**换令**（kind/目标变）需 **现令进度 ≥50%** 或 **静止 ≥25s**（`ORDER_STABLE`）；旁路 = 干预/玩家/重伤。
- **玩家令**：`source='player'`，TTL `30 游戏分钟`（`EngineBridge` 到期释放）。
- **命令历史环**（256 条）：`recent(n)` / `latestPerSquad(windowS)`（UI/探针只读）。

### 2.6 Protect —— 保护命令（只给双点）
- 引擎职责（信息单源）：每个保护关系提供 **G=被保护队长位置** + **P=玩家位置**；`refresh` 1Hz 刷新，锚=G。
- **不算锚、不做阻挡校验**——阻挡校验是**基类功能**（`entity/base/Blocking.blockCheck`），由队长自主执行（见 §3.2）。

### 2.7 AttackQueues + TimerManager（消费已落地）
- **攻击队列（`AttackQueues`，1Hz）**：维护"以玩家为半径""以舰船为半径"队列（可扩展祖宗/友军）；敌人**离哪个实体近就进哪个队列**（去重）；队列内做开火检验（射程 ≤`fireRange=25m`）。
- **开火许可 = 闩锁态**（`TimerManager.allowFire/canFire`）：一旦允许 → 持续开火，直到许可被去除；离场自动撤。
- **计时销毁（`TimerManager`，1Hz）**：
  - 卡死窗口：包围盒 <`BBOX_R=4m` 持续 `HOLD_S=25s` → 回收；**豁免**：驻守命令 / 交火（被击 8s / `noDemoteUntil`）；
  - **计时销毁（寿命 despawn）= 实体基类能力**（`entity/base/Abilities` 的 `despawn` 状态机），本管理器不重复；
  - `onExpire` 落地（LiveView.retire）：L3 `retire('recycled')` / L2 `SwarmSystem.recycleByUid`（归还编制）；
  - 探针：`stuckTotal / expiredTotal / latched / tracked / exempt / last`。

### 2.8 单源数据与视图
- `Positions`：玩家/舰船/各队队长位置**只此一处**（`setPlayer/setShip/setSquad/squad/nearestSquad/squadOf`）。
- `SquadManager`：每队一条记录（role/alive/x/z/atom/phase/progress/stillS/hpRatio/reports）；`report` 为**唯一接收器**（未给字段不覆盖）；`tick` 过期检查。
- `SectorManager`：扇形防区（建区/归区/中心点/安全度），后撤点由它给。
- `SquadView`：UI/探针**唯一只读口**（引擎令 + 汇报 + 队长核执行态 + 命令历史），**不反向指挥**。

### 2.9 EngineBridge —— 实机接线桥
- **LiveView 端口**（引擎不直读世界，G4）：`player/ship/squads/canReach/emit/playerAttacking/enemies/attackables/engineer/exemptOf/retire/wave1/t01/ledgerTotal/setReleaseCap/spawnBattalion`。
- **波次与兵力放行（决策源）**：`t01`（落地起算）+ `releaseAt(t01)` → `setReleaseCap` + `spawnBattalion(instant)`（**第一波 0.45 / 总攻 0.80**）；`t01` 回退（换落点/新一日）自动复位。
- **第一波抵舰驻留**：`wave1` 后进攻令（act/march）抵舰 70m 内 → **驻守 45s**；血比 <0.45 → 后撤；到期交回；玩家令不覆盖。
- **write 两趟**：① 全队决策（含工兵 `mission:'build'`）；② 统一校验链（环/全局密度/可达）→ 唯一发令器 → `emit` → **队长核 `accept`**。
- 探针 `dbg`：ticks/issued/refreshed/spread/last + 各管理器 dbg（`__rts.newEngine()`，G9）。

---

### 2.10 引擎命令语言（`engine/CommandLang.ts`）
```
sentence  := composite { modifier }
composite := 'protect' '(' G ',' P ')'          // G=被保护队长位，P=威胁(玩家)位
           | 'act'     '(' target ')'            // 行动：去某点
           | 'defend'  [ '(' object ')' ]       // 防御：守对象；缺省 = 守原地
modifier  := 'roe' | 'mission' | 'ttl' | 'seq' | 'source'
```
- 引擎只发**复合句**；`wellFormed`（良构：缺操作数/非法修饰 → 发令前拦下）→ `interpretEngine`（解释为意图 `op=block/move/hold`）→ `OrderWriter` 发布（G1/G2 不变）。
- `protect` 双点原样下发（G/P）；队长自主 `blockCheck` 选原子（§3.2）。**引擎不逐拍指挥、不算锚**。

## 3. 队长层（执行 `squad/`）

### 3.1 SquadCore —— 队长三件事
```
① 接令：唯一来源 = SquadOrderStore（引擎/玩家同源；同签名重发不重置进度）
② 驱动：状态→寻路→锚点→复合→原子→成员调遣（围队长）
③ 汇报：唯一接收器 SquadManager.report（位置/原子/阶段/进度/静止）
```
- `accept(order)` → 建执行态（`State.stateFromOrder`，同令沿用路径缓存）；`drive(squad, now, port)` 每帧执行：
  1. `port.ensurePath(state, squad, now)`（长/短寻路写入走廊；protect 除外）；
  2. `port.leaderTarget(...)`（`resolveAnchor`：保护护卫点+游曳 / 驻守绕掩体 / 走廊前瞻）；
  3. **`interpretLeader`**（§3.2）→ 原子与目标；**protect 未挡住 → 执行态目标覆盖为调整点 → 重解走廊**（调整点即寻路目标，到点再校验）；
  4. `port.clampRing`（事态环硬约束）；
  5. 成员调遣：`Decompose`（角色矩阵）+ 开火门（`fireAllowed`）+ **围队长**（队长走原子目标；成员 = 队长+阵型槽位）→ `port.applyDirective`（唯一落地口：池列 / L3 `onDirective`）。
- `tick(dt)`：进度（起始距离收敛比）/静止计时/阶段（到位 `done` → `onArriveAtom` 驻留口径）；原子由 drive 决定（自检降级时按距离兜底）。

### 3.2 队长命令语言（解释器 `squad/CommandLang.ts`）
```
sentence := composite            // 输入：引擎复合句 protect / act / defend（patrol = 原子直令）
atom     := 'patrol' | 'garrison' | 'march' | 'act'
choice   := atom '(' point ')'   // 解释结果：原子 + 目标点（why = 依据，探针可读）
```
> 复合句在此**解释成原子句**；原子句 + 角色桶再由 `Decompose` 编译成成员指令。逐层一门语言。

| 复合（引擎→队长） | 条件 | 原子 | 目标点 |
|---|---|---|---|
| **protect**（G=被保护队长位，P=玩家位） | `blockCheck(P,B,G,'block')` **已挡住** | `garrison` | 原地（保持阻挡，不挪窝） |
| | 离 P 太远（出 standoff 带） | `march` | **调整点**（P→G 线上、离 P=STANDOFF=7m） |
| | 偏了 / 不在带内 | `act` | **调整点** |
| **act** | 到锚点 d > 40m | `march` | 锚点（走廊前瞻） |
| | 1.5m < d ≤ 40m | `act` | 锚点 |
| | d ≤ 1.5m | `garrison` | 锚点（到位驻守） |
| **defend** | 锚先过 `resolveAnchor`（绕掩体/反斜/掩体复核）→ 同 act 三分 | `march`/`act`/`garrison` | 对象 / 自身位 |
| **patrol** | 同 act；到位驻留口径 `onArriveAtom` | `march`/`act`/`garrison` | 锚点 |

- **阻挡校验（基类 `Blocking.blockCheck`）**：三点一线 P—B—G；返回 ok/垂直偏离/**两个调整点**/建议原子；`block`（挡玩家）与 `guard`（驻守躲掩体）同内核；参数 `STANDOFF=7 / TOL=3.5 / NEAR=2.5 / FAR=3.5 / GAP=1.2 / HIDE=2.5`。
- **调整点即寻路目标**：不额外写行为逻辑；到点再校验（收敛到真挡住）。

### 3.3 其余队长件
- `State.ts`：执行态（order 映射 `toBoardOrder`：act/march→advance、defend→garrison、patrol→flank；路径缓存/锚点滞回/`ORDER_TTL_DEFAULT`）。
- `Decompose.ts`：默认分解矩阵（advance/retreat/protect/garrison/flank/bound/focus/regroup × melee/ranged/shield/logistics）；`MISSION_EXEC`（build 禁火 / rear 到位开火 / 各使命限速）；个体低血 `fallback`（`MEMBER_FALLBACK_HP=0.3`，盾/自爆除外）。
- `Anchor.ts`：`goalOf`（引擎令优先）、`currentTargetOf`（走廊前瞻 8m + 末程回落 <15m + 锚点滞回 <6m，`climb` 随锚存取）、`resolveAnchor`（protect=护卫点+游曳+`ensureCovered`；garrison=`standBehindCover`；其余=走廊）。
- `Follow.ts`：`leaderDir`（锚点优先，离队令目标 >8m 不停）、`followStopR`（队长未到位 2m；否则动 5m/停 8m 滞回）、`followDir`（近=直线；掉队 >12m 且直线被挡 → 沿队走廊前瞻 4m）。
- `Formation.ts`：楔形/线列槽位（按兵种），同槽冲突走横向车道。
- `Abilities.ts`：到位驻留口径（`patrol/defend/protect → patrol`，否则 `garrison`）。
- `MarchAction.ts`：`createSquadNav`（长寻路=可行性路径长度；短跳=`walkableLine`）。
- `SquadRegistry.ts`：每队一个 SquadCore；`accept/tick/stateOf/states/drop`；驱动端口（`squadOf/ensurePath/leaderTarget/clampRing/terrain/mobTactics/fireAllowed/applyDirective`）由 main 注入。

---

## 4. 数据层（`data/SwarmData.ts`）

> **纯数据/查询/端口，无指挥语义**；引擎/队长核/导航/UI/探针只读消费。文件头写明 owner。

- **地形与表**：`DefensePlan`（`analyzeLandingTerrain`）+ `PassTable`（建表并 `attachPassTable` 到寻路）+ `TerrainScore`（`rebuild` 每帧；`distGain=1+24·t01`）+ `TerrainSemantics`（L1，落点锚，静态）+ `HoleMask/HoleTable`（L2，破坏掩码 + 坑洞/掩体表 2Hz）+ `setSteerTable` 表桥（实体 SteerPick 同表）。
- **查询**：`blockedAt/coverAt/walkableLine/heightAt/slopeGradAt/pathMulAt/pathMulFor/scoreForType/rangedPost/debugHasCover/isWaterAt/terrain/pathStamp`。
- **事态与环**：`PostureFn`（`p = clamp(schedule(t)+provocation)`，挑衅=被击 ×0.01 / 击杀 ×0.03，τ=90s，上限 +0.35；姿态阈值 0.22/0.30/0.55/0.80，assault 锁定）；`battlePosture`；`t01` 时钟（落地归一，`DAY_RHYTHM_S=450` 兜底，`debugDayT01/scrubDay/followRealtime`）；`ringBounds`（宽环±80 → 0.45 大圆 90 → 0.62 甜甜圈 60/180 → 0.82 收 → 0.90 点）；`frontP`（单调）+ `ring/clampToRing/frontGate/postureInfo/setPosture`。
- **工事数据**：`FortifyPlanner`（8 扇区；`refreshOne` 摊销 1 区/拍；`assign` 需求最高优先一队一区；`targetOf` 危险点优先→扇区弧链随机可达点）；`pushM` 前推棘轮（8 区全达标 +0.5m/拍，封顶 `frontP×120m`）；`fortifyBand`（`rLo=max(24, frontMinD+8)`、`rHi=min(max(90,rLo+30)+pushM, frontMaxD)`）；`fortifyNeed`（`scoreForUnit('defense')×(1−cover/COVER_FULL)`）；`stage` S1→S2（第一波 0.45 停新增）；`engineerPort()`（见 §7）。
- **编制与生成执行**：`RosterController`（占比/缺口 4Hz）；`CommanderSpawn`（`deploy/battalion(instant)/drain/reset` + 回收名单）；生成端口（`spawnMob/spawnMobIndex/spawnBuilder/buildCover/digTrench`）由 main/CommanderWiring 注入；`planDefense`（建计划 + 表 + 复位 + 开局班底）。
- **地形破坏入口**：`noteTerrainDig/markTerrainDirty`（`ChunkManager.onTerrainDig` 中央钩子；子弹/战壕都过）→ 掩码窗扫 + TerrainScore 局部重算 + 采样缓存失效。

---

## 5. 代理与实体（L2/L3）

- **代理池（`AgentPool`，SoA）**：列 push/copy/snapshot **三处同步**（新增列必须三处齐改）；快照含 taskX/Z（已停用）、directive 列、order 列、LOD 列。
- **移动纪律（禁止向量合成）**：`SteerPick` 16 向候选 + 硬否决（表 blockedAt/陡坡）→ 打分（`W_PATH 1.6·cos` + `W_TABLE 0.8` + `W_TURN 0.7` + 避让惩罚 − 水/掩体惩罚）→ softmax(0.18) 抽样 → 承诺 0.5s；`move()`：队长走 `leaderDir`（锚点/队令目标）；成员走 `followDir`（追队长/走廊）；承诺反向保护（`dot(held,desired) ≤ −0.2` 重选）。
- **LOD**：L3 ≤45m（上限 36）/ L2 ≤120 / L1 ≤190 / 降格 55m；决策 2/5Hz、移动 10/20Hz、L3 编队 steer 10Hz；升格=视野（相机视锥±15% 且 <220m）；升降格走 `SwarmTierPort`（无损）。
- **实体三件套**：`EnemyBase`（载体）+ `EnemyBrain`（战斗原子/开火）+ `EnemyPresentation`（表现）+ `EnemyLocomotion`（危险绕行）。
- **基类（两载体同内核）**：`entity/base/CharacterCore`（推进/程序化爬坡/立面阻挡/贴地回退，`TerrainProbe` 注入）+ `Locomotion`（统一出口）+ `Abilities`（爬坡/爬掩体/脱困/计时销毁状态机）+ `Blocking`（阻挡校验）+ `RasterProbe`（地形探针共用）；`TerrainAssist`（坡正面混合 + 上岸爬岸，L2/L3 同参数）。
- **退役口径**：`killed / demoted / recycled / despawned / mode_cleanup`；唯一伤亡通道 `SwarmLedger.reportCasualty`；非击杀离场 `noteRecall/noteRemoved`。

---

## 6. 寻路（`nav/` + `SquadNavigator`）

- **PassTable（可行性表 · 真源）**：五值（自身高度 + 四向边 可走/净落差）；**边型 = 地形表裁决**（`weld/cliff`，与渲染同源）；格对齐块格（4m）；`weld`（坡/水/坑焊）= 普通可行边；`cliff` 落差 ≤`EDGE_CLIFF_BAND=0.6` 可走、>0.6 **上墙下可行**；深坑（`pit && h<−1.2`）双向禁；**每边存 climb 位**（坡面且净升 >0.6）。
- **LongPath（坡度加权 A\*）**：八向 octile；**上坡 +0.6/m**（偏好缓坡/垭口）；**上坡横平竖直**（斜向仅平/下坡）；输出走廊路点带 `climb` 标注。
- **短跳（ShortHop/贪心）**：LOS 10m（窄地形 6m）；推进 >0.5m 硬门槛；`W_SAFE=4×(1−pathMul)`；**爬升加价 2/m**；惯性 5s 同向加分。
- **分工（用户定）**：**长行军=长寻路**（`LONG_PATH_DIST=40m`）；短程（交战/巡逻/驻守/就近施工）=短寻路；`ensurePath` 触发 = 无路径 / 目标位移 >24m / 12s 超时 / 失败冷却 3s。
- **走廊**：`SquadNavigator.ensurePath` 写入**队长核执行态**（`state.corridor`），`Anchor.currentTargetOf` 沿线滚动；L3 编队 steer 与代理跟随同源。
- **执行层**：上坡走坡正面（明显爬坡才拉直：`up>0.45 && mag>0.22`；0.65 路径/0.35 梯度）；爬坡态定速直推、免立面、跳过分离；**坡面不许驻留**；水中上岸台阶放宽 `SHORE_CLIMB_MAX=2.5m`（陆地仍 0.6m）；水=正常地块（仅建表软降分 −0.6）。
- **无质心**：锚点前瞻/编队朝向/寻路起点/实体槽位全部按**队长**；成员 = 队长 + 槽位偏移。

---

## 7. 工兵（`engine/EngineerManager` 全权）

- **位置查询（唯一口径）**：`FortifyPlanner.targetOf`（危险点优先 → 扇区弧链随机可达点）；经 `SwarmData.engineerPort()` 消费（数据：分区/需求/环带/可达/落地端口）。
- **派件**：每拍摊销 1 区刷新；任期内沿用（未建 + 需求有效）；建成/失效/出带 → 重取；**件必须在施工带内**（环夹取会挪目标）；**首件豁免**"第一波停新增"（落地班底必派一件，完成一件后停）。
- **施工**：队长到件 **3m 内**计时（实秒）；**掩体 6s / 战壕 10s**（每 2s 挖 1 遍 ≤5 遍；坑底 −1.2m 封顶）；**总攻只修掩体**（战壕暂停）。
- **不入攻击队列**：`LiveView.attackables` 过滤工兵编制；统一计时仍看全体。
- **前推/连通**：8 区全达标 → `pushM` 棘轮（≤0.5m/拍，封顶 `frontP×120m`）；施工带 `rHi ≤ 环上限`。

---

## 8. 战斗与快车道

- **真弹道**：敌箭/敌法球/玩家弹三池 + `CombatSystem.resolveBulletHit`（敌人/静态世界分类结算）+ `ExplosionFx`。
- **快车道 `FastLane`**：代理直扣（`nearestAgentIndex + damageAgent`，倒序防 swap）；实体走伤害管线；屏幕外一律快车道。
- **AI 激活焦点=相机**（RTS 调试）：`aiCtx.focusX/Z = cam.tx/tz`；`aiActiveRadius=75m` 外休眠。
- **近战**：`hooks.melee`/`aiCtx.attack` 按 `AGENT_TARGET_SHIP` 扣舰船血。
- **开火闩锁**：见 §2.7（队列许可 → 队长写指令时软禁火/放行）。

---

## 9. 时间尺度（单源）

- **命令/规划层**（引擎发令 + 队长/成员命令）：**游戏分钟**；`GAME_SEC=0.2`、`GAME_MIN=12`（1 游戏分钟 = 12 实秒）。
  - 命令 TTL：引擎令 ≥60 / 指令 6 / 玩家令 30 **游戏分钟**；换令稳定门 进度≥50% 或 静止≥25 实秒。
- **其余一律实秒**：日钟（`simT/720000`）、施工（6s/10s）、战斗冷却、寻路重算 12s、卡死回收 25s、警戒 6~20s。
- **引擎时钟**：main 传 `performance.now()/1000`（实秒；不再是 simT 的千分之一）。
- 已知混合：高倍速时命令计时相对游戏时钟变短（`performance.now` 实秒），后续可统一到模拟时钟。

---

## 10. 时序（每帧）

| 频率 | 内容 |
|---|---|
| 每帧 | `data.tick`（地形表/事态环/工事数据/生成队列）→ `swarm.update`（代理移动/流场/LOD/回收）→ **引擎 tick（2Hz 相位）** → **队长核 tick（drive+汇报）** → `tickDemote` → `aiSystem.updateAll` → `charClamp` → `explosionFx` → `entities.simulate/present/renderAll` → 子弹池 → `CharacterFxManager` → 渲染 |
| 引擎内 1Hz | 攻击队列（入队/去重/开火检验+闩锁）+ 统一计时（卡死窗口/寿命） |
| 2Hz | 列表刷新、时间轴刷新、AiTrace 采样 |
| 变速 | `,/.` 调速 1~100×（子步进 ≤0.05s/步；日钟走模拟时钟） |

---

## 11. 关键参数（集中调参口）

| 参数 | 值 | 位置 |
|---|---|---|
| 环：宽环/大圆/甜甜圈/点 | ±80 / 90 / (60,180) / (0,0) | `SwarmData.ringBounds` |
| 波次 / 放行 | 第一波 0.45 / 总攻 0.80；releaseAt 0.20→0.50→0.75→0.95→1.00 | `EngineBridge` / `PostureFn.releaseAt` |
| 抵舰驻留 | 抵舰 70m → 驻守 45s；血比<0.45 后撤 | `EngineBridge.write` |
| 引擎节拍 | 2Hz（相位 tick） | `EngineCore.hz` |
| 兵种策略 | 近战 12m / 远程 18m / 飞天 10m | 各 Manager |
| 同兵种间距 | ≥40m（切向 θ；r 不变；不可满足 θ→π） | `engine/Spread` |
| 命令稳定门 | 进度≥0.5 或 静止≥25s | `ORDER_STABLE` |
| 玩家令 TTL | 30 游戏分钟 | `EngineBridge.PLAYER_ORDER_TTL` |
| 开火射程（闩锁） | 25m | `EngineBridge.fireRange` |
| 卡死回收 | 包围盒<4m 持续 25s（驻守/交火豁免） | `SwarmConfig.STUCK` |
| 工兵施工 | 到件 3m；掩体 6s / 战壕 10s（2s/遍×5） | `EngineerManager` |
| 施工带 / 需求线 | `rLo=max(24,frontMinD+8)`、`rHi=min(max(90,rLo+30)+pushM,frontMaxD)`；`NEED_DONE=0.6` | `SwarmData` |
| 长短寻路分界 | 40m | `CommandLang.MARCH_DIST` / `NAV.LONG_PATH_DIST` |
| 长寻路加权 | 上坡 +0.6/m；斜向 ×1.414（上坡仅四向） | `FeasibilityPath` |
| 短跳 | 10m→6m；爬升 +2/m；推进>0.5m | `ShortHop` |
| 硬边台阶豁免 | 0.6m；>0.6 上墙/下可行 | `PassTable.edge` |
| LOD | L3 45/36、L2 120、L1 190、降格 55 | `SwarmConfig.SWARM` |
| 掩体校验 | STANDOFF 7 / TOL 3.5 / NEAR 2.5 / FAR 3.5 / GAP 1.2 / HIDE 2.5 | `entity/base/Blocking.PROTECT` |

---

## 12. 验证防线（四关 + 指标基线）

| 关 | 命令 | 内容 | 失败口径 |
|---|---|---|---|
| 类型 | `npm run typecheck` | `tsc --noEmit`（src 全量） | 非 0 退出 |
| 架构 | `npm run guard` | ①文件膨胀（1200 软/3800 硬）②命令单源回潮防护（`board.issue`/`issueOrder` 不得再现）③迁移不回潮 ④配置真源 ⑤**G1~G9**（engine/squad/nav/**data**/entity-base） | 非 0 退出 |
| 冒烟 | `npm run smoke` | 选点页→换种子→进世界；6 项断言 | 6/6，否则退出 1 |
| 行为 | `npm run probe` | seed 4242，T+8/20/40/70 采样（阶段/环/命令/寻路/工事/销毁率/轨迹）+ 基线断言 **10/10** | 10/10，否则退出 1 |
| 自检 | `npm run test:engine` | 纯模块自检（引擎/队长/校验链/工事/计时/闩锁）**153/153** | 全过 |
| 合并 | `npm run check` | typecheck + guard | 非 0 退出 |

**§6 指标基线**（probe 量化）：

| 指标 | 目标 | 当前 |
|---|---|---|
| 成员空转 | <5% | ~2.5% ✅ |
| 同兵种目标间距 | ≥40m | 收拢态物理上限（r<20m 弦长≤2r）——**口径待定** |
| 卡死回收 | ≤10/min | ~3~5/min ✅ |
| cmdChanges（62s 窗口） | ≤5 | 6（删守点粘性的代价，差 1） |
| 销毁率 | 信息项 | 离场 ~7/min（杀/回收）+ 计时判决 ~5/min |

环境变量：`RTS_URL`（默认 `http://localhost:5175/`）、`CHROME_PATH`、`SEED`。

---

## 13. 铁律 G1~G9（重写铁律，arch-guard 静态强制；只查新目录）

| # | 规则 | 检查 |
|---|---|---|
| G1 | **单一发令器**：引擎命令只经 `engine/OrderWriter.ts` | 静态：`issueChecked/issueOrder/issue` 只许 engine/ 出 |
| G2 | **队令单写口**：`SquadOrderStore` 只许 `OrderWriter` 写 | 静态写方法引用 |
| G3 | **成员指令**：directive 列只许 `squad/`（队长层）写 | 静态写列 |
| G4 | **信息单源**：世界位置只许 `engine/` 读（禁直读 spawn/hooks） | 静态 |
| G5 | **保护锚专用**：`anchor` 写点只许引擎保护令（`data/State` 适配器注明例外） | 静态 `.anchor =` |
| G6 | **时间尺度**：engine/ 与 squad/ 禁裸 `performance.now()`（now 从参数传入） | 静态 |
| G7 | **寻路不改地形**：`nav/` 只读表（`PassTable.ts` 建表除外） | 静态 |
| G8 | **文件预算**：新目录单文件 ≤800 行 | 行数 |
| G9 | **调试口契约**：管理器暴露 `readonly dbg`；`__rts.newEngine()` 可读 | 探针冒烟 |

---

## 14. 里程碑（精简）

| 期 | 内容 | 状态 |
|---|---|---|
| R0-R13 | 相机/选点/地形一次性；命令单源；实体管线；AI+战斗；选择/列表/检视地图/记录器；区域任务/视野升格/快车道/环形活动区/时间轴 | ✅ |
| R14-R17 | 发令闭环 / 行为体检 / 蜂群优化 / 战术层级（扎堆/磨蹭/层级/施工计时） | ✅/⚠️ |
| R30-R45 | 验证防线 / 命令保护 / 分派收编 / 工兵收编 / 命令侧时间 / 爬山寻路 / 上岸 / 手动放敌 / 水=正常地块 / 可行性表重写 / 上坡横平竖直 / 去质心·跟队长 / 山地探针 | ✅ |
| **R46 单写口收口** | 旧战斗指挥链删除；执行板续期；玩家令 TTL；切向散开精确解 | ✅ 2026-09-25 |
| **R47 执行层换装** | `SquadCore.drive` 唯一队长层；`State/Decompose` 归位；`SquadDispatch/OrderGate/SquadTactics/CommandLedger` 删除；UI/探针改读 `SquadView`；开火闩锁/计时回收落地 | ✅ |
| **R48 能力回流** | 抵舰驻留迁波次决策源；磨蹭纠正/守点粘性按用户要求删除 | ✅ |
| **R49 波次迁入** | 波次判定 + 兵力放行迁 `EngineBridge`；t01 回退自动复位 | ✅ |
| **R50 数据面归位** | `SwarmCommander` → `data/SwarmData`（无指挥语义）；`swarm.commander` 全改 `swarm.data` | ✅ |
| **R51 复合→原子下放** | `squad/CommandLang` 解释器；引擎 `Protect` 只给 G/P；自检 153/153 | ✅ |
| 待办 | 收拢态间距口径 / cmdChanges 调优 / legacy `WorldMode.ts`（3558 行旧模式）清理 / §16 山地优化 | ⬜ |

---

## 15. 词汇表（UI 中英码对照）

- 复合命令（引擎→队长）：act 行动 / march 行军 / defend 防御 / protect 保护 / garrison 驻守 / patrol 巡逻
- 个体指令（队长→成员）：push 推进 / suppress 压制 / screen 掩护 / fallback 后撤 / boundBack 交替后撤 / guardWard 护卫 / block 拦截 / intercept 截击 / sneak 潜行 / pin 钉住 / strike 突击 / bound 跃进 / cover 掩体 / focusFire 集火 / regroup 收拢
- 来源：engine 引擎 / player 玩家（队长自主令已删）
- 原子能力：patrol 巡逻 / garrison 驻守 / march 行军（长寻路）/ act 行动（短跳）

---

## 16. 已知问题与待办

1. **收拢态间距**：总攻环收拢为点时，同兵种 40m 间距几何不可满足（弦长上限 2r）——需定"指标口径"（非收拢态判定）。
2. **cmdChanges 6~7**：删守点粘性后守点目标随自身漂移，略高于 ≤5；可用"守点节流/换令条件"微调。
3. **§16 山地**：短跳半径/角度自适应、台阶段落差聚合、拉直防贴崖、舰船/落点周围强制产坡（待定）、`TerrainScore.cls` 标定对齐（待定）。
4. **高倍速混合时钟**：命令计时用实秒（`performance.now`），100× 时相对游戏时钟变短；后续可统一到模拟时钟。
5. **guard 已知债务**：`ChunkManager/GachaOverlay/FluidSolver/MapEntityDecorBase/TerrainMaterial` 五个非蜂群大文件（与本次重写无关）。
6. **可选拆分**：`SwarmSystem`（1151）/`SwarmData`（692）/`EngineBridge`（415）/`main`（843）为"大而不乱"的文件，按需再拆。
