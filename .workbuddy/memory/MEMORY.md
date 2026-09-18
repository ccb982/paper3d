# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

## ★ 时间 / 昼夜（2026-09-18）

- 时间唯一入口：`main.ts` 主循环无条件调 `renderManager.update(dt)` → `SunCycle.update`。
  `DAY_SECONDS = 900`（现实 15 分钟 = 游戏 24h，≈37.5s/游戏小时），`START_HOUR = 6`。
- `WorldMode.enter()` 里 `renderManager.resetDay()` → 每次出击都重置到 6 点。
- ★★ **不变量（2026-09-18 用户定调）：不允许出现「敌人不动 + 时间照常流逝」**。
  舰内要么时间暂停，要么敌人 AI 照常 —— 二选一，禁止中间态（用户选了「全冻结」）。
  → 凡是 `WorldMode.update` 里**直接 return 冻结世界**的分支，都必须同步 `setClockPaused(true)`。
- ★ `renderManager.setClockPaused(true/false)`：只停太阳/昼夜，**不影响 scaledDt**
  （房间行走照常）。现有接线：`enter()` 复位 false / 进舱 true / 出舱 false /
  `shipDestroyed=true` 结算等待 true / `reviveShip()` false。
  （不加的话：舱内看不到天空但太阳偷偷走，待 10 分钟出舱天黑 16 小时。）
- `phase === 'interior'` 与 `shipDestroyed` 时 `WorldMode.update` 直接 return → 实体/敌人/定时遗物全停。
- 一致态：对话中 / 面板打开 = 世界照跑（只锁输入与指针）+ 时间照跑；顿帧 = 两者同缩。

## ★ 新增遗物的正确流程（2026-09-16）

**必须改三处**：
1. `src/config/relics.ts` → 加 `RELIC_ITEM_CONFIG` 条目（效果走 `src/core/RelicEffects.ts` 注册表，核心零改动）。
2. `src/services/item/ItemIconRegistry.ts` → `FTX_ICON_SOURCES` 补一条 `id: '/fx/xxx.ftx3.gz'`。
3. `src/config/gachaPool.json` → `outOfRunItems` 加 `{ id, rarity, weight }`，否则抽不到。

陷阱：
- `RelicItemConfig.texture` 是**死数据**；图标唯一真源是 `FTX_ICON_SOURCES`（漏填 = 图标空白）。
- **不要把 `FTX_ICON_SOURCES` 改成从 relics.ts 派生**（值导入会把 relics 拖进 core 初始化链 → 全灭）。试过并回退，注释里有警告。

effects 内置 type 小抄：
`stat_multiplier` / `timed_item` / `respawn_time` / `start_items` / `regen`。

## ★ 音频（BGM / SFX / 循环轨）

- **只在「船内」有音乐**：基地 → `base`；舰内舱（`phase==='interior'`）→ `ship`；
  `sail` → 静音；`explore` → `ambient`（野外微风底噪，走 BGM 通道所以自带淡入淡出）。
  战斗曲 `battle`：`groupWarnShown=true` 期间切入。
- 曲目真源 `src/config/bgm.ts`；★ 加键必须同步改手写联合类型 `BgmKey`（漏了 = TS2353，踩过两次）。
- 接线点：`main.enterBaseMode` → `playBgm('base')`；`WorldMode.syncSceneBgm()`
  （三级优先：sail 静音 > battle > interior/explore）。**每个 `this.phase =` 赋值后必须跟一次**
  （5 处）+ `groupWarnShown` 翻转后也要跟（3 处）。
- `WebAdapter.playBgm` 有路径级去重（同 src 续播不重头）；淡入淡出 `BGM_FADE_MS=700` 也在 WebAdapter。
- SFX：`src/config/sfx.ts`（每个 id 一组候选变体）+ `Sfx.ts` 的 `playSfx(id, minGapMs)`，
  **必须节流**（触发点在 update 里）。素材 Mixkit，64kbps 单声道，`public/sfx/` 11 个 ≈84KB。
  触发线：`updateAmbientSfx`（脚步按位移 2.2m 一步）/ `updateWaterEntry`（仅玩家）/
  `updatePlantGustSweep`（`plantGustAt` 返回 boolean 才响）/ `resolveBulletHit` → bulletGround。
- 循环轨（`shipEngine` 引擎声，sail 段响）走 **`playLoopSfx/stopLoopSfx` + `LOOP_SFX` 独立表**，
  不进 BGM 通道（BGM 只有一个 audio 元素，会互相顶掉）。从航行段直接回基地要手动停。

## ★ 敌人 LOD 三层与友军索敌（2026-09-17）

| 层 | 半径（距玩家） | 表示 |
|---|---|---|
| L3 实体 | 升格 35m / 降格 40m | EntityManager 里的 EntityBase |
| L2 代理 | 80m | `swarm.pool` 廉价代理 |
| L1 回收 | 140m 外删除 | — |

- **索敌半径 > 35m 的单位会「看不见敌人」**（查的是 EntityManager，远处只有代理）。
  修法：给它开代理层通道（查 pool + `swarm.damageAgent`），**不要**把远处敌人升格成实体（会占满 `L3_CAP=30`）。
