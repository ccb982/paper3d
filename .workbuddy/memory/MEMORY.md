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
- 曲目真源 `src/config/bgm.ts`（`base` / `ship` 两条路径；换曲子 = 丢文件进 public/music + 改这两行）
- 播放器 `src/services/audio/Bgm.ts`（`playBgm(key)` / `stopBgm()`，走 platform adapter）
- 基地：`main.enterBaseMode` → `playBgm('base')`
- 世界：`WorldMode.syncShipBgm()` —— **每个 `this.phase =` 赋值后必须跟一次**（5 处：
  enter / finishDock / enterShipInterior / exitShipInterior / tryBoardShip）。漏一处 = 音乐状态错一段时间。

`WebAdapter.playBgm` 有**路径级去重**：同 src 在播 → 不动；同 src 已暂停 → 直接 `play()` 续播（不重设 src，
所以同曲来回切不重头）；自动播放被拦 → 挂一次性 pointerdown/keydown 补播。
**音量淡入/淡出也在 WebAdapter**（`BGM_FADE_MS = 700` 线性，setInterval 驱动不是 rAF）：
开场/切入淡入、停止淡出到 0 再 pause、切曲 = 旧轨淡出 + 新轨淡入（交叉）。

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


## ★ 房间/基地视觉架构（2026-09-16）
- 房间三件套：`RoomDecoGeo`(手搓顶点挤出) + `RoomSurfaceMaterial`(全部程序化 shader) + `ui/base/RoomDecor.ts`(布局)。尺寸常量唯一源在 RoomDecor.ts，BaseScene import。
- ★ 自定义 ShaderMaterial 检查清单：每个 frag 用到的自定义 uniform 必须自己声明（uTime 也不例外）；GLSL 禁尾随逗号；frag 末尾 `#include <colorspace_fragment>`。漏一条 = program 编译失败 = **该材质全部 mesh 不渲染（房间整片消失）**。
- ★ shader 排障最快路径：临时验收页只挂 BaseScene + vite dev + puppeteer-core + 本机 Chrome（swiftshader 软渲染，不抢游戏 GPU），console.error 重定向进 DOM 截图拿报错行号。
- 舰内交互 = 站点制（`WorldMode.SHIP_STATIONS` + `setStationPads` 地面光圈），键位 E/F 通用；起飞/返航 = 航行终端面板二选一。

## ★ UI 约定（2026-09-16）
- 一切「关闭/返回上一级」语义的面板，统一用 `ui/components/BackButton.ts` 的 `createBackButton()`（FTX 素材 `/ui/返回按钮.ftx3.gz`），别写自造 ✕。
- 设置入口 = 基地左上角白齿轮（实现 `ui/components/SettingsPanel.ts` 的 `createSettingsUI`），**仅基地模式显示**（`enterBaseMode` 显 / `enterWorldMode` 隐）。齿轮 z-index 必须 > 遮罩，否则点不到。
- 性能 HUD（`hudWrap`）默认隐藏；「关闭」= 统计段整块不进 `if (hudVisible)` 之外，零累加零 DOM 写入。
