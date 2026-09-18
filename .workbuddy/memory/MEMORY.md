# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> **本文件只当索引**：每条留「触发条件 + 结论」。推导与细节去 `topics/*.md`，流水去 `YYYY-MM-DD.md`。
> 专题：hit-dye-fluid · spawn-quota-and-roster（刷怪配额/名册/**远程真弹道**/接地）·
> ui-overlay-and-misc · arch-and-swarm-v2
> 技能：god-object-extraction · game-audio-sfx-pipeline · game-frame-budget-profiling ·
> shader-fit-from-reference · threejs-glb-model-swap · game-map-hud-overlay ·
> codebase-dead-code-audit · data-driven-roster-registration

## ★ 环境 / 工具

- **bash 工具链损坏**（ls/cat/head/dirname/cd 全 not found）→ 用托管 python
  `~/.workbuddy/binaries/python/versions/3.13.12/python.exe`。
- **PowerShell 吞 stdout** → 重定向到 `$env:TEMP\x.txt` 再按 **utf-16** 读。
- 项目根 = `架构重置\全新的游戏`；`.workbuddy` 在工作区根（memory/tools/tmp/deadcode）。
- node 用托管 `22.22.2-3`；`node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  + `node scripts/arch-guard.mjs` —— **改完两个都要跑**。
- **项目无 git** → 改/删前备份到 `.workbuddy/tmp/`；无系统 ffmpeg → 托管 venv 的 imageio-ffmpeg。
- ★★ **同一文件多处修改必须串行发 Edit** —— 并行会互相覆盖、改动静默丢失（踩过两次，tsc 才报）。
- ★ **用户可能在玩游戏 → 不擅自跑游戏内实测**（抢 GPU、误归因），要实测先问；
  能离屏验收就别开浏览器（单文件 tsc 编译 + node 直跑真实模块 + 打印）。
- 沟通：**直接、简短、可验证**，给数字，说清改了什么 / 踩了什么坑 / 回退了什么。

## ★★ 时间 / 昼夜 + 阶段

- 时间唯一入口：`main.ts` 无条件调 `renderManager.update(dt)` → `SunCycle`
  （`DAY_SECONDS=900`、`START_HOUR=6`）。
- ★★ **禁止「敌人不动 + 时间照常流逝」**：`WorldMode.update` 里 `return` 冻结世界的分支必须同步
  `renderManager.setClockPaused(true)`（只停太阳，不影响 scaledDt）。
- ★ **`WorldMode.setPhase(next)` 是 phase 变更唯一入口**，别直接 `this.phase =`（guard 会数）。

## ★★ 刷怪 / 名册 → `topics/spawn-quota-and-roster.md`

- **刷怪=玩法层、蜂群=引擎层**；新刷怪逻辑写 `WorldSpawner.ts`（写回 WorldMode 则 guard FAIL）。
- ★★ 「敌人不生成」头号嫌疑 = **`quotaAllows()` 配额打满**（`spawned` 当天累计、只增不减、
  跨出击累计，只有换日清零）⇒「一只没有 + 删档就好」99% 是这个。
- 名册唯一真源 `src/config/enemyRoster.ts`：**加敌军 = 放帧包 + 名册加一条**；
  顺序 = `main.ts` 加载顺序 = `mobIndex`。★★ **禁「取模复用数值」**（按 id `ENEMY_BY_ID.get()`）。
- ★★ **远程兵种必须同时给 `attackRadius`（刹车距离）与 `attackRange`（真判定半径）**；
  要**可见弹道**走 `MobAIParams.ranged`（→ `rangedShot` → camp 路由到 `enemyBullets` 池）。
- ★★ **贴片接地新素材必查**：FTX bbox 不保证贴脚底 → `FootAnchor.ts` + `MobDef.groundSink`，
  **L3 `FTXQuad.setGroundSink` 与 L2 `SwarmBatch` 实例 y（含血条 `offsetY`）两条路径都要补**。
- ★★ 命中/瞄准高度**别写死 `position.y + 1.0`** → 问 `EntityBase.hitAnchorY()`（贴片 65% 胸口）。

## ★ 敌人 LOD 三层

| 层 | 半径(距玩家) | 表示 |
|---|---|---|
| L3 实体 | 升 35m / 降 40m | EntityManager EntityBase |
| L2 代理 | 80m | `swarm.pool` |
| L1 回收 | 140m 外删除 | — |

- **索敌半径 > 35m 的单位「看不见敌人」**（只查 EntityManager）→ 开代理层通道
  （查 pool + `swarm.damageAgent`），**别**把远处敌人升格（占满 `L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 代理下标**每帧重锁**，绝不跨帧缓存。

## ★ 音频

- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` /
  战斗 `battle`（`groupWarnShown` 期间）。真源 `config/bgm.ts`；
  ★ 加键必须同步手写 `BgmKey` 联合类型（漏 = TS2353）。
- ★★ SFX 必须节流且 **`minGapMs` ≥ 素材时长**；循环轨**按 src 分轨** + `LoopTrack.target` 不能省
  + `LOOP_FADE_MS=220` + 素材必须无缝循环。细节见技能 `game-audio-sfx-pipeline`。

## ★ 受击染料 / 死亡流体 → `topics/hit-dye-fluid.md`

- ★★ **两个 `createHitDyeEffect` 实现、配置完全不同，改前先确认实体走哪条**：
  `FtxAsset.load('.ftx3.gz')`（**主角 / 普通敌人**：`vector`、无衰减、有注入速度）
  vs `Asset.load('.scene.zip')`（**BOSS / 无人机 / 祖宗 / 抽卡立绘**：`scalar`、
  `decayRate 0.0588/步`、无速度）。
- ★★ **要"注入量大"只能持续重注入**（density/color 的 rate 都 clamp ≤1.0，重注入 = **覆盖非叠加**）
  ⇒ 每步**先重注入再 `step`**。
- ★★ **流体解算统一 1/30 降频**（受击染料 / 死亡动画 / 祖宗 / 图标）。
  `maxVelocity`：受击染料 50、死亡动画 200 px/s。
  **压力投影开关判据 = 速度场是否恒 0**。
- ★★ **调"力度"先算稳态流速** `v_eq ≈ g / (步率 × (1 − velocityScale))`；
  **`v_eq` 必须 < `maxVelocity`**，否则被钳位（踩过：g=160 ⇒ v_eq≈261 ⇒ 调了等于没调）。
- ★★ **散度注入 = `FluidSolver.explode()`**：**`strength` 必须为负才是向外**；散度场每步
  `clearGrid` ⇒ 一次性消费、**别每帧调**；仅 `enablePressure=true` 有效。
  ★ 它与降频的关系（易漏）：`envelope` 按**调用次数**衰减、散度源**不乘 dt** ⇒
  0.25s 内总量 ≈ 60fps 的 **68%**（`× dt` 的 radialSpeed/velImpulse 则节拍无关）。
- ★ **levelSet**：`surfaceTension > 0` 才真施加（负值 = 等效关闭）；`reinitIterations` **无兜底**；
  开启后压力求解切**自由表面模式**。
- ★★ **注入位置用 `mesh.worldToLocal()`**，`u=0.5+local.x`、`v=0.5−local.y`；
  注入值在**残差空间**（0.5 = 不变）；贴片是**整体替换**流体纹理，不是叠加。

## ★ 遗物 / 物品 / 抽卡 / 文案

- **新增遗物改三处**：`config/relics.ts` + `ItemIconRegistry.ts`（`FTX_ICON_SOURCES` =
  **图标唯一真源**，漏 = 空白）+ `config/gachaPool.json`（`outOfRunItems`，否则抽不到）。
  ★ 别把它改成从 relics 派生（值导入拖进 core 初始化链 → 全灭，试过回退）。
- 查 id 合法：`items.json` / `relics.ts` / `ItemIconRegistry.ts` / `gachaPool.json` / `Session.ts`。
- ★★ **遗物绝不进背包**（只住 `session.outOfRun.owned`）；`applyEffects` 的双向防呆**勿删**；
  **改配置不改存档 = 用户看着没修好** → 老的走 `SaveSystem.sanitize()`。
- 抽卡分档：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%（BOSS 独立优先判定不占权重）。
- ★ **用户贴的剧情文本逐字照抄，禁止润色**；落地后机器校验（一次性 .py 深比较 + difflib，跑完删）。
- ★ 给玩家东西 = `WorldUIManager.showPickupResult`（唯一播报渠道）；取名走 `displayNameOf()`。
  对话层零 DOM，只回调 `onGrant`，**上屏是模式层的事**。

## ★ 其他模块 → `topics/ui-overlay-and-misc.md`

- ★★ **UI 入口显隐两级**：`settingsAllowed`（只有 BaseMode）× `settingsSuppressed`（页面级）；
  **凡左上角有返回键的全屏页 `show()/hide()` 必须成对压制/恢复齿轮**；返回统一 `createBackButton()`。
- 小游戏：**丢文件进 `src/minigames/games/` 零索引改动**（`import.meta.glob` 自注册）；壳 z-index 300。
- 访客：只改 `visitors.ts` + `dialogues.json`；房间视觉 = `RoomDecoGeo` + `RoomSurfaceMaterial` +
  `ui/base/RoomDecor.ts`（★ ShaderMaterial 漏声明一个 uniform = 该材质全部 mesh 不渲染）。

## ★ 架构治理 / 蜂群 v2 → `topics/arch-and-swarm-v2.md`

- 头部过重（上限 1200，仅 warn）：`WorldMode.ts` ≈3595、`ChunkManager.ts` 3481、
  `GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。**下一刀 `ChunkManager.ts`**。
- ★ **真正让项目膨胀的是「人肉同步」**（不变量靠注释 + 记得改 N 处）；拆大类见技能
  `god-object-extraction`（**tsc 通过 ≠ 行为一致**，须方法体 difflib 比对）。
- 蜂群 v2（`蜂群架构.md` §11~§25，待实施）：寻路升 **HPA\* + 走廊带**；硬不变量 = 两阵营通行掩码 /
  陷阱不参与 HPA\* / 飞行兵不参与地面寻路。细节查该文档。
