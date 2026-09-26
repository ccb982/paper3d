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
   - **命令使用设计（用户定 2026-09-25）**：
     · **用命令（执行侧）= 按距离选寻路**（>40m 长=可行性表路线 / ≤40m 短=LocalStep）→ 沿路点走 → 到达即止；
       失败冷却重试、**不发不可保证的路**；不打断保障 = 锁存 + 重规划仅 4 事件。
     · **下命令（发令侧）= 引擎少发令**：只在"① 事态变更且不在范围 → 长寻路 / ② 危机 → 回撤 / ③ 扎堆 → 拉开"三时刻；
       长寻路非引擎专属（队长派件也可，如工兵进防区）；令尽后小队**自决**（短寻路、在无序中向舰推进）。
     · 详见《寻路重写方案.md》§4.4（执行契约）/ §4.4.2（下命令方案，8 维待裁决）。

### 0.1 收回机制铁律（不可动；用户定 2026-09-25）
- **卡死判决 / 寿命销毁 / 收回落地**（`TimerManager` → `retire` / `recycleByUid`）**一律不得弱化、不得放宽豁免、不得绕过或删除**。
- **被收回 = 一定出了问题**：工兵被收回 = 站桩/无件可派/到不了件；战斗单位被收回 = 卡住/失去行动。**修行为（派件、寻路、行动），绝不修判官**。
- 豁免名单**只减不增**（当前仅：驻守命令 / 交火中）。给某类单位新开豁免 = 放过问题，禁止。
- 口径：**宁可错杀不可放过**（从严；放宽=放过问题，比错杀更糟）。

### 0.2 禁私自补丁铁律（用户定 2026-09-25）
- **只做架构上的彻底调整**；**严禁**在管理器/执行层随手加兜底、阈值、特判、局部 hack（"乱打补丁会彻底毁掉项目"）。
- **发现问题必须汇报**（现象 + 证据 + 根因 + 影响面 + 方案选项），**不得私自"顺手修"**；等裁决后再动。
- 改动必须：① 说明问题与方案 ② 明确影响面（谁读谁写、铁律是否被碰）③ 同步更新本文件与相关注释。
- 未经裁决的临时改动一律标注 `★★ 待裁决（§0.2）★★`，可随时整体回滚。
- 本阶段口径：**整个项目最负责、最谨慎的阶段**——宁可慢，不可乱。

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
  nav/      PassTable LongPath LocalStep（短寻路；Corridor/ShortHop 旧加权链已退出主链）
  根        SwarmSystem（代理移动/渲染/LOD）、AgentPool、SquadTable、TerrainScoring/TerrainSemantics/HoleMask/HoleTable、
            PostureFn、FortifyPlanner、CommanderSpawn、SwarmLedger、SwarmBatch、SwarmConfig、SwarmDanger、UnitTactics/UnitStrategy
