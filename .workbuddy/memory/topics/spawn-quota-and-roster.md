# 专题：刷怪配额 与 敌军名册

> 索引见 `../MEMORY.md`。这里放细节。

## 刷怪 `src/systems/spawn/WorldSpawner.ts`

- **刷怪=玩法层、蜂群=引擎层**，只经 `SwarmSystem` + `swarmHooks` 交互。
  改引擎别动 WorldSpawner；新刷怪逻辑写这里（**写回 WorldMode 则 guard FAIL**）。
- `spawner` 构造在 `enter()` **最开头** —— 否则 `enter()` → `setPhase()` → `syncSceneBgm()` →
  `spawner.warnShown` 会在 spawner 还没建时崩。
- 依赖走 `SpawnDeps` 实时桥，**别做构造时快照**（否则拿不到 player / 拿不到今天的时间）。

### 症状「敌人不生成」排查顺序

1. `phase !== 'explore'`（非探索段本来就不刷）
2. `mobDefs.length === 0`（名册/帧包没加载）
3. `spawnedChunks`（该 chunk 已刷过）
4. ★★ **`quotaAllows()`（`quota − spawned > 0`）—— 头号嫌疑**
5. `MAX_ALIVE = 200`（存活上限顶满）

★★ `spawned` 是**当天累计**、只增不减、跨出击累计。只有换日 `resetDayQuota` 才清零
（`meta.day++` 只在 `onReturn` 里发生）。
⇒ **「一只敌人没有 + 删档就好了」99% 是配额打满**，不是 bug。

## 敌军名册（唯一真源 `src/config/enemyRoster.ts`）

- **加敌军 = 放帧包 + 名册加一条，零其他改动**；
  `ENEMY_ROSTER` 顺序 = `main.ts` 加载顺序 = `mobIndex`。
- ★★ **禁止「取模复用数值」**：旧 `MOB_BLUEPRINTS[i % 3]` 会让第 4 个起全是换皮。
  现按 id `ENEMY_BY_ID.get()` 一一对应，查不到就 warn + 回退。
- ★★ **近战**兵种必须同时给 `attackRadius` 与 `attackRange`：
  `attackRadius` 只是刹车距离，真正的判定半径是 `meleeSwing.params.range`（缺省 1.8）
  ⇒ 只放大 attackRadius 会「站远处挥空」。
  ★ 2026-09-18 修正：**远程兵不吃这条** —— 填了 `ranged` 时 `mobAI` 把 attack 行为整个换成
  `rangedShot`，`attackRange` 根本没读（弩手/术士写着的 `attackRange` 是无效配置）。
- 素材缺失只 warn 跳过（不阻断）；`npm run guard` 校验 file / 掉落 id / id 唯一 / public 漏登记。
- 已知引擎缺口：~~远程无弹道~~（2026-09-18 已修，见下）/ 飞行怪无空中层 / 海怪不下水。

## ★★ 远程真弹道（2026-09-18 落地）

**接线 = 4 处，加一个远程兵只需改 1 行**：

1. `aiconfig.ts` 的 `MobAIParams.ranged`（`MobRangedParams`）—— 填了 → `mobAI` 把 attack
   状态的行为从 `meleeSwing` 换成 `rangedShot`，**且 `attackFinished/outOfRange` 回 `chase`
   而非 `patrol`**（否则打一发回巡逻晾 3 秒 minStay，完全不像"射速快"）。
2. `behaviors.ts` 的 `rangedShot`：发 `type:'projectile'` 意图（与 `meleeSwing` 同一
   `aiAttackTimer`/`aiSwingDone` 契约，只是意图类型不同）。
3. `WorldMode.aiCtx.attack` 按 **camp 路由**：`opts.type==='projectile' && opts.camp==='enemy'`
   → `this.enemyBullets`（独立池）；其余 → `this.bullets`。**加弹种不用改 behaviors**。
4. 弹种视觉 = 池级资产：`services/fx/SolidBulletAsset.ts` 的 `createArrowAsset()`
   （纯程序化，24×96，无资产文件）。

**必须记住的坑**：

- ★★ **`BulletManager` 的弹体世界宽度由资产宽高比推**（`computeWorldSize(asset, baseWidth)`），
  默认 `baseWidth = 3.0`。细长弹（箭 1:4）**必须**传 `opts.baseWidth`（箭用 0.28）——
  否则得到一张 3m 宽 × 12m 长的方片。为此给 `BulletManager` 加了第 8 参 `opts`。
