# MEMORY.md —— 项目长期约定（架构重置 / 明日方舟同人游戏）

## ★★ 新增遗物的正确流程（2026-09-16 踩坑后沉淀）

新增一个遗物**必须改两处**，少一处就出问题：

1. **`src/config/relics.ts`** —— 加 `RELIC_ITEM_CONFIG` 条目
   （`id` / `name` / `rarity` / `description` / `texture` / `effects`）。
   效果类型走 `src/core/RelicEffects.ts` 的注册表，**核心代码零改动**。
2. **`src/services/item/ItemIconRegistry.ts`** —— 在 `FTX_ICON_SOURCES` 硬编码表里
   **补一条 `id: '/fx/xxx.ftx3.gz'`**。

### ⚠️ 关键陷阱

- **`RelicItemConfig.texture` 是死数据，没有任何消费者。**
  遗物图标的**唯一真源**是 `ItemIconRegistry.FTX_ICON_SOURCES`。
  只在 `relics.ts` 填 `texture` → **图标空白**（用户反馈「喜羊羊纹理没有使用」就是这个）。
- **不要试图把 `FTX_ICON_SOURCES` 改成从 `relics.ts` 自动派生**。
  虽然 `relics.ts` 表面只 `import type { RelicItemConfig }`，
  但 `ItemIconRegistry` 值导入它会把它拖进 core 层初始化链 → 全部遗物图标空白。
  已试过并回退，注释里写了警告。**保持显式声明。**
- 抽卡池在 **`src/config/gachaPool.json`**，新增遗物还要在 `outOfRunItems` 里加
  `{ id, rarity, weight }`，否则抽不到。

### 完善一条 JS 值键名映射的小抄（写代码时直接照抄）

```ts
// effects 可用的内置 type（RelicEffects.ts 注册表）
'stat_multiplier'  // { perDay?, perDayStep?, perDeath?, perDeathStep?, scope?: 'all'|'attack'|'defense' }
'timed_item'       // { itemId, interval, perCopyMul?, minInterval? }
'respawn_time'     // { base, perCopy }
'start_items'      // { items: [{ itemId, count }] }
'regen'            // { base, perCopy }
```

## ★ BGM 约定（2026-09-17 用户定调）

**只在「船内」有音乐，出击到露天一律静音**：
- 有音乐：基地（BaseMode；罗德岛号舱内）、舰内舱（WorldMode `phase === 'interior'`）
- 静音：`sail`（驾驶舰船航行）、`explore`（下机探索）
  —— **航行段也算「在外面」**。点「开始行动/开始突袭」进图第一件事就是停音乐。

接线点（改音乐只碰这两个）：
- 曲目真源 `src/config/bgm.ts`（`base` / `ship` / `ambient` / `battle`；换曲子 = 丢文件进 public/music + 改这两处）
- ★ **加键必须同步改手写联合类型 `BgmKey`**，漏了直接 `tsc TS2353`（踩过两次）。
- `battle`（战斗曲，`public/music/战斗.mp3`，Mixkit「Fight Till the End」id 81，64kbps 830KB）：
  大举入侵（近舰敌军持续超标 `groupWarnShown=true`）期间切入，威胁解除淡回。
- 播放器 `src/services/audio/Bgm.ts`（`playBgm(key)` / `stopBgm()`，走 platform adapter）
- 基地：`main.enterBaseMode` → `playBgm('base')`
- 世界：`WorldMode.syncSceneBgm()`（三级优先：sail→静音 > groupWarnShown→battle > interior→ship / explore→ambient）
  —— **每个 `this.phase =` 赋值后必须跟一次**，且 `groupWarnShown` 三处翻转后也要跟（5+3 处：
  enter / finishDock / enterShipInterior / exitShipInterior / tryBoardShip）。漏一处 = 音乐状态错一段时间。

`WebAdapter.playBgm` 有**路径级去重**：同 src 在播 → 不动；同 src 已暂停 → 直接 `play()` 续播（不重设 src，
所以同曲来回切不重头）；自动播放被拦 → 挂一次性 pointerdown/keydown 补播。
**音量淡入/淡出也在 WebAdapter**（`BGM_FADE_MS = 700` 线性，setInterval 驱动不是 rAF）：
开场/切入淡入、停止淡出到 0 再 pause、切曲 = 旧轨淡出 + 新轨淡入（交叉）。

