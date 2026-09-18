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
- ★★ **远程兵种必须同时给 `attackRadius` 与 `attackRange`**：
  `attackRadius` 只是刹车距离，真正的判定半径是 `meleeSwing.params.range`（缺省 1.8）
  ⇒ 只放大 attackRadius 会「站远处挥空」。
- 素材缺失只 warn 跳过（不阻断）；`npm run guard` 校验 file / 掉落 id / id 唯一 / public 漏登记。
- 已知引擎缺口：远程无弹道 / 飞行怪无空中层 / 海怪不下水。

### ★★ 贴片接地（新素材必查）

- FTX bbox **不保证贴脚底**（导出常留白）→ 底部锚点 ⇒ 留白 = 悬空。
- `services/fx/FootAnchor.ts` 运行时自动量（读 alpha 通道）。
- `MobDef.groundSink = ratio × scale + 手调`。
- ★★ **两条渲染路径都要补**，否则「远看接地、近看悬空」：
  1. L3：`FTXQuad.setGroundSink`
  2. L2：`SwarmBatch` 实例 y（**含血条 `offsetY`**）
- ★ 名册 `scale` = **quad 宽**；身高 = `scale × (bbox.h / bbox.w)`。
- 工具：`.workbuddy/tools/ftx_foot_measure.py`。
