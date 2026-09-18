# 2026-09-18 改动清单 ·「远程敌人不攻击」修复 + 落地名册陈列

> 本文件是这次改动的**回看/回退索引**（项目无 git）。
> 时间点：2026-09-18 晚。改前快照没留（失误），需要回退请按下面"改了哪几行"手动还原。

## 一、改了什么（5 个源文件 + 1 个护栏）

### 1. `src/systems/ai/conditions.ts`

- `seePlayer` 的**行为未变**，只在头部补了一段注释，说明
  「写进 `ctx.target` 的是候选**引用**」以及"候选必须活对象"的不变量。

### 2. `src/modes/WorldMode.ts` ← **核心修复**

| 位置 | 改动 |
|---|---|
| `enemyTargetCandidates()` 上方 | 新增 `candSlots`（4 个活对象槽：祖宗/舰船/玩家/友军）+ `candOut`（复用数组） |
| `enemyTargetCandidates()` 方法体 | `out.push({ x: p.x, z: p.z })` → 改成往槽里原地写 x/z 后 `out.push(slot)` |
| `enter()` 杂兵装配 | `MobDef` 多带 `id` / `name`（从名册 spec 透传） |
| 字段区 | 新增 `private rosterOnLanding = false` + `ctx.debug.rosterOnLanding` |
| `finishDock()` | 角色就位后：`if (this.rosterOnLanding) this.spawner.spawnRosterShowcase(sp.x, sp.z)` |

**根因一句话**：`ctx.target` 只在 `patrol` 的 `seePlayer` 里被赋值；候选原来是**坐标拷贝**
⇒ 一进 chase/attack 就冻成快照。远程兵 `attackFinished → chase`（永不回 patrol）
⇒ 永久锁死旧坐标。近战兵靠"打完回 patrol"侥幸自愈。

### 3. `src/systems/spawn/WorldSpawner.ts`

- `MobDef` 新增 `id` / `name`；`spawnBoss` 的字面量补 `id:'priestess' / name:'普瑞赛斯'`。
- 新增 `static readonly SHOWCASE_RADIUS = 16`。
- 新增 `spawnRosterShowcase(x, z, radius?)`：名册每种敌人各铺一只，绕圈分角，
  每只头顶飘名字；落点不可站时按候选表换角度/半径重试；走 `spawnOne`（与正常刷怪同源）。

### 4. `src/main.ts`

- 新增 `let rosterOnLanding = true` + `?roster=0` / `?roster=1` 解析；透传进 `ctx.debug`。

### 5. `scripts/arch-guard.mjs`

- ② 段（不变量退化）新增：`enemyTargetCandidates` 必须引用 `candSlots`，
  且**不得出现 `out.push({`** → 违反即 FAIL（回归护栏，已做正/负向双测）。

## 二、怎么验收

### 游戏内

- 直接 `npm run dev` → 出击 → 航行 → **F 停靠**。
  落地后舰船周围 16m 环带会出现**每种敌人各一只**（共 11 种 / 15 只），每只头顶有名字。
- 想关掉：`?roster=0`（例如做平衡调参时）。

### 离屏（不用开游戏）

```bash
# 目录：全新的游戏/.workbuddy/tmp/2026-09-18_ai-target/
node build-probe.mjs        # 打包 ai-probe.ts
node ai-probe.mjs           # 修复前/后对照实验 + WorldMode 源码不变量断言
node check.mjs              # tsc --noEmit + arch-guard（自带 chdir 包装，因为本机 bash 坏了）
```

（`roster-probe.ts` 需要单独用 esbuild 打一次包再跑：mock deps 直跑真 spawner，11 项断言。）
★ 打包产物 `*.mjs` 可随时删，源 `.ts` 与脚本请留着。

## 三、验收数字（`ai-probe.mjs`）

场景：弩手在 (0,0)，玩家站 (0,8) 六秒后被**瞬移**到 (0,-32)。

| | 修复前（坐标拷贝） | 修复后（活对象） |
|---|---|---|
| 玩家离开后的开火次数 | **15 次** | **0 次** |
| 平均偏角（弹道 vs 指向玩家） | **145.8°** | —（不再开火） |
| 最远射击距离 | **37.6m** | — |
| 状态轨迹 | 一直停在 `attack` | `attack → chase → patrol` 正常脱战 |