- ★★ AgentPool 是 swap-remove → 代理下标**每帧重锁**，绝不跨帧缓存。
- 无人机 `LOCK_RANGE=12m` < 35m，不受影响。

## ★ 房间 / 基地视觉（2026-09-16）

- 三件套：`RoomDecoGeo`（手搓顶点挤出）+ `RoomSurfaceMaterial`（程序化 shader）+ `ui/base/RoomDecor.ts`（布局，尺寸常量唯一源）。
- ★ 自定义 ShaderMaterial 检查清单：frag 用到的**每个**自定义 uniform 都要自己声明（含 uTime）；
  GLSL 禁尾随逗号；frag 末尾 `#include <colorspace_fragment>`。
  漏一条 = program 编译失败 = **该材质全部 mesh 不渲染（房间整片消失）**。
- 排障最快路径：临时验收页只挂 BaseScene + vite dev + puppeteer-core + 本机 Chrome（swiftshader 软渲染）。
- 舰内交互 = 站点制（`WorldMode.SHIP_STATIONS` + `setStationPads` 地面光圈），E/F 通用。

## ★ UI 约定

- 「关闭/返回上一级」统一用 `ui/components/BackButton.ts` 的 `createBackButton()`。
- 设置入口 = 基地左上角白齿轮，`SettingsPanel.createSettingsUI`，**仅基地显示**；z-index 必须 > 遮罩。
- 性能 HUD 默认隐藏（关闭时零累加零 DOM 写入）。

## ★ 剧情文案：用户贴的文本一律逐字照抄，禁止润色（2026-09-17 返工教训）

- 贴出的 JSON/台词 = **定稿**。不重写、不顺句、不改标点、不擅自换 id。
- 落地后**必须机器校验**：Write 一个一次性 .py 脚本，与 `dialogues.json` 解析结果做
  **dict 深比较** + `difflib` 打差异；跑完就删。
- 真源 `src/config/dialogues.json`（顶层 key 是 `trees`）；节点 `{text, next?|choices[], effects?, end?}`；
  effects 五种：`item` / `relic` / `random_relic` / `flag` / `heal`。
  ★ 要随机遗物就用 `random_relic`（按 gachaPool 权重抽），别在对话里写死 id。

## ★ 给玩家东西 = 走 `WorldUIManager.showPickupResult`（唯一播报渠道）

击杀掉落 / 采集 / 定时遗物 / **对话与访客奖励** 全调它；成功再配 `flashItemAndRefresh`。
- ★ 取名必须走 `WorldUIManager.displayNameOf()`（否则遗物播报成 `获得了 black_crown`）。
- 层间契约：`DialogueSystem` 零 DOM，只通过 `onGrant({kind,id,count,success})` 回调给模式层，**模式层负责上屏**。
- 遗物（`kind:'relic'`）不入背包 → 只播报，不要 `flashItemAndRefresh`。
- 未覆盖：BaseMode 的事件对话（`base_supply` / `base_echo`）仍静默。

## ★★ 遗物绝不进背包（2026-09-17 定调）

遗物只住 `session.outOfRun.owned`，永不进 `inventories` / `player.slots`。
- 对话 kind 写错（`relic` 写成 `item`）= 背包多一格 + 遗物列表看不到它。
- ★ `DialogueSystem.applyEffects` 有双向防呆（不要删）：`item` 分支发现 id 在 `RELIC_ITEM_CONFIG`
  自动改走遗物；`relic` 分支发现未登记自动改走背包，两边 `console.warn`。
- ★ 老存档矫正 = `SaveSystem.sanitize()`（`load()` 里调，幂等）。
  **教训：改配置不改存档 = 用户那边看着没修好。**

## ★ 查「一个 id 是不是合法物品」要看三处

| 想知道 | 去哪查 |
|---|---|
| 普通物品/消耗品/可部署 | `src/config/items.json` |
| 遗物配置+名称/效果 | `src/config/relics.ts` |
| 图标真源 | `src/services/item/ItemIconRegistry.ts` |
| 能否抽到 | `src/config/gachaPool.json` |
| 开局自带 | `src/core/Session.ts`（`STARTER_RELICS`） |

例：`black_crown` 不在 items.json，但四处都登记了 → 别因为查不到就替换掉。

## ★ 抽卡池分档（2026-09-16 定）：弹药 35% / 可装备 45% / 遗物 18% / BOSS 2%

总刻度 2000：弹药 2×350、可装备 4×225、遗物 5×72、**BOSS 40 独立优先判定不占权重**。
分类按 `items.json` 自动判定（弹药 = consumable 且无 deployable；可装备 = equip 或 deployable，
★ 无人机 consumable+deployable 归此档）。5★ 遗物档内权重均等。

## ★ 访客系统

