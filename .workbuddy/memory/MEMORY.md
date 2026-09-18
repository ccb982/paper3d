# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

> 只当索引：留「触发 + 结论」，细节在 `topics/*.md`（hit-dye-fluid · spawn-quota-and-roster ·
> relics-and-items · ui-overlay-and-misc · arch-and-swarm-v2），流水在 `YYYY-MM-DD.md`。

## ★ 环境 / 工具
- **bash 损坏**（ls/cat/head/dirname/cd 全 not found）→ 用托管 python/node（3.13.12 / 22.22.2-3），把 `node -e` 当 shell。项目根 `架构重置\全新的游戏`；**无 git** → 改前备份 `.workbuddy/tmp/`。
- ★★ 改完必跑 `tsc --noEmit -p tsconfig.json` + `node scripts/arch-guard.mjs`（要 cwd=项目根 → `process.chdir()` 包装）。同文件多处改**串行**发 Edit。
- ★ 用户在玩游戏时**不擅自跑游戏内实测**（抢 GPU/误归因），先问；优先离屏验收（node 直跑真实模块 + 反射/正则断言）。
- 沟通：直接简短可验证；给数字；说清改了什么/踩了什么坑/回退了什么。

## ★★ 时间 / 阶段
- 时间唯一入口 = `main.ts` 无条件 `renderManager.update(dt)` → `SunCycle`（900s/天，6 点起）。
- ★★ **禁止「敌人不动 + 时间照常流逝」**：`WorldMode.update` 里 `return` 冻结世界的分支必须同步 `setClockPaused(true)`。阶段变更只走 `setPhase(next)`。

## ★★ 渲染 / 离屏烘焙
- ★★ **离屏相机视锥 = `[0,1]²`**（`OffscreenBake`）→ 加进离屏 scene 的 quad **必须放 (0.5,0.5)**；`PlaneGeometry(1,1)` 默认居中于原点 → 被裁到**左下 1/4**。
  **症状**：`BulletVisual` 全幅路径（无蒙版实体 = **程序化弹**）烘焙只剩 1/4 → 敌方箭/火球**看着没画**（真素材 `.scene.zip` 走实体路径，网格跨度本就 0..1，故正常）。
  **判据**：`readRenderTargetPixels` 的 alpha>127 占比应等源纹理（箭 26.5% / 火球 48.8%）。自检页 `dev-bullets.html`。
- ★★ **两个 `createHitDyeEffect` 配置不同**：`.ftx3.gz`（主角/普通敌人：vector、无衰减、有注入速度）vs `.scene.zip`（BOSS/无人机/祖宗/立绘：scalar、每步衰减、无速度）→「降频有无观感影响」**按路径答**。
- ★ 流体调参公式（`v_eq`/`explode`/残差空间注入/`reinitIterations` 无兜底）→ `topics/hit-dye-fluid.md`。

## ★★ 刷怪 / 名册 / 索敌 → topics/spawn-quota-and-roster.md
- **刷怪=玩法层 → 写 `WorldSpawner.ts`**（写回 WorldMode = guard FAIL）。★★「敌人不生成」头号嫌疑 = **`quotaAllows()` 配额打满**（当天累计、只增不减、跨出击累计，仅换日清零）。
- ★★ **索敌候选必须是「活对象」**（`WorldMode.candSlots`）：`ctx.target` 只在 patrol 的 `seePlayer` 里赋值，chase/attack 不重索敌 → 候选一旦写成坐标拷贝，ctx.target 就冻成快照。**远程兵 `attackFinished → chase` 永不回 patrol ⇒ 永久朝空气射击**（已修 + arch-guard 护栏）。「远程不攻击」先查这条，别疑弹道。
- ★ **底座验收工具：`?roster=1`**（缺省开）→ 落地每种敌人各铺一只（不含普瑞赛斯）+ 头顶名字；离屏探针在 `.workbuddy/tmp/2026-09-18_ai-target/`。
- 名册真源 `config/enemyRoster.ts`：**加敌军 = 帧包 + 一条**；顺序 = 加载顺序 = `mobIndex`；★★ **禁取模复用数值**。
- ★★ 远程兵**同时给 `attackRadius`（刹车）与 `attackRange`（真判定）**；可见弹道走 `MobAIParams.ranged` → `rangedShot` → 按 camp 路由 `enemyBullets`/`enemyBolts`。
- ★★ **空中层**：名册 `isAir:true`+`airAltitude` → 悬停/不绕坑水/不掉坑判死/直线导航；L2+L3 高度口径同源。只在引擎层开洞（AgentPool SoA）。
- ★★ 新素材必查接地：FTX bbox 不保证贴脚底 → `FootAnchor.ts` + `MobDef.groundSink`，**L3 与 L2 两条渲染路径（含血条）都要补**。
- ★★ 命中/瞄准高度**别写死 `position.y+1.0`** → 问 `hitAnchorY()`。

