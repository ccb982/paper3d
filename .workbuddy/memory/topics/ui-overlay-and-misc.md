# 专题：UI 叠加层 / 小游戏 / 访客 / 房间视觉

> 索引见 `../MEMORY.md`。

## ★★ UI 入口显隐：两级控制

- `settingsAllowed` —— 只有 `BaseMode` 为 `true`（全局允许）。
- `settingsSuppressed` —— **页面级**压制。
- 生效式：`applySettingsVisible()` = `setVisible(settingsAllowed && !settingsSuppressed)`；
  页面调 `globalThis.setSettingsSuppressed(bool)`。
- ★★ **凡左上角有返回键的全屏页，`show()` / `hide()` 必须成对压制 / 恢复齿轮**
  （已接：`CraftingOverlay`、`GachaOverlay`）。漏了 = 齿轮浮在遮罩上看不见 / 点不到，
  z-index 必须 > 遮罩。
- 「关闭 / 返回上一级」统一用 `ui/components/BackButton.ts` 的 `createBackButton()`。
- 性能 HUD 默认隐藏（关闭时零累加、零 DOM 写入）。

## 小游戏模块

- **加新游戏 = 丢一个文件进 `src/minigames/games/`，零索引改动**：
  文件底部 `registerMiniGame(id, ctor)`，`import.meta.glob('./games/*.ts', {eager:true})` 自动拉起。
- 契约 `MiniGameResult{ score: 0~100 }`，**分数口径由调用方解释**。
- 对外只有 `startMiniGame(id, {onFinish,onCancel})` / `closeMiniGame()`。
- 壳 `MiniGameOverlay`：z-index 300（盖住对话 280）；ESC capture + `stopPropagation`；
  遮罩点击不关闭；`finish`/`cancel` 幂等；`forceClose()` 不触发回调。
- 模式层：对话 `onEnd` 查 flag → 开小游戏 → **开成就直接 `return`**；
  `exit()` 第一件事 `closeMiniGame()`。
- ★ 素材降级两个必踩坑：
  1. `<img>` 无 `src` 时 **`onerror` 不触发** → 必须在 `.then(tex => ...)` 里显式判 `!tex`。
  2. `replaceWith` 之后旧字段引用失效。

## 访客系统

- 名册驱动：**加访客只改 2 个 config** —— `src/config/visitors.ts` + `dialogues.json`。
- 模型 = Quaternius Cube Guy（7 名共用，CC0）。
- 换脸用 `faceMode:'plate'`（压平几何 + 贴立绘 + 删眼睛浮雕）。
- 模型局部轴：**`y`=前后（脸朝 `-y`）、`z`=高度、`x`=左右**；
  贴图 32×32 只采样 8 个 UV；头是封闭方盒，五官是几何浮雕。
- 详见技能 `threejs-glb-model-swap` 与 `2026-09-16.md`。

## 房间 / 基地视觉

- 三件套：`RoomDecoGeo`（手搓顶点挤出）+ `RoomSurfaceMaterial`（程序化 shader）
  + `ui/base/RoomDecor.ts`（布局，尺寸常量唯一源）。
- ★ 自定义 `ShaderMaterial` 检查清单：
  - frag 用到的**每个**自定义 uniform 都要自己声明（**含 `uTime`**）；
  - GLSL 禁尾随逗号；
  - frag 末尾 `#include <colorspace_fragment>`。
  **漏一条 = program 编译失败 = 该材质全部 mesh 不渲染（房间整片消失）。**
- 排障最快路径：临时验收页只挂 BaseScene + vite dev + puppeteer-core + 本机 Chrome
  （swiftshader 软渲染）。
- 舰内交互 = 站点制（`WorldMode.SHIP_STATIONS` + `setStationPads` 地面光圈），E/F 通用。
