# -*- coding: utf-8 -*-
import io

def load(p): return io.open(p, encoding='utf-8').read()
def save(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ============ SquadCore：驻守状态接入 ============
p = 'src/systems/swarm/squad/SquadCore.ts'
s = load(p)

old = "import { MARCH_DIST, ARRIVE_R } from './CommandLang';"
assert old in s, 'imp'
s = s.replace(old, "import { MARCH_DIST, ARRIVE_R } from './CommandLang';\nimport { HOLD_COVER, stepHoldCover, newHoldCoverState, type HoldCoverState } from './HoldCover';", 1)

old = """  /** ★ 巡逻腿查询（用户口径：查询可行移动目标点 → 长/短寻路走过去）；无可行点 → null */
  patrolNext?(id: number, x: number, z: number, ax: number, az: number, r: number, leg: number): { x: number; z: number } | null;"""
assert old in s, 'ports'
s = s.replace(old, old + """
  /** ★ 驻守（队长状态）：舰位（自主掩体循环的方向参照） */
  shipPoint?(): { x: number; z: number } | null;
  /** ★ 驻守：附近掩体查询（掩体表；毁件自然消失 → 触发后撤） */
  coversNear?(x: number, z: number, r: number): { x: number; z: number }[];""", 1)

old = """  private patrolLeg = 1;
  /** 是否已 drive 过（tick 降级兜底用） */
  private hasDrive = false;"""
assert old in s, 'fields'
s = s.replace(old, """  private patrolLeg = 1;
  /** ★ 驻守状态（自主掩体循环：藏/毁/撤/再进） */
  private hold: HoldCoverState = newHoldCoverState(0);
  /** 是否已 drive 过（tick 降级兜底用） */
  private hasDrive = false;""", 1)

old = """      this.patrolAnchor = null;
      this.patrolGoal = null;
      this.patrolLeg = 1;
    }"""
assert old in s, 'reset'
s = s.replace(old, """      this.patrolAnchor = null;
      this.patrolGoal = null;
      this.patrolLeg = 1;
      this.hold = newHoldCoverState(now);   // ★ 新令 → 驻守循环重开
    }""", 1)

old = """    } else {
      // 行军/驻守/保护/总攻：目标 = 引擎令目标（载荷）
      st.order.target = { x: engT.x, z: engT.z };
    }"""
assert old in s, 'hold branch'
s = s.replace(old, """    } else if (label === 'hold') {
      // ★★ 驻守 = 队长状态（用户定 2026-09-29）：**不钉死一点**——自主掩体循环：
      //   藏（更靠舰掩体背舰侧）→ 毁（掩体没了）→ 撤（更安全的掩体/背舰脱离）→ 过段时间再进。
      //   引擎给坐标（> 搜索半径 → 先到坐标；≤ → 就地起循环）；只给驻守（目标≈自身）→ 立起循环。
      const shipPt = port.shipPoint?.() ?? null;
      const covers = port.coversNear?.(lx, lz, HOLD_COVER.SEARCH_R) ?? [];
      if (shipPt && Math.hypot(engT.x - lx, engT.z - lz) <= HOLD_COVER.SEARCH_R) {
        const t = stepHoldCover(this.hold, now, { x: lx, z: lz }, shipPt, covers);
        st.order.target = { x: t.x, z: t.z };
      } else {
        st.order.target = { x: engT.x, z: engT.z };   // 先到引擎坐标（锚），进场再循环
      }
    } else {
      // 行军/保护/总攻：目标 = 引擎令目标（载荷）
      st.order.target = { x: engT.x, z: engT.z };
    }""", 1)
save(p, s)
print('ok core')

# ============ main.ts：接线两个端口 ============
p = 'src/main.ts'
s = load(p)
old = "        coverFrom: (tx, tz, x, z) => swarm.data.debugHasCover(tx, tz, x, z),"
assert old in s, 'main ports'
s = s.replace(old, """        // ★ 驻守（队长状态）：舰位 + 掩体表（自主掩体循环；毁件自然消失）
        shipPoint: () => ({ x: hooks.shipX, z: hooks.shipZ }),
        coversNear: (x: number, z: number, r: number) => swarm.data.holeTable.covers
          .filter((c) => Math.hypot(c.x - x, c.z - z) <= r)
          .map((c) => ({ x: c.x, z: c.z })),
        coverFrom: (tx, tz, x, z) => swarm.data.debugHasCover(tx, tz, x, z),""", 1)
save(p, s)
print('ok main')
