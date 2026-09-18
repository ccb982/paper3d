# 专题：遗物 / 物品 / 抽卡 / 对话文案

> 从 MEMORY.md 下沉（2026-09-18）。MEMORY.md 只留触发条件，细节在这。

## ★ 新增遗物的三处改动（缺一即静默失败）

1. `src/config/relics.ts` → `RELIC_ITEM_CONFIG` 加条目。
   **效果走 `src/core/RelicEffects.ts` 的注册表**（按 `type` 查），核心零改动。
   内置 type 小抄：`stat_multiplier` / `timed_item` / `respawn_time` / `start_items` / `regen`。
2. `src/services/item/ItemIconRegistry.ts` → `FTX_ICON_SOURCES` 补一条 `id: '/fx/xxx.ftx3.gz'`。
   **图标唯一真源**；漏填 = 图标空白。
3. `src/config/gachaPool.json` → `outOfRunItems` 加 `{ id, rarity, weight }`，否则抽不到。

### 两个陷阱

- ★ `RelicItemConfig.texture` 是**死数据**（没人读）。图标只看 `FTX_ICON_SOURCES`。
- ★★ **不要把 `FTX_ICON_SOURCES` 改成从 `relics.ts` 派生**：值导入会把 relics 拖进 core
  初始化链 → **全灭**。试过并回退，代码注释里有警告。

## ★ 查「一个 id 是不是合法物品」看五处

| 想知道 | 去哪查 |
|---|---|
| 普通物品/消耗品/可部署 | `src/config/items.json` |
| 遗物配置 + 名称/效果 | `src/config/relics.ts` |
| 图标真源 | `src/services/item/ItemIconRegistry.ts` |
| 能否抽到 | `src/config/gachaPool.json` |
| 开局自带 | `src/core/Session.ts`（`STARTER_RELICS`） |

例：`black_crown` 不在 items.json，但四处都登记了 → 别因为查不到就替换掉。

## ★★ 遗物绝不进背包

- 遗物只住 `session.outOfRun.owned`，**永不进 `inventories` / `player.slots`**。
- 对话/访客给遗物时 `kind` 写错（`relic` 写成 `item`）= 背包多一格 + 遗物列表看不到它。
- ★ `DialogueSystem.applyEffects` 有**双向防呆（不要删）**：
  `item` 分支发现 id 在 `RELIC_ITEM_CONFIG` → 自动改走遗物；
  `relic` 分支发现未登记 → 自动改走背包；两边 `console.warn`。
- ★ 老存档矫正 = `SaveSystem.sanitize()`（`load()` 里调，幂等）。
  **教训：改配置不改存档 = 用户那边看着没修好。**

## ★ 抽卡池分档（2026-09-16 用户定调）

总量化刻度 2000：弹药 2×350（35%）/ 可装备 4×225（45%）/ 遗物 5×72（18%）/
**BOSS 40 独立优先判定、不占权重**（2%）。
- 分类按 `items.json` **自动判定**：弹药 = `consumable` 且无 `deployable`；
  可装备 = `equip` 或 `deployable`（★ 无人机是 `consumable`+`deployable` → 归可装备档）。
- 5★ 遗物在档内权重均等。

## ★ 剧情文案：用户贴的文本一律逐字照抄

- 贴出的 JSON/台词 = **定稿**。不重写、不顺句、不改标点、不擅自换 id（2026-09-17 返工教训）。
- 落地后**必须机器校验**：写一次性 `.py` 脚本，与 `dialogues.json` 解析结果做
  **dict 深比较** + `difflib` 打差异；跑完就删。
- 真源 `src/config/dialogues.json`（顶层 key 是 `trees`）；节点
  `{text, next? | choices[], effects?, end?}`；
  effects 五种：`item` / `relic` / `random_relic` / `flag` / `heal`。
  ★ 要随机遗物就用 `random_relic`（按 gachaPool 权重抽），**别在对话里写死 id**。

## ★ 给玩家东西 = 唯一播报渠道

- 击杀掉落 / 采集 / 定时遗物 / **对话与访客奖励** 全走 `WorldUIManager.showPickupResult`；
  成功再配 `flashItemAndRefresh`。
- ★ 取名必须走 `WorldUIManager.displayNameOf()`（否则播报成 `获得了 black_crown`）。
- 层间契约：`DialogueSystem` **零 DOM**，只通过 `onGrant({kind,id,count,success})` 回调给模式层，
  **模式层负责上屏**。
- 遗物（`kind:'relic'`）不入背包 → **只播报，不要 `flashItemAndRefresh`**。
- 未覆盖：BaseMode 的事件对话（`base_supply` / `base_echo`）仍静默。