## ★ 敌人 LOD 三层
L3 实体（升 35 / 降 40m，EntityManager）> L2 代理（80m，`swarm.pool`）> L1 回收（>140m 删）。
- **索敌半径 > 35m 者「看不见敌人」** → 开代理层通道，别升格（`L3_CAP=30`）。
- ★★ AgentPool 是 **swap-remove** → 下标每帧重锁；**加 SoA 字段必须同步 `push/copy/snapshot`**。

## ★ 遗物 / 物品 / 抽卡 / 文案 → topics/relics-and-items.md
- **新增遗物改三处**：`config/relics.ts`（效果走 `RelicEffects`）+ `ItemIconRegistry.ts` 的 `FTX_ICON_SOURCES`（**图标唯一真源**）+ `gachaPool.json`。★ 别改成从 relics 派生（值导入拖进 core 链 → 全灭）。
- ★★ **遗物绝不进背包**；`applyEffects` 双向防呆**勿删**；**改配置不改存档 = 用户看着没修好** → 老档走 `SaveSystem.sanitize()`。
- ★ **用户贴的文本逐字照抄禁润色** + 机器校验；给东西只走 `WorldUIManager.showPickupResult`。

## ★ 音频
- **只在船内有音乐**：基地 `base` / 舱内 `ship` / `sail` 静音 / `explore` `ambient` / 战斗 `battle`。真源 `config/bgm.ts`；★ 加键同步手写 `BgmKey`（漏 = TS2353）。
- ★★ SFX 必须节流且 **`minGapMs` ≥ 素材时长**；循环轨按 src 分轨 + `LoopTrack.target` 不能省 + 淡入淡出 220ms + 素材无缝 + 动作层当主层（→ 技能 `game-audio-sfx-pipeline`）。

## ★ 其他 → topics/ui-overlay-and-misc.md
- ★★ **UI 显隐两级**：`settingsAllowed`（只 BaseMode）× `settingsSuppressed`（页面级）；凡有返回键的全屏页 `show()/hide()` 必须成对压制/恢复齿轮；返回统一 `createBackButton()`。
- 小游戏**丢文件进 `src/minigames/games/` 零索引改动**；访客只改 `visitors.ts` + `dialogues.json`；房间三件套（★ ShaderMaterial 漏声明 uniform = 该材质全部 mesh 不渲染）。

## ★ 架构治理 / 蜂群 v2 → topics/arch-and-swarm-v2.md
- 头部过重（上限 1200，仅 warn）：`WorldMode.ts`≈3636、`ChunkManager.ts` 3481、`GachaOverlay.ts` 1763、`FluidSolver.ts` 1505。**下一刀 `ChunkManager.ts`**。
- ★ **让项目膨胀的是「人肉同步」**；拆类见技能 `god-object-extraction`（**tsc 通过 ≠ 行为一致**，须 difflib 比对）。
- 蜂群 v2：HPA\* + 走廊带；硬不变量 = 两阵营通行掩码 / 陷阱不入 HPA\* / 飞行兵不入地面寻路。