- ★★ **`BulletEntity.sharedSilhouetteCanvas` 是 static** → 建第二个子弹池会**覆盖**第一个池的
  地面剪影（玩家圆弹变成箭形影子）。已修：`BulletManager` 建池时把画布**同时写进每个实例的
  `silhouetteCanvas`**，`getShadowFrameData()` 实例优先、static 兜底。
- ★★ **敌方弹打地形必须门掉经济副作用**：`WorldMode.resolveBulletHit` 的"静态世界"分支会
  `playBulletImpact`（改地形）+ `spawnItemDrops`（掉落）⇒ 不加 `if (self.camp==='enemy') return;`
  玩家就能靠敌人箭免费挖矿。命中特效仍走 `BulletEntity.hitFx`，反馈不缺。
- ★★ **瞄准/出膛用 `hitAnchorY()`（贴片 65% 胸口），别用 `position.y + 固定值`**：
  名册 scale 跨度 1.6~4.2（身高差 2.6 倍），固定值对小兵是头顶、对大个子是膝盖。
  `ctx.focusY` 也默认给 `player.hitAnchorY()`（`focusX/Z` 只是无高度的平面坐标）。
- 池容量：敌方 8（玩家 10）。`BulletManager` 池空只 warn + 丢弃该发，不崩。
- 命中可靠性：敌方弹物理半径只有 `BULLET_BODY_RADIUS = 0.05`，且 ≤15m 的"近点小弹"
  不放大（`BULLET_CLOSE_DIST`）⇒ 弩手（射程 9m）**永不放大命中窗口**，全靠 CCD 撞
  运动学碰撞体。若实测"箭穿人而过"，就去松 `BULLET_CLOSE_DIST` 或给弹加 per-instance 半径。

### ★★ 贴片接地（新素材必查）

- FTX bbox **不保证贴脚底**（导出常留白）→ 底部锚点 ⇒ 留白 = 悬空。
- `services/fx/FootAnchor.ts` 运行时自动量（读 alpha 通道）。
- `MobDef.groundSink = ratio × scale + 手调`。
- ★★ **两条渲染路径都要补**，否则「远看接地、近看悬空」：
  1. L3：`FTXQuad.setGroundSink`
  2. L2：`SwarmBatch` 实例 y（**含血条 `offsetY`**）
- ★ 名册 `scale` = **quad 宽**；身高 = `scale × (bbox.h / bbox.w)`。
- 工具：`.workbuddy/tools/ftx_foot_measure.py`。

## ★★ 空中层（2026-09-18 落地；《蜂群架构.md》§25）

**一句话**：名册 `isAir: true` + `airAltitude`（米，相对地表）⇒ 该兵种悬停、
不走地面规则、走**直线**导航；L2 代理与 L3 实体两条表示都按同一高度公式抬升。

### 为什么这样切（设计口径）

- **不新增寻路系统**：所谓"独立空中层"= **不参与**地面那套（流场 / 危险地形 / 掉坑），
  而不是另写一套 HPA\*。飞行兵要的就是"直线飞过去"，地面流场对它是负担。
- **不动 L3 实体管线**：y 的唯一驱动点是 `WorldMode.clampCharacter`（全项目就它钉地形），
  在那里加一个飞行分支即可；`CharacterBase` 只多三个字段（`airborne` / `airAltitude` / `airPhase`）。
- **必须两个表示都改**：L2（远）与 L3（近）是同一敌人的两种画法，只改一个 ⇒ 升/降格瞬间跳变。

### 高度公式（唯一口径，两条路径共用）

```
y = raster.surfaceHeightAtFor(x, z, 当前y) + altitude
    + sin(t · AIR_BOB_RATE + phase) · AIR_BOB_AMP
```
- `AIR_ALTITUDE_DEFAULT=2.6` / `AIR_BOB_AMP=0.22` / `AIR_BOB_RATE=1.35`
  —— 定义在 **`AgentPool.ts`**（引擎层零三方依赖的落点），玩法层与渲染层都从这取。
- ★★ **地表取样必须同源**：两处都用 `surfaceHeightAtFor(x, z, 当前y)`（不是 `surfaceHeightAt`）。
  用了不带 hint 的版本 ⇒ 跨地形层时 L2/L3 取到不同地表 ⇒ 升格瞬间"跳一下"。
- ★ 相位：L2 用 `pool.phase`（0~1），L3 用 `e.airPhase`（0~2π），**都是每只随机** —— 别改成共享时间，
  否则整队飞兵同频上下摆。
- ★ 浮动是**纯表现**：只改渲染 y 与 `pool.y` 回写值，不参与任何 AI 水平决策。
- ★ 距地表最低点 = `altitude − AIR_BOB_AMP`（bomber 1.58m）⇒ 调低 `airAltitude` 时别低于 ~0.3m。

