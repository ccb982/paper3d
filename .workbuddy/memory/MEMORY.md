# MEMORY.md —— 项目长期约定（架构重置）

> 索引：只留「触发 + 结论」。细节 → `topics/*.md`（hit-dye-fluid · spawn-quota-and-roster ·
> relics-and-items · ui-overlay-and-misc · arch-and-swarm-v2）；流水 → `YYYY-MM-DD.md`；
> stickman-lab → 项目内文档 + `2026-10-01 / 10-26 / 10-27.md`。

## ★ 环境 / 工具
- **bash 损坏**（ls/cat/head/cd 全 not found）→ 托管 python 3.13.12 + node **22.22.2-6**（旧路径
  `22.22.2-3` 已不存在 → FileNotFoundError），`node -e` 当 shell。项目根 `架构重置\全新的游戏`；
  **无 git** → 改前备份 `.workbuddy/tmp/`。
- ★★ 改完必跑 `tsc --noEmit` + `node scripts/arch-guard.mjs`（cwd = 项目根）。同文件多处改
  **串行**发 Edit；★ Edit 报成功后**必须 grep 复核**（出现过报成功但没写入）。
- ★ 用户玩游戏时**不擅自跑实测**（抢 GPU / 误归因），先问；优先离屏验收（node 直跑真实模块 + stub 断言）。
- 沟通：直接简短可验证；给数字；说清改了什么 / 踩了什么坑 / 回退了什么。

## ★★ 时间 / 阶段
- 时间唯一入口 = `main.ts` 无条件 `renderManager.update(dt)` → `SunCycle`（900s/天，6 点起）。
- ★★ 禁止「敌人不动 + 时间照常流逝」：`WorldMode.update` 里冻结世界的 `return` 分支必须同步
  `setClockPaused(true)`。阶段变更只走 `setPhase(next)`。

## ★★ 渲染 / 离屏烘焙
- ★★ 离屏相机视锥 = `[0,1]²` → 加进离屏 scene 的 quad **必须放 (0.5,0.5)**（`PlaneGeometry(1,1)`
  默认居中原点 → 被裁到左下 1/4）。症状：程序化弹烘焙只剩 1/4 → 敌方箭/火球看着没画。
  判据：`readRenderTargetPixels` alpha>127 占比应等源纹理（箭 26.5% / 火球 48.8%）。自检 `dev-bullets.html`。
- ★★ 两个 `createHitDyeEffect` 配置不同（`.ftx3.gz` vs `.scene.zip`）→「降频有无观感影响」按路径答。
- ★ 流体调参公式 → `topics/hit-dye-fluid.md`。

## ★★ 刷怪 / 名册 / 索敌 → topics/spawn-quota-and-roster.md
- 刷怪 = 玩法层 → 写 `WorldSpawner.ts`（写回 WorldMode = guard FAIL）。★★「敌人不生成」头号嫌疑
  = `quotaAllows()` 配额打满（当天累计、只增不减、仅换日清零）。
- ★★ 每日敌人总数 = `estimateDailyTotal(threat)` → `ledger.total`（**配额闸门** `canSpawn`）。
  **数量按天复利 1.1^(day-1)**（权威值 = `ThreatProfile.dailyTotal`，第 1 天基准 59；2026-10-27 用户定"每天 +10%"）。
  ★ 结构项（场数/波数/频率/攻击欲望）仍按威胁度插值 → **别再用威胁度插值去算数量**
  （旧口径每天固定 +1 只 ⇒ 相对增幅逐天变小，且跨 lerp 台阶会跳变，实测第 8→9 天 ×1.545）。
- ★★ 索敌候选必须是**活对象**（`WorldMode.candSlots`）；远程兵 `attackFinished→chase` 永不回 patrol
  ⇒ 永久朝空气射击（已修）。「远程不攻击」先查这条，别疑弹道。
- 名册真源 `config/enemyRoster.ts`：加敌军 = 帧包 + 一条；顺序 = `mobIndex`；★★ **禁取模复用数值**。
  远程兵同时给 `attackRadius`（刹车）+ `attackRange`（真判定）。
- ★★ 空中层 `isAir` + `airAltitude`（只在引擎层开洞）；新素材必查接地（`FootAnchor.ts` +
  `MobDef.groundSink`，**L2/L3 两条渲染路径都要补**）；命中高度别写死 `y+1.0` → 用 `hitAnchorY()`。