名册驱动：**加访客只改 2 个 config** —— `src/config/visitors.ts` + `dialogues.json`。
模型 = Quaternius Cube Guy（7 名共用，CC0），换脸用 `faceMode:'plate'`（压平几何 + 贴立绘 + 删眼睛浮雕）。
模型局部轴：**`y`=前后（脸朝 `-y`）、`z`=高度、`x`=左右**；贴图 32×32 只采样 8 个 UV；头是封闭方盒，五官是几何浮雕。
详见 `.workbuddy/memory/2026-09-16.md` 与技能 `threejs-glb-model-swap`。

## ★ 小游戏模块（2026-09-17）

**加新游戏 = 丢一个文件进 `src/minigames/games/`，零索引改动**（底部 `registerMiniGame(id, ctor)`，
`import.meta.glob('./games/*.ts', {eager:true})` 自动拉起）。
- 契约 `MiniGameResult{score:0~100}`，**分数口径由调用方解释**。
- 对外只有 `startMiniGame(id, {onFinish,onCancel})` / `closeMiniGame()`。
- 壳 `MiniGameOverlay`：z-index 300（盖住对话 280）；ESC capture+stopPropagation；
  遮罩点击不关闭；`finish`/`cancel` 幂等；`forceClose()` 不触发回调。
- 模式层：对话 `onEnd` 查 flag → 开小游戏 → **开成就直接 return**；`exit()` 第一件事 `closeMiniGame()`。

写「素材降级」两个必踩坑：
1. `<img>` 无 src 时 **onerror 不触发** → 必须在 `.then(tex => ...)` 里显式判 `!tex`。
2. `replaceWith` 后字段引用失效 → 外层用**固定尺寸槽位 div**，动画只驱动槽位。
3. `let x` + `Promise<typeof x>` → TS 窄化成初值类型 → **显式声明 interface**。

## ★ 工程习惯 / 环境

- **bash 工具链损坏**：`ls`/`head`/`cat`/`dirname`/`cd` 全 command not found → 用 `python -c` + `subprocess`。
  ★ bash 会把 python -c 里的**反引号当命令替换**（写 md 日志会吞内容）→ 长文本用 Write 写 .py 再跑。
- **node/npx 用托管版** `C:\Users\22641\.workbuddy\binaries\node\versions\22.22.2-3`（加进 PATH 再 `cmd /c npx`）；
  打包 `npm.cmd run build`（cwd=项目根）。tsc：`node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。
- **系统无 ffmpeg** → 用托管 venv 的 imageio-ffmpeg：
  `...\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe`（自带 lame/opus/vorbis）。
- `vite.config.ts` **没设 base**（产物绝对路径 `/assets/...`）→ 子目录托管会 404 白屏。
- 沙箱**不能监听端口**：vite dev/preview 起不来。
- **用户可能在玩游戏** → 不擅自跑游戏内实测（抢 GPU 帧率崩 + 误归因）。要实测先问。
- 用户偏好：**直接、简短、可验证**；给数字；说清做了什么 / 踩了什么坑 / 回退了什么。

## ★ ffmpeg 音频加工踩坑（2026-09-17）

- **不能原地写文件**（`same as Input` 报错）→ 临时文件 + `shutil.move`。
- **`loudnorm` 对 1~2s 短音效完全失效** → 短音效用「测 RMS → 算增益 → 压缩 + 线性归一」。
- **`alimiter` 在这版不生效** → 用 `volume=<target/current>` 手动归一；`acompressor` ratio 上限 20。
- 「素材不够响」的正解是**压缩降 crest factor**（网格扫描选「归一后 RMS 最大」那组），不是调 volume。
- 测响度 `ffmpeg -i x -af ebur128=peak=true -f null -`；短音效自己解 PCM 算 RMS 更靠谱。
- ★★★ `afade=t=out:st=S:d=D` 是从 S 起**一直静音**，不是只淡那一小段。
  要淡入写 `t=in`；要淡出必须写 `st=<末尾时刻>`。
- ★ 选素材看「**裁掉首尾静音后的有效段 RMS**」，不是峰值（瞬态音 peak 高但听着轻）。
- 无缝循环：`atrim 0:(L-f)` 主体 + `atrim (L-f):L` 淡出 → `amix=normalize=0` 叠回开头。

## ★ 死代码审计结论（2026-09-17，240 文件）

**架构干净**，只清出 3 处真垃圾：`ShipUIManager._gachaOverlay` 套装 /
`minigames/index.ts` 的 `isMiniGameRunning()` / `RandomRelic.ts` 的多余 export。
审计后 `tsc --noEmit`（含 `--noUnusedLocals --noUnusedParameters`）与 `npm run build` 均 EXIT=0。

**这些类别不要删**（下次审计直接跳过）：自注册扩展点（`registerMiniGame`/`registerTile`）、
`import.meta.glob` 产物、worker 入口、build 期脚本/预留接口、只在本模块用但被 public 签名引用的类型。

临时脚本姿势（`package.json` 有 `"type":"module"`）：不能丢 `.js` 到项目根（会被当 ESM）。
→ 建 `_t/` 放 `{"type":"commonjs"}`，或用 `.mjs`；**跑完必须删**。

**疑似写了没接线（未动，等裁定）**：`registerTile` 零调用 / `PRESERVER_AI` 零引用 / `drainInteractions` 零调用。