```

> **已删（不再存在）**：`SquadDispatch / OrderGate / SquadTactics / CommandLedger / EngineerCorps / EngineerDispatch /
> CommanderAnchorSelect / Decide / BattleLine / MemberTaskBoard / MemberTaskNav / SquadDoctrine / SwarmRecovery / SwarmCommander`；
> `?swarm=old` 回退开关与 5 篇旧设计文档一并删除（git 可回溯）。

---

- **`tactics/`（战术侧新层，2026-09-26 起）**：`SectorBuilder`（8 扇区构建/可部署面/主攻选择）+ `BattalionManager`（大队编制/小队情况表/部署去重/缺口表）。
  只读地形与小队状态、**不发令**（发令唯一出口仍 `engine/OrderWriter`）；对 `__rts.tactics` 暴露。

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
  ③ **可达**：`canReach` 注入核验（**长途 BFS / 短程 LOS 快筛**；`SwarmSystem.reachFrom` 唯一实现；不可达 → 不发/调用方缩近）。
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

### 2.10b 原子与行为（用户定 2026-09-25）
- **原子只有两个**：**长寻路（march）** 与 **短寻路（act）**——移动世界里的全部原语。
- **一切行为（驻守/巡逻/保护/撤退/远程选位…）都是循环**：
  ```
  loop { 目标点 = 取目标函数(现场)   // 必须返回"可行"目标点（三张表校验）
         移动到目标点：短寻路（近）或 长寻路（远） }
  ```
- **取目标函数（每行为一个）**：如工兵 `FortifyPlanner.targetOf`（可行建造点，模板）、
  巡逻 `patrolNext`（锚点附近可行点）、保护 `blockCheck` 调整点 **+ 掩体校正**（保证**被保护目标真被挡**）、
  驻守=守点 **+ 掩体校正**（保证**自己真被挡**）、撤退=后撤点。
- **禁止**：为某行为写独立移动实现；行为只准"取目标 + 两个原子移动"。
- **小队分配（用户定 2026-09-26，待实施）**：近战/远程管理器**知道全局小队数与各队位置**——
  “哪队去哪”必须是**综合考虑的全局分配**（可数量、位置、同兵种间距、可达性、任务优先级），
  不是只在小队目标上加一个切向间距修正（现状 `Spread.spreadFix` 只做后者，属临时口径）。
- **上坡（最终收敛 2026-09-26；移动侧已闭环）**：上坡点/落点 = 可行性表构建期预处理（连续坡段中心、坡面前 2m / 坡面后 1.5m、带坡宽/rise）；
  长寻路与 S1 短寻路共享 `nav/ClimbVia` 插"上坡点→跨坡点★"。
  **凭证 = 两条来源并存（用户定）**：① **小队凭证**（`state.climbCred`，全队持有；`ensurePath.applyCred`：新路有坡点→换票、
  无坡点→保留（`kept`）、**只有"到达目标、接上下一条寻路"才回收**）；② **成员自身寻路凭证**（追队长的长寻路含跨坡点 ∧ 低侧 ∧ ≤10m → 该成员也得票）。
  执行 `CharacterCore`：**① 强制走位三点式**——未起爬时 退出坡面 → 坡底横移对齐 → 正向进点；
  **② 起爬必须在爬坡点**（≤`CLIMB_START_R=0.6m`，此时才查**硬边防线**=本格有该向可爬边）；
  **③ 爬升承诺 ClimbCommit**——一旦起爬锁存本次坡+落点，凭证丢失/steer 过期/零限速/停步/眩晕均不得中断（自主最低速 `CLIMB_MIN_SPEED=2.5`）；
  **④ 完成 = 到落点且脚着地**（`|top−y|≤0.25`；埋体/悬空不算爬完）；
  **⑤ 防卡地里**（爬升态贴最高表面：L2 跟随 `gy`、L3 `CharacterClamp` 取 `surfaceHeightAt`）；**⑥ 硬墙斥力**依 `canStep`（出自"不卡墙"版本，保留）。
  **精确记录**：`__rts.climbStats`（core/route/trace）——起爬点实测距（`startDistMax`/`badStarts`）、会话/到落点/弃约、
  脚高记录（`y0/top0/buryMax/footGap`/`buryFrames`）、聚集诊断（`near/nearDeep/nearAlign/nearGo`）。
  成员移动 = 定时对队长长寻路（同一条路）。**实测：badStarts 0 · startDistMax 0.598m · 聚集区 noCred 采样 1606→18 · 会话 738/到落点 202/卡地里帧 2。**
- 收口（2026-09-26）：类型 `MoveAtom = 'march' | 'act'`（两个原子）；`SquadMode = MoveAtom | 'patrol' | 'garrison'`
  （运行模式；patrol/garrison 属行为循环驻留）。`engine/contracts.ts` 单源。

### 2.11 三张表原则（用户定 2026-09-25）
**只有三张表**：**地形语义表**（偏好/评分基础）· **可行性表**（硬通行唯一来源）· **战壕掩体表**（动态工事：参与评分；工兵建成即更新）。
`TerrainScore` **已废除**（越权的第四套网格，2026-09-26）：① 硬通行（`blockedAt`/`pickSteer` 硬格）→ 地形真相（坑=墙）+ 与寻路同口径陡差；② 评分面 → `TerrainScoring.ts` **查询时纯函数**（语义表可站/宽度/隘口/坡 + 可行性表高度 + 掩体表战壕/bonus + raster 高度）。详见《寻路重写方案.md》§4.4.6。

### 2.12 战术侧重构（用户定 2026-09-26；**用户亲自主导**；待实施）

> 背景（本日只读调研）：现战术侧 = 全兵种只绕舰画环（无以敌为目标）+ 到达/换令口径四套阈值打架 + TTL 不续期 + 近战伤害 targetKind 断链
> → 小队“executing 空转”、整场零战斗产出（详据见 §16.8）。重构方向以下三条，均由用户亲定。

**① 按 chunk 的战术策略（用户亲自写）**
- 地形模板有限——**以飞船所在的 chunk 为键**，用户手写该 chunk 的战术策略：
  进攻方向/节奏、集结与压迫线、火力位、掩体/战壕需求、撤退条件等；引擎按当前 chunk 选择并执行；
  无策略 chunk 走默认。（现环形几何 `MeleeManager/RangedManager/FlyerManager` 作为兜底，不再作为主策略）
- 策略表格式/键与默认策略待用户亲定。

**② 编制：大队制（用户定 2026-09-26 细化；**已实现 v1：`tactics/BattalionManager`**）**
- 全部兵力编为若干**大队**（约 **30 人/大队**），大队下设小队；**部署/任务以“小队”为原子单位**。
- 大队 = **任务与防区的持有者**；新**大队管理器**职责：组建/补员/满编维持、按小队向防区部署、跨防区调度。
- **部署去重（管理器视角）**：同一防区**不重复部署同类小队**（按配额）；同一小队不双投；部署表全局唯一。
- **缺什么补什么**：每个防区持一张“小队类型缺口表”；部署器按缺口逐队补齐；尽可能维持各小队**满编**。
- **大队编制（管理器视角）**：大队（~30 人）= 若干小队（近战/远程/工兵按配比）；管理器维护
  **大队花名册 + 每小队情况表**（类型、在编/满编、实时位置与所在层、当前任务/原子、目标可达性、伤亡与补员缺口、静止时间）。
  数据源单一：`SquadManager`（位置/原子/阶段/进度/静止）+ `SquadTable`（成员/领队）+ `Ledger`（伤亡缺口）。
- **按情况部署**：部署决策以“小队情况”为输入——缺编先补员/补队；按防区缺口表配类型；不重复部署；满编优先。

**③ 战区（扇区）重写：8 扇区 + 主攻方向（用户定 2026-09-26）**
- **全环仍分 8 个扇区**（就是现有 `FORTIFY_SECTORS = 8` 口径）；**从中选 1~3 个作为主攻方向**（按难度）——
  **未入选的扇区不部署/不作战**；主攻扇区 = 部署与作战的唯一范围。
  **（后续待实现；用户定 2026-09-26 细化）非主攻扇区派遣“工兵 + 护卫队”——**四处造防线，阻碍玩家采集**：
  工兵小队在非主攻扇区（玩家采集路线/资源点周边）修筑防线与战壕，**阻断/骚扰采集**；护卫小队随行掩护；
  编制来自非主攻方向的富余兵力（**不占主力编制**）；待定：采集点/资源点表的来源（语义表新增或单独表）、被阻断判定。——本期只记档，不实现。
- 一个主攻扇区可**部署多个大队**（**含工兵小队**）。
- 防区产出缺口表→部署器按小队下发；防区的作用 = **部署与驻守的唯一容器**（不再是“一对一认领”）。
- **随打随补**：损失即补员、空编即补队，维持满编（补给走 roster/spawn 缺口闸门）。

**④ 全新的扇区构建系统（SectorBuilder；用户定 2026-09-26；**已实现 v1**）**
- **基准**：以角色（舰船）所在位置/层为圆心，全环 8 扇区（角度均分）。
- **可部署面**：同层可达 ∧ 无需爬坡/绕路（`canReach` 同层口径）∧ 在作战/施工带内；
  **排除与角色同层连通的高原/山顶整片区域**（上去要绕路）。
- **构建产物**（每扇区）：可部署点集/容量 · 到舰距离带 · **小队类型缺口表** · 需求热点（工事 need）；
  供部署器**选 1~3 个主攻扇区**并逐队部署。
- **刷新**：摊销/事件驱动（舰迁移、地形/工事变、到达置不了）；中心单源（`lastShipX/Z` 就绪门：未就绪不构建）。
- **可视化（用户定 2026-09-26）**：小地图（**M** 总览）按 SectorBuilder 点集画**防区真形**（随地形；高原/山顶整片不画），**主攻扇区橙色高亮** + 边界射线 + 区号/点数标注。

**⑤ 地形高度硬规则（用户定 2026-09-26；极重要）**
- **舰船所在位置关联的一片高地（含**高地里的坑洞/凹陷**）整片不得纳入防区**——上去要绕路；
  防区偏防守，不强占舰船所在的高原/山顶。**没有舰船 → 正常占领**（不做高度排除，只排坑/水/硬墙）。
- 防区 = **山脚下的包围圈**；判定口径（`SectorBuilder.onShipHighland`）：① 高度 ≥ 舰船层-0.5m → 高地本体；
  ② 自身深陷（>1.2m）但 **8 方向 8m 内 ≥6 个方向为舰船层高** → 高地里的坑洞/凹陷（一律排除）。

**与现有层的关系**：策略层（chunk 策略）→ 大队（任务/防区）→ 小队（执行：现 `squad/` 三件套 + 两原子）；现 `DecisionChain` 作为无策略时的兜底保留。

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

### 3.2 队长命令语言（解释器 `squad/CommandLang.ts`；**原子=长/短寻路**，见 §2.10b）
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
- `MarchAction.ts`：`createSquadNav`（**仅降级兜底**：自检/未 drive 时的距离分流计数；实机执行侧=按距离选寻路 LocalStep/可行性表）。
- `SquadRegistry.ts`：每队一个 SquadCore；`accept/tick/stateOf/states/drop`；驱动端口（`squadOf/ensurePath/leaderTarget/clampRing/terrain/mobTactics/fireAllowed/applyDirective`）由 main 注入。

---

## 4. 数据层（`data/SwarmData.ts`）

> **纯数据/查询/端口，无指挥语义**；引擎/队长核/导航/UI/探针只读消费。文件头写明 owner。

- **地形与表（上坡点/斥力均出自 PassTable）**：`DefensePlan`（`analyzeLandingTerrain`）+ `PassTable`（建表并 `attachPassTable` 到寻路；`climbRuns` 预处理上坡点、`canStep` 供硬墙斥力）+ `TerrainScoring`（查询时评分纯函数；`SwarmData.scoringSrc` 每拍注入三张表句柄 + 权重 + 玩家位；`distGain=1+24·t01` 并入 dist 权重）+ `TerrainSemantics`（L1，落点锚，静态）+ `HoleMask/HoleTable`（L2，破坏掩码 + 坑洞/掩体表 2Hz）+ `setSteerTable` 表桥（实体 SteerPick 同表）。
- **查询**：`blockedAt/coverAt/walkableLine/heightAt/slopeGradAt/pathMulAt/pathMulFor/scoreForType/rangedPost/debugHasCover/isWaterAt/pathStamp/canStep/climbRunAt/nearestClimbPoint`。
- **事态与环**：`PostureFn`（`p = clamp(schedule(t)+provocation)`，挑衅=被击 ×0.01 / 击杀 ×0.03，τ=90s，上限 +0.35；姿态阈值 0.22/0.30/0.55/0.80，assault 锁定）；`battlePosture`；`t01` 时钟（落地归一，`DAY_RHYTHM_S=450` 兜底，`debugDayT01/scrubDay/followRealtime`）；`ringBounds`（**p 驱动**：**外圈大圈一直收缩只减不增**：D0max → 大圆 90 → 缓缩 80 → 0；**内圈小圈先收缩 → 第一波后立即增大（甜甜圈 60，p 0.45-0.55）→ 再收缩**；总攻 p≥0.80 时已是 (0,0) 点）；环 1Hz 更新；**时间轴可自由快进/倒退**（`scrubDay`/`followRealtime` 重置姿态状态 → 环可反向）；`frontP`（单调）+ `ring/clampToRing/frontGate/postureInfo/setPosture`。
- **工事数据**：`FortifyPlanner`（8 扇区；`refreshOne` 摊销 1 区/拍；`assign` 需求最高优先一队一区；`targetOf` **扇区内 ∧ 带内 ∧ 可达 ∧ 需求最高**（候选=需求降序表；高位不可达→次高可达；全不可达→null；**绝不出扇区/带**，确定性不掷随机数））；`pushM` 前推棘轮（8 区达标 +1m/拍=2m/s，封顶 `frontP×120m`；**无可行点扇区视为达标**、未扫描不算；前推闸门 `FRONT_TAU=18`）；`fortifyBand`（`rLo=max(24, frontMinD+8)`、`rHi=min(max(90,rLo+30)+pushM, frontMaxD)`；**总攻 → (0,0) 收缩为点**）；`fortifyNeed`（`scoreForUnit('defense')×(1−cover/COVER_FULL)`）；`stage` S1→S2（第一波 0.45 停新增）；`engineerPort()`（见 §7）。
- **编制与生成执行**：`RosterController`（占比/缺口 4Hz）；`CommanderSpawn`（`deploy/battalion(instant)/drain/reset` + 回收名单）；生成端口（`spawnMob/spawnMobIndex/spawnBuilder/buildCover/digTrench`）由 main/CommanderWiring 注入；`planDefense`（建计划 + 表 + 复位 + 开局班底）。
- **地形破坏入口**：`noteTerrainDig/markTerrainDirty`（`ChunkManager.onTerrainDig` 中央钩子；子弹/战壕都过）→ 掩码窗扫（`HoleMask.refresh`，挖过即战壕·评分查询时直读）+ 采样缓存失效。

---

## 5. 代理与实体（L2/L3）

- **代理池（`AgentPool`，SoA）**：列 push/copy/snapshot **三处同步**（新增列必须三处齐改）；快照含 taskX/Z（已停用）、directive 列、order 列、LOD 列。
- **移动纪律（禁止向量合成）**：`SteerPick` 16 向候选 + 硬否决（表 blockedAt/陡坡）→ 打分（`W_PATH 1.6·cos` + `W_TABLE 0.8` + `W_TURN 0.7` + 避让惩罚 − 水/掩体惩罚）→ softmax(0.18) 抽样 → 承诺 0.5s；`move()`：队长走 `leaderDir`（锚点/队令目标）；成员走 `followDir`（追队长/走廊）；承诺反向保护（`dot(held,desired) ≤ −0.2` 重选）。
- **LOD**：L3 ≤45m（上限 36）/ L2 ≤120 / L1 ≤190 / 降格 55m；决策 2/5Hz、移动 10/20Hz、L3 编队 steer 10Hz；升格=视野（相机视锥±15% 且 <220m）；升降格走 `SwarmTierPort`（无损）。
- **实体三件套**：`EnemyBase`（载体）+ `EnemyBrain`（战斗原子/开火）+ `EnemyPresentation`（表现）+ `EnemyLocomotion`（危险绕行）。
- **基类（两载体同内核）**：`entity/base/CharacterCore`（推进/上坡三点式+承诺/立面阻挡/贴地回退/脱埋，`TerrainProbe` 注入）+ `RasterProbe`（地形探针共用）+ `SteerPick`（`SteerTable` 表桥）。旧 `Locomotion/Abilities/contracts/Climb` 已删（收敛 2026-09-26）。
- **退役口径**：`killed / demoted / recycled / despawned / mode_cleanup`；唯一伤亡通道 `SwarmLedger.reportCasualty`；非击杀离场 `noteRecall/noteRemoved`。

---

## 6. 寻路（`nav/` + `SquadNavigator`）

### 6.0 表管线（真相源 → 可行性表 → 语义表；用户定 2026-09-25）
```
地形生成（真相源；静态）
  Tiles（地块类型：平地/高台/水/坑·装饰）+ ChunkGenerator（高度场）
        │
        ▼
  Refinements.finalRuling —— 边裁决唯一出口（weld=坡 / cliff=硬边）
        │                   （水全向插值 / 30% 大落差产坡 / 围裙保护）
        ├────────► 渲染/几何/物理（坡面/立面）——同源
        ▼