- 验收工具 `?roster=1`（缺省开）。★ AgentPool 是 swap-remove → 加 SoA 字段必须同步 `push/copy/snapshot`。

## ★★ 碰撞 / 推挤（2026-10-27）
- ★ 角色 = **kinematic**（位置 100% 代码驱动）⇒ Rapier 不推角色；**挡路全靠 JS 静态障碍索引**
  （`StaticObstacleRegistry` + `CharacterBase.separateFromStatics`），船体另有一套 Rapier 复合刚体。
- ★★ 船体分段（`entity/ship/hullShape.ts`）= OBB 定向矩形；**walkableTop 必须同时判顶面与底面**：
  船停在高处时水平投影盖住下方地面，只判顶面 ⇒ 玩家走到船下被水平推挤、多段抵消 ⇒ **原地卡死**。
  判定统一走纯函数 `obstacleBlocksCharacter(o, footY, halfH)`（抽成纯函数 = 为了能离屏断言）。
- ★ 船**贴地**时底面只离地 0.15~0.45 m（`LANDED_HEIGHT=2.0`，段 hy 1.45~1.95）⇒ 玩家身体 2 m 垂直必然重叠，
  那种情况**必须挡**（防穿船）—— 别把「船下方」一刀切放开。

## ★ 遗物 / 物品 / 抽卡 / 文案 → topics/relics-and-items.md
- 新增遗物改三处：`config/relics.ts` + `ItemIconRegistry.FTX_ICON_SOURCES`（**图标唯一真源**）+
  `gachaPool.json`。★ 别改成从 relics 派生（值导入拖进 core 链 → 全灭）。
- ★★ 遗物绝不进背包；`applyEffects` 双向防呆**勿删**；改配置不改存档 = 用户看着没修好 → 老档走
  `SaveSystem.sanitize()`。给东西只走 `WorldUIManager.showPickupResult`。
- ★ **用户贴的文本逐字照抄禁润色** + 机器校验（疑似错字也照抄，只在回复里提示，不擅自改）。