## ★ 环境音效（2026-09-17 用户点题）

- 曲目真源 `src/config/sfx.ts`（每个 id 一组候选 = 随机变体）；播放器 `src/services/audio/Sfx.ts`
  的 `playSfx(id, minGapMs)` —— **必须带节流**：触发点在 update 里，不节流会一帧响十几次。
- 素材来自 **Mixkit**（免费商用、无署名），全部 64kbps 单声道，`public/sfx/` 共 11 个 ≈ 84 KB
  （同目录 `来源.txt` 记了每个文件对应的原始音效名）。
- 三条触发线（都在 WorldMode）：
  1. `updateAmbientSfx()` —— 脚步按**位移**触发（每 `WorldMode.STEP_DISTANCE`=2.2m 一步），
     音色 = 脚下 `raster.tileDefAt().genRole`（liquid/pit 不响、platform=硬地）+ 1.6m 内有无植被（草/土）；
     穿过草丛 = 0.2s 节拍查 1.3m 内植被 → grassBrush。
  2. `updateWaterEntry()` —— 复用现成的水面泛波节拍：入水/坠落 → waterEnter；水中移动 → waterWade。
     ★ 只对玩家响（`e === this.player`）。
  3. `updatePlantGustSweep()` —— `MapEntityDecorBase.plantGustAt` **返回 boolean**（该株冷却通过 = 真的摇动），
     true 才播 grassHit。

## ★ 第二条常驻音轨：循环音效（2026-09-17）

**引擎轰鸣这类「要一直响、但属于音效不属于音乐」的走 `playLoopSfx` / `stopLoopSfx`，
不要塞进 BGM 通道** —— BGM 通道只有 `WebAdapter.bgmAudio` 一个元素，换曲会把引擎顶掉，
反之引擎也会顶掉战斗曲。两条通道独立、可同时响（loop 音量 0.55，BGM 1.0）。

- 接口 `PlatformAdapter.audio.playLoopSfx/stopLoopSfx`；实现 `WebAdapter.loopTrack`（复用同一套 fadeTo）
- 配置 `src/config/sfx.ts` 的 `LOOP_SFX`（**独立表**，别混进 `SFX`——SFX 是一次性通道，每次 new Audio）
- 服务层 `Sfx.ts` 的 `playLoopSfx(id)` / `stopLoopSfx()`
- 目前只挂了 `shipEngine`（`飞行引擎.mp3`，sail 段响）：开关写在 `syncSceneBgm()` 开头，
  自动继承已有的 5 处 phase + 3 处 groupWarn 调用点。**从航行段直接回基地要手动停** ——
  `main.enterBaseMode` 里有 `stopLoopSfx()`。
- 素材必须做过无缝循环（尾 1.5s 淡出叠回开头），否则 loop 接缝咔哒。
  4. `resolveBulletHit()` 命中静态世界那段 → `impact.water === 'none'` 时播 bulletGround（打水里/洞顶不响）。
- **野外环境音**：`bgm.ts` 的 `ambient` 键（微风 loop，12.9s，素材里已压低 12dB）。
  它走 **BGM 通道**，所以自动带淡入淡出 + 循环。`WorldMode.syncSceneBgm()` 三态：
  interior → ship 曲 / explore → ambient / sail → 静音。
  ⚠️ `BgmKey` 是**手写联合类型**，加键必须同步改它（否则 tsc 报 known properties 错）。
- 环境音若要**无缝循环**：`atrim 0:(L-f)` 主体 + `atrim (L-f):L` 淡出 → `amix=normalize=0` 叠回开头。

## ★ 抽卡池分档概率（2026-09-16 用户定调）


弹药消耗品 **35%** / 可装备道具 **45%** / 遗物 **18%** / BOSS **2%**（精确，非约等）。

用**总刻度 2000** 实现：弹药 2 件各 350（档 700）、可装备 4 件各 225（档 900）、
遗物 5 件各 72（档 360）、BOSS 登记 40（**独立优先判定，不占池权重**）。

- 分类口径按 `items.json` 自动判定，别手写：
  - 弹药 = `type:'consumable'` 且无 `deployable`
  - 可装备 = `type:'equip'` 或 `deployable`（★ 无人机是 consumable+deployable，归此档）
- 5★ 遗物**权重统一**（用户明确要求），档内每件均等。

## ★ 访客系统

