# WorldMode 上帝类拆解计划（2026-09-21）

> 现状：`modes/WorldMode.ts` **3642 行**（护栏上限 1200；当前按"已知债务"豁免）。
> 原则：**行为零变化**、每刀独立可编译、优先抽"纯配置/纯顺序流程"，最后才碰 `update()` 主循环。
> 参照已用模式：`modes/world/CommanderWiring.ts`、`RestoreWalls.ts`、`TargetCandidates.ts`（deps 接口 + 独立模块）。

## 已完成
- ✅ **WorldConfig**（`modes/world/WorldConfig.ts`，~180 行）：模块常量、`WorldModeEnterContext`、
  相机临时向量、`interpCamPose` 纯函数。WorldMode −117。
- ✅ **WorldPersistence**（`modes/world/WorldPersistence.ts`，~90 行）：`saveWorldStateNow / restoreWorldState`
  两个 IO 流程迁出，WorldMode 里只剩两行 delegate。−38。
- ✅ **LandingCamera**（`modes/world/LandingCamera.ts`，~140 行）：观察机位（`landingCamera.shot` 共享状态）、
  `tryStartLandingShot / updateLandingShot / playerExitPoint`；三处常量（起调高度/过渡/下机偏移）一并迁出。−102。
- 净结果：**3797 → 3540 行（−257）**；tsc / guard / build 全绿。
- ⚠ 教训：批量 python 切片删除必须用"唯一锚点 + 断言命中次数"，不能用"两个 index 之间整段删"
  （本次曾误删 600 行，靠 `git show HEAD:./src/modes/WorldMode.ts` 完整恢复——**每刀后立刻 tsc 是保险丝**）。

## 待拆（按建议顺序）

| # | 目标模块 | 内容（现 WorldMode 里的成员） | 规模 | 依赖要点 |
|---|---|---|---|---|
| 1 | `world/Docking.ts` | `requestDock / beginSettle / updateSettle / finishDock` + `landing/landingTouchdown` 状态（`landingRt`） | ~180 行 | 依赖已拆的 LandingCamera；deps：phase/session/ship/chunks/swarm/spawner/worldUI/cameraCtrl/setPhase/syncSlotAllies/showFloatingAt/camBlend |
| 2 | `world/SentinelSupport.ts` | `spawnSentinelAt / launchSentinelProjectile / updateSentinelShots / sentinelShotHitEnemy / fireSentinelShot(AtAgent) / sentinelMine / pickMinePoint / sampleMinePoint / getSentinelTexture` | ~250 行 | deps：entities/combatSystem/item drops/allySystem；纯逻辑可搬 |
| 3 | `world/ShipInterior.ts` | `enterShipInterior / exitShipInterior / tryBoardShip / openNavChoice / openReturnConfirm / applyShipInteriorEvents / reviveShip` | ~260 行 | deps：UI 管理器/scene/setPhase/session；注意 `setPhase` 副作用矩阵 |
| 4 | `world/PlayerCombat.ts` | `firePlayerBullet / cameraRay / crosshairPoint / nearestSwarmOnRay / aimDirectionFromMuzzle / aimAssist / refreshPlayerStats / updateHealProc / cycleQuickItem / buildAmmoEntries` | ~300 行 | deps：combatSystem/session/UI；与输入绑定解耦 |
| 5 | `world/DebugApi.ts` | `__ppMode` 调试访问器对象 + `updateSwarmDbg` + `?swarmdbg` 创建 | ~220 行 | 需把访问的私有字段改为 `readonly` 公开或走 getter 接口 |
| 6 | `world/SaveRestore.ts` | `saveWorldStateNow / restoreWorldState`（已依赖 `WorldStateCache`/`RestoreWalls`） | ~80 行 | 低风险 |
| 7 | `world/Deploy.ts` | `deploySurfaceAt / landingAlong / deployAimPoint / updateDeployPreview / launchCoverProjectile / spawnCoverAt` | ~180 行 | deps：DeployPreview/CoverEntity/entities |
| 8 | `update()` 主循环 | 拆成"分相位步骤表"：每段调用一个 `stepX(dt)`（仍在本类，但可继续下沉） | — | 最后做；先把 1~7 抽干净再评估 |

## 每刀验收（固定流程）
1. `npx tsc --noEmit` → 2. `npm run guard`（WorldMode 行数应单调下降）→ 3. `npm run build`；
4. 实机 30 秒冒烟（进世界 → 落地 → 开火一次），确认无 pageerror 并记录行数变化。

## 其它上帝类（后续，按体积）
- `services/map/ChunkManager.ts` 3522（可拆：网格装配 / 挖掘 / 水面 / 洞顶）
- `ui/base/GachaOverlay.ts` 1763、`vendor/player/fluid/FluidSolver.ts` 1505、
  `services/map/decor/MapEntityDecorBase.ts` 1430、`services/map/TerrainMaterial.ts` 1265。
- 蜂群侧当前最大 `SwarmCommander.ts ~1100`（<1200，暂不拆）。