可行性表 PassTable（**敌人消费收敛层**：只读、静态、一次构建）
  · 每格：高度 + 四向有向边（can/drop/climb）+ 水域 + 坑墙
  · 消费语义：weld=坡（双向；上坡标 climb → 程序化爬坡）
              cliff ≤0.6m 可走（无视小落差）；>0.6m **只下不上**
              坑（**地块类型 pit**，不是战壕）→ 墙（目标口径）
        ├──► 寻路（LocalStep / Route —— 只读 PassTable）
        └──► 移动内核（CharacterCore 经 TerrainProbe）

地形语义表 TerrainSemantics（消费层·战术偏好；与可行性**正交**）
  · 高地/低谷/迎背坡/关口/走廊/开阔/隐蔽/陡壁/水/坑
  · 只影响"偏好"（短寻路 risk / TerrainScoring 评分），**不决定能不能走**

动态破坏 HoleMask / HoleTable（工兵挖掘/战壕；**不是地块类型**，与 pit 无关）
```
- **铁律**：地形裁决**只在真相源**（Tiles/ChunkGenerator/Refinements）——敌人侧不改裁决，只消费。
- PassTable 只经 `finalRuling` 读取；一次构建，工事/挖掘**不重建**（动态破坏走 HoleMask；战壕 ≠ pit）。
- 寻路**只读 PassTable**；安全偏好读 TerrainSemantics（经 `riskAt` 注入），**可行性优先于偏好**。

- **高精度定位（待实施，用户定 2026-09-25）**：4m 格「同 (x,z) = 同地」忽略 y/层 → 崖底被判「已在崖顶」；
  设计 = H2 **y 感知层**（cell+layer 判等/到达/取点，`surfaceHeightAtFor` 选层）+ H1 队长附近 **1m 局部高精度** + H3 1m 语义取点；
  **实现归属 = 实体基类**（`TerrainProbe.layerAt` + `CharacterCore.canShift`，L2/L3 同内核自动同款；nav/Anchor 只经端口消费）；见《寻路重写方案.md》§4.4.5。
- **待实施（2026-09-25 用户报告）**：① **位移绕过**——人群分离/障碍推出/贴地（`CharacterClamp`）未过台阶校验 → 敌人可"借推力卡上硬边"；规则 = 所有水平位移统一过 `canShift`、贴地前置校验（见《寻路重写方案.md》§4.4.4A）；② **寻路成本无"坡优先"**——weld 坡与 ≤0.6m 台阶硬边同价 → A* 选最短"爬墙"路（§4.4.4B，待定点验证 + 移动质量成本）。
- **上坡（历史口径，已废）**：旧的 `uphillNormal(x,z,R=5)`+`dot≥0.8` 正对坡面口径**已废**；
  现行 = §2.10b「强制走位三点式 + 起爬必在爬坡点 + ClimbCommit 到落点」。
- **PassTable（可行性表 · 敌人消费收敛层，只读）**：五值（自身高度 + 四向边 可走/净落差）；**边型 = 地形表裁决**（`weld/cliff`，与渲染同源）；格对齐块格（4m）；`weld`（坡）= 双向可行 + 每边存 `climb` 位（净升 >0.6）；`cliff` 落差 ≤`EDGE_CLIFF_BAND=0.6` 可走、>0.6 **上墙下可行**；坑（地块类型 `pit`）**目标口径一律墙**（现状仅致死坑 `pit && h<−1.2` 双向禁）。
- **LongPath（坡度加权 A\*）**：八向 octile；**上坡 +0.6/m**（偏好缓坡/垭口）；**上坡横平竖直**（斜向仅平/下坡）；输出走廊路点带 `climb` 标注。
- **短寻路（`nav/LocalStep`，S1）**：有限窗口 Dijkstra（半径 24m；语义风险偏好；终点精确 ≤1.5m；无解 → null）；仅直线不可走时启用。
- **分工（用户定）= 按距离**：>40m=长寻路（可行性表路线，加密 ≤10m + 逐段 climb）/ ≤40m=短寻路（LocalStep）；
  长寻路非引擎专属（队长派件也可）。`ensurePath` 触发（S3b）= 目标位移 >24m / 净推进停滞 3s / 表代次变 / 无路径；失败冷却 3s。
- **走廊**：`SquadNavigator.ensurePath` 写入**队长核执行态**（`state.corridor`），`Anchor.currentTargetOf` 沿线滚动；L3 编队 steer 与代理跟随同源。
- **执行层**：上坡 = §2.10b 最终口径（三点式强制走位 + 起爬必在坡点 + 承诺到落点）；爬坡态免立面/免回退/不被限速压死；水中上岸台阶放宽 `SHORE_CLIMB_MAX=2.5m`（陆地仍 0.6m）；水=正常地块（仅建表软降分 −0.6）。
- **无质心**：编队朝向/寻路起点/实体槽位全部按**队长**；成员 = 队长 + 槽位偏移。
- **统一移动形式（用户定 2026-09-25）**：保护/驻守/撤退/远程选位/风筝/掉队 = **先给目标点**，再走同一条寻路链
  （短/长寻路 + 可行性校验）；**禁止旁路独立实现**（锚点层已删）。见《寻路重写方案.md》§4.4.7。
- **方案 A（已实装 2026-09-25）：移动消费格边图**——`nav/EdgeFollow`：路线→去重格序列→执行步=**轴对齐单步**（`canStep` 校验；
  斜向格分解两拍）；格边模式跳过 16 向软转向/坡混合，分离保留；L2/L3、队长/成员同款（成员=贪心格边步跟队长）。
  （原结构性问题：移动=连续向量 vs 寻路=离散格边图 → 规划可达但执行走不了；见《寻路重写方案.md》§4.4.3。）

---

## 7. 工兵（`engine/EngineerManager` 全权）

- **取件门**：`engineerPort.canReach = SwarmSystem.reachFrom`（长途 BFS / 短程 LOS；唯一口径）。
- **位置查询（唯一口径）**：`FortifyPlanner.targetOf`（**扇区内 ∧ 带内 ∧ 可达 ∧ 需求最高**；高位不可达→扇区内次高可达；全不可达→null，绝不越界）；经 `SwarmData.engineerPort()` 消费（数据：分区/需求/环带/可达/落地端口）。
- **派件（重做 2026-09-26；用户定）**：**一队一分区**（每支工兵小队独立分区、不重合；队自己指挥自己、及时汇报）；
  **件预约制**（格点全局唯一；防多队同点）+ **每拍复检**（件 ∈ 本区 ∧ 带内 ∧ need 有效 ∧ 可达）+ **到件看门狗**
  （超 `ARRIVE_TIMEOUT_S=25s` 未到 → 拉黑该点换件，`BLACK_TTL_S=60s`）；**补队**：分区工兵小队没了 → 补一支新小队（3 只成队）；
  **件必须在施工带内**；**首件豁免**“第一波停新增”（落地班底必派一件，完成一件后停）。
- **施工**：队长到件 **3m 内**计时（实秒）；**掩体 6s / 战壕 10s**（每 2s 挖 1 遍 ≤5 遍；坑底 −1.2m 封顶）；**总攻只修掩体**（战壕暂停）。
- **不入攻击队列**：`LiveView.attackables` 过滤工兵编制；统一计时仍看全体。
- **前推/连通**：8 区全达标 → `pushM` 棘轮（≤1m/拍=2m/s，封顶 `frontP×120m`）；施工带 `rHi ≤ 环上限`；**总攻收缩为点**。

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
- 玩法计时统一 **`services/SimClock`**（模拟时钟单源；`performance.now` 只留给性能测量/渲染动画）：倍速时行动/下命令/免降格/撤退/警觉/工事占用/卡死豁免全部同步。

---

## 10. 时序（每帧）

| 频率 | 内容 |
|---|---|
| 每帧 | `data.tick`（地形表/事态环/工事数据/生成队列）→ `swarm.update`（代理移动/流场/LOD/回收）→ **引擎 tick（2Hz 相位）** → **队长核 tick（drive+汇报）** → `tickDemote` → `aiSystem.updateAll` → `charClamp` → `explosionFx` → `entities.simulate/present/renderAll` → 子弹池 → `CharacterFxManager` → 渲染 |
| 引擎内 1Hz | 攻击队列（入队/去重/开火检验+闩锁）+ 统一计时（卡死窗口/寿命） |
| 2Hz | 列表刷新、时间轴刷新、AiTrace 采样 |
| 变速 | 档位 1/2/5/10/20/50/100×（Timeline 按钮 / `,`/`.` / `__setSpeed` 同源；子步进 ≤0.05s/步；全部玩法计时走 SimClock） |

---

## 11. 关键参数（集中调参口）

| 参数 | 值 | 位置 |
|---|---|---|
| 环：外圈（大圈） | D0max → 90 → 80 → 0（一直收缩，只减不增） | `SwarmData.ringBounds`（p 驱动，1Hz） |
| 环：内圈（小圈） | D0min → 0（收缩）→ 60（第一波后立即增大）→ 0（再收缩） | 同上 |
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
| 施工带 / 需求线 | `rLo=max(24,frontMinD+8)`、`rHi=min(max(90,rLo+30)+pushM,frontMaxD)`；总攻 (0,0)；前推 2m/s；`NEED_DONE=0.6` | `SwarmData` |
| 长短寻路分界 | 40m | `CommandLang.MARCH_DIST` / `NAV.LONG_PATH_DIST` |
| 可达核验：短程 LOS 快筛 | 20m | `SwarmConfig.REACH_SHORT_LOS_R`（长途一律 BFS） |
| 长寻路加权 | 上坡 +0.6/m；斜向 ×1.414（上坡仅四向） | `FeasibilityPath` |
| 短寻路 | 窗口 24m；语义风险；终点精确；无解 null | `LocalStep` |
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
3. **§16 山地**：短跳半径/角度自适应、台阶段落差聚合、拉直防贴崖、舰船/落点周围强制产坡（待定）、~~`TerrainScore.cls` 标定对齐~~（已随 TerrainScore 删除终结）。
3b. **移动侧（已闭环 2026-09-26，用户确认"基本上去哪都行"）**：所有移动 = 长短寻路（含成员对队长长寻路）；上坡 = 上坡点起步 + 承诺到落点脚着地 + 双凭证源。
   剩余非移动问题：崖段（x≈40-49）派令/绕行距离、回收空转（recall churn）、`smoke` 选点页流程——与移动内核无关。
4. ~~高倍速混合时钟~~（已修 2026-09-25）：玩法计时统一到 `services/SimClock`，10×/100× 行动与下命令同步加速。
5. **guard 已知债务**：`ChunkManager/GachaOverlay/FluidSolver/MapEntityDecorBase/TerrainMaterial` 五个非蜂群大文件（与本次重写无关）。
6. **可选拆分**：`SwarmSystem`（1151）/`SwarmData`（692）/`EngineBridge`（415）/`main`（843）为"大而不乱"的文件，按需再拆。
8. **战术侧重构（用户定 2026-09-26；用户亲自主导；已开工：大队+扇区 v1 已落）**：见 **§2.12**——按飞船 chunk 手写战术策略 / 大队制（~30 人）/ 防区扇区 + 随打随补 + 满编维持。
   同日只读调研的现状三根因（①只绕舰画环无以敌为目标 ②到达/换令口径打架+TTL 不续期 ③近战伤害 targetKind 断链）为重构输入。
7. **寻路重写（待裁决）**：长寻路=通行优先的 Route 服务（逐段可执行、无路报 blocked，绝不回落直线）；短寻路=地形语义引导的 LocalStep（有限窗口完备、无死循环）。方案见 **《寻路重写方案.md》**，批准后按 S1→S4 逐步实施。
