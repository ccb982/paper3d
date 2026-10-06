# -*- coding: utf-8 -*-
"""腰部重构接线：upperBorrow → waist；step/balance 只填意图；controller 调用 waistSystem"""
import io, re

# ══ 1. rigState：upperBorrow → waist ══
P = 'src/core/rigState.ts'
s = io.open(P, encoding='utf-8').read()
i0 = s.index('  upperBorrow = {')
i1 = s.index('  /**\n   * ★★★ **修正增量通道**')
NEW = '''  /**
   * ★★★★ **腰（脊柱）的状态** —— 2026-10-06 重构（`systems/waist.ts`）。
   *
   *   语义：`step` 与 `balance` 只往这里**填意图**（度、域口径），
   *   **唯一发布者**是 `waistSystem` —— 它把「基准 + 迈步名义 + 借力 + 平衡修正」
   *   合成后逐轴写成脊柱的**目标角**。
   *   ⇒ 脊柱永远有人写目标（`axisOwner` 不再是 `bind`），这是"折腰"的结构解。
   */
  waist = {
    /** 迈步系统的意图（度；`gain` = 它那一份借力增益，按相位 `authority` 调） */
    step: { pitch: 0, roll: 0, yaw: 0, gain: 0, authority: 0 },
    /** 平衡系统的意图（度；`gain` = 它那一份借力增益） */
    bal: { pitch: 0, roll: 0, gain: 0 },
    /** 本拍腿产生的水平 GRF（已低通）—— 借力的**唯一来源** */
    grfX: 0, grfZ: 0,
    /** 本拍借力项（度，诊断） */
    borrow: { pitch: 0, roll: 0 },
    /** 本拍**实际发布**的目标（度） */
    out: { pitch: 0, roll: 0, yaw: 0 },
    /** 增益和（诊断） */
    kSum: 0,
    /** 本拍是否发布过（0 = 消融/关闭 —— 读回端必须能区分"没发布"与"发布了 0"） */
    published: 0,
  };

'''
s = s[:i0] + NEW + s[i1:]

# 删掉 applyUpperBorrow（逻辑已移进 waist.ts）
i0 = s.index('  applyUpperBorrow(')
# 向前找注释块起点
j = s.rindex('  /**', 0, i0)
i1 = s.index('return { roll: r, pitch: p };', i0)
i1 = s.index('\n  }', i1) + 4
s = s[:j] + s[i1:]
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('rigState ok')

# ══ 2. step：不再直写脊柱，只填意图 ══
P = 'src/core/systems/step.ts'
s = io.open(P, encoding='utf-8').read()
s = s.replace("""        rs.requestAngle(jj, 2, kp.trunkPitch / nSp, 'step', '躯干矢状·目标');
        rs.requestAngle(jj, 0, (swS * kp.trunkLat) / nSp, 'step', '躯干额状·目标');""",
"""        void jj; void nSp;
        // ★★★ 2026-10-06 重构：**不再直写脊柱**（用户：「两个系统都走腰部借力」）
        //   本系统只填**意图**（名义倾角 + 自己那一份借力增益），由 `waistSystem` 统一发布。
        //   理由（`§22.12.2`）：脊柱原先的目标只存在于本分支 ⇒ 迈步一停手就 `bind`、腰自由折。
        rs.waist.step.pitch += kp.trunkPitch;
        rs.waist.step.roll += swS * kp.trunkLat;
        rs.waist.step.yaw += swS * kp.trunkYaw;
        rs.waist.step.authority = rs.authority;""", 1)
s = s.replace("""      rs.upperBorrow.kStep = rs.authority * 0.0;   // ⚠ A/B：0.3 会把「迈步系统停手」打到 1.17s""",
"""      rs.waist.step.gain = rs.authority * (p.waistBorrowK ?? 0.0);""", 1)
s = s.replace("""      rs.requestAngle(jj, 0, latT / nSp2, 'step', '躯干额状·目标');""",
"""      void jj; void nSp2;
      rs.waist.step.roll += latT;
      rs.waist.step.authority = rs.authority;""", 1)
