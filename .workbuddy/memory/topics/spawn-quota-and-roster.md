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