- 名册驱动：**加访客只改 2 个 config** —— `src/config/visitors.ts` +
  `src/config/dialogues.json`（顶层 key 是 `trees`，不是 `dialogues`）。
- 访客模型 = Quaternius Cube Guy（7 名共用，CC0，334KB），
  **换脸方案 = `faceMode:'plate'`**（真正压平几何 + 贴立绘 + 删眼睛浮雕）。
- 该模型局部轴：**`y` = 前后（脸朝 `-y`）、`z` = 高度、`x` = 左右**、
  贴图 32×32 只采样 8 个 UV、头是**封闭方盒**、脸上"五官"全是**几何浮雕**。
- 详见 `.workbuddy/memory/2026-09-16.md` 与技能 `threejs-glb-model-swap`。

## ★ 工程习惯 / 环境

- **bash 工具链损坏**：`ls` / `head` / `cat` / `dirname` / `cd` 全 command not found
  → 一律用 `python -c` + `subprocess` 代替。
- ★ **bash 会把 python -c 字符串里的反引号当命令替换**，写 md 日志时反引号内容会被吞掉！
  写含反引号的长文本 = 用 Write 工具写 .py 脚本再运行，别直接 `python -c`。

## ★ ffmpeg 音频加工踩坑（2026-09-17）

- **不能原地写文件**（`same as Input` 直接报错）→ 输出临时文件再 `shutil.move`。
- **`loudnorm` 对 1~2s 短音效完全失效**（目标 I=-7 做出 -16.4 LUFS）。短音效用
  「测 RMS → 算增益 → 压缩 + 线性归一」。
- **`alimiter` 在这个 imageio-ffmpeg 版本不生效**（limit=0.95 照样输出 peak 1.44）→ 用
  `volume=<target/current>` 手动归一。
- `acompressor` 的 **ratio 上限 20**（超了报错退出）。
- 「素材不够响」的正确解法不是调 volume（峰值早就削波了），而是**压缩降 crest factor**：
  扫描参数网格，选「归一到同峰值后 RMS 最大」那组。见 `_audio_backup/scan_land.py`。
- 测响度：`ffmpeg -i x -af ebur128=peak=true -f null -` 拿 LUFS/peak；短音效额外自己解 PCM 算 RMS 更靠谱。
- ★★★ **`afade=t=out:st=S:d=D` 从 S 起淡到 0 后是「一直保持静音」，不是只淡那一小段**。
  写成 `afade=t=out:st=0:d=0.02`（本意"去掉起始爆音"）= 整段音频只剩 0.02s，
  实测 RMS 0.1625 → 0.0052（压掉 31 倍），成品"小到几乎听不见"。
  **要淡入写 `t=in`；要淡出必须写 `st=<末尾时刻>`。**
- ★ 选素材的响度指标要用「**裁掉首尾静音后的有效段 RMS**」，不是峰值也不是 25ms 窗峰值。
  短促瞬态音 peak 高但 RMS 极低 = 听着很轻。脚本 `_audio_backup/pick_laser.py` 就是干这个的。
- **node/npx 要用托管版**：`C:\Users\22641\.workbuddy\binaries\node\versions\22.22.2-3`，
  并把其目录加进 `PATH` 再 `cmd /c npx ...`。打包 = `npm.cmd run build`（cwd=项目根）。
- **系统没有 ffmpeg**。要转码音频用托管 venv 里的 imageio-ffmpeg：
  `C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe`
  （自带 libmp3lame / libopus / libvorbis）。BGM 压码率命令见 `.workbuddy/memory/2026-09-17.md`。
- `vite.config.ts` **没设 `base`**（默认 `'/'`，产物是绝对路径 `/assets/...`）→ 子目录托管/预览面板会 404 白屏。
- 沙箱**不能监听端口**：vite dev / preview 起不来，别在这里做 browser 联调。
- **用户可能正在玩游戏** → 不要擅自跑游戏内实测（会抢 GPU 帧率崩，且会被误归因到刚改的代码）。
  要实测先问一句。
- 用户偏好：**直接、简短、可验证**的结论；给数字；明确说清做了什么、踩了什么坑、回退了什么。


## ★★ 敌人 LOD 三层与「友军索敌」的冲突（2026-09-17 踩坑）

敌人有三层表示，**实体只在玩家附近存在**：