s = s.replace("""    rs.upperBorrow.kStep = rs.authority * 0.3;""",
"""    rs.waist.step.gain = rs.authority * (p.waistBorrowK ?? 0.0);""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('step ok')

# ══ 3. balance ⑧：只填意图 ══
P = 'src/core/systems/balance.ts'
s = io.open(P, encoding='utf-8').read()
old = """    rs.upperBorrow.kBal = p.upBorrowK ?? 0;
    const slew = (p.upBorrowSlewDeg ?? 3) * D2R / 60;   // 每控制拍最多转多少（防抖）"""
assert old in s, 'bal-borrow'
i0 = s.index(old)
i1 = s.index("    // 诊断：corr 与 final 的含义已改为\"修正量\"", i0)
NEW = """    // ★★★ 2026-10-06 重构：**借力的方向与合成收归 `waistSystem`**。
    //   balance 只填两件：① 自己那一份**借力增益**；② 保护性**修正量**。
    //   （先前在这里直接算 `applyUpperBorrow` 并写脊柱 ⇒ 与 step 各按各的相位借力，
    //     且脊柱的目标只在别处存在。现在脊柱的写入只有一个出口。）
    rs.waist.bal.gain = p.upBorrowK ?? 0;
    const cRoll = noiseBlocked ? 0 : clamp(kUp2 * (zRecv - rs.com.z), leanMax);
    const cPitch = noiseBlocked ? 0 : clamp(kUp2 * (xRecv - rs.com.x), leanMax);
    rs.waist.bal.pitch = cPitch / D2R;
    rs.waist.bal.roll = cRoll / D2R;
"""
s = s[:i0] + NEW + s[i1:]

# ══ 4. balance：脊柱刚度/让位（块⑤ 早已移出）—— 确认 upBorrowK 默认仍是 0 ══
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('balance ok')

# ══ 5. controller：调用 waistSystem ══
P = 'src/core/controller.ts'
s = io.open(P, encoding='utf-8').read()
s = s.replace("""    balanceSystem(rs, this.cfg.balance, this.sim.doll);""",
"""    balanceSystem(rs, this.cfg.balance, this.sim.doll);
    // ★★★ 2026-10-06 重构：**腰的唯一发布者** —— 必须在 step/balance **之后**
    //   （它们填意图）、`arbitrate` **之前**（发布目标）。见 `systems/waist.ts`。
    waistSystem(rs, { ...this.cfg.waist, ablate: this.cfg.balance.ablate });""", 1)
s = s.replace("import { stepSystem, DEFAULT_STEP_PARAMS, type StepParams } from './systems/step';",
"""import { stepSystem, DEFAULT_STEP_PARAMS, type StepParams } from './systems/step';
import { waistSystem, DEFAULT_WAIST_PARAMS, type WaistParams } from './systems/waist';""", 1)
s = s.replace("""  step: StepParams;""", """  step: StepParams;
  waist: WaistParams;""", 1)
s = s.replace("""    step: DEFAULT_STEP_PARAMS,""", """    step: DEFAULT_STEP_PARAMS,
    waist: DEFAULT_WAIST_PARAMS,""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('controller ok')

# ══ 6. step：加 waistBorrowK 参数 ══
P = 'src/core/systems/step.ts'
s = io.open(P, encoding='utf-8').read()
s = s.replace("""export interface StepParams {""",
"""export interface StepParams {
  /**
   * ★★★ 本系统那一份**借力增益**（2026-10-06 重构，用户定调「两个系统都走腰部借力才对」）。
   *   最终倾角 = `(kStep + kBal) · GRF_水平 / (m·g)`，由 `waistSystem` 统一算。
   *   默认 0 = 未标定（先让 balance 单独借，避免两边互相抵消）。
   */
  waistBorrowK?: number;""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('step param ok')