### 11 处接线（漏一处 = 静默错误）

| # | 位置 | 漏了会怎样 |
|---|---|---|
| 1 | `enemyRoster.EnemySpec.isAir/airAltitude` | 名册不认识空中层 |
| 2 | `AgentPool` SoA + push/**copy**/snapshot | **漏 copy：swap-remove 尾元素填位时飞行标记丢失 → 飞兵突然落地** |
| 3 | `SwarmBatch.sync` 的 `baseY` 分流（+ 血条 y） | 远层贴地、或血条留在脚下 |
| 4 | `SwarmSystem.update` 掉坑判死 gate | 飞过坑口就判死 |
| 5 | `SwarmSystem.move` 的 `danger()` gate | 空中还要绕坑/水/墙 |
| 6 | `SwarmSystem.think` 的流场 gate | 沿地面路径场绕圈 |
| 7 | `demote` 路径（两个快照构造点） | 一降格就落地 |
| 8 | `CrowdGrid.separation` 跨层 gate | 飞兵悬在地面兵头顶还互推 |
| 9 | `WorldSpawner` 两条 spawn 通路 + **落点闸门豁免** | 飞行兵刷不到（闸门排除 liquid/pit，而它恰好爱停在水面/坑上）；★ 悬停基准要用**顶层地表**，否则飞在坑上时以坑底为基准 → 飞到地下 |
| 10 | `createEnemyEntity`（L3 构造） | 升格即落地 |
| 11 | `EnemyBase`（`climbAnyTerrain` + `isDangerAhead` + 出生抬升） | 被墙挡住 / 第一帧从地面弹上去 |

### 常驻护栏

`arch-guard.mjs`：名册 **`isAir` 与 `airAltitude` 必须成对**（设了 isAir 忘给高度 →
静默落到兜底 2.6m；非空中单位写高度是无效配置）。会打印 `空中层 N 种：...`。

---

## ★★ 症状「远程敌人根本不攻击」的根因：ctx.target 是冻结快照（2026-09-18 修复）

**现象**：远程兵（弩手/扩音术士/战争术士）像不会开火；偶尔看到箭/火球飞向空无一人的方向。

**根因链（离屏直跑真实 AI 定位，非猜测）**：

1. `conditions.seePlayer` 把选中的候选**写进 `ctx.target`**，而它**只挂在 `patrol` 状态的
   转移表上** —— chase / attack 期间**不再重跑索敌**。
2. 模式层 `WorldMode.enemyTargetCandidates` 原本 push 的是**坐标拷贝**
   `{ x: p.x, z: p.z }` ⇒ `ctx.target` 一写进去就成了**"看见那一刻的坐标快照"**。
3. 近战兵侥幸能自愈：`attackFinished → patrol` → 重新 seePlayer。
   ★★ **远程兵 `attackFinished → chase`（持续开火设计，故意不回 patrol）
   ⇒ 永不重新索敌 ⇒ 永久锁死在旧坐标**；
   而 `inRange` / `outOfRange` / `loseTarget` **全部按这个冻结坐标判定**
   ⇒ 既打不到人、也永不脱战。

**量化（`.workbuddy/tmp/2026-09-18_ai-target/ai-probe.ts` 直跑 `CROSSBOW_AI`）**：
玩家站 6s 后被瞬移 40m 外 —— 修复前：敌人在 `attack` 态**继续开火 15 次、平均偏角 145.8°、
最远在 37.6m 处朝空气射**；修复后：**0 次开火**，状态 `attack → chase → patrol` 正常脱战。

**修复 = 1 处**：候选改为**活对象**（`WorldMode.candSlots`，每帧原地更新 x/z），
`ctx.target` 自然跟着目标走。顺带零分配（原来是每帧每敌 new 数组 + N 个对象）。

★★ **不变量**：`enemyTargetCandidates` 的候选**必须是活对象**，禁止退回坐标字面量。
已加 `arch-guard.mjs` 护栏（查 `out.push({` 出现 → FAIL）。

### ★ 附带发现（未改，待定）

- **L2 代理的远程兵用默认伤害**：`mobAgentStats` 只认 `meleeSwing` 行为 →
  远程兵在代理层拿到缺省 `damage=8 / range=1.8`。
  实测：`war_caster` AI 声明 20 → 代理只打 8（差 12；弩手 8 恰好撞对）。
  ⇒ 同一只怪「远看 8、近看 20」。要不要对齐是**平衡决定**（代理不会射弹道，
  给了 `range` 也没法远程命中），故留作待办没动。