| 层 | 半径（距玩家） | 表示 |
|---|---|---|
| L3 实体 | 升格 35m / 降格 40m（`SWARM.L3_RADIUS` / `DEMOTE_RADIUS`） | EntityManager 里的 EntityBase |
| L2 代理 | 80m | `swarm.pool` 的廉价代理 |
| L1 回收 | 140m 外删除 | — |

**任何索敌半径 > 35m 的单位都会「看不见敌人」** —— 因为它查的是 EntityManager，而远处只有代理。
典型症状：站桩的祖宗（射程 42m）一离开玩家就不开火。

- 修法：给该单位开一条**代理层通道**（查 pool + 用 `swarm.damageAgent` 结算），
  不要为了让它开火而把远处敌人升格成实体（会占满 `L3_CAP=30`，玩家身边反而没实体，手感更差）。
- ★★ **AgentPool 是 swap-remove → 缓存的代理下标会静默漂移到别的代理**。
  必须**每帧重新锁定**，绝不跨帧缓存 idx。
- 无人机不受影响：`LOCK_RANGE = 12m` < 35m，目标必定是实体。

## ★ 房间/基地视觉架构（2026-09-16）
- 房间三件套：`RoomDecoGeo`(手搓顶点挤出) + `RoomSurfaceMaterial`(全部程序化 shader) + `ui/base/RoomDecor.ts`(布局)。尺寸常量唯一源在 RoomDecor.ts，BaseScene import。
- ★ 自定义 ShaderMaterial 检查清单：每个 frag 用到的自定义 uniform 必须自己声明（uTime 也不例外）；GLSL 禁尾随逗号；frag 末尾 `#include <colorspace_fragment>`。漏一条 = program 编译失败 = **该材质全部 mesh 不渲染（房间整片消失）**。
- ★ shader 排障最快路径：临时验收页只挂 BaseScene + vite dev + puppeteer-core + 本机 Chrome（swiftshader 软渲染，不抢游戏 GPU），console.error 重定向进 DOM 截图拿报错行号。
- 舰内交互 = 站点制（`WorldMode.SHIP_STATIONS` + `setStationPads` 地面光圈），键位 E/F 通用；起飞/返航 = 航行终端面板二选一。

## ★ UI 约定（2026-09-16）
- 一切「关闭/返回上一级」语义的面板，统一用 `ui/components/BackButton.ts` 的 `createBackButton()`（FTX 素材 `/ui/返回按钮.ftx3.gz`），别写自造 ✕。
- 设置入口 = 基地左上角白齿轮（实现 `ui/components/SettingsPanel.ts` 的 `createSettingsUI`），**仅基地模式显示**（`enterBaseMode` 显 / `enterWorldMode` 隐）。齿轮 z-index 必须 > 遮罩，否则点不到。
- 性能 HUD（`hudWrap`）默认隐藏；「关闭」= 统计段整块不进 `if (hudVisible)` 之外，零累加零 DOM 写入。

## ★★ 剧情/文案：用户贴的文本一律「逐字照抄」，禁止润色（2026-09-17 返工教训）

**用户贴出 JSON / 台词片段 = 定稿，不是参考稿。** 不要按自己的文风重写、不要"顺一下句子"、
不要改标点、不要因为觉得某处笔误就替换物品 id 或措辞。不确定就照抄 + 单独问。

- 落地后**必须有一步机器校验**，不能靠肉眼看：把用户的原文嵌进一次性 python 脚本，
  与 `dialogues.json` 解析结果做 **dict 深比较**（`cur[key] == exp[key]`）+ `difflib` 打印差异行。
  dict 相等是 key 顺序无关、内容敏感的 → 多键/少键/任何一个字符差异都会暴露。
  脚本用 `Write` 写成 `.py` 再跑，**跑完就删**（bash 工具链损坏，`python -c` 里塞大段中文 JSON 不可靠）。
- 对话文案真源：`src/config/dialogues.json`（顶层 key 是 `trees`）。
  树内节点结构：`{text, next?|choices[], effects?, end?}`；
  effects 支持 `item`(id,count) / `relic`(id,count) / `flag`(key,value?) / `heal`(amount|percent)。


## ★ 给玩家东西 = 走 `WorldUIManager.showPickupResult`（唯一播报渠道）

**任何"获得了 X"都要上屏，且只有一条渠道**（2026-09-17 定）：
击杀掉落 / 采集 / 定时遗物补给 / **对话与访客奖励** 全部调
`worldUIManager.showPickupResult(itemId, success, count)`；成功再配 `flashItemAndRefresh(itemId)`。