（本节数字未固定随机种子，每次跑会有 ~1 次的微飘；嘲讽扫描那一节已固定种子可复现。）

## 四、★ 附带发现（**没有改**，等你定夺）

1. **L2 代理层的远程兵吃默认伤害**
   `mobAgentStats()` 只认 `meleeSwing` 行为 → 远程兵在代理层拿到缺省 `damage=8 / range=1.8`。
   实测：`war_caster` AI 声明 `damage=20`，代理层只打 **8**（弩手 8 恰好撞对，扩音术士 10→8）。
   ⇒ 同一只怪「远看 8 / 近看 20」。要对齐的话得先定"代理该不该有远程口径"（代理不会射弹道）。

2. **舰船优先于玩家**
   `enemyTargetCandidates` 里舰船排在玩家之前且**不带 radius** ⇒ 只要舰船在该敌 aggro 内，
   它就永远打船不打玩家。落地后在船边几乎不会被敌人围攻。
   这是既有设计（舰船是静止受击目标），但建议复核。

3. **近战兵现在也会真的追击了**
   修复同时消除了近战兵的"追鬼影"（它们以前只是靠回 patrol 侥幸重新索敌）。
   体感上敌人会**明显更主动**——如果你觉得变难了，这是原因，不是错觉。

4. **★★ 祖宗嘲讽：40m 是"看得见"的门槛，不是"追得到"的门槛**（⚠️ **未改，等你定夺**）
   入场与退场用的半径**不对称**：
   - `seePlayer` / `retarget`：用**候选自带的 radius**（祖宗 = 40m）→ 能看见、能切换过去；
   - `loseTarget`：**只认敌人自己的 `loseRadius`**（弩 24 / 扩音 26 / 战争 34 / 整合 12），
     完全不看 `t.radius`。
   ⇒ 祖宗落在敌人 `loseRadius` 之外时，敌人"被吸进 chase 一帧 → 立刻按超距踢回 patrol（minStay 3s）"，
   每 3 秒只推进 1 帧 chaseSpeed（≈5cm），**永远够不着**。

   实测（`ai-probe.mjs` 扫描，固定种子可复现，12 种子/档）：

   | 兵种 | loseRadius | 8m | 14m | 20m | 26m | 32m | 38m |
   |---|---|---|---|---|---|---|---|
   | 弩手 | 24 | 咬住 | 咬住 | 67% | 50% | 25% | 25% |
   | 扩音术士 | 26 | 咬住 | 咬住 | 咬住 | 58% | 25% | 25% |
   | 战争术士 | 34 | 咬住 | 咬住 | 咬住 | 咬住 | 67% | 33% |
   | 整合运动人员 | 12 | 75% | 33% | 25% | 17% | ★松口 | ★松口 |

   （单元格 = 「20s 内贴上并进 attack 的种子比例」，咬住 = 12/12。
   实测阈值比 `loseRadius` 再低 4~8m —— 因为脱战后有 3s 游走，敌人自己会飘开。）

   ⇒ 想让"嘲讽半径 40m"真的等于"会被拉走 40m"，需要**两处各 1 行**（都在 `conditions.ts`）：
   1. `retarget`：`ctx.target = { x: c.x, z: c.z }` → `ctx.target = c`
      （**顺带修掉这里残留的坐标拷贝**：虽然祖宗站桩不动、当前无感，但它是同一类快照隐患；
      而且拷贝会**丢掉 `radius`**，下面第 2 条就废了）
   2. `loseTarget`：`const radius = pnum(params,'radius',12)` → `const radius = t.radius ?? pnum(params,'radius',12)`
      （只有祖宗候选带 radius，玩家/舰船槽 `radius===undefined` → 行为不变）

   **未实施** —— 用户明确"追祖宗是我的设计"，这属于该机制的行为口径，先问再动。

## 五、已知未做

- `AISystem` 里没有"每帧重索敌"，只有 `seePlayer`（patrol）+ `retarget`（祖宗抢仇恨）。
  现有实现靠"候选活对象"绕过，够用；若以后要加"追到一半改打更高优先目标"，
  需要在 chase/attack 重新做优先级选取（注意别再引入快照）。
- 上面第 4 条的两行改动（嘲讽半径口径统一）待用户拍板。