- **舰船优先于玩家**：`enemyTargetCandidates` 里舰船排在玩家之前，且不带 radius
  ⇒ 只要舰船在该敌 aggro 半径内，它就**永远优先打船、不打玩家**（落地后在船边几乎不会被围）。
  这是既有设计（舰船是静止受击目标），但值得复核。
- 舰船落地/停靠后不移动，所以"快照冻结"对**船**不显形 —— 这也是这个 bug 长期没被发现的原因。
- ★★ **祖宗嘲讽：40m 是"看得见"的门槛，不是"追得到"的门槛**（2026-09-18 实测；**未改**）。
  入场/退场半径**不对称**：`seePlayer`/`retarget` 用**候选自带 `radius`**（祖宗 40m），
  而 `loseTarget` **只认敌人自己的 `loseRadius`**（弩 24 / 扩音 26 / 战争 34 / 整合 12），
  完全不看 `t.radius` ⇒ 祖宗超出该敌 `loseRadius` 时，敌人"进 chase 一帧 → 立刻按超距踢回
  patrol（minStay 3s）"，每 3 秒只推进 1 帧 chaseSpeed（≈5cm）→ **永远够不着**。
  实测"20s 内贴上并进 attack 的种子比例 / 12 种子"（`ai-probe.mjs`，已固定 LCG 种子可复现）：

  | 兵种 | lose | 8m | 14m | 20m | 26m | 32m | 38m |
  |---|---|---|---|---|---|---|---|
  | 弩手 | 24 | 咬住 | 咬住 | 67% | 50% | 25% | 25% |
  | 扩音术士 | 26 | 咬住 | 咬住 | 咬住 | 58% | 25% | 25% |
  | 战争术士 | 34 | 咬住 | 咬住 | 咬住 | 咬住 | 67% | 33% |
  | 整合运动人员 | 12 | 75% | 33% | 25% | 17% | ★松口 | ★松口 |

  实测阈值比 `loseRadius` 再低 4~8m（脱战后 3s 游走会自己飘开）。
  **想统一口径 = 2 行**（均在 `conditions.ts`，用户尚未拍板）：
  ① `retarget`：`ctx.target = { x: c.x, z: c.z }` → `= c`（**这里也残留坐标拷贝**，
  且拷贝会**丢掉 `radius`**）；② `loseTarget`：`const radius = t.radius ?? pnum(params,'radius',12)`
  （玩家/舰船槽 `radius===undefined` → 行为不变，只影响带 radius 的祖宗候选）。
  ★ 排查提示：度量"嘲讽咬不咬得住"别用"chase 连续帧数"——`patrol.minStay=3` 会造成
  patrol↔chase 抖动把信号淹掉；要用 **20s 内 minDist + 是否进过 attack**。

## ★ 落地名册陈列（`?roster=1`，2026-09-18）

`WorldSpawner.spawnRosterShowcase(x, z)`：舰船落地（`finishDock`）后把**名册里每种敌人各铺一只**，
绕舰船落点 16m 环带均匀分角，每只头顶飘一次名字（`MobDef.id/name` 就是为此加的）。

- **不含普瑞赛斯**：Boss 不在 `mobDefs` 里（走 `spawnBoss` 独立路径）⇒ **结构性排除，不用特判 id**。
- 走 `spawnOne`（刷怪唯一收口点）⇒ 配额计账 / 落点闸门 / 空中豁免 / 代理池全部同源，
  看到的是**真实行为**而非特例路径。
- 环带 16m < L3 升格半径 35m ⇒ 落地后逐个升格成实体（2 只/帧）。
- 开关：`main.ts` 的 `?roster=0` 关 / `?roster=1` 开（URL 参数缺省**开**）。
- 验收探针：`.workbuddy/tmp/2026-09-18_ai-target/roster-probe.ts`（mock deps 直跑真 spawner，
  11 项断言：兵种覆盖 / Σpack / 无 priestess / 标签 / 环带几何 / 空中高度 / mobIndex 回查）。

### ★ 已知限制

- **§25 的"只轰炸不缠斗"完整 sortie 未做**（盘旋→投弹→延迟引信→返场）；
  飞行兵目前仍以贴脸挥击 / 法球结算。
- **`CrowdGrid.segmentHit` 是 2D（无 y）**：所以 L2 飞行代理在远距离"从下方打也能中"，
  而 L3 实体（碰撞体真在 3.2m 高）必须抬枪瞄。补 y 要往 `hitTestSegment` 加 y0/y1 两参 + 调用点。
- **命中手感依赖抬枪**：`aimAssist` 只有 ~2.9° 锥、最大修正 1.7°，基本不帮忙。
  `airAltitude` 就是可玩性旋钮（bomber 1.8 / war_caster 3.2）。

