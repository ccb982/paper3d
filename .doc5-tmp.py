# -*- coding: utf-8 -*-
import io

p = '移动执行重写.md'
s = io.open(p, encoding='utf-8').read()
tail = u'''**\u9a8c\u6536**\uff1a\u8fdc\u573a\u4e09\u7c7b\u56de\u6536\u663e\u8457\u4e0b\u964d\u4e14\u6218\u573a\u56de\u6536\u4e0d\u5347\uff1b\u5347\u683c\u524d\u540e\u4f4d\u7f6e/\u76ee\u6807\u8fde\u7eed\uff08\u65e0\u8df3\u53d8\uff09\uff1b
\u56db\u5173\uff08tsc / \u81ea\u68c0 290 / smoke 6/6 / arch-guard\uff09\u4e0d\u9000\u3002
'''
assert tail in s, 'tail anchor'
add = u'''
### 7.6 实施进展（2026-09-27；本会话落地清单）

**已落地（四关绿：tsc 0 / 自检 291 / check OK / smoke 6/6）**：

- **分层模块**：`systems/swarm/tiers/`——`L1.ts`（队长单点+预留名册工具）/ `L2.ts`（令执行：**走廊优先**，
  无走廊才指令直行）/ `L3.ts`（契约占位）/ `carry.ts`（零丢失换算）/ `Flux.ts`（交接编排：隐藏/收纳/取出复用，
  幂等、失败不半途、未注入=不动）；自检 [13] 10 条（含 `tierForDistance` 创建分档）。
- **懒加载（实体资源）**：`EntityBase.tierStash()/tierRestore()`（冻结不销毁）；
  `WorldSpawner.demote` = 收纳进对象仓（纹理/血条保留、停更）；`promoteAgent` = 对象仓取出复用（不重建）；
  `dropStashByUid` 真死清理；实测 70s@3×：**stash 1246 / reuse 1242**（无重建）。
- **创建分档接口**：`tierForDistance / createAt`（近 L3 / 中 L2 / 远 L1 队长单点+预留名册）；
  `SquadTable.reserve/takeReserved` + `WorldSpawner.tickReserved`（走近 ≤L2 半径物化成员；当前地图不触发）。
- **工事懒更新**：`CoverLazy`（远处只写数据；玩家/相机更近者 ≤L3 半径才物化，每拍限 4 座）；实测 6 座先记数据、走近物化 1。
- **判官口径**：只判 **L3 实体**（`agents()` uid 集合剔除池；池回收=0）；garrison/patrol(30s>4m) 已豁免，其余不豁免。
- **L3 兜底**：段进-巡逻只给 L3（池队长拦截，未知默认放行）；工兵"目标=自身"= 没活 → 段进接管；
  "真有活"强制切回施工；长停滞（≥15s）强制接管；progress 高水位 + 2% 量化（绕圈不再骗过停滞）。
- **巡逻无腿兜底**：BFS 取不到腿 → 四方向×10/6/3m 取**可达**点（`reachFrom`），全不可达才 null。
- **单一地理权威**：`nav/PassTableKeeper`——地形改动（含挖坑/子弹破坏）标脏 → 0.5s 重建可行性表 + 代次戳
  （根治"表说能走、现场是坑"死锁）；SwarmData 压回 ≤800 行。
- **凭证所有权**：`SquadNavigator` 新路线必清旧 `climbCred`；凭证在**所有 steer 出口**同门携带
  （远程选位分支此前漏带 → 远程队长带票也进不了爬坡态）；`EnemyLocomotion` 凭证在身放行危险点硬停。

**剩余形态（有末帧证据；指标轮间波动 5~11，单轮不可结论）**：

1. `走廊=0/1`：该点**全不可达** → 站住（需在生成/取位侧避免或给可达退路）；
2. `走廊 88~93 点` + 有位移无净进展：**长走廊来回震荡**（换腿/重算节律问题）；
3. `cred=有` 的爬坡接近段：本会话已补"全出口携带+放行"，需多轮采样确认收益。

（口径：不修判官、修行为；单源/所有权优先；四关照跑。）
'''
s = s.replace(tail, tail + add, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok', p)

# 蜂群重写计划 §8 增一行进展指针
p2 = '蜂群重写计划.md'
s2 = io.open(p2, encoding='utf-8', newline='').read()
anchor = u'\u8be6\u89c1\u300a\u79fb\u52a8\u6267\u884c\u91cd\u5199.md\u300b\u00a77.4\u3002\r\n'
assert anchor in s2
add2 = anchor + (u'- **\u5b9e\u65bd\u8fdb\u5c55\uff082026-09-27\uff09**\uff1aP-L2 \u5b8c\u6210\uff08\u6c60\u4ee4\u6267\u884c\u642c\u5165\u6a21\u5757 + '
                 u'\u957f\u8d70\u5eca\u4f18\u5148\uff09\uff1b\u61d2\u52a0\u8f7d\uff08\u9690\u85cf/\u6536\u7eb3/\u590d\u7528\uff0c\u5b9e\u6d4b 1246:1242\uff09\uff1b'
                 u'P-L1 \u9884\u7559\u540d\u518c\uff1b\u5de5\u4e8b\u61d2\u66f4\u65b0\uff08CoverLazy\uff09\uff1b\u53ef\u884c\u6027\u8868\u968f\u5730\u5f62\u91cd\u5efa\uff1b'
                 u'\u51ed\u8bc1\u968f\u8def\u7ebf\u3002\u8be6\u89c1\u300a\u79fb\u52a8\u6267\u884c\u91cd\u5199.md\u300b\u00a77.6\u3002\r\n')
s2 = s2.replace(anchor, add2, 1)
io.open(p2, 'w', encoding='utf-8', newline='').write(s2)
print('ok', p2)