## ★ 音频
- 只在船内有音乐（基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` ambient / 战斗 battle）。
  真源 `config/bgm.ts`；★ 加键同步手写 `BgmKey`（漏 = TS2353）。
- ★★ SFX 必须节流且 `minGapMs` ≥ 素材时长；循环轨按 src 分轨 + `LoopTrack.target` 不能省 + 淡入淡出 220ms。

## ★★ 鼠标 / 输入屏蔽（2026-10-27）
- ★★ 指针锁定唯一事实来源 = `WorldMode.update` 里
  `uiOpen = hasModalOpen || talking || isMiniGameRunning() || phase==='interior'`
  → `binding.setLockSuspended(uiOpen)` + `setPointerLock(!uiOpen)`。
- ★ 漏判案例：**校队检测 = 小游戏 `alignment_trial`，不是对话** ⇒ 小游戏期间 `talking=false`、
  `hasModalOpen=false`、`phase` 仍 explore → 鼠标被锁。**舰内因 `interior` 躲过 ⇒ 只有舰船外复现。**
- ★ `DesktopBinding.setLockSuspended(v)`：true → 立即 `exitPointerLock`，且期间忽略一切加锁请求
  （含 click 画布 → `requestLock`）。为什么需要：`DialogueView` 是**底部条、非全屏**，对话中点到
  框外画布会把光标重新藏起来。
- `DialogueSystem` 新增 `onOpen` / `onClose`（`finish` 与 `close` 都触发 onClose，与 `onEnd` 区分）。
- 小游戏期间 `uiLocked` 也要纳入（WASD/滚轮/Q 不消费；Tab 背包也屏蔽，但**保留舰内可用**）。

## ★ 其他 → topics/ui-overlay-and-misc.md
- ★★ UI 显隐两级：`settingsAllowed`（只 BaseMode）× `settingsSuppressed`（页面级）；凡有返回键的
  全屏页 `show()/hide()` 必须成对压制/恢复齿轮；返回统一 `createBackButton()`。
- 小游戏**丢文件进 `src/minigames/games/` 零索引改动**；访客只改 `visitors.ts` + `dialogues.json`
  （★ **顶层是 `{"trees":{...}}`，不是直接以树 id 为键**）；房间三件套（★ ShaderMaterial 漏声明
  uniform = 该材质全部 mesh 不渲染）。

## ★ 架构治理 / 蜂群 v2 → topics/arch-and-swarm-v2.md
- 头部过重（上限 1200，仅 warn）：`WorldMode.ts`≈3700、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763。
  **下一刀 `ChunkManager.ts`**。
- 膨胀根因是「人肉同步」；拆类见技能 `god-object-extraction`（**tsc 通过 ≠ 行为一致**，须 difflib 比对）。

## ★★ stickman-lab（独立项目：物理火柴人 → 隐藏 boss）
真源：`stickman-lab/架构设计.md`（13 章 + 移植契约 `BossController`）、
`stickman-lab-v2/docs/照搬验收.md`、`stickman-lab-v2/docs/写手收敛-2026-10-26.md`。
骨架：13 刚体 / 12 球关节（无踝）= 36 自由度；质量 Dempster 1955、力矩上限 MuJoCo gear；
几何从 `海猫_抠图` 素材**反推**（相邻组件 bbox 重叠区 = 关节）。已整体重写为真 3D（2D 方案废弃）。
- ★★ 关节马达必须自实现（成对等大反向冲量）+ 两条硬不变量：**限加速度** `|imp| ≤ α·|err|·Ieff`、
  **自实现软限位**（只在越界后介入，**禁止提前量**）。
  **有效刚度 = `kP · min(τmax/JOINT_MAX_SPEED, α·Ieff/dt)`** —— 排查"站不住/不出力"的**第一站**。
  `MOTOR_ALPHA=1.0`（出厂 0.35 会把刚度压到设计值 22% ⇒ 髋被重力压开劈叉；α=2 才振荡）。
- ★★ 确定性只能靠整世界重建（`Sim.buildWorld()`）；`reset()` 清不掉暖启动缓存（偏差 1.84e-3 m）。
- ★★ `restTension` 必须饱和（`target += −k·clamp(a,±a_ref)`，ref 0.25）；线性无界版会给每个关节
  加 ±57.3° 隐形软墙、执行器权限砍 62%。教训：调参别只看单一指标，要看对整条回路的影响。
- ★★ 站立可行性：判据是 **DCM `ξ = x+ẋ/ω ∈ ±p_max`**，不是 CoM 投影在支撑面内。
  实测被动域 前后 ±0.110 / 侧向 **±0.070**（支撑多边形口径侧向高估 3.8 倍）。走路靠调 CoP
  数学上不可能 ⇒ **站与走是两个域**。
- ★★ `targets=0` 不是松手，是**把角速度刹到 0**（全力制动）⇒ 排查"关节不出力"先量零出力轴占比。
- ★★ 蹲姿侧向第一站：`squat.ts:206-225` 的 DCM 侧向律被下一行 `targetZ = servoOn ? ... : zAlloc`
  整段丢掉 ⇒ 关 `SQC_LAT_SERVO_POST_ROLL`（roll 51°→24°），别再调 `CO_LIMIT`。
- ★ 通路结构：仲裁键 `dof|kind|channel`，不同 kind 永不仲裁只是加数 ⇒ "加一种 kind" = 多开一条
  并联通路（写手数失控的结构性原因）。用户口径 = **提案制**（伺服/动作层只交提案，执行层统一操作写手）；
  ★★ **用户明确否决"删一批死写手"** ⇒ 零删除/零改名/零改数，只做归属搬移 + 安全区。
- ★★ 照搬 v1 **只能整文件 `cp`，不许对着代码手抄**（用户原话「你为什么不能用复制粘贴」）；
  验收用 `diff` 比 `DEFAULTS` 逐字节（用 node 脚本，别用 grep）。手抄必漏（实测漏 `footAngularDamping=30`）。
- ★ **用户不认截图**（原话"截图0作用"）⇒ 证明改好了要给**逐组件受力/力矩读数**。
- ★ `node_modules` 是 junction ⇒ 必需 `vite-plugin-wasm` + `vite-plugin-top-level-await`，且
  **必须设 `cacheDir:'.vite'`**（否则与本体共用 deps 互相清缓存 → dev server 启崩）。
- 离屏：`node tools/run.mjs <probe-*>`（esbuild 打包后直跑真实模块）；纯数学部分刻意拆成模块级
  导出函数以便断言。回归双闸门 = `probe-golden`（逐位指纹）+ `probe-states`（stand/squat/p2stand），
  **必须锁随机种子**（`actions.ts` idle 用了 `Math.random()`，不锁种子 = 假证明）。
- 已知限制：自主避障 / 3D 地形**完全没有**（输入 27 维无地形量）；行走最佳仍判摔；战斗命中通道已通
  但被"站立没学会"阻塞。