- 位置：`position:fixed; top:8.97%; right:0.16%; width:20.3%; z-index:70`，挂 body，**不受战斗 HUD 显隐影响**。
- 与 `DialogueView`（`bottom:36px; z-index:280`，无全屏遮罩）**不重叠** → z-index 低也没事。
- ★ **取名必须走 `WorldUIManager.displayNameOf()`**：archetype 未命中时回退 `RELIC_ITEM_CONFIG[id].name`。
  直接写 `getArchetype(id)?.name ?? id` 的话，给遗物会播报成 `获得了 black_crown`。
- 层间契约：`DialogueSystem` **零 DOM**，只通过 `onGrant(grant)` 回调把
  `{kind:'item'|'relic', id, count, success}` 报给模式层；**模式层负责上屏**。
  `success` 取 `itemManager.addItem` 的返回值（背包满 = false）。
- 遗物（`kind:'relic'`）**不入背包** → 只播报，**不要** `flashItemAndRefresh`。
- 尚未覆盖：**BaseMode 的事件对话**（`base_supply` / `base_echo`）没有播报渠道，仍是静默。



## ★ 小游戏模块（2026-09-17 新建）

**加一个新小游戏 = 丢一个文件进 `src/minigames/games/`，零索引改动：**
1. 新建 `XxxGame.ts`，实现 `MiniGame`（`mount(root, host)` / `dispose()`）；
2. 文件底部 `registerMiniGame('xxx', () => new XxxGame())`。
   `index.ts` 的 `import.meta.glob('./games/*.ts', { eager: true })` 自动 import（副作用即注册）。

- 契约：`MiniGameResult{score: 0~100, detail?}` —— **分数口径由调用方解释**（如 ≥80/≥50 分档）。
- 对外只用三个：`startMiniGame(id, {onFinish, onCancel})` / `closeMiniGame()` / `isMiniGameRunning()`。单实例锁 `current`。
- 壳 `MiniGameOverlay` 的硬约定：
  - **z-index 300**（对话 280）→ 小游戏一定盖在对话之上；
  - ESC 用 **capture + stopPropagation**；遮罩点击**不关闭**（玩法多为点击判定）；
  - `finish`/`cancel` **幂等**；`forceClose()` 不触发任何回调（模式退出用）。
- 模式层接线：对话 `onEnd` 里查 flag → 开小游戏 → **开成就直接 return**，别走原收尾（否则 NPC 走了、结果对话还在说话）；
  `exit()` 第一件事 `closeMiniGame()`。

### ★ 写「素材降级」时的两个必踩坑
1. **`<img>` 没有 src 时 `onerror` 不会触发** → 靠 onerror 做降级 = 死代码。必须在 `.then(tex => ...)` 里显式判 `!tex`。
2. **`replaceWith` 之后字段引用失效** → 动画目标会指向已脱离 DOM 的节点，从此不动。
   正确做法：外层用**固定尺寸的槽位 div**（内部 img ↔ 文字可换），动画只驱动槽位，引用全生命周期恒定。
3. `let x` + `Promise<typeof x>` → TS 会把 `typeof` 窄化成初值类型（如 `null`，报 TS2322）。**显式声明 interface。**

## ★ 查「一个 id 到底是不是合法物品」要看三处，不是一处

`items.json` 只管**普通物品/消耗品**。遗物与图标在别的地方：

| 想知道 | 去哪查 |
|---|---|
| 普通物品/消耗品/可部署 | `src/config/items.json` |
| **遗物配置 + 名称/效果** | `src/config/relics.ts`（`RELIC_ITEM_CONFIG`） |
| **图标真源** | `src/services/item/ItemIconRegistry.ts`（`FTX_ICON_SOURCES`） |
| 能否抽到 | `src/config/gachaPool.json`（`outOfRunItems`） |
| 开局自带 | `src/core/Session.ts`（`STARTER_RELICS`） |

例：`black_crown`（魔王的黑冠）**不在 items.json**，但它是正经 5★ 遗物，四处都登记了。
→ 别因为 items.json 查不到就把它替换掉。

对话 effects 的 `kind`：`'relic'` 写 `session.outOfRun.owned`（永久生效）；
`'item'` 走 `ItemManager.addItem` 塞背包格子（**不校验 id**，写错会得到无图标的幽灵道具）。
